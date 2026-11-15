# 群聊式 Agent 协作平台：实施设计包 v1.6

日期：2026-11-14，Asia/Tokyo。本目录交付性质：产品与技术设计；工作区现已另有 W03 核心参考服务和 0.3.0 原生 Windows 工作台，但不是完整产品。

**首次接手请先读 [项目交接说明.md](项目交接说明.md)**，其中逐文件说明内容、阅读顺序、角色分工、P0 启动任务和校验命令。便于连续阅读的合订版见 [完整方案.md](完整方案.md)，由分章生成。

## 当前构建优先级 · 2026-11-14

用户要求后端/平台先行，原生UI设计最后。W06开发态Broker基础之上，W07已实现固定开发进程的受控启动、授权patch、只读进度、停止/超时与退出对账，见[W07实施记录](W07-DEVELOPMENT-RUNNER.md)。只管理自有合成夹具，不接通原Agent，不等同原WBS工作包或G0/G1完成。源码现为schema 4；0.3.0便携包仍为schema 2、未重发，禁止用旧包打开已升级库。真实原客户端/Windows隔离/完整管家与生产灾备仍未完成；停稳development环境的本机恢复基础已另行实现。

参考项目研究：[Agents Anywhere 本机接入评估](research/2026-11-14-agents-anywhere.md)。仅静态源码证据；区分自有进程与原客户端会话附着，不替换 Claude Desktop，不改变原生 UI 或 G0/G1 门槛。

当前阶段：[管家前实施范围](PRE-COORDINATOR-FOUNDATIONS.md)、[W08适配基础](W08-ADAPTER-FOUNDATION.md)、[W09依赖/授权资料](W09-DEPENDENCIES-KNOWLEDGE.md)、[W10离线灾备](W10-OFFLINE-RECOVERY.md)已实现限定开发范围。真实客户端保持UNVERIFIED，不把底座当Agent上线。用户已确认coordinator-core-review-1为最新管家方案；实现仍停在管家之前。持续工作规则见项目根AGENTS.md。

## DSH初始化增量 · 2026-11-15

[W11 DSH ACP生命周期](W11-DSH-ACP-LIFECYCLE.md)已实现固定安装的独立initialize、能力观测、授权只读状态、关闭与断线处理，且完成真实编译走查；没有session/prompt/模型请求，没有接管原Desktop。初始化成功不是L1–L3资格，所有执行能力仍关闭。模块仅可信进程内使用，UI最后；用户于2026-11-15确认的最新管家设计已纳入本分支，管家仍不构建。

## 最新管家设计 · 2026-11-15确认

用户确认以下修改为最新版并授权提交；不再以旧版“方案未定”描述当前基线，不据此开放管家实现。

本轮管家设计补充（2026-11-14，coordinator-core-review-1）：已将九类核心清单与记忆/上下文/工具审查写入 [02](02-data-contracts.md) §7、[04](04-reliability-security-operations.md) §9/12、[10](10-delivery-risks-and-controls.md) §8、[11](11-coordinator-agent.md) §4/7/9/13/19；覆盖和验收入口见 [12](12-protocol-closure-and-validation.md) §7.3–7.5。样本升级为 coordinator-quality/1.1：20项基础题 + 6组连续变体/38步骤，均未运行，参考判断待独立人工审阅。平台v1.6/管家v1.2和250项AT/CA编号不变；这些是设计规则，不改变当前后端阶段或原客户端资格。

[W12 DSH独立新会话探针](W12-DSH-SESSION-PREFLIGHT.md)已获单独授权并完成一次真实新建/关闭/EOF验收，35项合成测试覆盖异常与启动边界。没有prompt、旧凭据或Desktop附着；生产适配器仍为initialize-only，模型任务与OS/窗口验收未升级。

## 阅读与交接

本设计包以用户已经明确的目标为基准：用户创建项目群、邀请 Codex / Claude Desktop / DeepSeek Harness 等 agent、自行分配职责；同群共享项目知识、协作数据和成果，agent 可以相互求助，共同完成项目。

