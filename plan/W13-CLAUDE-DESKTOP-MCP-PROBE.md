# W13 Claude Desktop独立MCP接入探针

日期：2026-11-16（Asia/Tokyo）。当前状态：**真实Desktop的一次合成只读工具往返已通过；完整生产接入和Windows隔离仍未完成**。早期失败保留在历史记录，不能由本次成功抹去。

## 最新结果：第十二轮真实只读工具往返

第十二轮已完成一次真实Claude Desktop合成任务往返：沿用CC Switch「me＋路由」，发送一条授权prompt，原客户端调用task_get一次，服务返回queued，窗口复述正确任务ID及状态。任务连接收到一次roots变化通知且无故障，两条MCP连接均EOF；权限响应once由自有日志证实，助手未点击权限按钮。根进程exit0、Job为空、host退出及原客户端清单核对通过，临时凭据清除且369文件扫描零匹配/零未读，原四配置和live路由摘要保持。累计三条用户prompt、一次真实工具读取，总请求/费用及运行时上游仍未知。单任务验收完成不等于生产连接器、自动驱动或Windows强制隔离；管家不构建。

实际用户路径：新建空profile → 显示Gateway和原生Claude模式 → 输入并发送一条合成任务 → 工具权限响应once → task_get读取一次 → 窗口显示同一任务ID及queued → 所属根进程退出 → 撤销临时grant、清除复制令牌并核验源配置。既有用户历史未复制/读取，权限按钮没有由助手代点；09:31:39的once响应由本次自有Desktop诊断确认，没有宣称视觉观察到用户点击。

本次同时验证了两项真实兼容修复：任务和发现连接各写独立报告；task连接正常接收roots_list_changed后成功读取，tool_errors为0、fault为null。第十一轮实际被拒绝的通知帧仍未捕获，不回写历史归因。自有Desktop日志另有EventLogging批次上报403/region_unavailable，保留该外部诊断，未隐藏、绕过或误当成网关推理错误；本次工具返回由独立服务及窗口共同证实。

第十二轮最终验证：全量439/439，0失败/0跳过；原生14组C#＋1项WPF静态、旧包989文件、编译只读走查及两项目录回归通过；设计51文件/P0共12项通过。端口修复未改变本次已验收的MCP三个模块，当前编译入口摘要与第十二轮启动固定值相同。

后续入口：一次真实合成读取验收已完成，本次没有追加第二条prompt。生产邀请/受保护凭据、服务签发的provider外发约束、原客户端自动唤醒/忙碌排队/取消恢复以及同配置Windows隔离仍需分别建设与授权验收。原生Team点击、生产在线/离机灾备、签名安装升级不随此结果升级，250 AT/CA保持原状态，管家未构建。


## 历史：第十/十一轮与协议兼容修复

累计十一轮真实尝试，本地MCP发现已通过，但真实工具读取仍为0。第十轮发送一条合成prompt后报告工具不可用，定位为发现连接与任务连接共用独占报告文件；已改为每连接独立报告，第十一轮证实两份报告均创建。第十一轮单独获准的一条prompt触发正确task_get授权框，但未批准，测试窗口于09:14:07（JST）自行退出；不能再要求用户点击已消失的窗口。任务连接另报MCP_NOTIFICATION_INVALID：已复现并修复合法roots变化通知被拒绝的问题，但该次实际通知方法未捕获，真实修复验收仍待完成。两个prompt的授权均已使用；新增真实任务需具体授权及用户亲自确认Allow once。CC Switch的me＋路由元数据继续固定，原配置/历史未改；费用与运行时上游仍未知，完整接入/Windows隔离/生产资格不升级，管家不构建。

- 第十轮：原生窗口可见Gateway、连接器已启用，但任务运行时再次启动MCP时独占单一`--report`失败。`--report-dir`在已验证目录下创建独立connection子目录；旧单文件入口仍拒绝覆盖，不吞掉写入错误。第十一轮两份独立报告确认该修复实际生效。`tests/claude-desktop-live.mjs`仍是短时发现专用入口，单报告模式不能用于完整任务验收。
- 第十一轮：原生Claude请求`agent-weave-probe/task_get`的Allow once，但任务MCP连接发生通知错误，未批准权限、未读任务。Computer Use不代点权限提示。用户随后看不到窗口是因为自有根进程已经ROOT_EXIT/exit0，Job为空且host退出0；没有助手STOP指令，不归因用户操作。此后原实例未接管。09:21只读清单为空，但以后启动仍须即时复核。
- 固定安装的LocalMcpServerManager注册roots provider后会发送`notifications/roots/list_changed`。红测试1失败/1通过证明旧桥会终止；现在仅在ready状态接受无业务参数或合法_meta的此通知，计数但不读取roots、不请求客户端文件、不扩大固定资源范围。早到、畸形、未知通知和重复initialized仍拒绝。连接器21/21通过；没有宣称已捕获第十一轮原始通知或完成真实修复验收。
- 第十/十一轮分别扫描364/370个已停止自有profile文件，精确gateway令牌0匹配/0未读/0重解析漏扫；源四配置摘要及live路由摘要保持。共发送两条授权用户prompt，后台探测/总模型请求及费用未知。没有读原历史、改原配置、登录官方账号或以独立Code/SDK/API替代Desktop。
- 默认测试曾429/431失败，原日志保留。16路重复运行Runner/DSH组合全部出现Runner等待超时，限制两路后16/16通过；因此将测试文件并发限为2，所有断言、全部文件及生产超时保持。该实验支持Runner资源争用，不证明原DSH监控unknown的确切原因；该断言只增加安全状态诊断，不放宽预期。

