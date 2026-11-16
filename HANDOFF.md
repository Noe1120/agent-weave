# Agent Weave 会话交接

更新时间：2026-11-16，Asia/Tokyo。面向完全没有此前聊天上下文的新会话。

**工作位置最新决定：用户已要求同步回 `D:\Users\1\Desktop\team`，后续以该主工作区继续。C 盘 linked worktree 保留，不再作为默认交付位置。新会话应显式指定 D 盘 workdir；聊天原绑定目录可能仍指向 C 盘，不能仅凭默认 cwd 推定用户希望的位置。**

## 0. 先看结论

### W16 最新增量（优先于下方前序交接）

用户已明确“暂缓 Windows 隔离部署与实测，先推进产品级连接管理后端”。本轮在 D 盘主工作区的 `codex/connection-management` 分支实施 [W16](plan/W16-CONNECTION-REGISTRATION.md)：主人邀请、单次兑换、登记凭据、只读列表/自身状态、过期/撤销/成员变更失效。没有迁移、原客户端启动、模型调用或系统策略改动。登记状态 registered **不等于在线**，runtime_state 始终 not_connected，凭据不能用于 execution_grant/runtime_control。

代码入口 `packages/service/src/connection-registry.ts`、`workspace-http.ts`、`http.ts`；测试 `tests/connection-http.test.ts` 和编译后 `tests/connection-walkthrough.mjs`。源库 schema4 不变。邀请 10 分钟，连接凭据自签发起 8 小时；签名键轮换/备份恢复后旧凭据拒绝。成功兑换仅返回自己的登记元数据，不开放项目内容。下一阶段应实现受信连接器/原生会话绑定与按任务最小授权，不能把邀请持有者自行声明的 fingerprint 当真实客户端身份。验证与交付见 `evidence/connection-registration/COMPLETION.md`，Git 状态以实际 log/status 为准。

以下记录保留 W15 交接历史；其中“下一方向尚未编码”已由本增量取代。

1. 我们在构建 **Agent Weave：独立原生 Windows 多 Agent 项目协作平台**，不是浏览器壳，也不是用模型 API 替代原客户端的聊天软件。
2. 最新已交付阶段为 **W15 受保护运行管理后端**，代码提交 `0f2134ff6eb93f1f0c0642a55813a722f86e6fc1`，上一轮已普通推送并核对远端 main 一致。
3. **用户最新表示当前环境难以支持 Windows 隔离阶段，希望先做其他任务。后续按暂缓实际隔离部署/实测来安排，不要再把购买内存、创建虚拟机或取得系统管理员权限作为所有开发工作的前提。** 暂缓不是豁免或通过；真实 Agent 写入与私密执行仍受该门槛约束。
4. 下一实施方向已向用户说明为 **产品级连接管理后端**，承接 W15。尚未新建正式阶段编号、细化实施计划或开始编码；先阅读代码和源章，在 plan/ 制定最小可交付范围，再测试驱动实施。
5. 用户允许既定范围内自主推进，只在需要具体决策/授权时停下；**管家 Agent 不构建**。后端先行，最终原生 UI 设计放后面。
6. 本交接是导航与事实摘要，不是第二套设计。规范维护在 plan/；AGENTS.md 中的权限和安全边界继续有效。

## 1. 项目目标与用户要求

用户创建项目群，邀请 **Codex、Claude Desktop、DeepSeek Harness（DSH）** 原客户端，自行指定前端/后端/规划等职责。平台管理任务、消息、授权、依赖、文件变更与交接，最终让不同 Agent 安全协作交付项目。

