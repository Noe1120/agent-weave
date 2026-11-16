# W18 主人连接诊断与重新邀请 Implementation Plan

> **For agentic workers:** 使用 executing-plans / test-driven-development；用户已要求无决策点自动推进，当前D盘checkout独立分支，不启动子模型。作者自检，HANDOFF.md冻结，README实时更新。

**Goal:** 主人明确知道登记为什么失效，并能通过一次原子请求撤销旧登记、为当前成员版本与配置重新发出邀请。
**Architecture:** 复用ConnectionRegistry及resources；抽取事务内邀请构造器，新增reinvite方法和主人HTTP路由。登记只读投影追加reason/replaces_connection_id/replaced_by_connection_id，runtime_state仍not_connected。不会调用W17的观测器或签发grant。
**Tech Stack:** TypeScript/Node24/SQLite schema4；无迁移、WPF不变。
**Spec:** 02/03本阶段增量、W16登记、W17关闭标准。不是实时原客户端连接状态。

## 决定与界限

- 选择原子替换而非客户端先revoke再invite，避免第二步失败留下半成品；不引入万能renew或自动重连。
- `POST /v1/console/connections/reinvite`，Cookie+CSRF+Origin，严格字段：project_id/connection_id/expected_revision/expected_member_revision/configuration_fingerprint/action_id。member/target只能由旧登记和当前成员事实确定。
- 事务内核对主人、项目、成员active与版本、旧登记CAS，再撤销旧登记并创建新pending邀请。新旧ID不同、双向关联，只允许一个替代。scope和旧grant不复制。失败全部回滚。
- 同action同载荷仅在新邀请仍pending有效时返回同邀请；新邀请被消费/过期/撤销/失效后拒绝，不偷偷再签发。不同action争抢旧登记冲突。action命名空间与普通invite共享，禁止碰撞绕过。
- 可替换pending/registered/expired/invalidated/revoked登记，但inactive成员仍拒绝；成员更新需提供最新revision。已有另一有效登记时拒绝，不能接管它。
- reason为固定枚举：INVITATION_PENDING / REGISTERED_NOT_CONNECTED / INVITATION_EXPIRED / CREDENTIAL_EXPIRED / MEMBER_UNAVAILABLE / MEMBER_CHANGED / SIGNING_KEY_CHANGED / REVOKED / REPLACED。不返回密钥/hash/native会话/路径。读取零DB写入，不调用观测器、不把未知当停止。
- 新邀请兑换只得到登记凭据。W17旧task token立即被旧登记revoked拒绝；新task授权仍需可信装配和独立授权。真实controller健康投影及自动派工仍不在此阶段。

## 实施清单

- [x] 基线verify；tests/connection-http.test.ts新增断言：`assert.equal(reinvite.status, 200)`（当前404红灯）；登记reason字段（当前undefined红灯）。
- [x] packages/service/src/connection-registry.ts实现原因投影及事务内invite复用；workspace-http.ts增加reinvite严格主人路由。
- [x] 测试原子失败、重试/并发、旧凭据、新成员revision、过期/键变化、恢复重开、无token泄漏；W17专项证明旧task权限失效。
- [x] 编译HTTP走查重新邀请→旧task拒绝→新兑换仍无任务权限；全量verify、native、旧包、P0/设计，README与证据更新、HANDOFF摘要不变。
- [x] 阶段验证已完成582/582；发布需暂存扫描、正常提交/同步主分支/推送核验（结果见Git）。下一入口：真实控制器只读观测桥的合成集成；实际客户端/模型仍须具体授权，管家不构建。
