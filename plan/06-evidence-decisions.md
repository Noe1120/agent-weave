# 06 资料依据、选型与决策记录

原调研日期：2026-11-13；v1.3 于 2026-11-14 重读 E01/E05/E09 与 E15–E19；v1.4 同日增量核验 E20–E22（Asia/Tokyo）。v1.5 同日读取 E23–E32（管家框架/检索依据）；v1.6 同日增量读取 E33（JSON Schema 格式）；其余保留为历史依据，未声称每次修订都全部重新核验。本文件区分：官方文档事实、开源项目的自述、设计建议、尚未验证的假设。没有安装候选项目或审计全部源码。

## 1. 官方依据索引

| ID | 来源 | 该来源支持的有限结论 |
| --- | --- | --- |
| E01 | OpenAI Codex App Server | 提供 thread/turn、请求/事件；用户输入请求列为实验功能，详细段落涉及原生 request 与 resolved/清理行为，按实际 schema 验证 |
| E02 | OpenAI Codex MCP server removal | 旧命令已移除；迁移页同时保留 app-server 实验性与生产限制说明 |
| E03 | Anthropic Claude Desktop Local MCP | Desktop 支持本地 server 和扩展安装；该页不保证任意状态自动唤醒 |
| E04 | Anthropic Agent SDK overview | SDK 与原 Desktop 是不同接入方式；第三方产品的登录/额度和品牌使用有规定 |
| E05 | DeepSeek Harness ACP package | 这是面向自动化的桥；能力和取消/关闭行为有明确边界 |
| E06 | ACP v1 Initialization | 协议版本与可选能力需要协商；遗漏的能力不能视为支持 |
| E07 | MCP 2026-07-28 官方发布说明 | 协议核心、通知和授权有变化；旧示例不能直接充当当前客户端能力证据 |
| E08 | MCP Authorization（draft） | HTTP 与 stdio 的凭证处理不同；token 必须绑定正确资源和身份 |
| E09 | MCP Security Best Practices（2025-11-25 固定规范） | 实现授权的服务逐请求验证；session 不能用于认证，关联需绑定已认证身份 |
| E10 | Git worktree 官方手册 | 支持多个工作树，部分 Git 元数据共享 |
| E11 | Electron Security | 渲染隔离、IPC 验证和远程内容加载需要显式约束 |
| E12 | SQLite WAL | WAL 的同主机限制、checkpoint 与伴随文件不能被忽略 |
| E13 | SQLite Backup API | 存在可对活动数据库创建一致性快照的官方机制 |
| E14 | Git update-ref 官方手册 | 可核对旧引用值更新 ref，并支持多 ref 事务；不意味着 Git/数据库/文件系统跨系统原子 |
| E15 | Microsoft AppContainer isolation | 描述资源隔离目标；不证明三个原客户端或工具链兼容 |
| E16 | Microsoft How DACLs Control Access to an Object | DACL 与线程访问令牌用于对象访问检查；须据此配置并测试实际身份边界 |
| E17 | Microsoft Job Objects | 提供进程分组/终止等能力，也存在 breakaway/子进程例外；不能当作完整安全边界 |
| E18 | Microsoft File Security and Access Rights | 文件对象的安全描述符、访问权与句柄关系；目录/进程 profile 要实际验证 |
| E19 | Git bundle 官方手册 | 打包 Git refs/对象不包含完整 index/working tree，本地灾备须另补 dirty 成果 |
| E20 | OpenAI Working with evals | 定义预期任务、运行测试输入、分析结果并迭代；不保证本项目的回归通过率 |
| E21 | Playwright Isolation | BrowserContext 用于隔离浏览器 cookies/storage 等测试状态；不证明后端资源或 OS 已隔离 |
| E22 | OWASP SSRF Prevention Cheat Sheet | 目的地/IP/domain 验证、重定向与 DNS 绕过防护；不是完整数据防泄漏方案 |
| E23 | LangGraph JavaScript overview | 图式编排与持久化/人工介入基础；不替代本项目业务授权 |
| E24 | LangGraph Workflows and agents | 预定义 workflow 与动态 agent 的分工，可组合受控流程 |
| E25 | LangGraph Fault tolerance | 持久化重放与副作用应幂等或去重；不提供外部操作天然 exactly-once |
| E26 | LangGraph Interrupts | 等待可持久化，恢复会从节点开头重入；先前副作用需幂等 |
| E27 | LangGraph Persistence | thread checkpoint 与跨线程 store 分工，不构成本项目的访问控制 |
| E28 | LangChain Retrieval | 可检索现有数据库/文档/全文系统，不必先重建向量库 |
| E29 | LangChain Models | 统一模型接口仍有工具/结构化/流式等不同能力，需逐配置验证 |
| E30 | Embedding models integrations | 嵌入模型具有独立文档/查询向量接口，须另配能力与授权 |
| E31 | LangGraph v1 migration | 迁移页将 createReactAgent 标为弃用并指向 createAgent；按固定版本核对 |
| E32 | OWASP Vector and Embedding Weaknesses | RAG 中的访问控制缺陷、知识污染和泄漏风险，提示词不是隔离边界 |
| E33 | JSON Schema 2020-12 Core | Schema 方言、复用定义与引用；不提供业务授权、事务或 exactly-once 保证 |