文档中的 MUST 表示本方案建议的验收要求，SHOULD 表示可调整但须记录理由的建议；它们不代表用户已经接受某个软件版本、商业条款或范围变更。方案把未验证的能力列为实施门槛，不承诺“所有客户端一定能全自动协作”。

| 文档 | 使用者 | 内容 |
| --- | --- | --- |
| [01-product-architecture.md](01-product-architecture.md) | 产品负责人、架构师、全体开发 | 产品范围、流程、群语义、模块边界和技术决策 |
| [02-data-contracts.md](02-data-contracts.md) | 后端、前端、连接器开发 | 数据约束、消息、任务、状态机、API/MCP、共享记忆 |
| [03-agent-integration.md](03-agent-integration.md) | 连接器与运行器负责人 | 三个目标 agent、认证、能力分级、Windows、接入验证 |
| [04-reliability-security-operations.md](04-reliability-security-operations.md) | 后端、测试、运维 | 故障恢复、权限、代码集成、成本、备份和升级 |
| [05-delivery-acceptance.md](05-delivery-acceptance.md) | 项目经理、测试、交付负责人 | 工作分解、阶段门槛、验收矩阵、风险与交接要求 |
| [06-evidence-decisions.md](06-evidence-decisions.md) | 架构师、采购/发布负责人 | 官方依据、开源借鉴、未证实事项、决策记录 |
| [07-directed-messages-progress.md](07-directed-messages-progress.md) | 全体开发与测试 | 定向消息权限、不打断进度查询、忙碌时排队与新增验收 |
| [08-core-operating-decisions.md](08-core-operating-decisions.md) | 产品、后端、连接器与测试 | 存储、权限、参数适配、Git、文件独占与 Markdown、协调员的六项设计决定 |
| [09-review-closure-and-gates.md](09-review-closure-and-gates.md) | 架构、运行器、安全与测试 | 六项评审处置、失联恢复、执行 grant、Windows 部署决定、变更集依赖、完整灾备和等待回答 |
| [10-delivery-risks-and-controls.md](10-delivery-risks-and-controls.md) | 产品、后端、运行器、测试与交付 | 十项落地风险：阶段集成、验收保护、环境、人工介入、停滞、需求、体验、行为回归、资源和外发 |
| [11-coordinator-agent.md](11-coordinator-agent.md) | 管家/模型/知识/群服务/前端与测试 | 用户 API、LangGraph/受限 ReAct、RAG、委派/披露、计划并发与恢复；专项 v1.2，60 项 CA |

| [12-protocol-closure-and-validation.md](12-protocol-closure-and-validation.md) | 全体实施/QA/产品 | 部分执行/停止/收束、core/1.0 与等待协议、同配置验证、质量/效率样本及异常 UX |

阅读顺序以《项目交接说明》§4.1 为唯一入口；本页不另定义一套顺序。实施时回到对应源章与 contracts/validation。两份 research/ 历史调研保留独立 GitHub 选型信息，但不是实施规范。

已确认的 P0 文档准备见 [P0-PROBE-PLAN.md](P0-PROBE-PLAN.md)，16 项声明式探针见 [validation/p0-probe-manifest.json](validation/p0-probe-manifest.json)，专项离线回归见 [tools/test_p0_readiness.py](tools/test_p0_readiness.py)。它们不启动客户端，不授予实际执行权限，不改变产品 NOT_RUN / 兼容 UNVERIFIED / 契约 NOT_FROZEN。

本轮核心服务实施计划见 [W03-CONTRACT-BASELINE.md](W03-CONTRACT-BASELINE.md)。新增 transport-bindings / error-mapping / resource.schema 描述八操作 HTTP 绑定和六类只读投影；原 core/1.0 Schema 不变。运行代码、测试、OpenAPI 和证据在 plan 外；详见工作区根 README。它们不构成完整 W03 冻结或 G0/G1 通过。

