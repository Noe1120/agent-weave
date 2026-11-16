# W15 受保护运行管理 Implementation Plan

> **For agentic workers:** 使用 superpowers:executing-plans 与 test-driven-development；本轮用户授权自主推进，作者自检，不新增子模型。

**Goal:** 将已有 DSH/Codex 控制器接入受保护的后端查询与生命周期通路，不扩大原客户端、模型或系统操作授权。
**Architecture:** 复用 resources/grant/policy/run、现有控制器与回环 HTTP。默认无 launcher；可信装配显式注入固定控制器。查询永不启动/恢复/关闭进程。HTTP 写操作另需 runtime_control 权限，不能把 agent 的 adapter_configure 自动升级为远程启动许可。
**Tech Stack:** Node 24、TypeScript、SQLite；无新依赖、无迁移、无 UI 重设计。
**Spec:** 02 INV-06/12/16、03 原客户端边界、09 §3/4、12 §2；用户已批准管家前持续实施。

## 设计与取舍

选用小型 RuntimeGateway，而非把 controller 直接挂到所有 agent 请求，也不新增通用 prompt API。已有控制器仍掌握 CAS、幂等、所属进程和撤权；网关只负责权限边界、选择固定控制器和安全投影。Claude MCP 是另一种连接模型，不伪装成可启动的 Codex 控制器。

- `GET /v1/projects/:project/runtimes/:runtime`：adapter_read；返回成员/run 关联、受限状态、已记录 task/thread 摘要及明确资格。无控制器的活动记录为 unknown，不把 SQLite 的 ready 当在线。
- `POST /v1/runtimes/{codex|deepseek_harness}/{start|close}`：先 runtime_control，再由控制器校验 adapter_configure、scope、grant、CAS 和 action_id。请求字段沿用控制器严格白名单；不接受程序路径、凭据、prompt 或 attached_session。
- 默认 createServer 不安装控制器；未配置时写入明确拒绝。源库 schema4、core/1.0、旧便携包不变。
- 响应不包含原生 thread 明文、provider/bridge token、原始模型消息、绝对路径或用户历史。闭合/退出观察不升级 OS 撤写资格。
- 新真实启动、付费 turn、凭据复用、系统身份/ACL/网络和窗口操作仍分别需要具体授权。本轮测试只启动仓库自有合成夹具。

## 执行清单

### 1. 同步与基线
- [x] 当前 linked worktree 从 4aef527 快进到 d62d940，远端 main 同为 d62d940；不改 DSH 主工作区。
- [x] 全量 verify 基线 497/497，0 失败/跳过。

### 2. 网关与 HTTP
**Files:** packages/service/src/runtime-gateway.ts、http.ts、domain.ts；tests/runtime-http.test.ts。
**Interfaces:** RuntimeGateway(store, controllers, now).read(token,project,id)、command(token,target,operation,body)；createServer 第三个可选参数注入网关。
- [x] RED：HTTP fixture 中调用 GET，期望 200 且 state=unknown；旧路由 404；红灯日志保留在 .runtime/w15/red-read.log。
- [x] RED/GREEN：撤权/过期/跨项目/依赖 ACL 拒绝；无 runtime_control 拒绝；原生敏感字段不出响应；100 次读 SQL total_changes 不变。
- [x] RED/GREEN：受信 Codex 合成进程 start → ready → 只读进度 → CAS close → closed；重复 action 不再启动；错误 revision=409；未知操作、附着、动态程序/凭据参数拒绝。控制红灯保留在 .runtime/w15/red-control.log。
- [x] RED/GREEN：无控制器的活动记录 unknown，closed 只表示已记录退出，不升级 OS 隔离；不能向错误 target 的控制器读/关记录。另验证 DSH initialize-only HTTP 生命周期。

### 3. 验证与交付
- [x] 全量 verify 504/504、原生 14 C# + 1 静态、旧包 989 文件通过；编译后 HTTP 走查的 100 次读取零写入，撤权后拒读且所属 fixture 正常退出。设计/P0 结果见交付记录。
- [x] 更新源章及交接、生成合订/摘要；暂存扫描、正常提交和授权推送。实际提交 0f2134f，已核对远端 main；本项于会话交接补正勾选。

## 后续依赖 / 需决策项

最新执行安排：用户因当前环境条件提出暂缓隔离阶段，先继续不依赖它的产品级连接管理等后端任务。隔离仍为实际写入/私密执行门槛，不能被跳过；新阶段尚未制定正式计划或编码。续建见根 [HANDOFF.md](../HANDOFF.md)。

W15 不是完整产品连接管理：主人邀请/长期凭据与 WPF 控制仍待接入；DSH 的真实模型任务、Claude 长期原生会话控制、Codex 同配置联合撤权仍未验。Win-SID-Broker-1 必须获准在指定测试环境创建隔离身份、ACL/网络限制后才可验，不能用 Job 或新 home 代替。离机灾备需要用户指定可信介质/目的地及密钥保管；正式签名需真实发布者证书。管家不构建。

下一决策的具体范围与回滚：[Windows 隔离测试环境](WINDOWS-ISOLATION-DECISION.md)。本阶段审查为作者自检，无独立审核。实现中 Node strip-only 拒绝构造器参数属性，已改为显式字段；测试 fetch 的可选 body 违反 exactOptionalPropertyTypes，已改为仅在存在时添加字段。未改变检查器或放宽类型设置。
