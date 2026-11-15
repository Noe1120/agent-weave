# W13 Claude Desktop独立MCP接入探针

日期：2026-11-16（Asia/Tokyo）。当前状态：**第五至七次真实尝试通过CC Switch第三方配置的MCP握手/发现与清理；只读桥合成走查通过，完整Claude任务接入仍未完成**。前四次空配置记录保留；原客户端完整工作能力仍待逐项验收。

## 范围与依据

固定本机官方Windows包5.11492.2.0（应用5.11492.2）、签名与EXE/ASAR摘要。官方Desktop作为MCP客户端主动初始化本地stdio server，不能照搬DSH的ACP会话方法；不替换为Claude Code/SDK/API。用户要求找到失败原因并持续重试，已覆盖上轮提出的单个遗留进程核验清理。

前四次仅使用全新空profile。用户随后明确其CC Switch第三方配置可用，要求先只读核实，并进一步要求连续完成Claude接入。第五次按此后续授权只复用选定的本机gateway连接配置与令牌到独立目录，不复制历史/cookie或上游provider密钥，不改已有配置、不登录、不发模型prompt、不操作窗口、不改系统身份/ACL/网络策略。管家不构建。

## 当前验收路径

1. 默认verify运行合成MCP和Windows原生进程/目录回归，不启动真实Claude。
2. 真实入口必须显式opt-in及新建一次性尝试目录；核对安装摘要、路径、现有客户端清单。已有Claude时拒绝启动，不附着或重启。
3. 创建全新profile和USERPROFILE/AppData/Roaming、AppData/Local。通过原生SHGetFolderPath核对两个已知文件夹确实解析到本次目录。禁止受厂商签名保护的CLAUDE_USER_DATA_DIR/E2E/CDP钩子。
4. 验收专用.NET host保留实际启动返回的根进程句柄，显式将根进程加入Job。独立观察根进程退出；不能用stdout/close替代。限时60秒，握手和发现成功后立即停止；有限诊断仅留本地。
5. 成功必须同时具备真实initialize/initialized/tools-list、根句柄退出、Job为空、host正常退出和前后客户端清单一致。回收是强制终止，不写成Desktop正常EOF退出。
6. 真实入口不自动登录；缺失外部前提时保留未通过，不能以合成测试补齐。全量服务、原生、包保护、设计/P0、暂存扫描后交付。

## 历史失败与根因

首次尝试：35秒内未见MCP启动，新目录只有探针配置。既有W07开发Job报告为空时实际Claude仍存活，host只观察close不足以判断进程退出。此时没有依据归因登录，历史报告原样保存在真实记录内。

用户要求修复重试后，已按创建时间、可执行路径及完整独立profile参数重新核验遗留进程，持有句柄终止并观察退出。新host直接持有真实根进程句柄，显式入Job；不再从中间worker的Job成员关系推断Desktop归属。具体Windows打包启动的继承机制尚未确定，不将本轮结果称为OS隔离。

第二次尝试：完整清理通过，stderr和本次生成的错误文件明确记录 Failed to get 'appData' path。SHGetFolderPath回归复现HRESULT 80070003。原先只创建任意appdata/localappdata并覆盖环境变量，缺少Windows按USERPROFILE展开并验证的AppData/Roaming和Local目录。已修复标准布局，并在真实启动前核对原生路径。

第三次尝试：修复后正常启动，页面约27秒加载完；30秒总窗口仍未见MCP，完整清理通过。第四次将观察延长到60秒，页面约17秒完成加载，仍没有MCP请求，清理再次通过。三次重试均保持原六个DSH进程身份不变。

## 全量回归发现的验收辅助缺口

首次全量回归有一项DSH权限拒绝场景未观察到退出。检查发现DSH验收辅助探针仅监听close；增加独立合成后代持管道场景后，稳定复现根进程已退出却被标UNKNOWN。已分别记录exit与streams_closed：根退出可被确认，但管道未收束仍是失败，不把它变成PASS，也不重复kill已退出根。首轮间歇失败没有完整底层时序，不能证明其触发条件与合成场景完全一致；保留首轮日志。生产DSH控制器和既有真实会话证据未改，没有重启真实DSH。

