// ============================================================================
// dsh-whale-pet 宿主能力适配层（0.2.0-rc.2）
// ============================================================================
// 0.2.0-rc.2 起旧版 connection.api 已移除，宿主能力改由官方 typert Remote
// 服务提供。本文件只保留「设置读写」这一块必需的宿主能力；远程会话活动感知
// 依赖宿主侧 sessions/uiSession，客户端拿不到，已按官方边界移除。
//
// remote.settings 是 typert 子服务：RemoteNamespaceService 以
// "remote.settings"（remoteServiceKey = `remote.${namespace}`）为服务名注册，
// 可用 ctx.get('remote.settings') 软获取；它要等远端连接建立后才就绪，快速
// 重载/页面刷新时可能晚于 apply。因此这里接收一个惰性取值函数 getSettings，
// 真正读写时才轮询等它就绪。
// ============================================================================

// 关键结论：绝不把 remote.settings / remote.session 写进插件 inject——子服务
// 就绪晚于 apply，注入会让 fiber 等待，轻则延迟挂载、重则 renderer boot failed
// （还连累其他窗口的浮层布局）。软获取 + 惰性轮询才是 0.2.0 的正确姿势。
function settingsOf(getSettings) {
    try {
        const s = getSettings();
        return s && typeof s.describe === 'function' && typeof s.update === 'function' ? s : null;
    } catch {
        return null;
    }
}

function waitForSettings(getSettings, timeoutMs) {
    const s = settingsOf(getSettings);
    if (s) return Promise.resolve(s);
    return new Promise((resolve) => {
        const started = Date.now();
        const poll = () => {
            const svc = settingsOf(getSettings);
            if (svc) return resolve(svc);
            if (Date.now() - started >= timeoutMs) return resolve(null);
            setTimeout(poll, 250);
        };
        poll();
    });
}

// 把 typert Remote 的 settings 命名空间适配成桌宠内部 api。
export function resolveHostApi(services = {}) {
    const { getSettings } = services;
    if (typeof getSettings !== 'function') return undefined;

    // settings 适配：typert Remote direct 方法返回 { ok, value, error } 信封；
    // settings.describe() → { ok:true, value:{writable,hasDocument,namespaces} }。
    // 内部契约保持旧形状 { result:{ok,value:{namespaces}} }，供 createConfigStore 复用。
    return {
        settings: {
            describe: (_args = {}, _signal) =>
                waitForSettings(getSettings, 15000).then((svc) => {
                    if (!svc) return { result: { ok: false, value: null } };
                    return svc.describe().then((r) => ({
                        result: {
                            ok: !!(r && r.ok),
                            value: r && r.ok && r.value ? { namespaces: r.value.namespaces } : null,
                        },
                    }));
                }),
            update: (args, _signal) =>
                waitForSettings(getSettings, 15000).then((svc) => {
                    if (!svc) throw new Error('Host settings not ready');
                    // typert direct 是严格元数校验：host 侧签名
                    // update(ns, patch, expectedRevision) 必须显式给足 3 个实参，
                    // 少一个就抛 "expected 3 argument(s), got 2"（踩过）。
                    // expectedRevision = undefined 表示无条件写入（跳过乐观锁），
                    // 与设置表单「最后一次写入生效」的语义一致。
                    return svc.update(args.ns, args.patch, args.expectedRevision).then((r) => {
                        if (!r || r.ok !== true) {
                            throw new Error((r && r.error && r.error.message) || 'Host settings update failed');
                        }
                        return r.value;
                    });
                }),
        },
    };
}