来源地址（编码格式便于复制，页面可能更新）：

- [E01] `https://learn.chatgpt.com/docs/app-server.md`；官方入口 `https://developers.openai.com/codex/app-server/`。
- [E02] `https://learn.chatgpt.com/docs/mcp-server`。
- [E03] `https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop`。
- [E04] `https://code.claude.com/docs/en/agent-sdk/overview`。
- [E05] `https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/acp/acp/README.md`。
- [E06] `https://agentclientprotocol.com/protocol/v1/initialization`。
- [E07] `https://blog.modelcontextprotocol.io/posts/2026-07-28/`。
- [E08] `https://modelcontextprotocol.io/specification/draft/basic/authorization`。
- [E09] `https://modelcontextprotocol.io/specification/2025-11-25/basic/security_best_practices`；v1.2 曾引用 draft 页面，本轮改用固定规范的授权/会话安全说明。
- [E10] `https://git-scm.com/docs/git-worktree`。
- [E11] `https://www.electronjs.org/docs/latest/tutorial/security`。
- [E12] `https://sqlite.org/wal.html`。
- [E13] `https://sqlite.org/backup.html`。
- [E14] `https://git-scm.com/docs/git-update-ref`。

- [E15] `https://learn.microsoft.com/en-us/windows/win32/secauthz/appcontainer-isolation`。
- [E16] `https://learn.microsoft.com/en-us/windows/win32/secauthz/how-dacls-control-access-to-an-object`。
- [E17] `https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects`。
- [E18] `https://learn.microsoft.com/en-us/windows/win32/fileio/file-security-and-access-rights`。
- [E19] `https://git-scm.com/docs/git-bundle`。
- [E20] `https://platform.openai.com/docs/guides/evals`。
- [E21] `https://playwright.dev/docs/browser-contexts`。
- [E22] `https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html`。

- [E23] `https://docs.langchain.com/oss/javascript/langgraph/overview`。
- [E24] `https://docs.langchain.com/oss/javascript/langgraph/workflows-agents`。
- [E25] `https://docs.langchain.com/oss/javascript/langgraph/fault-tolerance`。
- [E26] `https://docs.langchain.com/oss/javascript/langgraph/interrupts`。
- [E27] `https://docs.langchain.com/oss/javascript/langgraph/persistence`。
- [E28] `https://docs.langchain.com/oss/javascript/deepagents/retrieval`。
- [E29] `https://docs.langchain.com/oss/javascript/langchain/models`。
- [E30] `https://docs.langchain.com/oss/javascript/integrations/embeddings`。
- [E31] `https://docs.langchain.com/oss/javascript/migrate/langgraph-v1`。
- [E32] `https://genai.owasp.org/llmrisk/llm082025-vector-and-embedding-weaknesses/`。
- [E33] `https://json-schema.org/draft/2020-12/json-schema-core`。