## CC Switch本机证据及归因修正

第四次空profile无官方cookie、账号和MCP请求的观察保留，但不能据此要求用户登录官方账号。实际链路是：CC Switch 4.0.16数据库中的claude-desktop当前provider为proxy；Desktop本地3p配置库选定CC Switch条目，gateway指向CC Switch所属的回环监听端口，保存的gateway令牌与CC Switch一致。settings.json旧official选择器和live-state的direct字段不代表实际账号模式。只读SQLite以mode=ro/query_only打开，仅查询配置表，不读取请求/会话日志。

本机Local/Claude与Local/Claude-3p分别是重解析目录；先解析实际目标，再核对配置库和选定文件摘要。固定安装源码将3p userData定位到LOCALAPPDATA/Claude-3p；MCP配置也必须位于该实际目录。原配置没有mcpServers。第五次只在新目录写入探针与选定连接配置，真实initialize、initialized及tools/resources/prompts发现均收到；约数秒后停止，根句柄退出、Job为空、原客户端清单一致、源配置摘要不变。真实MCP已经通过，无需官方登录。

## 后续只读连接器实施计划

用户要求继续全部Claude接入阶段；每项完成必须分别有证据，原生点击/严格写入/自动唤醒不能由传输成功替代。保持现有Windows强制隔离与工具边界，未通过时不开放敏感域或Broker写入。

- [x] tests/claude-third-party-probe.ts：先红后绿验证选定配置摘要、明确凭据复用开关、3p实际目录与空历史；tests/claude-desktop-live.mjs复用保留根句柄的限时真实入口。默认verify只使用假令牌夹具。
- [x] packages/service/src/mcp-session.ts：实现有界stdio MCP会话、版本协商、空资源/prompts、明确工具发现及请求错误。协议数据与诊断分离，非法帧/EOF/过载可观察，无通用shell/URL/模型调用入口。
- [x] packages/service/src/mcp-read-client.ts：固定本机HTTP服务、project及有限resource清单；工具task_get、project_progress、message_poll只转调既有服务。每次服务侧仍检查grant/policy/run/ACL；本地配置另明确允许外发的合成数据范围及到期时间。模型参数不能改URL/token/project/provider。
- [x] packages/service/src/mcp-entry.ts：只读固定配置启动，凭据不放命令参数、不写报告；不打开数据库，不启动/控制原客户端；断开不杀客户端。报告只有连接/方法计数与故障码。
- [x] tests/claude-read-connector.test.ts：真实本机服务+合成MCP客户端验证读取、撤权/跨域/过期/错误/静态查询零写入；另用真实Desktop只验证工具发现，不能冒充模型调用。
- [x] 全量verify、受影响原生回归、旧包、设计/P0、暂存内容审查；发布源码与经审查的元数据。记录真实工作任务/窗口/隔离状态，未通过项不升级。

## Orca参考与验收限制

按用户建议只读研究Orca提交af82fa8634e19c0376738ad636237aac847b2179，参考其Windows进程身份复核和未证实退出不释放状态的原则。其Claude Code/SDK结构化会话路径不能证明Claude Desktop支持；没有运行或复制其实现，第三方checkout位于忽略目录。

MCP握手即使成功也只证明传输，不证明任务执行、自动唤醒、群数据授权、L1–L3或Windows隔离。服务新增只读task投影和验收专用MCP桥；数据库schema、WPF、旧包和管家保持。原生点击仍未验收；250 AT/CA保持NOT_RUN。实测和合成分别见[真实记录](../evidence/claude-desktop/real-attempt-report.json)及[交付记录](../evidence/claude-desktop/COMPLETION.md)。

## 本次验证与剩余阶段

第六次真实尝试使用编译只读连接器，第七次使用最终构建重复验证。两次均初始化、tools/resources/prompts发现、根句柄退出、Job为空及前后进程清单一致；tool_calls均为0。第六次发生在feed响应校验最终加固前，其构建摘要独立保存，不冒充最终字节验收。第七次配置使用实际选定路由摘要，并将合成grant/policy动作收窄为read_resource/get_plan_progress。复制的gateway令牌均已清除，三个新profile扫描零匹配；原四份配置摘要不变。

