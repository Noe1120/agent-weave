# W18 主人登记诊断与重新邀请

日期2026-11-16；D盘主工作区；基线27ac2d1。

新增主人POST /v1/console/connections/reinvite，Cookie/CSRF/Origin保护，旧登记与当前成员双revision CAS。单事务撤销旧登记并创建新pending邀请，双向替代关系。同动作同载荷仅重取有效pending邀请，不同动作争抢拒绝；已消费/过期不偷偷签发新凭据。旧连接token/邀请及W17任务grant均拒绝；新登记不继承任务权限。

GET登记列表追加固定reason及替代关系，仍not_connected/UNVERIFIED，不查询模型/原客户端、无DB写入。不返回凭据/hash/原生会话。签名键变化、成员更新/停用、过期、撤销有明确原因。

## 验证

- 基线558/558，最终npm run verify 582/582（0失败/0跳过）。新增24项；连接HTTP36项+任务授权42项共78项。
- 红灯：新路由404及reason缺失；实现后通过，原始日志.runtime/w18/red.log。真实SQLite触发器注入INSERT失败，原异常保持可见，旧登记回滚且仍可读；移除故障后同请求成功。
- 并发两次替代仅一个成功；旧CAS/成员CAS、跨项目、额外字段、CSRF/Origin/Bearer混合、动作碰撞均拒绝。关闭重开数据库后可重取，过期后拒绝；其他活动登记不能被替代请求接管。
- 编译JS+真实回环HTTP：配对/建项目成员/邀请兑换/合成授权/100次连接与任务读取（0写入）/重新邀请重试/新兑换仍无task权限/旧token与旧task拒绝。node tests/connection-reinvite-walkthrough.mjs 可复现。
- 原生14/14加1 WPF静态、旧包989文件、P0文档13项通过；设计校验单独运行。不是原生点击、真实厂商或OS隔离验收。

作者自检，非独立审核。无新增模型、原客户端、私有历史、系统策略操作；schema4/001–004与旧包未改。HANDOFF.md未编辑，SHA256仍9E057D55395FAABD77A175B64042F18DF24A7AC53334C10A0A370D3F06DF0586。README实时更新，原始日志/数据库不上传。

下一入口：控制器只读观测桥的合成集成。仍不开放真实写入/私密执行，Windows隔离暂缓，管家不构建，250AT/CA不升级。