E08 仍为 draft，E09 为固定规范；它们提供设计依据，不意味着未来实现可忽略实际协议协商。P0 应固定实际支持的协议/SDK，并归档对应规范版本。厂商账号能访问哪些功能也必须独立验证。

## 2. 必须保留的事实边界

### Codex 稳定性

E01 的“稳定 API surface”与 E02 对 app-server 的整体实验性描述不同。本方案记录两者并存，不声称已经得到厂商对生产稳定性的保证。实施团队应保留固定版本、使用方式和风险处置决定。

### 原客户端与 API

MCP 工具可用不等于原客户端在结束回合后会主动调用工具，也不等于平台可以接管已有聊天。官方支持一种集成方式，不代表支持所有第三方组合。

### 第三方仓库声明

README 说明某功能存在，只能作为候选证据。未经实际测试，不把 Windows 安装包、支持列表或“自动唤醒”文字当作本项目验收通过。

### 本地与外部数据

数据库在本地不代表模型在本地推理。提交到 agent 的上下文仍可能发送给对应 provider，是否留存和如何计费以实际接入方式和条款为准。

## 3. 开源参考项目

| ID / 仓库 | 可借鉴部分 | 边界和取舍 |
| --- | --- | --- |
| P01 rainyflash/agent-room | 人与 agent 同房间、邀请、成员归属、自动回复控制；README 标为 Alpha，基于 Matrix | 参考产品交互。是否 fork 要看源码/维护/密钥信任模型；不为本地 MVP 自动引入联邦体系 |
| P02 puffo-ai/huddo-mcp | 邀请入群、消息、等待、附件，列出 Desktop 配置 | 参考连接器工具面；仓库是 Huddo 接入包，不能据此假设完整服务可本地自部署 |
| P03 WarrenSchultz/chatroom-mcp | 原子任务领取、版本冲突、群事件、hooks/watcher | 参考协作与领取；现有唤醒方案针对 Claude Code，不能直接推广到 Desktop |
| P04 Alex-R-A/multi-agent-collaboration-mcp | 已运行本地客户端的共享房间、角色和历史 | 参考小型原型；README 明确身份自报、浏览器无登录和监听限制，不能照搬为多用户安全边界 |
| P05 OrchestratorInc/agent-orchestrator | 每任务 agent/branch/worktree、检查/评审/合并反馈、多种 agent 适配 | 参考运行与交付层；不把任务看板直接当作完整群协作核心 |

- [P01] `https://github.com/rainyflash/agent-room`
- [P02] `https://github.com/puffo-ai/huddo-mcp`
- [P03] `https://github.com/WarrenSchultz/chatroom-mcp`
- [P04] `https://github.com/Alex-R-A/multi-agent-collaboration-mcp`
- [P05] `https://github.com/OrchestratorInc/agent-orchestrator`

这些项目规模、成熟度和信任模型不同，不能凭功能名称相同就直接拼接。星数不是兼容性或安全证据，本方案不以星数排序。

如果决定复用，逐项记录：准确 commit/tag、LICENSE/NOTICE、依赖与捆绑资源许可、构建可复现性、网络/遥测行为、维护活动、未解决关键问题和本地兼容结果。未检查的项目填 UNKNOWN，不填通过。

## 4. 三条技术路线的取舍

