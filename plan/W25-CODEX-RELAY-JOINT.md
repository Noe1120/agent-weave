# W25 Codex relay同配置联合验收

用户于2026-11-17同意：沿用既有CC Switch路由，必要provider配置与凭据临时复用到新隔离home；一个新实例、一次合成task_get turn，随后撤权、严格退出、清理。30,000 tokens软停止，金额UNKNOWN，上报滞后可超出，不付费重试。无历史读取、不改全局配置/原实例/路由。管家不构建、Windows隔离暂缓、HANDOFF冻结。

最小实现复用W20联合业务验收，增加显式--relay模式及仅验收装配helper：W24 prepareClient→固定Codex relay_binding；装配在controller.close请求时先桥排空/EOF/exit0→relay真实OS退出→原生宿主关闭。失败保持失败并只清理自有句柄。生产控制器/默认注册不改，旧W20行为及历史FAILED保留。

先写脚本级回归，用本项目协议夹具＋实际桥/relay/HTTP/CoreService验证邀请、兑换、单任务grant、一次读取、只读进度、连接撤销拒绝、控制grant撤销自动收尾及清理。合成由测试明确发起MCP读取，不冒充模型选择。之后运行全量/原生/旧包/设计检查、只读核对现有安装与provider元数据（不输出token），再执行一次真实运行，.runtime/w25/authorization-used.json独占，失败不重复消耗。

真实验收必须同一尝试内同时满足task_get恰好1/0错误、原生复述同task和状态、turn completed、1000次进度0写入、撤连接后旧访问拒绝、撤控制grant后桥/relay/宿主正常退出、凭据残留0及原实例/配置不变。relay停止前持有Windows句柄，不能把socket关闭当exit。只对该固定配置登记结果，不覆盖W20、不升级L1–L3/OS/250产品验收。

## 执行结果

唯一真实尝试2026-11-17T10:22:14.689Z—10:22:25.822Z，10项检查全部通过，PASSED_FIXED_CONFIG。task_get=1/tool_errors=0；task 3a6201d6-b4d2-4fbe-86f9-66a40134ef10、draft，原生回复匹配，generation1 completed。18,196 tokens（18,084输入/112输出），未触发30,000软阈值，金额UNKNOWN；无追加尝试。

同次先连接撤销验证直接服务和任务relay均404，控制grant撤销后进度拒绝GRANT_REVOKED，并由controller维护触发组合关闭。真正桥stdin_eof=true、exit0，relay持句柄exit0于10:22:24.7593744Z，之后10:22:24.816Z关闭宿主，宿主exit0/非强制。原12客户端清单/用户配置摘要保持；桥配置自动删除、home配置另删1，限定78文件零残留。证据见根evidence/codex-relay-joint，旧W20不改。

677/677全量、原生14+1、旧包989、P0 13项与设计检查通过；旧W20合成回归单独通过，新增同链演练和缺外部退出证明负例。首次verify在TS7016失败：新MJS测试helper无类型声明，不关闭strict/不忽略错误，补明确.d.mts声明后完整重跑通过。生产源码未改；仅新增opt-in验收组合，不把测试装配当产品入口。HANDOFF未改。

下一阶段：受信产品配置的桥生命周期组合，需要明确关闭失败传播、授权丢失/崩溃/未初始化/缺OS证明、无默认开启与凭据清理责任。先开发合成反例，不能借此再用本次真实授权。Windows隔离暂缓、UI最后、管家不构建。
