# W17 连接绑定与单任务只读授权 Implementation Plan

> **For agentic workers:** 使用 executing-plans / test-driven-development，在 D 盘当前 checkout 单独分支内实施；按用户持续指令自主推进，作者自检，不默认启动子模型。HANDOFF.md 冻结，根 README 实时更新。

**Goal:** 将 W16 登记与受信进程内会话观测绑定，签发仅能读取一个合成任务及其授权依赖的短期 execution grant；每次使用都重新检查连接和观测，失效后不可复活。
**Architecture:** 延续已有 trusted provisioning：调用方显式准备 policy/run/resource ACL 与 Grant 模板，本模块不能扩大这些权限。ConnectionTaskAccess 消费连接凭据、模板、task_id 和由可信装配注入的只读 observation 函数。中央 authorizeGrant 增加可选连接约束；旧 grant 不变，带约束的 grant 在缺少本进程验证器时一律拒绝。无需迁移或 HTTP 管理/派工接口。
**Tech Stack:** Node24 / TypeScript / SQLite schema4，WPF 不改。
**Spec:** 02/03 W17 增量、09执行授权交集、W16关闭标准。

## 设计与取舍

不把自报 fingerprint 当原客户端证明；不增加 HTTP 自证/签发入口，也不直接将 owner/connection token 当任务 token。相比现在就接真实 controller/模型，先实现可验证的授权交集；相比建立独立身份平台，复用既有 resources/grants/policies/runs。

- 仅可信装配调用 `ConnectionTaskAccess(workspace, observe).issue(connectionToken, connectionId, grant, taskId)`。观测来自服务装配，不接受 HTTP 参数；本阶段只允许 `synthetic_only` 数据与 `owned_process` 会话模式，不宣称实际原客户端认证。
- observation 明确 connection/project/member/target/configuration/run/epoch/native_binding、active状态、observed_at；不发送 prompt 或心跳消息。观测最多30秒旧，未来时间拒绝，grant最多5分钟且不超过连接到期。
- grant actions 必须恰为 read_resource；policy/run/ACL 仍独立检查。模板的 resource_ids 必须恰好等于 task 引用闭包，且闭包只有一个 task。权限不足、额外资源、第二任务、非活动 run 均拒绝，不自动添加 ACL。
- 身份、配置、连接版本、run/epoch/native绑定固定；每次 auth 读取已有观测和登记。一次发现丢失/过期/变更后本进程门永久失效，不自动重连恢复。TTL/成员/签名键/撤销沿用 W16。
- 只在内存保存本次返回 token 以支持同 grant 同参数重取；同 ID 不同参数冲突。DB 仍只存摘要，不把 token 写入通用命令回执。重开 Store / 服务重启无验证器，旧 token 拒绝；需新的显式授权，不重取旧 token。
- 不修改 task/run状态、不释放锁、不停止原进程。授权失效不是进程停止证明。source/observation 的合成断言不是实际数据分类、原客户端身份或外发资格。

## 任务1：授权门与最小签发

Files: tests/connection-task-access.test.ts；packages/service/src/{connection-task-access,connection-grant-guard,connection-registry,auth,domain}.ts。
- [x] 基线 npm run verify；红灯先验证缺失连接约束仍可读取的问题：`assert.throws(() => authenticate(store, token, project, 'read_resource', now()), /GRANT_REVOKED/)`。
- [x] 红灯：邀请/兑换→可信观测→issue→真实 CoreService.readResource 返回 draft；额外资源/写权限拒绝。issue 未存在时先保留失败日志。
- [x] 实现默认拒绝 gate、registry 非秘密受信快照、模板校验与原子 issue；不改迁移。
- [x] 扩展反例并红绿验证：撤销、到期、成员变化、签名键变化、观测失联/陈旧/未来/身份漂移、run未知/epoch变化、policy/ACL撤销、重开、重试、token隔离、读取零写入。

## 任务2：编译用户顺序与交付

Files: tests/connection-task-walkthrough.mjs；evidence/connection-task-access/COMPLETION.md；README.md；plan源章与派生文件。
- [x] 编译实际 HTTP 用户顺序：配对/建项目/成员→邀请/兑换→可信合成装配→task GET→100次只读→主人撤销→同token拒绝；不能自证/签发HTTP；没有模型/原客户端。
- [x] npm run verify、test:native、test:native:package；设计刷新/只读校验及P0。失败先定位，保留失败记录，不跳过。
- [x] 作者自检、README结果、HANDOFF SHA256不变；全量558/558、专项41/41、原生14+1、旧包989、P0 13/13、设计56文件通过。提交与发布需完成暂存扫描并核对远端，最终结果见根README/Git。

## 关闭与下一阶段

本阶段只关闭上述合成只读授权内核，不称完整生产连接管理。下一阶段是连接状态/失败原因的主人只读投影及显式重新授权流程，随后再对真实控制器做独立集成与获准后的同配置验收。Windows隔离、DSH模型任务、真实联合撤权、附着会话、原生点击、生产灾备/签名升级及250项产品验收仍未完成；管家不构建。
