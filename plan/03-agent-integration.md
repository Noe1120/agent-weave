# 03 Agent 接入、兼容性与 Windows 验证

> 2026-11-14：开发实现增量：W08仅可信进程内登记、能力原因投影、配置失效与本地detach。普通调用方不能自报VERIFIED或注入执行命令；真实发送/回答/审批/打断未开放，详见W08-ADAPTER-FOUNDATION.md。

> 2026-11-15：W11已用本机官方DeepSeek Harness 0.2.1-rc.3完成独立ACP initialize生命周期实测，ACP协议1/bridge 0.0.1；没有session/prompt或原Desktop附着。声明能力不是可执行资格，详见[W11](W11-DSH-ACP-LIFECYCLE.md)。

本文件优先保留用户明确点名的 Codex、Claude Desktop 和 DeepSeek Harness。DSH初始化/独立新会话及W13 Claude一次真实合成只读工具往返已有分项实测；完整生产接入仍未验收。03 与 05 的门槛是实施团队必须完成的验证工作。

## 1. 接入等级与发布口径

| 等级 | 定义 | 能对用户宣称什么 |
| --- | --- | --- |
| L0 仅配置 | 已登记成员，但未验证连接 | 待连接 |
| L1 协作工具 | 能认证、收发、读记忆、报告产物 | 可在原客户端主动参与 |
| L2 可响应 | 在已验证的状态下能收到任务并进入处理 | 显示具体可响应条件，不能泛称任何时刻在线 |
| L3 可托管执行 | 可启动、监控、取消、恢复，能提交真实产物 | 在已验证权限与生命周期内自动执行 |

群支持混合等级；“全自动三 agent 协作”发布标准要求三个目标成员都能完成其指定任务的 L2 行为，并能核对产物。原生 Desktop 不一定能达到 L3，不能用平台不能控制的进程伪造 L3。

辅助模式允许成员在原客户端手动继续，是明确的受限模式。如果用户的目标要求无人值守原客户端协作，此模式不算完成原目标。

## 2. 为什么分开 MCP 和运行协议

MCP 协作入口用于 agent 调用平台工具：查群、读上下文、领取任务、发消息、提交产物。它不天然赋予平台启动宿主 agent 的能力。

Codex app-server / ACP / SDK 等运行协议用于驱动具体 harness，取得它实际提供的会话、权限和执行事件。两者可同时存在：同一个托管 agent 也能通过工具访问群服务。

截至调研日，MCP 的传输/通知设计仍有版本演进，旧的 transport 教程不可直接套用。客户端版本协商、实际支持能力和所用 SDK 版本必须存入 compatibility manifest [E07]。自有 UI SSE 与 MCP transport 是两个独立接口，不混用。

## 3. 统一 capability manifest

每个 adapter 探测以下字段，不从 provider 名称推断：

- 连接：protocol_name、protocol_version、client_version、harness_version、auth_mode。
- 生命周期：can_start、can_prompt、can_cancel、can_resume、can_reconcile、can_wake_idle。
- 执行：can_read_files、can_write_files、can_run_checks、supported_workspace_scopes。
- 事件：structured_output、tool_events、approval_callback、usage_reporting、artifact_reporting。
- 输入：text、image、file_refs、max_context_hint、max_input_size；另列 can_request_input、can_accept_input_reply、can_resume_waiting_operation、input_reply_mode、pending_request_recovery、reply_idempotency。
- 执行授权：execution_grant_binding、native_context_isolation、per_execution_credentials、tool_scope_enforcement；不支持时不能仅用 member token 参与私密执行。
- 不打断观测：observation_mode、last_observed_at、can_observe_without_prompt、can_defer_message；不能靠向活动 turn 追加提问实现。
- 会话：parallel_sessions、active_turn_limit、supports_checkpoint、history_retrieval。
- 治理：sandbox_scope、credential_owner、policy_enforcement_location、egress_enforcement、native_network_observability、resource_accounting、controlled_environment_binding。
- 行为资格：configuration_fingerprint、suite_revision、qualification_status、last_validated_at；协议连接通过不能替代行为回归。