| 路线 | 优点 | 主要代价 | 当前决定 |
| --- | --- | --- | --- |
| 直接 fork 完整群聊项目 | 快速获得 UI/房间/邀请 | 继承整个运行和信任模型，可能带入 MVP 不需要的设施 | 作为备选，P0 后有证据再决定 |
| 独立小型协作核心 + 已有协议/连接器思路 | 数据和权限边界围绕本需求设计，可替换 runner | 需要自行完成消息可靠性和客户端集成 | 推荐基线 |
| 在代码工作台上加群聊 | 可以复用 worktree/CI/评审 | 群成员、记忆、外部客户端可能与既有任务模型不匹配 | 仅当源码边界证明适合时采用 |

独立核心不是重新实现 provider 的 agent loop，也不是重新发明 MCP/ACP。实现重点应在群语义、可靠调度、项目记忆和验收；协议用官方 SDK/明确适配层。

## 5. 架构决策记录

| ADR | 决定 | 理由 | 重新评估条件 |
| --- | --- | --- | --- |
| ADR-01 | 群与项目协作核心独立于任何 provider | 接入和用户分工会变化 | 现成项目通过全部核心验收且扩展成本更低 |
| ADR-02 | 本地模块化单体，分离 runner 进程 | 控制复杂度，同时隔离运行生命周期 | 多机器/多人需求被正式纳入 |
| ADR-03 | 单服务写 SQLite + outbox | 本地可部署、事务边界清楚 | 实测吞吐/多机目标需要服务端 DB |
| ADR-04 | 公共记忆有版本，输入用快照 | 避免不同成员依据不同事实 | 新检索机制仍需保持来源与版本 |
| ADR-05 | 消息至少一次 + 消费幂等 | 承认故障窗口并消除重复派工 | 不因换消息中间件取消此要求 |
| ADR-06 | 每任务写入工作区 + 单集成队列 | 改动归属与组合验收明确 | 非 Git 项目另行制定产物集成规则 |
| ADR-07 | MCP 协作与运行 adapter 分层 | 工具调用不等于原客户端唤醒 | 厂商提供新的官方控制接口 |
| ADR-08 | 无法证明的能力显示未知/辅助模式 | 防止产品口径和真实行为不一致 | 实测通过才升级能力等级 |
| ADR-09 | 默认用户确认合并与外部发布 | 保持项目和外部副作用的控制权 | 用户制定受限自动化规则 |
| ADR-10 | 首版不强制向量库，不做微服务/联邦；授权全文检索优先 | 先证明三 agent 交付闭环，语义索引按 C0/C2 评估增补 | 新后端仍须通过 ACL/外发/版本/恢复，不是正确性来源 |
| ADR-11 | 单独 @ 默认窄 audience，回复/派生内容继承，扩大范围由用户发布 | 用户明确要求其他 agent 不读取定向指令 | 只有用户明确改变产品规则才可调整 |
| ADR-12 | 进度查询不进入工作会话，无关本人提问排队；匹配活动等待请求的回答独立恢复 | 用户明确要求工作中询问不打断任务 | 新接口必须通过无副作用实测，不能降低此要求 |
| ADR-13 | 同项目逻辑文件跨 worktree 强制单写者，记录/版本完成后交接 | 用户要求同文件同时间单 agent 修改并写 MD 告知其他成员 | 只能由用户明确放宽，不能以监视器/独立分支代替 |
| ADR-14 | 受控自动本地 Git 检查点，私有记录不自动发布 | 可恢复且不覆盖用户已有工作 | 用户调整频率/发布规则；不降低证据与恢复要求 |
| ADR-15 | 协调员由服务与可选模型组成，名称可自定义 | 汇总进度与派工便利，状态/权限仍确定可靠 | 更换模型不改变权限；不能自动继承用户私信 |
| ADR-16 | 实际撤写/停止、进程和 journal 对账完成后才解除逻辑隔离 | 统一失联重试与跨 worktree 单写者 | 只有等效可靠写能力切断证据可替代停止，不接受超时推断 |
| ADR-17 | 服务端 execution_grant 与原生安全域隔离 | 防同成员跨私密/公开执行读回历史 | 新协议也须通过逐执行权限验收 |
| ADR-18 | 完整 changeset + 一致快照；WIP 显式依赖并传递失效 | 单文件 digest 不能保证跨文件一致性 | 可换底层版本工具，不降低依赖与组合验收要求 |
| ADR-19 | G0 首先验证 Win-SID-Broker-1 | 明确进程身份、ACL、IPC、命令与撤权边界 | 兼容失败则新 ADR 验证 VM/AppContainer 或保留受限角色 |
| ADR-20 | 平台/Git/dirty 三部分闭合备份 | 本地提交与未提交成果不能仅凭 hash 恢复 | 更换备份技术仍须离线干净恢复验收 |
| ADR-21 | continuation_reply 独立于普通输入和 approval | 消除等待任务与排队回答死锁 | provider 不支持时明确阻塞/人工模式，不伪装等价 |
| ADR-22 | 接口 owner + 分阶段纵向集成 + 用户场景 | 避免各模块完成而整体不可用 | 调整里程碑不取消整体场景验收 |
| ADR-23 | 生效验收独立于作者候选测试 | 降低断言不能自动替代业务正确 | 验收修改产生新 revision 和独立确认 |
| ADR-24 | human_run 受控接管、实际 diff 报告、消费者重验 | 人工修改也需避免并发与旧结果复用 | 外部 editor 必须同等受控；旁路直改按异常 |
| ADR-25 | 运行环境与资源单独登记/隔离 | worktree 不能覆盖 DB/缓存/浏览器/端口 | 后端可替换，但须验证真实访问边界 |
| ADR-26 | 根工作流累计账本与无进展停止扩展 | 防派生任务规避预算和反复返工 | 阈值可调，历史和已消耗额度不清零 |
| ADR-27 | 版本化约束/假设、早期体验与反馈闭环 | 避免依据未经确认假设走远 | 普通技术细节仍可在授权内自主决定 |
| ADR-28 | 连接兼容与行为回归分别验收 | 协议正常不证明升级后仍守要求 | 每次相关配置变化复验，不能虚构可回滚 |
| ADR-29 | 分类并发和依赖感知清理 | 防资源累积与删除唯一恢复证据 | 配额可调，未知写入者和 pins 不可忽略 |
| ADR-30 | read/connect/transmit/publish 分离 | 可读数据也可能禁止送到某 provider | 实际边界不满足则限制数据范围或拒绝组合 |
| ADR-31 | 用户 API + LangGraph + 受限 ReAct + 授权 RAG | 管家理解/解释与确定性状态分开，工作客户端不变 | 替换框架须保持动作/恢复/权限契约 |
| ADR-32 | propose_only 默认与可撤销有限委派 | 用户保留职责决定权，减少已授权小事反复审批 | 策略显式修订，不自动扩权 |
| ADR-33 | 披露与派工分别批准，干净协作上下文 | 私密入口可以组织协作而不转发全部私信 | 用户明确发布指定载荷；不能降低执行域隔离 |
| ADR-34 | 项目计划头 CAS + 读写集合 + 业务动作账本 | 单图互斥不能解决跨图/用户并发；崩溃恢复不能重复派工 | 可优化粒度但不得减少原子检查与安全交接 |
| ADR-35 | 管家复用平台实体，专项第 11 章单源维护 | 避免人工介入/预算/验收和文档版本双重真相 | API/schema 改动同步共享契约与两组验收 |
| ADR-36 | 部分执行默认依赖隔离，控制与成果撤销分开 | 数据库原子应用不能代替多成员整体执行 | 调整策略须明确范围/授权，不降低撤写/验收/费用核对 |
| ADR-37 | 等待注册检查、消费恢复意图各自原子提交 | 防先完成后等待、通知丢失和图重入重复业务动作 | 外部副作用仍需幂等/查询，不能声称跨系统恰好一次 |
| ADR-38 | core/1.0 与公开样本先成文、实测资格另记录 | 避免多模块各自解释，区分文件检查和产品验证 | 变更版本/反例/映射同步，冻结不代表已实现 |