最新本地验证：全量436/436、Claude专项80/80、原生14组C#＋1项WPF静态、旧包989文件及编译只读走查通过；两项走查目录回归通过。默认测试没有启动原Agent，不把这些合成结果计为真实工具往返。

后续：确认用户愿意再进行一条相同范围的合成任务并能及时点击Allow once，先检查现有进程为空、me路由及安装摘要，再新建独立profile；不能复用旧授权、改用内部IPC或替代客户端。原生WPF、生产凭据/外发约束、自动驱动与Windows隔离仍分别未验收。没有进入管家实施。


## 历史：me路由核对与第八次验收增量

用户明确指定CC Switch的me分组＋路由模式。2026-11-16只读复核发现live-state为proxy/attached，proxy_route匹配me；settings旧选择器仍为official、数据库is_current仍为cc7，二者不能替代活动路由证据。此前仅固定Desktop网关文件，未固定me，相关结论已收窄为MCP传输通过。第八次测试窗口发现MCP但未发送prompt、tool_calls=0，模型不可用提示未解决；测试实例退出与凭据清除已核实。现在第三方准备入口要求绑定路由目标、live-state及provider元数据摘要，并在启动前再次核对；这仍不是运行时provider外发证明。当时一次任务授权尚未使用、原用户实例运行；该历史状态已由最新结果取代。

第八次窗口实际可见Gateway页脚及Configured model not available（claude-haiku-4-5）；该显示不能证明使用官方账号，也不能证明me模型请求成功。没有发送测试prompt、没有服务读取；后续窗口句柄失效，host记录ROOT_EXIT/exit0及Job为空。仅核实自有实例退出，不控制随后出现的用户实例。CC Switch窗口最小化且检测到用户输入，本轮没有取得有效界面核对，不以配置表冒充UI验收。

新增回归先证明仅网关配置会被旧入口错误接受，再验证缺少绑定、其他分组、直连、断开、名称/模型路由变更和准备后漂移均阻止启动；准备后失败清除测试凭据，不写源配置。 真实入口省略第三方路由也明确拒绝，不再退回空profile。最终全量431/431，0失败/0跳过；原生14＋1、旧包989、设计51文件/P0共12项和编译只读走查通过。host仅提高验收上限至十分钟，默认发现仍60秒；超出上限仍拒绝，停止/根句柄/Job证据要求不变。

## 后续只读排查：自动连接探测与现有实例门槛

2026-11-16继续测试时，用户现有Desktop主进程仍运行，独立入口没有启动第九次尝试，也未附着/关闭现有窗口。继续只读验证me路由通过；仅GET本机gateway的模型目录，返回200/4项，不调用messages推理接口，不读取请求或聊天历史。目录中的sonnet ID与Desktop配置名有差异，但目录不证明具体模型可调用，未擅自改映射。

对固定安装文件与第八次自建profile诊断的交叉核对发现：Desktop启动健康检查会自行向gateway发送max_tokens=1的连接探测，优先使用配置中的haiku。其通用错误映射将400或404标记为config_model_rejected，因此该提示既不能证明官方登录，也不能单独证明模型缺失；仍须原始响应才能判断实际失败根因，不能隐藏提示或跳过健康检查。第八次自建日志未保存该响应，未以读取用户请求历史补齐。

费用口径修正：零用户任务prompt不等于零后台推理请求/零费用。之前实际user prompt与MCP调用为0仍成立；Desktop自动连接探测次数、上游计费与实际返回原因未知，不回填零。新增实测仍需原有实例由用户正常退出，当时的一次任务授权后来已在第十轮使用，不据广义“继续”追加任务。

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
| 实际身份/第三方配置核实 | Desktop身份/网关传输已核实；me仅有本轮路由配置元数据，运行时上游仍UNVERIFIED |
| 本地MCP握手与工具发现 | PASS_REAL，固定官方Desktop/CC Switch |
| task/progress/feed只读桥 | PASS_SYNTHETIC，默认构建及stdio连接器；未注册生产成员 |
| 断开、重连、撤权、分页/零写入 | PASS_SYNTHETIC；原客户端仅发现，没有模型调用 |
| 原客户端一次模型任务/工具往返/消息回复 | PASS_REAL_SINGLE_SYNTHETIC_READ；第十二轮一次task_get及正确回复；生产收发仍未交付 |
| 自动唤醒、忙碌排队、取消/恢复与会话切换 | UNVERIFIED，没有已验证原Desktop驱动接口；不替换为Code/SDK或注入内部IPC |
| 实际provider外发绑定/私密域/Windows强制隔离 | NOT_IMPLEMENTED_OR_NOT_TESTED，不用Job或声明字段代替强制边界 |
| 原生WPF点击、生产注册/凭据/安装升级 | NOT_RUN_OR_NOT_DELIVERED |

