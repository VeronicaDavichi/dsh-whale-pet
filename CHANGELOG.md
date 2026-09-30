# 更新日志

本项目遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.2.0] - 2026-09-30

### 重大变更

- 兼容 DSH `0.2.0-rc.2`，**不再支持 0.1.x**（`dsh.compatibility.dsh` 与全部 peer 依赖对齐 `^0.2.0-rc.2`）。
- 宿主能力改由官方 typert Remote 服务提供：设置读写走 `remote.settings`，会话活动走 `remote.session` + `sessions` + `uiSession`。
- 移除对旧版 `connection.api` / `connection.rpc.call` 的依赖。

### 修复

- 适配 `remote.settings.describe()` 新返回形状（`namespaces` 直接返回，无 `result.ok` 包装）。
- 适配活动感知：`uiSession.pendingInteractions` → `uiSession.sessionStatus`。
- 适配当前会话检测：`sessions.list.getSnapshot().current` 已移除，改由 `uiSession.current` 提供。
- 修正 `ctx.inject` 服务名：`remote.session` → `remote`（cordis 不支持点号命名空间解析）。

### 依赖

- `@deepseek-ai/cordis` 升至 `^4.0.4`。
- 新增 peer 依赖 `@deepseek-ai/dsh-api-remotes`、`@deepseek-ai/dsh-api-session-controller`。

## [0.1.2] - 2026-08-26

### 新增

- 新增桌宠交互特效层，补充更明显的互动反馈。
- 新增“变成球”动作及其公开资源，补充对应视频与展示素材。

### 修复

- 修复惯性甩动时与双击蓝鲸动画、挤压形变类名和悬停呼吸效果相关的交互问题。
- 调整光标倾斜跟随的触发范围，减少误触发。
- 修复“减少动态效果”场景下的特效与自主行为表现。
- 优化气泡从尾部浮现的表现，并细化甩动碰撞与回弹体验。

### 改进

- 刷新 `0.1.2` 对应的公开资产、截图与文档说明。
- 统一 README 与许可说明中的文档链接、MIT 标识和第三方资源说明。
- 统一代码缩进、Prettier 约束与注释风格。

## [0.1.1] - 2026-08-23

### 修复

- 将浏览器端 ModuleLoader 注册 ID 与 npm 包名 `@luweiyabo/dsh-whale-pet` 对齐，修复 scoped npm 安装后的客户端加载失败。
- 为自定义动作资源接口补充同源与本机访问控制。
- 统一宿主端、客户端和 bundle patch 中的插件标识。

### 改进

- 新增发布契约测试、语法检查和 npm 发布前自动校验。
- 将测试输出统一为中文。
- 完善中英文 README、安装来源冲突说明和 GitHub Raw 图片地址。
- 分离中英文第三方资源许可说明，明确代码与动画资源采用不同授权条款。

## [0.1.0] - 2026-08-23

- 首次 npm 发布。
- 提供 94 个分类动画、Agent 状态感知、点击与拖拽交互、屏幕漫游、自定义动作、触发规则和余额气泡。
- 已知问题：scoped npm 包安装后，浏览器端模块注册名不匹配；已在 `0.1.1` 修复。

[0.1.2]: https://github.com/luweiyabo/dsh-whale-pet/releases/tag/v0.1.2
[0.1.1]: https://github.com/luweiyabo/dsh-whale-pet/releases/tag/v0.1.1
[0.1.0]: https://www.npmjs.com/package/@luweiyabo/dsh-whale-pet/v/0.1.0