本轮新增 [W04-LOCAL-WORKSPACE.md](W04-LOCAL-WORKSPACE.md)：W04 身份/普通消息离线子集 + W02 最小主人工作台。契约源为 [workspace.schema.json](contracts/workspace.schema.json) 和 [workspace-bindings.json](contracts/workspace-bindings.json)；支持单机配对、项目/指定成员登记、普通消息/分页搜索、任务草稿和可信绑定 feed。原客户端全部未接通，没有真实派工/执行；离线 UI/服务自检不改变250项NOT_RUN、兼容UNVERIFIED或正式冻结NOT_FROZEN。证据与运行说明在工作区根README，不放入本设计目录。

当前唯一维护目录为 `plan/`（本机 `D:\Users\1\Desktop\team\plan`），设计版本仍为平台 v1.6 / 管家 v1.2，目录整理版本为 plan-layout-1。十二章、contracts/、validation/ 是实施依据；完整方案由 README + 01–12 生成，保留作连续阅读。管家全文直接阅读 11，不再单独保存重复阅读稿。旧 docs/ 和 deliverables/ 中的已迁移副本、重复 ZIP/管家导出在本目录核对后清理；迁移摘要与结果见 organization-record.json，历史版本清理见 verification-report.json。需要对外分享时可按交接说明临时生成 ZIP，本目录不保留重复压缩包。

## 关键设计决定

1. 群聊是协作入口，平台是权威记录与调度服务；用户保有职责和范围决定权。
2. 群内共享已公开的版本化项目事实；定向消息只对发送者和指定成员可见，每次 agent 执行使用服务签发的 execution_grant 与独立上下文快照，同一成员的公开执行不能读取私密执行历史。
3. 分离群成员身份、原生会话、任务和运行尝试，避免把一段聊天误当成任务状态。
4. 采用“群服务 + MCP 协作入口 + 可替换运行连接器”；MCP 与运行控制协议分工明确。
5. 第一版以 Windows 本地部署、单人管理多个私有项目群为默认；核心数据带身份和群范围，不开放公网。原客户端接入仍是优先验证对象。
6. 建议独立实现小型群协作核心，借鉴现有项目；是否直接 fork 必须在源码与许可证审查后决定。协议层与业务层分开。
7. 数据库采用本地 SQLite，服务独占业务写入，持久化事务 outbox；文件和产物按内容摘要存储。
8. 一个项目绑定一个主群；独立 worktree 遵守跨工作区的项目逻辑文件独占写锁，完成版本与变更 Markdown 后交接，并通过同一个集成队列验收。
9. 平台不伪造 agent 进度、成本、权限能力或“任务已完成”；不可观测项显示未知。
10. 全自动原客户端协作若验证失败，必须报告目标未达成；辅助模式可交付为受限试用，但不可冒充完整版本。

11. 用户单独 @ 一个 agent 时形成定向消息；其他成员不能通过历史、搜索、摘要、工具或事件读取内容，回复继承相同可见范围。
12. 进度查询走独立只读状态通道；不向当前工作会话追加输入，不取消、重启或插入新的模型回合。

13. Git 项目自动创建受控本地检查点；变更记录与代码版本关联，自动提交、合并与远端发布分别管理。
14. 提供可自定义名称的协调员入口：服务统计事实，模型负责可选规划/解释；其权限不因“管理员”名称扩大。
15. 失联路径跨全部 worktree 保持隔离；撤实际写能力、核对进程与 journal 后才发新 epoch，不能换目录抢写。
16. handoff_ready、accepted、依赖 valid 分开；按完整 changeset/一致快照交接，消费 WIP 必须显式授权，失效传递阻止写入与合并。
17. 备份闭合平台状态、所有必需 Git 对象/引用与 dirty 成果；在原仓库不可用环境仅凭备份恢复。
18. continuation_reply 只回答当前有效 request_id，恢复对应等待点；无关提问继续排队。
19. 模块/接口有负责人，先做可运行纵向集成；受保护验收与阶段用户体验共同判断交付，不能用模型共识代替。
20. 人工修改先冻结相关范围并检查点，human_run 接管；管家根据实际 diff 汇报，消费者同步并重验后继续。
21. 环境/资源独立登记，子任务继承根工作流账本；没有验收进展时停止自动扩展，不靠消息量判断进展。
22. 升级要过行为回归；清理排除活动/未知资源和恢复引用；读取、联网、外发与发布分别授权。