下一步可执行的具体验收：在独立3p测试profile的新对话中，经批准的Computer Use选择已发现的Agent Weave只读工具，向当前CC Switch provider发送一条只含合成task UUID的请求，让其调用task_get并复述queued状态；只允许一条用户prompt，不读已有聊天、不写项目、不改原配置。记录实际tool call及回复、费用已知/未知，并核对退出和撤权。Team窗口限制仍不能绕过。第八次独立Claude窗口观察已执行，但模型任务未发送，不能据此报告全阶段完成；这段为第八轮历史计划；该授权已在第十轮使用，费用未知不报零。

本桥当前synthetic_only/provider_fingerprint仅为可信验收声明，未构成服务端分类/网络绑定；固定配置需由可信代码准备。正式部署必须补服务签发的外发授权、provider变化失效与安全凭据配置，随后同配置联合验收。250 AT/CA与资格模板不变。

发布前复验新增定位DSH合成测试时限问题：正常流程三个RPC均已确认，但测试辅助统一只给300ms EOF退出时间；32路并发复现31通过/1个DSH_EOF_TIMEOUT（实际exit0但超时已触发，仍正确判失败）。增加600ms延迟EOF的确定性红绿回归，普通退出使用已有探针默认5秒预算；故意忽略EOF/后代持管道的故障用例仍300ms、原失败断言保留。37项会话回归及32路并发通过；不修改生产DSH控制器或协议辅助，也没有新增真实DSH调用。原始复验失败/压力复现均保留，不能把旧失败日志改成通过。

另一轮全量复验触发W07 flood退出竞态：原生host因输出超限退出时，控制器仍在写ack，输入EPIPE先到使RunnerHost停止读取stdout，丢失后到的独立Job-empty/exit证据。确定性回归复现后，输入故障保持可见，但继续严格解析独立输出；只有完整合法exited及host退出0才能保留证据。畸形输出/缺失证据仍UNKNOWN；controller保留实际输出超限根因，任务仍失败、grant撤销、锁隔离，不把错误改成成功。新增输入故障/同时输出损坏两条回归，原flood失败断言不变。仅修改W07开发运行器，不扩大原客户端或OS资格。

本轮继续复验发现编译只读走查在全新工作区缺少.runtime父目录时直接ENOENT；此前指定已有evidence父目录未覆盖该路径。新增两个实际执行回归，先复现1失败/1通过，再仅补父目录创建，仍以独占mkdir拒绝已有尝试目录，不覆盖旧证据。两个回归及默认命令走查通过（两次连接、40次进度、EOF/重连/撤权，读取零写入），没有修改生产服务或MCP校验、没有新增原客户端/模型任务。原失败与红绿日志摘要见验证汇总。总模型调用计数改为未知，不再用数字0配附注表示；当时0仅用于用户任务prompt；最新累计用户prompt为2。

## 第九次独立窗口与最新复验状态

用户确认退出原进程后，空进程清单及me路由预检通过，第九次仅启动新建临时profile。界面为Gateway且没有历史，原因是刻意不复制用户历史，并非切换官方登录。MCP初始化/发现通过，未输入或发送prompt，tool_calls与服务读取均0；用户询问历史后已停止自有测试实例，根句柄退出、Job为空、原客户端清单一致，复制令牌清除且324文件扫描零匹配/零未读。原四份配置摘要和原profile目录映射保持，未读取历史内容。

当时全量复验为429/431、2失败、0跳过：DSH授权监控状态unknown、Runner成功场景保留TIMEOUT。原日志不覆盖；后续资源实验、严格范围的修复及最新验证分别见本页最新结果和verification-summary.json。DSH原始失效的精确触发条件仍未证实。

## 第十二轮收尾回归：本机动态端口兼容性

真实单任务通过后，全量回归出现435/436、一项message_poll首次本机读取MCP_SERVICE_UNAVAILABLE。原始运行未记录底层fetch原因或端口，不覆盖该失败。只读netsh确认本机动态TCP端口范围1024起、64511个；3000次本机合成监听/读取中，2999次成功、一次分配10080后Fetch在发包前拒绝bad port。测试进程仅模拟系统把port0分配到10080，稳定复现主服务已经启动却无法用Fetch读取的缺陷。该证据证明分配器兼容问题，不反推原失败一定用了10080。

修复自动HTTP监听从49152–65535选取端口，只在EADDRINUSE时有限重试绑定，不重试业务请求；显式端口保留且冲突仍失败。没有关闭Fetch端口保护、改系统网络范围、放宽超时或删除分页/权限断言。主服务自动端口、MCP测试、Fetch工作台测试和编译只读走查共用入口；原生私有服务入口及旧便携包未改。确定性红测试和27项针对性绿回归保留。首次测试错误地期待HTTP Server没有内置listening处理器，已按实际内置setupConnectionsTracking保留身份核验，原失败日志不删。