- 前端是 WPF 原生 Windows 独立窗口，不用 Electron/WebView/浏览器壳。
- 风格要像 Linear 官网或 Apple 备忘录一样简洁：减少标语、提示文字和次要标签，优先改善布局。
- 平台数据库是事实权威；模型回复、握手成功、工具发现都不能冒充任务完成。
- 定向消息及其派生资料不能泄漏给其他成员；进度查询不能插入 prompt、恢复/打断任务或产生新模型回合。
- 同项目逻辑文件跨 worktree 单写者；失联或租约到期不代表旧进程已停止，不得贸然解锁。
- 代码写入要有实际 diff、journal、变更 Markdown 和 Git 检查点；提交存在不等于验收通过。
- 用户于 2026-11-15 确认最新版管家设计 `coordinator-core-review-1`，可提交，但其模型、LangGraph、ReAct、RAG 编排和自动派工仍不实施。
- 遇错先复现/找根因，再回归测试与最小修复；不得删断言、跳过检查、吞报错或用假数据报成功。

## 2. 仓库、工作区与最新状态

| 项 | 值 |
| --- | --- |
| GitHub | https://github.com/Noe1120/agent-weave.git |
| 前序开发工作区（保留） | `C:\Users\1\.codex\worktrees\dsh-acp-lifecycle\team` |
| 当前工作区分支 | `feat/claude-desktop-mcp-probe`，历史名称，不代表只能修改 Claude |
| 本会话最新代码 HEAD | `0f2134f`，W15 |
| 用户指定的后续主工作区 | `D:\Users\1\Desktop\team` |
| 同步前主工作区状态 | 本地 main 为 `d62d940`，检查时无未提交修改；本次同步将快进纳入 W15 与本交接 |

两个目录是同仓库的 linked worktree，共用 Git 对象，但 checkout 内容不同。不要把 D 盘目录当已包含 W15。新会话先检查 status/log/remote；若在 D 盘继续，应在确认干净且可快进后同步，**不 reset、不覆盖 DSH 或用户修改**。

这份 HANDOFF.md 属于 `0f2134f` 之后的文档提交；用户已授权将其与 W15 同步到 D 盘主工作区。最终提交与推送状态以 `git log -1`、`git status` 和远端核验为准；不要将旧的“未跟踪 HANDOFF.md”描述沿用为同步后的状态。

用户已授权正常推送本项目。先验证、扫描暂存、检查远端；禁止 force push、覆盖他人历史、凭空添加许可证。只上传源码/设计/审核后的证据，不上传运行数据库、凭据、profile、SDK/依赖缓存、安装包或第三方 checkout。

## 3. 方案在哪里，先读什么

开始阅读顺序：

1. 根 `AGENTS.md`、本文件。
2. `plan/项目交接说明.md`、`plan/README.md`：以最新增量为准，下方有历史交接，不应把历史“下一阶段”当当前任务。
3. `plan/W15-RUNTIME-GATEWAY.md` 与 `evidence/runtime-gateway/COMPLETION.md`。
4. `plan/01-product-architecture.md`、`08-core-operating-decisions.md`、`07-directed-messages-progress.md`：目标、布局方向与可见性。
5. `plan/02-data-contracts.md`、`09-review-closure-and-gates.md`、`12-protocol-closure-and-validation.md`：数据、授权、状态、隔离与验收门槛。
6. `plan/03-agent-integration.md`、`04-reliability-security-operations.md`：原客户端与恢复。
7. 按任务补读 05 验收、10 风险、11 管家设计（只用于理解边界，不构建）。

其他入口：

- `Prompt.md`：原始要求；最新实现进度以交接和阶段证据为准。
- `connect.md`：DSH/Claude 方法与交给 DSH 实施 Codex 的教程；包含旧时态，Codex 当前状态以 W14/证据为准。
- `plan/PRE-COORDINATOR-FOUNDATIONS.md`：W08–W10 开发底座。
- `plan/WINDOWS-ISOLATION-DECISION.md`：未来恢复隔离实测时的环境/系统变更提案，不是已经获得的执行授权。
- `plan/contracts/`、`plan/validation/`：契约及验收定义。250 项产品验收模板仍 NOT_RUN。
- `plan/完整方案.md`：派生合订阅读稿，不直接编辑。先改源章，再运行 `plan/tools/verify_design.py` 生成报告、合订与摘要。

## 4. 已完成阶段与真实边界

这里的 W 编号是增量实施记录，不等同原始 WBS 同编号工作包或 G0/G1 门槛完成。

