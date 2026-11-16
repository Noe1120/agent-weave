# W16 成员连接登记与凭据生命周期 Implementation Plan

> **For agentic workers:** 使用 executing-plans + test-driven-development，当前 D 盘工作区单独分支；作者自检，不新增子模型。

**Goal:** 完成主人邀请 → 单次兑换 → 连接登记 → 只读查询 → 过期/撤销闭环。连接登记不是原客户端在线证明。
**Architecture:** 复用 OwnerAuth、workspace_members 和 resources；无新表/迁移。登记凭据只允许查询自身登记状态，绝不能用作 execution_grant、任务读取或 runtime_control。固定 HMAC 域分离生成可安全重取的邀请/连接凭据，数据库仅存摘要；恢复重建签名键后旧凭据无效。
**Tech Stack:** Node 24 / TypeScript / SQLite，schema4，WPF 不变。
**Spec:** 02 身份/邀请/授权分离、03 原客户端边界、09 §3、W15、AGENTS.md；用户确认隔离暂缓后继续连接管理。

## 设计取舍及约束

不直接把 owner 凭据或长期万能 grant 发给模型，也不将“连接成功”混同原客户端已在线。选择小型独立 ConnectionRegistry，保持普通 workspace_commands 回执不存秘密；不增加独立账号系统。

- 主人沿用 Cookie+CSRF。`POST /v1/console/connections/invite` 字段严格为 project_id/member_id/action_id/expected_member_revision/configuration_fingerprint；服务由成员记录确定 target。邀请有效 10 分钟，连接凭据从签发时起最多 8 小时，不无限续期。
- 同 action+同参数返回同邀请（仅尚未消费且有效）；不同参数 409。每成员最多一个有效 pending/registered 登记；显式撤销或过期后新邀请。不读取/复制 provider 密钥。
- `POST /v1/connections/redeem` 使用 invitation Bearer，body 仅 connection_id/action_id/configuration_fingerprint；第一次兑换在事务内写 registered。同兑换 action 可重取原连接凭据；其他 action 拒绝。错误 fingerprint 不消费邀请。
- `GET /v1/connections/:id` 使用连接 Bearer，只读自身元数据；没有任务/消息/原生历史数据。没有会话、运行授权或实际在线证明，qualification=UNVERIFIED、runtime_state=not_connected。
- `GET /v1/console/projects/:project/connections` 主人查询非秘密列表；`POST /v1/console/connections/revoke` 使用 project_id/connection_id/action_id/expected_revision，CAS+幂等，撤销只是登记凭据失效，不杀客户端/解锁。
- 每次访问复查成员项目、active 和原 member revision；成员修改/停用后即失效，重新激活也不复活旧登记。配置变更需撤销并发新邀请，不由 connector 自行修改可信配置。
- 记录 kind=connection_registration，ACL 空、无 execution grant，禁止从 core resource API 获取。客户端声明的 fingerprint 不作为身份/二进制证明。
- 状态 expired/invalidated 是只读推导；读取不写 DB。注册键摘要与当前签名键核对，恢复/键轮换后登记失效。旧恢复工具清除 console_secrets 不会遗留可用连接凭据。
- 列表不暴露 token、token hash 或 secret-key 摘要。HTTP no-store、Host/Origin/cookie/方法/字段限制沿用现有传输。
- 暂不实现真实客户端启动、原生 session 绑定、执行 grant 签发、OS 凭据库、自动连接/模型调用；这只是产品级管理的登记子阶段。

## 实施与验收步骤

### 1. 基线与 HTTP 红灯
Files: tests/connection-http.test.ts；plan/02、03。
- [x] `npm run verify` 基线 504/504。
- [x] 新建真实回环服务测试，owner pair/create_project/add_member 后 POST invite，断言 status=200；旧实现为404，红灯日志保留。
- [x] 覆盖未授权/CSRF/跨项目/旧member revision/重复 action/额外字段/邀请和执行凭据不可互换。

### 2. 最小登记实现
Files: packages/service/src/connection-registry.ts、workspace-http.ts、http.ts。
Interfaces: ConnectionRegistry(workspace).invite(owner,csrf,body)、revoke(owner,csrf,body)、list(owner,project)、redeem(invitation,body)、read(credential,id)。
- [x] 在 resources 保存 owner 固定的 member/target/revision/fingerprint 与到期时间；凭据 HMAC 前缀分离且仅保存 digest。
- [x] `store.transaction` 内检查并消费邀请；读取从成员事实与签名键判断状态；不改 workspace 成员在线计数。
- [x] HTTP 正/反例、同凭据并发兑换、数据库重开后同请求重取、撤权/过期/成员变化/恢复键变化立即拒绝。共13项。

### 3. 编译走查与交付
- [x] 编译后真实 HTTP 路径：邀请→兑换→100次只读→撤销→旧凭据拒绝；0真实客户端/模型调用。
- [x] 全量 verify 517/517、native 14+1、旧包989文件通过；README/交接/HANDOFF 更新，原始日志本地，审核摘要白名单上传；设计/P0另由交付命令核验。
- [ ] 暂存扫描、正常提交、同步主分支与远端，不丢失用户修改。

## 关闭标准与下一入口

上述登记/凭据闭环和反例通过才关闭本子阶段。不称完整连接管理或真实客户端资格完成。下一步是受信连接器身份/原生会话绑定及按任务签发最小 execution_grant；开发先合成验证，真实客户端/凭据/模型需具体授权，隔离未知时禁实际写入/私密执行。管家不构建。