## 6. 开发前必须解决的开放事项

| 问题 | 当前状态 | 验证或决定方式 |
| --- | --- | --- |
| 原版 Desktop 是否达到目标自动响应能力 | 未实测 | P0 + AT-31，失败则明确范围决定 |
| Codex 的具体版本、稳定性与适用方式 | 文档存在表述差异，未实测 | E01/E02 + P0 + 版本锁定 |
| DeepSeek 实际版本与工作区/取消能力 | 有官方接口说明，未实测 | P0 + AT-32 |
| 是否必须沿用正在打开的原生聊天 | 用户未明确要求接管既有会话 | 默认新建/显式加入项目会话；若要求接管需新增验收，不静默执行 |
| 当前前端技术路线 | 用户已明确要求原生（2026-11-14） | WPF 原生 Windows 控件；服务契约不变，禁止浏览器壳 |
| 是否很快需要多用户/跨设备 | 未确认 | 默认本地单用户；新增为下一阶段范围 |
| 使用方式和第三方账号额度是否被允许 | 依赖具体 provider/模式 | 按官方支持方式与实际账号验证，不迁移 cookie/token |
| 复用仓库的完整许可证和依赖 | 未全面审计 | 选定 commit 后完成发布检查 |

这些开放项不会被包装成“已解决”。它们都有明确负责人和门槛，不要求在本次对话里逐一问用户才能交付设计。