| 阶段 | 已交付 | 限制 |
| --- | --- | --- |
| W03 核心服务 | SQLite、核心契约、授权、状态处理与基础服务 | 不是完整产品冻结 |
| W04 工作台 | 项目、成员职责、公开/定向消息、任务草稿、只读进度 | 成员登记不等于客户端上线 |
| W05 原生基础 | WPF 窗口、所属后端生命周期、0.3.0 便携包基础 | 真实点击/视觉验收与最终 UI 未完成 |
| W06 Broker | 开发仓库受控写入、逻辑锁、diff/journal/Markdown/Git、恢复 | 未证明真实客户端强制隔离写入 |
| W07 运行器 | 自有 fixture 启停、超时、撤权、退出对账 | Job Object 不是 OS 沙箱 |
| W08 适配底座 | 能力/身份登记、配置失效、权限投影、detach 边界 | 不自动授予真实能力资格 |
| W09 依赖/检索 | 任务 DAG、输入快照、上游失效阻断、授权检索 | 不是管家 RAG/真实多 Agent 联合交接 |
| W10 恢复底座 | 本机停稳 development 的 SQLite/Git/dirty 成果备份恢复 | 生产在线/离机恢复未交付 |
| W11 DSH | 官方 0.2.1-rc.3 initialize-only 真实生命周期 | 无真实模型任务 |
| W12 DSH 会话 | 独立空会话 new/close 真实验证 | 无 prompt/MCP/旧凭据；生产控制器仍 initialize-only |
| W13 Claude | 官方 Desktop + CC Switch me/route，一次真实 task_get 与退出清理 | 不等于长期生产连接/自动唤醒/完整隔离 |
| W14 Codex | 固定配置下一次真实模型 task_get、只读进度与退出清理 | 非完整产品接入；同次真实运行撤权未验 |
| W15 运行网关 | 受保护 HTTP 状态与 start/close；独立控制权限 | 默认无真实 launcher；不是完整主人连接管理 |

当前能诚实给出的进度：真实模型只读任务已验证 2/3（Claude/Codex，DSH 未完成）；真实原客户端 + 强制隔离 + 代码写入联合资格 0/3。没有可信的整体工时百分比，不按阶段数虚报完成比例。

### Claude 必须保留的本机事实

- 官方 Claude Desktop `5.11492.2`、CC Switch `4.0.16`，用户使用 **me 分组＋路由**，不是官方订阅登录。
- 活动模式看实际 live-state 的 proxy_route/me 元数据；旧 official 选择器、is_current 或某个 gateway 文件单独不能证明活动上游。
- 独立空 profile 没有第三方连接，不等于用户原客户端需要官方登录。不要要求重登官方账号或修改现有模式。
- 第十二轮一次真实合成 prompt → task_get → queued → 窗口准确回复已完成；两条 MCP EOF、根进程 exit0、Job 为空、复制凭据清理与原配置保持有证据。
- 证据 `evidence/claude-desktop/COMPLETION.md`、W13。历史单次启动/任务授权已使用，不可借此再启动、重启、接管已有实例或读取历史。
- 用户曾反馈历史对话不见、看不到测试窗口，后续尤其不能改写/切换原 profile 或把隐藏独立实例误称原客户端窗口。

### Codex 必须保留的最终事实

- 官方 CLI `0.167.0-alpha.3.2`，模型 `gpt-6.1-sol`，用户既有 CC Switch 回环路由；独立 fresh CODEX_HOME，不是 attached_session。
- 正确工具面配置是 `[features.code_mode] direct_only_tool_namespaces = ["mcp__agent_weave_probe"]`，不是顶层 `[code_mode]`。
- 本地固定版本 schema/实测优先于在线新文档；该版本不接受 `mcp_servers.<id>.omit_tools_from`。
- 最终真实调用一次、tool_errors=0、turn completed、回复同一任务 ID 和 draft，22,331 tokens，金额 UNKNOWN；历史 8 次失败保留，累计 9 次 182,421 tokens。不能主张“预算未超”。
- 真实厂商轮遗漏撤权；之后同 harness 的本地模型桩运行验证撤权关闭。两份证据不能拼成同配置真实联合撤权通过。
- 核心证据：`evidence/codex/real-vendor-directonly-2026-11-16.json`、`COMPLETION.md`、`plan/W14-CODEX-APP-SERVER.md`。
- 用户确认“DSH 已完成”指 DSH 完成了 Codex 的限定阶段，不代表 DSH 自身真实模型接入已完成。