每项值 supported/unsupported/unverified，附 probe_case_id 和观察时间。升级后旧结果失效或待复验。能力缺失时提供明确 UI 降级；不可通过抓取聊天文本伪造结构化状态。

## 4. Codex

文档依据：app-server 提供面向自建产品的进程协议、线程/回合与请求处理 [E01]；旧 codex mcp-server 已被移除，迁移页要求其他入口 [E02]。

注意官方页面的表述差异：迁移页将 app-server 描述为实验性并对生产提出限制，而 app-server 主文档又区分稳定 API surface 与实验功能/传输 [E01][E02]。本方案不自行消除这项差异。

建议验证路径：

1. 固定官方 CLI 发行版、操作系统、认证方式和构建来源，优先按该版本的 stdio app-server 文档接入。
2. 进行初始化与能力协商，按实际 schema 生成/验证客户端类型；不要依靠未知字段或非文档化 RPC。
3. 建立项目专属 thread，记录 native_id、working directory 和 policy；发送任务后消费结构化事件。
4. 验证工具权限请求、拒绝、取消、恢复、断连和 usage 的真实行为。普通澄清单独验证请求/答复能力：E01 将 tool/requestUserInput 列为实验功能，正文也引用 item/tool/requestUserInput；必须按固定版本 schema 映射原生 request ID 与 resolved/清理通知，不能把 send_input 视为等价，见 09 §7。
5. 向用户公开是否创建新会话。可编程新会话与接管既有 Codex 桌面聊天是不同验收项。

GO 条件：固定版本下通过测试；如果产品要作为对外生产服务，还需记录对官方稳定性限制的处置决定。仅能在实验环境使用时，交付标注试验版，不能隐藏风险。

降级：按需求接受官方 SDK/非交互入口时，创建独立的 adapter 类型并重新验收。不得声称 SDK 已接管原来的桌面聊天。

### 4.1 交给DSH的下一接入任务（2026-11-16）

用户要求由其使用的DSH学习已完成的DSH/Claude接入过程，继续实现Codex接入；根目录[connect.md](../connect.md)是操作教程和任务交接，不替代本目录设计。当前轮仅整理交接，不启动DSH或Codex。DSH是下一阶段实施者，Codex是被接入对象；不是重新完成DSH自身的模型接入，也不启动管家。

目标先完成官方Codex独立会话的最小可用闭环：固定本机身份/版本/真实配置 → 合成协议与授权回归 → 获准的真实握手 → 新会话中的一条合成任务 → 一次平台只读工具调用及可核对回复 → 纯只读进度 → 所属连接关闭/退出对账、撤权与凭据清理。复用W08授权/幂等/配置失效与现有只读服务，不以单独演示脚本、工具列表或模型自述代替平台接入。尚无Codex专项运行模块或真实验收结果。

优先调查官方stdio app-server与本地MCP的组合，但必须核实它与本机原Codex的发行来源、配置/账户和会话归属关系。官方新会话不等于已有桌面聊天附着；若不能证明用户指定原客户端身份，或需要改用SDK/API/另一发行版，应停在该边界并提出具体差异，不偷偷替换。新进程/会话、凭据复用、模型费用、窗口操作和OS策略分别核对授权；以前的DSH/Claude单次授权不转移到Codex。