## 7. v1.1 的需求依据

FR-17、FR-18 和 ADR-11、ADR-12 来自本次用户直接补充，属于产品要求，不是由开源项目能力推导出的限制。本次只修改设计，未新增外部产品支持声明或运行验证。


## 8. v1.2 的需求依据

用户明确要求同文件同时间仅一个 agent 修改，修改后写入 Markdown 让其他 agent 了解。FR-20 为硬约束；存储分层、权限五维、adapter 参数归一化、自动 Git 本地检查点和可更名协调员是针对其六个问题提出的设计建议。新增 FR-19/21 与验收将这些建议转为可评估的实施基线。

已知关键限制：无法受控的原生文件/shell 写入不能满足严格独占要求；共享 Git 仓库的分支不提供私信保密。不能在未实测时把所有原客户端标成可写成员。

## 9. v1.3 增量核验与证据边界

六条评审均已对照原章核实，实际冲突与修订映射见 09 §1。E09 支持逐请求验证与 session 非认证；execution_grant 的字段、原生实例分域和三层交集是本平台设计，并非宣称 MCP 已内建完整 run 授权。

本轮通过官方页面直接获取内容核验 E01/E05/E09/E15–E19；网络检索工具没有返回可读内容，随后通过获准的只读 HTTP 请求取得页面。source-verification.json 记录请求地址、读取日期、内容摘要与支持的有限结论。E05 使用官方仓库 master 内容并保存 SHA-256，尚未固定发行 commit，实施时仍须锁定实际版本。

E01 的输入请求是实验性、页面方法名表述有细节差异；E05 明确列出 elicitation 不支持。09 的适配器契约要求独立能力验证，不能从规范化 respond_input 方法反推客户端支持。Windows 文档只证明机制存在，Win-SID-Broker-1 及替代 VM/AppContainer 与原客户端是否兼容仍 NOT_RUN。E19 证明 bundle 覆盖限制，完整备份切点/闭包是本平台提出的实现要求。

## 10. v1.4 落地风险依据

十项问题来自用户本轮补充；对应的阈值、运行状态、human_run、root 账本、验收保护和外发策略属于本平台设计，不宣称参考项目已提供这些保证。新增 FR-22–FR-29 及 AT-111–AT-160，既有 FR-04/08/16 扩充验收语义。详见 10。