## 5. 当前阶段 W15：已做什么，还差什么才能结束

**W15 的限定实现、验证、代码提交和推送已完成。** 此前计划末尾未勾选发布项是交付后的文档滞后，本次交接已据实际提交补正；不要因此重新运行真实客户端验收。

代码入口：

- `packages/service/src/runtime-gateway.ts`：RuntimeGateway，读取安全投影/调用固定控制器。
- `packages/service/src/http.ts`：createServer 第三个可选参数注入网关；默认无控制器。
- `packages/service/src/domain.ts`：新增 `runtime_control` action。
- `tests/runtime-http.test.ts`：7 个 HTTP 回归。
- `tests/runtime-walkthrough.mjs`：编译后用户路径走查，只有仓库自有协议 fixture。

接口：

- `GET /v1/projects/:project/runtimes/:runtime`：adapter_read；grant/policy/run/resource 求交，成员/run 来自认证上下文，task 引用另验权限。无控制器的活动记录显示 unknown。
- `POST /v1/runtimes/{codex|deepseek_harness}/{start|close}`：先 runtime_control，再由控制器检查 adapter_configure、scope、CAS/action 幂等与所属进程。
- 拒绝动态程序路径、凭据、prompt、附着模式；HTTP 未开放 turn/interrupt/通用执行。
- 不返回原生 thread 明文、模型消息或凭据；退出观察不升级 OS 撤写资格。

已验证结果（上一阶段实测，不是本交接重新跑出的结果）：

| 检查 | 结果 |
| --- | --- |
| 同步后的基线 npm run verify | 497/497，无失败/跳过 |
| W15 npm run verify | 504/504，无失败/跳过；格式/类型/生成/构建/冒烟通过 |
| test:native | 14 C# + 1 WPF 静态通过；非点击验收 |
| test:native:package | 旧包 989 文件通过 |
| 编译后 HTTP 走查 | start → 相同 action 重试 → ready → 100 次零写入查询 → revoke → 拒读 → 维护关闭 → 非强制 exit_observed |
| P0 离线检查 | 13/13（含新增 LF 字节回归） |
| 设计校验 | 54 文件、53 摘要项，产品 AT190/CA60 仍 NOT_RUN |
| 暂存扫描/空白检查 | 20 文件扫描通过，diff --cached --check 干净 |

本地原始日志：`.runtime/w15/` 下 baseline、red-read、red-control、red-report、verify、native、package、walkthrough、design-refresh、design-check 等；这些通常被忽略，不上传。审核摘要在 `evidence/runtime-gateway/COMPLETION.md`。

W15 之后的工作不是补造 W15 通过：主人邀请、长期凭据、正常入口装配、原生 UI 控制、真实客户端联合生命周期仍是后续产品化工作。新会话先确认交接文档已保存/可见，随后即可开始下一阶段方案与测试。

## 6. 最新顺序：隔离暂缓，其他任务继续

用户当前环境不适合承担 Windows 虚拟机/强制隔离测试，已提出先做其他任务。本会话说明可以改变顺序，但不删除或绕过门槛。**不要无授权创建账户、改 ACL/防火墙、开启 Hyper-V、下载镜像、购买云主机或安装虚拟机软件。**

后续推荐顺序（尚未分配新 W 编号）：