23. 管家启用时使用用户自带生成模型 API，工作客户端保持独立；LangGraph 管流程，ReAct 做受限推理，RAG 检索授权知识，服务仍掌握事实。
24. 默认仅提议，有限自动委派须明确配置；私密派工的内容披露与动作批准分开，经批准的副本进入干净协作执行。
25. 跨管家图及人工任务修改共用计划头/资源版本 CAS，业务动作跨 attempt 去重；活动任务换人先撤写与完整交接。

这些是设计基线；第 11、12 项及文件独占与修改后记录来自用户明确补充的要求。它们不构成对外部产品兼容性的事实保证。

## 明确默认值

| 事项 | 设计默认 | 修改影响 |
| --- | --- | --- |
| 初期用户与部署 | 同一设备的单个使用者，私有项目群 | 多人/公网发布另过身份、授权和服务端部署门槛 |
| 首批目标 | Codex、Claude Desktop、DeepSeek Harness | Claude Code/SDK 可作另一个显式成员类型，不静默替换 Desktop |
| 项目 | 一个 Git 仓库对应一个主项目群 | 多仓库、多个群同时写同项目后置 |
| 并发 | 默认 3 个运行槽、每原生会话 1 个活动 turn | 以设备与 provider 实测调整 |
| 自动化 | 定向 @ 先按意图区分查询与指令；进度查询不派工，指令按授权和忙闲状态执行/排队 | @全体才进入全组讨论；普通消息不全员唤醒 |
| 定向可见性 | 发送者与显式收件成员可读，回复继承；群摘要和其他成员上下文不得包含 | 扩大范围必须由用户显式发布指定内容 |
| 进度查询 | 根据既有运行事件返回状态与更新时间；无关本人提问等当前工作结束；绑定等待请求的回答立即校验并恢复该等待点 | 不伪装成 agent 刚刚停止工作并亲自回复 |
| 数据去向 | 元数据与产物留在本地；被发给 agent 的内容可能交由其服务方处理 | 本地存储不等于本地推理 |
| 版本与交接 | 受控本地 Git 检查点，文件锁跨 worktree 生效；完整变更集可交接不等于已验收，WIP 依赖须显式登记 | 自动 push/merge 需单独规则；不能保证写入隔离的连接器不启用严格写入 |
| 协调员 | 可更名入口；确定性报告始终可用；启用用户 API 后提供 LangGraph/ReAct/RAG 管家 | 默认 propose_only；bounded_auto 需明确授权，不代替工作客户端 |
| 私密派工 | 披露内容/接收者与派工动作分别批准；下游新 grant/干净上下文 | 一般委派不转发私信；载荷或服务方变化需复核 |
| 计划应用 | 项目计划头和读写集合 CAS + 动作账本/outbox | 单图互斥不等于跨图安全；活动负责人变更必须交接 |
| 发布与部署 | 不默认替用户执行外部发布 | 以后通过专门权限和流程接入 |

## 六项先做验证的条件

- H1：原版 Claude Desktop 能通过所选 MCP 入口入群、读写项目工具，并在所需状态下响应任务。其自动唤醒能力目前未证实。
- H2：所固定的 Codex 集成版本满足生产目标；官方页面对于 app-server 稳定性的表述存在差异，不能忽略。
- H3：DeepSeek Harness 的实际 ACP 能力、可执行入口和本地权限适合所需交付；不能要求它输出接口未提供的 UI 或完整轨迹。