2026-11-16实际读取的官方[App Server文档](https://learn.chatgpt.com/docs/app-server)描述initialize→initialized、thread/start、turn/start与结构化事件；stdio使用JSONL，示例省略jsonrpc字段，WebSocket仍标实验性且不受支持。[MCP文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)描述Codex作为MCP客户端配置stdio服务。两页分别由developers.openai.com/codex/app-server/与codex/mcp/重定向取得。它们只作候选接口依据，不能取代本机固定版本schema、实际探针、认证授权或稳定性处置；本轮没有运行这些接口，不更新旧E系列来源日期。

正式阶段计划由DSH在plan内建立：分别登记握手、真实单任务、生命周期、原生UI与Windows强制隔离门槛。取消/恢复/忙碌排队/未知退出等先合成验证，再按具体授权补真实验收。进度读取不得调用turn/start、turn/steer或thread/resume；可只读也不代表可以读取用户私有thread。严格写入、生产外发、完整L1–L3与平台整体完成仍按本章及09/12逐项验收，UI最后、管家不构建。

### 4.2 W14本机实施状态（2026-11-16）

[W14](W14-CODEX-APP-SERVER.md)已完成Codex接入的真实闭环：本机固定`codex-cli 0.167.0-alpha.3.2`的app-server真实initialize、真实原生thread、一条真实turn、一次真实平台只读`task_get`往返（客户端经stdio MCP调桥、平台HTTP服务返回、原生agent message复述同一任务与状态）、1000次纯只读进度与所属进程正常退出；原12个客户端进程前后不变，隔离home不含用户配置或凭据。

本轮由客户端自带schema核实并纠正了此前的文档推断：信封无`jsonrpc`成员；`initialize`响应为`{codexHome,platformFamily,platformOs,userAgent}`（无`protocolVersion`）；`TurnStatus`含`inProgress`且非终态；MCP每个server收成一个`namespace`工具`mcp__<server>`，调用须带`namespace`，扁平名被拒。空home无provider时真实turn会诚实失败（默认端点不可达，退避重试后`failed`）。

模型为本地回环Responses桩（无凭据、无外发、无计费）。此后按操作者授权（总费用10元以内）用其CC Switch回环路由发起5次真实厂商模型turn：turn均完成、桥均握手成功，但模型一次也没有调用平台工具（合计106,377 tokens，已停止）。根因在客户端对该模型启用code模式工具面（仅`functions/clock/collaboration`，MCP工具只能在`functions.exec`的`tools.*`里调用），模型四次不同措辞下都未进入该路径；同一客户端在无模型元数据时会直接暴露`mcp__agent_weave_probe`并调用成功。**真实厂商模型的工具调用记为FAILED_AT_MODEL_TOOL_SELECTION；已有桌面聊天附着、Windows强制隔离、原生UI与完整L1–L3仍NOT_RUN**；独立新thread不等于桌面聊天附着；原客户端实例未被启动、附着或改写。

## 5. Claude Desktop

官方文档支持通过本地 MCP server/桌面扩展连接外部能力 [E03]。已有社区连接器展示了群聊天工具接入，但它们不构成官方对全生命周期自动唤醒的承诺 [P02][P04]。

建议原客户端路径：

1. 用户创建成员邀请，发行限群的注册凭据；该凭据只能注册可信 connector，不直接读取内容。每个工作执行另由服务签发 execution_grant，限制 run、数据域和资源。
2. 安装本地 MCP 扩展或配置 stdio connector。首次连接展示授权范围，并与实际成员身份绑定。
3. connector 连接本地群服务，暴露 02 中的协作工具和受限工作区工具。
4. 用户在 Desktop 会话中选择参与群，由可信映射取得该 execution_grant 内的 onboarding 快照；不靠读取私有应用数据库实现。如果应用级 MCP 连接无法隔离不同会话，只能固定到一个窄数据域并隔离实例；不能让模型传 session_id 切换私信范围。未通过 AT-83 的实例不开放私密执行。
5. 验证 message_poll / message_wait、任务领取、文件读取/补丁和检查操作。

一定要分别测试的状态：当前会话正在等工具；当前会话已结束一轮；窗口切到其他会话；应用最小化；机器锁屏/休眠恢复；应用已退出；用户拒绝权限；connector 重连。不得把其中一个状态成功概括为全部成功。

若宿主不能主动唤醒：成员状态显示“待原客户端继续”；工具事件留在未读队列；不把反复轮询或通知当成模型已经执行。操作系统通知可帮助用户回到会话，但仍不是自动执行。

前端文件交付采用显式授权的 workspace_read / workspace_apply_patch / checks_run；也可以使用客户端已经具备且经验证的文件能力。平台不能控制用户另行安装的其他 MCP server，不能保证所有路径都在本平台沙箱内。

原客户端只共享经授权的群数据；不要求导出个人历史、其他项目对话或隐藏记忆。若须经过 UI 自动化才能执行，单列脆弱性测试与维护费用，不能作为未说明的可靠默认路径。

### 5.1 W13本机实施记录（2026-11-16）

用户明确指定CC Switch的me分组＋路由模式。只读复核live-state为proxy/attached、proxy_route匹配me；旧official选择器或数据库is_current不能替代活动路由证据。第十二轮已完成一条合成prompt→一次task_get→服务queued结果→窗口准确回复；任务与发现连接独立报告，合法roots变化通知正常处理。两条MCP均EOF、所属根进程exit0且Job为空，复制令牌清除、369文件扫描零匹配，原四配置摘要不变。累计三条已授权用户prompt，总模型请求/费用未知；这些单次授权已使用，不授权下次启动或任务。真实记录见W13及其证据。

固定官方Desktop 5.11492.2的CC Switch第三方gateway路由已实际通过本地stdio MCP initialize/initialized及tools/resources/prompts发现。旧空profile缺少第三方连接，不能据此要求官方登录。普通--user-data-dir不足以定位3p配置；本机安装会使用LOCALAPPDATA/Claude-3p/configLibrary中_meta.json选定的条目。测试仅在全新标准Windows profile复用获准的本机gateway令牌，不复制上游provider密钥/历史/cookie，不改现有模式或配置。

实现一个合成验收专用的固定project/read-only grant桥：task_get读取新增task安全投影，project_progress只查get_plan_progress，message_poll可选且由执行feed检查grant绑定。固定配置拒绝动态URL/token/project，逐次复核服务权限和声明的披露到期时间，拒绝重定向、超限响应与未知字段；stdout只承载JSONL。协议会话上限1000帧/1MiB，每帧64KiB，单次HTTP超时5秒，响应64KiB。它不是长期运行的生产connector。

synthetic_only与provider_fingerprint当前是可信验收配置声明，不提供生产数据分类或实际provider网络绑定；不得据此放行真实私密数据。尚未接入邀请、受保护凭据配置、实际原生会话绑定或服务端外发策略。早期发现tool_calls=0与第十二轮一次真实调用分开保存；编译读取/重连/撤权是合成走查，不提升完整L1–L3。严格写入、自动唤醒、完整窗口流程与OS隔离仍待验收。见[W13](W13-CLAUDE-DESKTOP-MCP-PROBE.md)。

## 6. Claude Code / Agent SDK 是独立选项

官方 Agent SDK 是另一种集成方式，认证与对外服务的使用要求需要遵照其文档 [E04]。不能默认第三方平台可直接复用用户 claude.ai 登录和订阅额度，也不能把改用 SDK 后的成员继续标为“Claude Desktop”。

若实施阶段需要替代或补充，应新增明确区分的原 CLI 成员或 Claude Agent（SDK 接入）成员类型；SDK 展示名称还须遵循官方品牌规定 [E04]，由产品负责人记录范围决定，再进行完整测试。这个选项不自动满足 Desktop 的原客户端接入要求。

## 7. DeepSeek Harness

官方 ACP package 文档说明其 bridge 面向自动化，支持核心会话和提示流程，部分 UI / 历史 / fork 能力没有完整覆盖 [E05]。ACP 能力须按初始化协商与该版本实际实现判断 [E06]。

建议验证路径：固定官方 harness 与 ACP package 版本 → 以其文档确认启动入口 → 初始化协议 → 设置任务目录 → 创建会话 → prompt → 处理权限/事件 → cancel / resume / reconcile。

不要把第三方项目 README 中的启动参数当作所有版本的固定官方命令；把实际可执行路径、参数数组、版本输出和哈希写入 manifest。

如果 bridge 不能输出完整工具轨迹，UI 只显示已知事件、结果与检查证据；如果不能检索原生历史，用平台自己的上下文快照恢复新 run，明确这是新会话，不能伪装为原生恢复。

规划角色也要可验证：输出结构化建议、任务依赖和验收条件；由服务校验 DAG 和授权，不允许把任意自然语言计划直接写成执行命令。

另外，E05 的 stdio server 按可信控制器设计，其 authenticate 不提供额外认证，不能直接暴露给不可信网络。该文档还区分 prompt cancel 和 session close；停止群时必须核对后续/子任务活动，需要结束成员会话时按实际支持执行 close，不能把一次 cancel 返回当成永远不会继续工作的证明。

DeepSeek ACP 的输入等待也要单独验证：本次读取的 E05 将 elicitation 列为不支持。平台 help 工具若提供替代等待模式，需要独立验证暂停点与回答消费；未验证时显示能力阻塞/人工继续，不能注入活动 prompt 或静默重启。

## 8. 原生认证与凭证处理

用户凭证与平台成员 token 分开。provider 凭证由原客户端或 runner 的凭证存储管理；平台群 token 只用于协作服务，不兼任模型 API key。

禁止导出浏览器 cookie、读取其他应用私人 token 或绕过登录流程。实际支持的认证方式和计费归属要在连接 UI 写清楚；未验证的订阅复用显示未知。

本地 stdio connector 通过受保护配置/操作系统凭证存储取得对应执行的短期 token；注册/成员管理凭据留在可信 controller，不能交给模型或 worker。协议 stdout 只输出合法协议消息，日志写 stderr 并脱敏。HTTP 模式单独验证授权和 Origin，不因只监听 loopback 就取消认证。

连接令牌采用短期 bootstrap + 受保护的实例注册凭据 + 服务端签发的 execution_grant；注册凭据无内容读取权。邀请默认 10 分钟有效、单次使用，值以哈希保存。群移除成员时撤销所有相关 grants/session/connector scopes，并按实际写入通道核对运行，不把 token 撤销当作物理停止。

## 9. Windows 专项

首先验证 09 §4 的 Win-SID-Broker-1：Group Service、Broker、可信 Runner Controller 与每个执行安全域的 Worker 分属受限身份；服务数据/权威仓库与 worker profile/cache/temp 的 ACL 分离。Agent 无权直接写权威 worktree，命令在受限候选区执行，Broker 检查锁与 diff 后应用。AppContainer/VM 是另行验证的替代部署，不是已通过能力。G0 必交付 SID/目录/IPC/网络/句柄撤销矩阵与攻击性证据。

- 首版明确使用 Windows 原生执行域；若某 agent 仅支持 WSL，为其建立显式 worker profile，单独验证路径/权限/进程控制。
- 不自动把 `D:\...` 字符串传给 Linux 程序；不在两种执行域对同一 worktree 混合写入。跨域拷贝/挂载需列入实际测试。
- 可执行文件用绝对路径和参数数组启动，避免把用户输入拼成 shell 字符串。检查参数支持、退出码、编码与超长输出。
- `.cmd` / PowerShell wrapper 有额外转义语义；优先直接启动实际 executable；不可行时实现固定的受审查 wrapper，不拼接聊天文本。
- 覆盖中文/空格路径、盘符大小写、长路径、CRLF、文件锁、junction/symlink、Git 可执行权限差异、休眠恢复和并发端口。
- 根据实际能力使用 Windows Job Object 或等效进程树控制；PID 重用时核验启动时间和实例标识，不能误杀无关进程。
- 预览服务分配独立端口并记录归属；仅监听 loopback；停止任务时核对其子进程是否仍占端口。
- 安装、升级和签名在干净用户环境验证；不依赖开发机全局 Node/Python/隐藏路径才能运行。

## 10. 定向消息和不中断查询的连接器边界

定向消息在投递与读取时按成员权限 ∩ execution_grant ∩ 资源 ACL 过滤。同一成员的新公开执行也不能读取其旧私密执行的数据；工具、feed、cursor、附件、缓存和重连都绑定 grant。原生会话及可访问的记忆/配置按安全域隔离，含私密上下文的会话不能直接用于公开输出；无法可信分域的原客户端仅使用固定公开域。

工作期间的 progress_query 默认不进入 connector 的 prompt/send_input 路径；由状态服务读取它已经上报的事件。只有经过证明无任务副作用的状态读取接口才可作为额外观测源；不得把 provider 对话调用冒充状态查询。

无关的本人提问与新任务放 deferred_inbox，待当前任务自然结束后投递。匹配当前有效 input_request 的 continuation_reply 独立响应 waiting_user/waiting_peer，只恢复该等待点；不进入延后队列。能力不足时返回“已排队/状态信息有限”，不取消原任务，不另启替代 agent 代答。查询回执标明平台来源和观测时间。

兼容验收新增：在长任务执行时连续查询，检查无由查询造成的 prompt/steer/cancel/restart 或额外模型回合；同时验证隐藏私信不会进入 connector 输入和历史工具结果。

## 11. 兼容性验收记录

每次测试报告至少保存：OS/build、客户端/CLI/协议版本、认证模式、运行参数（脱敏）、连接类型、测试用例 ID、操作步骤、结果、原始日志/截图摘要、观察到的能力、限制、日期、执行者。

最低用例：身份映射、群隔离、消息往返、@ 路由、空闲唤醒、忙碌消息排队、停止/拒绝、文件补丁、检查结果、进程退出、断网、重启恢复、重复消息、上下文更新、用量未知情况。

发布前至少在一台干净 Windows 机器复现。每次客户端或 harness 升级重跑其契约与生命周期用例；对无法锁版本的自动更新客户端记录最近验证版本，并提供停用该 connector 的开关。


## 12. 参数归一化和严格写入资格（v1.4）

各 adapter 将平台的版本化 run envelope 映射成自身协议，不要求原生参数同名同义。manifest 分 required/optional/unsupported/unverified；provider 特有参数保留命名空间与 schema，启动前校验，不能把取消提示与关闭会话混为一项能力。每次 run 记录平台契约、原生协议和实际配置版本。

新增 write_enforcement、can_bypass_broker、writable_mount_scope、controlled_commands、file_lock_protocol_version、isolation_profile_id、write_revocation_proof、execution_scope_binding。要成为严格写入成员，必须证明所有项目写入由 Broker 或实际隔离控制；拥有任意 shell/额外插件写入其他 worktree 的能力视为未通过，不能靠自愿遵守锁升级为通过。不同 worktree 也遵守同一项目逻辑路径锁。

不能满足严格写入的原客户端保留只读、规划、评审角色；如指定其开发代码，G0 必须报告阻塞并验证实际隔离，不能静默取消文件独占要求。文件监视只作违规检测。

协调员是单独配置的系统成员，纯状态查询仍由服务回答。可选模型配置沿用 adapter 参数规范；名称变化只修改 display_name，不改变 member_id、权限或原生会话归属。

## 13. v1.4 环境、行为与外发准入

adapter 启动前核对 root_workflow、预算 reservation、environment manifest、配置指纹、验收/约束版本和外发 policy。原客户端的额外网络、插件、后台调用若不能纳入强制边界，必须如实声明限制；禁止外发的数据不能先送进原生会话再期待它自行保密，见 10 §10。

每次客户端/模型配置/提示模板/工具描述/上下文规则变化，行为资格置 reevaluation_required；版本不可观测时为 unknown。按 10 §8 在隔离资源上比较真实回归任务与原基线，不能只重跑协议握手。降级/停用作用于新任务准入，在途运行按已知状态核对，不盲目重启或假定可以回退厂商模型。

human_run 不经过模型 adapter，但沿用文件/资源锁、检查点和版本校验。原客户端需支持相关 Agent 在人工修改期间真正收敛写入，并在新快照和权限下继续；无法可靠续接则明确创建新 attempt/session，而非伪装原会话恢复。

## 14. 管家模型 API 与原客户端适配分开（v1.5）

管家由用户接入生成模型 API，使用 11 的 model_profiles/model_probes；不是把工作 Agent 改成同一模型。Claude Desktop 的自动响应、原客户端账号/能力门槛不因管家能够调用 API 而通过。通用 Adapter 契约用于工作 Agent；Model Adapter 负责模型消息、工具调用、结构化输出、流式完成、用量和错误归一化，两种适配器不能混为一种“统一聊天接口”。

C0 使用预先获准的最小合成数据，分别验证文本、tool call ID/参数/结果往返、Schema、截断与重复结果、上下文上限和 unknown 用量；生成/Embedding 模型分别验证。失败则只开放真实具备的能力：无工具能力仅总结/草案、流式失败退非流式、语义检索失败显式退授权全文。不得执行半段流式工具参数，不默认上传项目来“测试连接”。

按 profile revision 固定单次执行；更换模型/端点/提示/工具/图版本重新行为评估，不静默切 provider。Key 在系统秘密存储，原客户端凭证与管家 API Key 独立；传给 LangGraph/模型的图状态不得含可用凭证。自定义端点由用户配置，遵循 10 的目的地/网络/外发边界；本地模型也需明确允许。

管家 Graph Runner 与索引 worker 属于可信受控服务职责，不能让工作 Agent 从磁盘读取 checkpoint、向量/全文索引、模型配置秘密或动作账本。图/模型并发使用独立许可，但同时受设备总资源、provider 和 root 额度约束。后台索引不得借“维护任务”无限调用 Embedding。验收覆盖 CA-01–09、CA-25–33、CA-39 与平台 AT-161–162/170。

## 15. v1.6 联合兼容验证登记

按 12 §2 和 validation/compatibility-matrix.json 填写实际版本/build/摘要、账号匿名引用、启动身份、目录/网络/插件/shell 配置、工具链及统一 fingerprint。三原客户端逐项验证同一部署下的任务响应、私密隔离、受控写入、等待回复、不中断进度、真实撤写与恢复，不能拼接宽权限成功与受限权限安全结果。管家 API 记录独立，不替代 Claude Desktop 或其他原客户端。

UNKNOWN/NOT_RUN 不形成资格；LIMITED 列出人工步骤及禁用能力。配置变化使原资格待复验；无法满足用户指定代码职责时完整目标 G0=BLOCKED。所有实际凭据留在原安全存储，不填入方案模板。

## 16. W07开发运行器与未来附着边界（实施注记）

W07仅启用固定哈希配置的 development_fixture，以 owned_process 绑定平台自有测试进程；可信进程内RunnerController负责授权、持久化和Broker调用，worker只提交严格JSONL事件。原生RunnerHost的Job生命周期管理不构成安全沙箱：以当前用户运行的进程仍可能访问同用户资源，合作式等待begin的fixture不能推广为任意原客户端的启动隔离证明。

后续 attached_session 必须区分断开连接、中断回合、退出客户端；不得把自有进程的Terminate路径用于用户原客户端。参考[Agents Anywhere定向研究](research/2026-11-14-agents-anywhere.md)只提供源码线索，Claude SDK不能替代Claude Desktop。能力发现/配置校验与会话读写分别实现；只读查询不能顺手resume/接管，未知发送结果不能自动重发。实际适配入口仍需本章与09/12规定的固定版本、明确授权和同配置证据。