1. **产品级连接管理后端**：主人邀请、连接绑定、授权范围、过期/撤销/重新授权、配置失效；整合 W08/W15，不创建另一套事实库。
2. **任务与运行流程集成**：任务/成员/run 关联、显式操作、状态与失败投影、幂等；合成进程验证，不开放任意真实 prompt 或默认自动派工。
3. **异常恢复**：服务重启、断连、未知结果、授权变化、恢复后重新连接；不自动重发未知任务、不凭超时解锁。
4. **备份恢复增强**：测试库/仓库上的管理、完整性、预检与新目录恢复；在线一致性/离机加密与真实灾备另验。
5. **安装升级基础**：版本/迁移兼容、预检/回滚测试；不覆盖用户旧包/数据库。生产证书、真实升级发布另需条件。
6. **原生 WPF 集成与最终 UI**：后端稳定后再设计；真实窗口点击权限与实测单独登记。
7. **条件具备后回补 Windows 隔离和真实联合验收**：同配置低权限执行、真实客户端写入与撤权、隐私隔离、多 Agent 协作。

管家持续排除在以上实施范围之外。低资源开发优先串行/低并发、小规模测试数据，不同时启动三个客户端与虚拟机。

### 下一阶段的建议起手任务与完成判据

先检查 `workspace-service.ts`、`workspace-auth.ts`、`workspace-schema.ts`、`workspace-feed.ts`、`adapter-registry.ts`、`runtime-gateway.ts`、`auth.ts`、`store.ts` 和相应测试，明确主人 Cookie/CSRF 与执行 Bearer 的边界。

在 plan/ 建立一个有界的连接管理阶段：优先完成“主人登记/邀请 → 限定绑定 → 查询 → 过期/撤销 → 旧凭据不可继续使用”的合成闭环。必须明确哪些可以离线完成，哪些操作实际会启动客户端或涉及凭据/外发，后者默认禁用。不要默认把 runtime_control 发给普通模型成员，不能仅让模型自行提交 member_id/session_id 就建立可信绑定。

该方向尚未设计到字段/接口级，以上是继续探索的入口，不是冻结契约。完成判据应包含原子兑换/重复请求、不扩权/跨项目反例、撤销立即生效、配置变化失效、只读无副作用、重启后未知状态，以及全量回归和编译后的用户路径。若需要迁移，只新增迁移，不改既有 001–004；实际用户库升级仍另需授权。

## 7. 困难、根因与成功经验

| 问题 | 根因与解决办法 / 可复用经验 |
| --- | --- |
| 当前 checkout 落后 DSH | 检查两个 worktree 与远端后，只将当前工作区从 4aef527 快进到 d62d940；不 reset 或覆盖主目录 |
| Codex 原工具面反复失败 | 注册和工具发现不等于模型会调用；区分注册、声明、编码、路由和选择。按固定版本实测正确 features.code_mode 键，direct_only 固定配置才获得真实往返 |
| Codex 旧 turn 结果污染新 turn | 使用 generation + native thread/turn 对齐，旧通知忽略；unknown 不允许换 action 继续，先对账 |
| 独立 Claude profile 出现官方登录 | 缺失本机第三方连接配置不代表原客户端需官方登录；先核对 CC Switch live route，不复制历史、不改原身份 |
| Windows 自动端口 EACCES | 自动端口可能撞保留范围；对自动端口做有界 EADDRINUSE/EACCES 重试，固定端口仍直接报错，不吞异常 |
| 新 HTTP 接口起初 404 | 先运行缺路由的 RED 用例，再补 RuntimeGateway/路由；加入权限、CAS、错误 target 和无副作用断言 |
| Node 直接执行 TS 语法失败 | Node strip-only 不支持构造器参数属性；用项目现有显式字段赋值，不关类型检查或换成绕过方案 |
| fetch body 类型失败 | exactOptionalPropertyTypes 下不能显式 body: undefined；仅有载荷时添加属性，不放宽 tsconfig |
| Windows 生成报告全文件空白错误 | .gitattributes 为 * -text 保留精确字节；Python write_text 产生 CRLF。先运行字节回归失败，再改 UTF-8 write_bytes，重新生成摘要，未关闭 Git 检查 |
| 环境内存不足以舒适运行 VM | 暂缓隔离实测，先做独立后端；不把硬件限制误当所有开发都必须停止，也不绕过隔离资格 |