- H4：选定 Win-SID-Broker-1 能约束原客户端的 shell/插件/子进程，且工具身份可信绑定到执行 grant。未通过不开放相应写入/私密执行资格。
- H5：单 Agent 原型能完成一致快照交接、请求输入/回答、崩溃核对和完整灾备闭环。未通过不开放三 Agent 代码协作。

- H6：C0/C1 验证用户 API/图恢复/动作幂等与授权 RAG；私密披露、有限委派和跨图计划原子应用通过反例测试。管家模型关闭不影响确定性控制，不代表完整管家已验收。

03、05、09、11 和 12 规定测试办法、证据和失败后的处理。任何一项未通过，都不能把完整目标标成已完成。

- H7：同一实际配置能同时满足原客户端可用与强制隔离；不是拼接两套配置。
- H8：部分执行/停止/等待竞态按12的协议可恢复，质量、锁效率和异常用户流程达到预登记标准。

H7/H8 的联合记录与样本已提供，但尚未实测；P0–P2 结果不成立时必须回填限制，不能只继续扩大 UI 投入。

## 本次工作的边界

文档范围：保留 v1.3 六项底层规则、v1.4 十项运行控制和 v1.5 管家合并；v1.6 补齐部分执行、核心协议/等待、同配置联合验证、质量/效率样本及四异常流程。共 33 项需求、190 项平台 AT 与 60 项管家 CA（250 项产品验收定义，全部 NOT_RUN）。另有26个 wire 格式/语义边界样例、16项声明式故障样本、20项公开质量样本、4类效率负载和4条兼容记录；它们不重复计为已通过的产品测试。校验见 verification-report.json，处置见 DESIGN-REVIEW.md。v1.6 初次内容修订曾增量读取 E33 JSON Schema 官方依据；上一轮 p0-preparation-1 只修正文档口径、准备探针及离线检查，没有重新联网获取来源，既有来源保留历史日期。

W03 已执行 Node 依赖锁定安装、本机确定性服务测试及编译冒烟，证据独立保存；本轮官方技术资料取回记录位于工作区 evidence/w03/2026-11-14-core-baseline/source-records.json，不修改既有 E33 历史。仍未执行：原客户端启动/登录、计费模型调用、跨 agent 原型、候选项目全部源码审核、原客户端/Windows 安全隔离和性能实测。因此所有性能数字是建议验收目标，兼容矩阵均不得标为“实测通过”。

方案完整性的依据是需求可追踪、风险可验证、失败有处理方式，而非保证将来不出现问题。

当前原生客户端阶段见 [W05-NATIVE-DESKTOP.md](W05-NATIVE-DESKTOP.md)。这是前端与所属服务生命周期交付，不等同原 WBS 受控执行/恢复的 W05 完成。原生窗口操作权限不足，真实点击/视觉走查待补；产品门槛保持不变。

## Claude Desktop本地MCP与只读桥 · 2026-11-16

[W13](W13-CLAUDE-DESKTOP-MCP-PROBE.md)已完成MCP发现与合成只读桥，真实Desktop工具调用仍为0。用户明确指定CC Switch的me分组＋路由模式。2026-11-16只读复核发现live-state为proxy/attached，proxy_route匹配me；settings旧选择器仍为official、数据库is_current仍为cc7，二者不能替代活动路由证据。此前仅固定Desktop网关文件，未固定me，相关结论已收窄为MCP传输通过。第八次测试窗口发现MCP但未发送prompt、tool_calls=0，模型不可用提示未解决；测试实例退出与凭据清除已核实。现在第三方准备入口要求绑定路由目标、live-state及provider元数据摘要，并在启动前再次核对；这仍不是运行时provider外发证明。用户已授权一次独立窗口合成任务，不重复索取；当前已有用户Claude实例，不能接管或重启，下一次真实尝试尚未启动。 同配置Windows隔离和完整任务接入未完成；管家仍不构建。见[证据](../evidence/claude-desktop/COMPLETION.md)。