E20–E22 本轮已读取官方原文，source-verification.json 保存读取日期、内容摘要和有限结论。检索工具未返回可读内容，随后使用获准的只读 HTTP 获取页面；未因此增加产品实测结论。原缓存不参与实现或证据引用，清理后保留 URL/摘要/结论记录。

## 11. v1.5 管家合并依据

用户提供管家专项 v1.0，并授权按核对结果修改整体方案。本轮保留其 24 节设计和 40 项既有 CA，合并为 11 专项 v1.1，新增 12 项 CA 与 12 项 AT。新增 FR-30–FR-33，定义总计 33 项需求、172 项 AT 和 52 项 CA。规则与阈值是本项目设计，不声称 LangGraph/RAG 自动实现了业务安全。

原专项 S01–S10 一一对应 E23–E32，本轮 web.run 未返回可用内容，随后获准以只读 HTTP 读取官方页面，记录 URL、实际最终地址、读取日期、内容 SHA256 与有限结论。实际请求旧 durable-execution.md 跳转到 persistence.md；副作用边界另读 fault-tolerance.md。未把页面读取当作运行实测。未重读的 E01–E22/P01–P05 保留原日期与状态。实际依赖版本、模型/Embedding 能力、checkpointer、账号、Windows 原客户端资格及质量阈值仍需 P0/C0 实测固定。

v1.5/v1.6 内容修订时曾由11生成独立管家阅读稿。2026-11-14目录整理后，当前唯一入口为plan/，管家专项直接读11，合订版由README与十二章生成；旧位置、重复ZIP和专项导出在新目录核对后清理。历史引用与清理摘要保留，不再依赖旧文件；本次目录整理没有重新查询外部来源或改变业务协议。

## 12. v1.6 六项评审与验证材料依据

本轮用户授权完善上一轮六项评审。新状态、等待算法、错误协议、调度公平性、质量/效率阈值和异常流程均为本项目设计，不能归因于某框架已自动保证。保留33项FR，新增18项AT与8项CA，总计250项产品验收定义，全部NOT_RUN。

E33 通过获准只读 HTTP 取得官方页面（web工具未返回可用正文），记录真实HTTP200、长度和SHA256；只支撑 Schema 方言/定义/引用的有限事实，不证明本平台字段或业务设计正确。既有来源未全部重读，保留历史核验记录。

本轮提供最小 Schema、26个wire样例、16项声明式故障样本、20项公开质量题、4条兼容登记、4类效率负载及离线设计校验脚本；它们均非产品实现。格式/文档检查与250项产品实测分开记录，人工oracle审阅、隐藏留出题、真实客户端/API/Windows隔离/性能/用户流程仍待执行。

## 13. 原生 Windows 界面决策（0.3.0）

用户明确“就是要原生的”，取代原 Electron/Tauri 建议。WPF 作为 Windows 原生控件前端，保留 Node/SQLite 权威服务；所属私有管道配对、关闭/崩溃进程回收和明确错误反馈属于本轮实现，不外推为 Agent 强制隔离或完整产品资格。布局删减重复文案，以项目/对话/任务与按需成员视图表达结构。

- [E34] `https://learn.microsoft.com/en-us/dotnet/desktop/wpf/overview/`。只支持框架能力，原生包/测试证据另存。
- [E35] `https://builds.dotnet.microsoft.com/dotnet/release-metadata/10.0/releases.json`。选用发布日期 2026-11-10 的 SDK 10.0.404 / runtime 10.0.15，固定 ZIP SHA512，本地安装不改变系统 SDK。

web.run 未提供可读正文，按现有网络权限只读取得官方资料；来源记录在 source-verification.json。Computer Use 未获准读取 Team 窗口，真实原生点击/视觉走查尚未完成，不以后台测试替代。未调用模型或启动指定原 Agent。
