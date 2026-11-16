# W19 控制器只读观测桥 Implementation Plan

> **For agentic workers:** 使用executing-plans/TDD；用户要求自动推进，无额外子模型，D盘当前分支，HANDOFF冻结。

**Goal:** 用现有CodexRuntimeController的实际所属句柄状态为W17提供只读观测，而非手写active对象。
**Architecture:** 新增可信进程内`connectionObserver(token,project,runtimeId,connectionId)`工厂，固定控制grant、instance及native thread摘要；返回与W17兼容的回调。每次校验adapter_read/grant/policy/run/resource与controller.read的owner/句柄状态，再投影。不公开HTTP，不创建线程或turn。
**Tech Stack:** Node24/TypeScript/SQLite schema4，既有Codex协议合成子进程。
**Spec:** 03本阶段增量、W17只读约束、W18下一入口。

## 边界

- 仅development_fixture来源可使用；真实official_codex要另经外发/数据分类/费用/联合撤权批准和集成，不因该桥升级。
- 工厂建立前必须已有ready运行和非空thread，run active。回调固定instance/thread，配置变化、句柄死亡、controller重建、run unknown/epoch变化/控制grant撤销均不能投影active。
- 工厂不保存token到DB/日志；连接ID在可信装配提供，W17再与登记身份/配置求交。注册状态查询不调用该工厂；没有HTTP自证入口。
- native_binding仍是平台run绑定；另固定原生thread摘要作为该回调的稳定会话证据，不把平台ID冒充原生thread。不暴露原始thread或消息。
- 回调只读控制器现有状态，以读取时刻作为检查时刻；不发心跳、prompt、resume、cancel。unknown不是停止，不改task/run或锁。
- 控制grant不能自身携带connection_constraint，避免授权递归/用任务token提升为controller权限。

## 实施与验收

- [x] tests/codex-runtime.test.ts先写`assert.equal(typeof c.connectionObserver,'function')`红灯，再验证已启动合成进程→工厂→100次观测零写入/零turn。
- [x] packages/service/src/codex-runtime.ts最小工厂；测试wrong connection、unknown、关闭、撤权、thread/instance/config变化、新controller、official_codex拒绝。
- [x] 真实CoreService+ConnectionTaskAccess贯通：合成controller ready→主人登记→只读task grant→读取→controller关闭→读取拒绝，任务/run不变。
- [x] 全量595/595、原生14+1/旧包989、P0 13项/设计58文件与编译走查通过；README/证据已更新，HANDOFF摘要不变。发布执行暂存扫描与普通推送，事实见Git。

下一门槛：同一固定真实配置上联合验收controller观测/邀请/W17 task_get/撤权退出，必须单独确认原客户端启动、凭据、数据外发、费用预算。DSH生产仍initialize-only，Claude长期controller未构建；不能把Codex合成桥当三客户端通用完成。隔离和管家仍暂停。