// control 流由 sessions 服务维护。仅为当前/正在运行的会话开只读 follow，
// 不下载全部历史，不激活 Agent，也不参与审批/问答的回答链。
export function subscribeSessionActivity({ sessions, remote, uiSession }, emit, options = {}) {
    const watches = new Map();
    let disposed = false;
    // 0.2.0-rc.2：uiSession.pendingInteractions 已改为 uiSession.sessionStatus
    // （store，快照为 Map<sessionId,{running,pendingInteraction,completionUnread}>）。
    const status = uiSession?.sessionStatus;
    const send = (frame) => {
        if (!disposed) emit(frame);
    };
    const interaction = (id, snapshot = true) => {
        if (!status) return;
        const watch = watches.get(id);
        const current = status.getSnapshot().get(id)?.pendingInteraction;
        if (!snapshot && watch.pending === current?.key) return;
        const kind = (current?.kind || watch.pendingKind) === 'approval' ? 'approval' : 'question';
        watch.pending = current?.key;
        watch.pendingKind = current?.kind;
        send({ type: kind + (current ? '/requested' : '/resolved'), sessionId: id, snapshot });
    };
    const stopWatch = (id, watch) => {
        watches.delete(id);
        watch.controller?.abort();
        watch.unsubscribe?.();
        clearTimeout(watch.timer);
        clearTimeout(watch.retireTimer);
        send({ type: 'activity/reset', sessionId: id });
    };
    const open = async (id, watch) => {
        const controller = new AbortController();
        watch.controller = controller;
        try {
            const child = sessions.subagentAddress?.(id);
            const address = child ? { kind: 'subagent', ...child } : { kind: 'session', sessionId: id };
            for await (const frame of remote.session.follow({ address, maxMessages: 1 }, controller.signal)) {
                if (disposed || controller.signal.aborted || watches.get(id) !== watch) break;
                if (frame.type === 'snapshot') {
                    watch.cursor = frame.cursor;
                    send({ type: 'activity/reset', sessionId: id });
                    // 只恢复当前未结束回合的状态；历史不触发规则、用量查询或错误气泡。
                    const records = frame.records || [];
                    let start = -1;
                    for (let i = 0; i < records.length; i++) {
                        if (records[i].event?.type === 'turn/start') start = i;
                        if (records[i].event?.type === 'turn/end') start = -1;
                    }
                    if (start >= 0 && watch.running)
                        for (const record of records.slice(start)) {
                            if (record.type === 'event')
                                send({
                                    type: 'session/event',
                                    sessionId: id,
                                    event: record.event,
                                    snapshot: true,
                                });
                        }
                    const model = frame.projections?.values?.modelSelection;
                    if (model?.next || model?.lastUsed)
                        send({
                            type: 'session/event',
                            sessionId: id,
                            event: { type: 'model/selection', data: model.next || model.lastUsed },
                            snapshot: true,
                        });
                    send({
                        type: 'host/session-status',
                        sessionId: id,
                        running: watch.running,
                        snapshot: true,
                    });
                    interaction(id);
                } else if (frame.type === 'event' && frame.event.seq > watch.cursor) {
                    watch.cursor = frame.event.seq;
                    send({ type: 'session/event', sessionId: id, event: frame.event });
                    const alias = {
                        'approval/asked': 'approval/requested',
                        'approval/decided': 'approval/resolved',
                    }[frame.event.type];
                    if (alias) send({ type: alias, sessionId: id });
                    if (frame.event.type === 'turn/end' && frame.event.data?.reason?.kind === 'error')
                        send({ type: 'host/agent-error', sessionId: id });
                }
            }
        } catch {
            // Remote 负责鉴权及宿主代际；本订阅在流结束后重新获取权威快照。
        }
        if (!disposed && !controller.signal.aborted && watches.get(id) === watch) {
            send({ type: 'activity/reset', sessionId: id });
            watch.timer = setTimeout(() => open(id, watch), options.reconnectMs ?? 2000);
        }
    };
    const reconcile = () => {
        const list = sessions.list.getSnapshot();
        const ids = new Set();
        // 0.2.0-rc.2：list 快照不再含 current；当前会话改由 uiSession.current 提供。
        const currentId = uiSession?.current?.getSnapshot?.()?.key;
        if (currentId) ids.add(currentId);
        if (options.scope !== 'current')
            for (const id of list.ids || []) {
                if (list.byId[id]?.running) ids.add(id);
            }
        for (const [id, watch] of watches)
            if (!ids.has(id)) {
                // control 的 idle 可能先于 follow 的 turn/end 到达，留出收尾窗口。
                if (options.scope === 'current' || !list.byId[id]) stopWatch(id, watch);
                else if (!watch.retireTimer) watch.retireTimer = setTimeout(() => stopWatch(id, watch), 4000);
            }
        for (const id of ids) {
            let watch = watches.get(id);
            if (!watch) {
                watch = { cursor: -1, running: undefined };
                watches.set(id, watch);
                const session = sessions.binding?.(id)?.session;
                if (session?.subscribe) {
                    // 0.2.0-rc.2：Session 快照的 queue 字段已并入 pendingSubmissions，
                    // 其中 placement === 'queued' 表示排队中的用户消息。
                    let queueKey;
                    const update = () => {
                        const snapshot = session.getSnapshot();
                        const pending = Array.isArray(snapshot.pendingSubmissions)
                            ? snapshot.pendingSubmissions
                            : [];
                        const queued = pending.filter((echo) => echo && echo.placement === 'queued');
                        const key = queued.map((echo) => echo.requestId).join(',');
                        if (key !== queueKey) {
                            queueKey = key;
                            send({
                                type: 'session/queue',
                                sessionId: id,
                                items: queued.length ? queued : [],
                            });
                        }
                    };
                    watch.unsubscribe = session.subscribe(update);
                    update();
                }
                void open(id, watch);
                interaction(id);
            }
            clearTimeout(watch.retireTimer);
            watch.retireTimer = null;
            const running = !!list.byId[id]?.running;
            if (watch.running !== running) {
                watch.running = running;
                send({ type: 'host/session-status', sessionId: id, running });
            }
        }
    };
    const unsubscribe = sessions.list.subscribe(reconcile);
    const unsubscribeStatus = status?.subscribe(() => {
        for (const id of watches.keys()) interaction(id, false);
    });
    reconcile();
    return () => {
        disposed = true;
        unsubscribe();
        unsubscribeStatus?.();
        for (const [id, watch] of watches) stopWatch(id, watch);
    };
}