全量verify 419/419、Claude专项63/63、原生14组C#与1项WPF静态、旧包989文件、编译只读流程均通过。首轮全量415项有1项OpenAPI旧路由数断言失败：新增task使路径从23增为24，已同步预期并增加task字段严格性和Bearer校验，保留原日志。编译走查首次把apply_plan后任务误期望为ready；按既有契约及服务回归纠正为queued，再走查通过，不改服务状态机。

作者自检发现预启动失败可能留下复制的gateway令牌：现在在非敏感准备完成后才写入凭据，预启动检查失败时清除副本并保留原错误；清除失败作为独立AggregateError上报。不是独立安全审核。

| 阶段 | 结果与实际边界 |
| --- | --- |
| 实际身份/第三方配置核实 | PASS，只读配置元数据；不读历史 |
| 本地MCP握手与工具发现 | PASS_REAL，固定官方Desktop/CC Switch |
| task/progress/feed只读桥 | PASS_SYNTHETIC，默认构建及stdio连接器；未注册生产成员 |
| 断开、重连、撤权、分页/零写入 | PASS_SYNTHETIC；原客户端仅发现，没有模型调用 |
| 原客户端一次模型任务/工具往返/消息回复 | NOT_RUN，需要新测试会话的具体窗口操作及一次合成任务/费用授权 |
| 自动唤醒、忙碌排队、取消/恢复与会话切换 | UNVERIFIED，没有已验证原Desktop驱动接口；不替换为Code/SDK或注入内部IPC |
| 实际provider外发绑定/私密域/Windows强制隔离 | NOT_IMPLEMENTED_OR_NOT_TESTED，不用Job或声明字段代替强制边界 |
| 原生WPF点击、生产注册/凭据/安装升级 | NOT_RUN_OR_NOT_DELIVERED |

下一步可执行的具体验收：在独立3p测试profile的新对话中，经批准的Computer Use选择已发现的Agent Weave只读工具，向当前CC Switch provider发送一条只含合成task UUID的请求，让其调用task_get并复述queued状态；只允许一条用户prompt，不读已有聊天、不写项目、不改原配置。记录实际tool call及回复、费用已知/未知，并核对退出和撤权。当前窗口工具此前拒绝读取Team；未解除该限制，不换工具模拟点击或绕过。该原客户端模型/窗口步骤尚未执行，不能据此报告全阶段完成。

本桥当前synthetic_only/provider_fingerprint仅为可信验收声明，未构成服务端分类/网络绑定；固定配置需由可信代码准备。正式部署必须补服务签发的外发授权、provider变化失效与安全凭据配置，随后同配置联合验收。250 AT/CA与资格模板不变。

发布前复验新增定位DSH合成测试时限问题：正常流程三个RPC均已确认，但测试辅助统一只给300ms EOF退出时间；32路并发复现31通过/1个DSH_EOF_TIMEOUT（实际exit0但超时已触发，仍正确判失败）。增加600ms延迟EOF的确定性红绿回归，普通退出使用已有探针默认5秒预算；故意忽略EOF/后代持管道的故障用例仍300ms、原失败断言保留。37项会话回归及32路并发通过；不修改生产DSH控制器或协议辅助，也没有新增真实DSH调用。原始复验失败/压力复现均保留，不能把旧失败日志改成通过。

另一轮全量复验触发W07 flood退出竞态：原生host因输出超限退出时，控制器仍在写ack，输入EPIPE先到使RunnerHost停止读取stdout，丢失后到的独立Job-empty/exit证据。确定性回归复现后，输入故障保持可见，但继续严格解析独立输出；只有完整合法exited及host退出0才能保留证据。畸形输出/缺失证据仍UNKNOWN；controller保留实际输出超限根因，任务仍失败、grant撤销、锁隔离，不把错误改成成功。新增输入故障/同时输出损坏两条回归，原flood失败断言不变。仅修改W07开发运行器，不扩大原客户端或OS资格。