成功方法：测试先行、固定版本和配置、进度读取纯只读、默认不装配真实 launcher、白名单投影、独立控制权限、合成与真实证据分开、失败证据保留、作者自检不称独立审核。

## 8. 本机环境与验证命令

最近只读观测：Windows 11 家庭中文版 build 22631；Ryzen 9 7945HX 16 核/32 线程；约 16 GB 内存，当时空闲 3.5 GB；C 剩余 54.6 GB、D 剩余 187.6 GB。空闲数会变化。当前进程非管理员。虚拟化固件启用、HypervisorPresent=true；SLAT 查询 false 不能单独判定硬件不支持，未做虚拟机兼容验收。不要假设家庭版具备完整 Hyper-V 管理功能。

已用工具路径（新会话先 Test-Path 核实）：

```powershell
Set-Location -LiteralPath 'D:\Users\1\Desktop\team'
$env:PATH = 'D:/新建文件夹;D:/PiData/apps/Git/cmd;' + $env:PATH
# Node 24.14.0；项目要求 >=24.14.0 <25
& 'D:/新建文件夹/npm.cmd' run verify
& 'D:/新建文件夹/npm.cmd' run test:native
& 'D:/新建文件夹/npm.cmd' run test:native:package
& 'D:/新建文件夹/node.exe' tests/runtime-walkthrough.mjs # 先 build
& 'D:/UAV/conda/python.exe' -X utf8 -B plan/tools/test_p0_readiness.py
& 'D:/UAV/conda/python.exe' -X utf8 -B plan/tools/verify_design.py
```

文档改源后：

```powershell
& 'D:/UAV/conda/python.exe' -X utf8 -B plan/tools/verify_design.py --refresh-combined --write-report --refresh-manifest
& 'D:/UAV/conda/python.exe' -X utf8 -B plan/tools/verify_design.py
# 明确选择文件暂存后
& 'D:/新建文件夹/node.exe' scripts/scan-staged.mjs
git diff --cached --check
```

Python 当前 3.9.13；不要无意使用仅新版解释器支持的 API。.NET 在 `.tools/dotnet/dotnet.exe`，Git 在 `D:/PiData/apps/Git/cmd/git.exe`。工具/依赖通常是本机忽略文件，新克隆并不自带；不要提交它们。

**不要自动运行 test:*:live 脚本。** 它们可能启动原客户端、读取获准配置或产生付费调用，不属于普通 npm run verify。若发现原生包/SDK缺失，应报告前置缺失而不是删断言。

## 9. 必须继续遵守的边界

- 保留三个原客户端身份，不以 Claude Code/SDK/直接 API 替代 Desktop。
- 不读用户私有历史，不修改原客户端配置/登录模式，不接管或关闭已有实例。
- 新真实客户端操作、凭据复用、敏感外发、模型费用、系统身份/ACL/网络和窗口操作，按具体授权核对。用户允许自主开发不是所有系统/模型操作的通行证。
- owned_process 和 attached_session 分开：断开附着不能杀用户进程；新 thread 不冒充原桌面聊天。
- 源码 schema4，旧 0.3.0 包 schema2；不能用旧包打开升级库，不能擅自升级用户真实 DB 或覆盖旧包。
- 旧拒绝清理目录不得重试或换工具绕过；位置见 W07 记录。
- 不默认启动子 Agent、额外模型或独立评审；按 AGENTS.md 作者自检并如实标注。
- 250 AT/CA、L1–L3、OS 隔离、发布资格分别有对应证据才能升级。管家 CA 也不应在管家未实施时冒充管家前必须已跑完。

## 10. 新会话的第一步

先读上述文件并核对 Git。无需重复询问整体需求，也不要立即启动任何原客户端或虚拟机。说明你已承接“W15 已完成、隔离暂缓、管家不构建、后端优先”的状态，然后从产品级连接管理的有界方案与失败测试开始。遇到具体缺失授权或不可逆变更再询问，普通可逆开发按已有规则持续推进。
