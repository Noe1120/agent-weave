# Agent Weave 接入教程与 Codex 任务交接

更新：2026-11-16，Asia/Tokyo。整理基线：提交 `56b9c6a348ca553c69ff358cd829055005fa050d`。

**给下一位实施者 DSH 的任务：先学习本文与现有 DSH、Claude 接入源码及证据，再完成 Codex 的接入实现和真实验收。** DSH 是执行这项开发任务的 Agent；Codex 是本次被接入的原客户端。本文将用户所写的“ddsh”按上下文记为 DeepSeek Harness（DSH），不新增另一种成员类型。

本轮只编写教程和交接，没有启动 DSH/Codex，也没有开始 Codex 实现。本文是仓库根目录的操作说明；**设计仍以 `plan/` 为唯一维护源**，遇到冲突先核对最新交接、源章及实际代码，不另建一套架构。Codex 下一阶段范围已同步到 [03 §4.1](plan/03-agent-integration.md)。

阅读导航：§1–3 确认基线与边界；§4 学习 DSH；§5 学习 Claude；§6 是 DSH 要执行的 Codex 工作清单；§7 是授权、验证和交付规则；§8 可直接作为交接指令。

## 1. 先确认接手的是哪一份代码

仓库：[Noe1120/agent-weave](https://github.com/Noe1120/agent-weave)。本文整理时，最新接入实现已推送到 `feat/claude-desktop-mcp-probe`，**不要假定 main 或旧原工作区包含这些改动**。

- 本轮工作区：`C:\Users\1\.codex\worktrees\dsh-acp-lifecycle\team`。
- 原工作区：`D:\Users\1\Desktop\team`；可能有独立修改，不能覆盖或重置。
- 接手先执行 `git status --short`、`git branch --show-current`、`git log -5 --oneline`、`git remote -v`，确认包含上述基线及本文后续提交。检查工作目录属于哪个 checkout，再运行命令。
- `.tools`、`artifacts`、`node_modules` 在当前机器可能是本地目录映射，不在 Git 中；新克隆没有它们是正常的。按 [README](README.md) 准备固定依赖，不能把缺文件当作允许下载/启动原客户端的授权。
- 当前源码数据库 schema 4；旧 `0.3.0` WPF 便携包 schema 2。不得用旧包打开升级后的库，不升级用户实际数据库，不覆盖旧包。

推荐阅读次序：

1. [AGENTS.md](AGENTS.md)、[项目交接说明](plan/项目交接说明.md)、[plan/README](plan/README.md)。[Prompt.md](Prompt.md)只保留最初要求，其中“尚无产品”等历史说法不能覆盖当前交接。
2. [03 原客户端接入](plan/03-agent-integration.md)、[02 契约](plan/02-data-contracts.md)、[09 权限/隔离](plan/09-review-closure-and-gates.md)、[12 协议闭环](plan/12-protocol-closure-and-validation.md)。
3. [W08 适配基础](plan/W08-ADAPTER-FOUNDATION.md)、[W11 DSH 初始化](plan/W11-DSH-ACP-LIFECYCLE.md)、[W12 DSH 新会话](plan/W12-DSH-SESSION-PREFLIGHT.md)、[W13 Claude](plan/W13-CLAUDE-DESKTOP-MCP-PROBE.md)。
4. 本文列出的实现文件和审核证据。历史阶段报告保留当时结论，最新阶段增量优先；例如 W11 的“未建会话”后来已由 W12 的独立会话探针补充。

## 2. 当前到底完成了什么

| 对象 | 已有真实证据 | 代码接入范围 | 仍未完成 |
| --- | --- | --- | --- |
| DSH W11 | 官方 0.2.1-rc.3 初始化一次；1000 次只读查询零 DB 写入；EOF 正常退出；旧回执不重启、撤权拒读 | 可信进程内 `DshRuntimeController`、`adapter_runtime`；initialize-only | 生产会话/模型执行、HTTP/MCP/WPF 注册、完整任务闭环 |
| DSH W12 | 一次 initialize → session/new → session/close → EOF；各一条请求/回执，exit0；原 6 个 Desktop 进程身份不变 | `tests/` 内显式 opt-in 的独立会话验收工具 | 没有 prompt、没有配置 MCP、没有旧凭据；不能称真实模型任务通过 |
| Claude W13 | 第十二轮：原 Desktop＋CC Switch me 路由；一条合成 prompt → 一次 task_get → 服务与窗口均返回同一任务、queued；退出/清理通过 | 合成验收专用只读 MCP 桥；真实原客户端单次任务验收 | 生产邀请/凭据/外发、自动唤醒、忙碌排队、取消恢复、完整 UI 与 OS 隔离 |
| Codex | 尚无本项目 Codex 专项真实验收 | W08 中只有通用身份/能力底座；没有 Codex 专项运行模块 | 这是 DSH 接下来负责的接入任务 |

最近一次代码基线验证：全量 **439/439，0 失败/0 跳过**；原生 **14 组 C#＋1 项 WPF 静态**、旧包 **989 文件**、编译只读走查通过。它们是已保存的历史结果，后续修改仍须重新验证。

不要把以上结果升级为整个平台完成、完整 L1–L3、Windows 强制隔离、生产灾备或签名升级交付。250 项 AT/CA 模板仍保持原有 NOT_RUN 状态。管家方案已确认，但**管家实现仍暂缓，原生 UI 设计最后**。

## 3. 两种协议方向必须分开

```text
DSH 运行控制：
Agent Weave 可信控制器 ──ACP JSONL──> 官方 DSH 附带的 ACP 入口
                           <──初始化/会话回执与事件──

Claude 协作读取：
真实 Claude Desktop ──MCP stdio──> 本项目 MCP 桥
                                        │ 固定范围、短期执行授权
                                        v
                                  本机 HTTP 群服务

Codex 候选组合（待本机验证，不是已实现）：
可信控制器 ──官方 app-server 协议──> 官方 Codex 独立会话
                                             │ MCP 工具调用
                                             v
                                  本项目只读桥 → 群服务
```

MCP 是 Agent 调用平台工具的入口，不自动赋予平台唤醒、取消或恢复该 Agent 的能力。ACP/app-server 是具体客户端的运行协议；它们的字段、握手和通知不同，不能复制一套 JSON 帧给所有客户端。

`owned_process` 表示控制器确实持有本次启动的进程；`attached_session` 表示与已有原生会话建立连接。断开附着不能杀客户端，持久 PID 不能替代当前进程句柄。新的官方会话也不能写成“接管了用户已有桌面聊天”。

## 4. DSH 接入教程

### 4.1 先阅读实现和证据

| 文件 | 用途 |
| --- | --- |
| [dsh-acp.ts](packages/service/src/dsh-acp.ts) | `officialDshLauncher`、固定启动与 initialize-only 有界传输 |
| [dsh-runtime.ts](packages/service/src/dsh-runtime.ts) | 授权、CAS/幂等、持久启动意图、只读状态、撤权维护和关闭 |
| [dsh-acp.test.ts](tests/dsh-acp.test.ts)、[dsh-runtime.test.ts](tests/dsh-runtime.test.ts) | 合成进程与控制器回归 |
| [dsh-live-walkthrough.mjs](tests/dsh-live-walkthrough.mjs) | 编译后的真实 initialize-only 走查 |
| [dsh-session-launch.ts](tests/dsh-session-launch.ts)、[dsh-session-probe.ts](tests/dsh-session-probe.ts) | 空目录准备、固定三方法新会话状态机 |
| [dsh-session-live.mjs](tests/dsh-session-live.mjs)、[dsh-session.test.ts](tests/dsh-session.test.ts) | 真实 opt-in 入口及合成回归 |
| [W11 真实报告](evidence/dsh-lifecycle/real-initialize-report.json)、[W12 真实报告](evidence/dsh-session/real-session-report.json) | 已实际执行的请求与退出证据 |

### 4.2 固定安装与启动方式

1. 只读核对官方安装目录、版本、签名/来源、EXE 和 `resources/app.asar` 摘要。该次版本为 `0.2.1-rc.3`，完整摘要见 W12 真实报告；版本变化须重新核验，不能仅更新配置中的版本字符串。
2. 本地启动配置严格只有五项：`installation_root`、`data_root`、`client_version`、`executable_sha256`、`archive_sha256`。前两项为绝对路径，数据根预先存在且位于安装目录外，不接受链接路径或额外命令字段。
3. 可信启动器使用该发行包自带的 `DeepSeek Harness.exe`，参数数组为 `--expose-internals`、包内 `dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js`、`--profile`、`acp`。这是**该固定发行版已核验的官方内置入口**，不是通用启动承诺；不要移植这些参数到 Claude 或 Codex。
4. 启动器创建全新 home/agents/user/appdata/localappdata/temp/work，使用最小环境；关键值为 `ELECTRON_RUN_AS_NODE=1`、`DSH_HOME`、`DSH_AGENTS_HOME`、`DSH_TELEMETRY_DISABLED=1`、`DSH_PERMISSION_MODE=read-only`。这些不是 Windows 强制隔离证明。
5. 普通 API 调用者不能指定任意 EXE、参数或环境。哈希不匹配、授权撤回、路径不可信时，在 spawn 前拒绝；不自动安装新版本、读取旧配置或提供凭据。

### 4.3 W11：初始化生命周期

1. 在合成平台库中准备包含 runtime/scope 的 grant、policy 和资源；不用用户实际库。
2. `start` 携带唯一 action_id、expected_revision=0、配置指纹；先持久登记启动意图，再启动。每个异步边界复核授权和世代。
3. 只发送 initialize，解析白名单能力。`ready` 只表示初始化连接正常；`session_id=null`，执行能力保持禁用，不虚构原生会话 ID。
4. `read` 只读取已有状态。真实走查连续读取 1000 次，没有额外 RPC 或 DB 写入。
5. 对所属子进程发送 stdin EOF，观察真实 exit；旧 start 回执重试返回原结果，不重新启动。撤权后查询拒绝，独立维护周期负责收束连接。
6. 断流、协议故障、控制器丢失所有权或重启后，不能继续报告 ready。退出未知保留 unknown，不解锁、不重派工、不按旧 PID 杀进程。

仅在另有对应真实操作授权、配置已核验后执行：

```powershell
npm run build
npm run test:dsh:live -- --allow-dsh-initialize --config "<绝对配置路径>" --output "<尚不存在的绝对证据目录>"
```

`<...>` 是需替换的占位符，不能原样执行。该命令不会核准授权；开关只是防误启动机制。原 Desktop 进程前后保护还应单独核对，不能仅凭 W11 脚本返回 PASS 推断。

### 4.4 W12：独立空会话探针

1. 先核对 session/new 的实际副作用。它会创建 Agent、读取模型配置、建立指定 MCP 并持久化，**不是只读握手**；因此 W12 曾单独获得新会话授权。
2. 使用全新 cwd/home，`mcpServers=[]`，不提供旧凭据，不 list/resume 原会话，不 authenticate，不 prompt/cancel。
3. 顺序固定为 initialize → session/new → session/close（仅本次返回 ID）→ stdin EOF。每一步必须收到相应回执。
4. 记录协议结果后再做后检，避免进程清单核验失败覆盖前面的真实协议证据。核验正常 exit0、非强制、原客户端进程身份不变。
5. `session/close` 不删除持久化会话，也不证明整个 OS 执行域已经撤写。公开证据只保存 session ID 摘要，原 profile 留本机。

仅在新会话操作另获授权后执行：

```powershell
npm run test:dsh:session:live -- --allow-dsh-new-session --config "<绝对配置路径>" --output "<尚不存在的绝对证据目录>"
```

输出目录采用独占创建，重复运行不能覆盖旧证据或再次执行 session/new。失败先查根因，不能改目录自动重试。W12 工具没有把会话能力接到生产 `DshRuntimeController`；后者至今仍 initialize-only。

## 5. Claude Desktop 接入教程

### 5.1 源码、工具和证据

| 文件 | 用途 |
| --- | --- |
| [claude-desktop-launch.ts](tests/claude-desktop-launch.ts) | 固定官方安装、标准 Windows 目录、启动准备 |
| [claude-third-party-probe.ts](tests/claude-third-party-probe.ts) | me 路由/选中配置固定、凭据副本、启动前复验和清理 |
| [Claude.ProbeHost](tests/claude-host/Program.cs) | 保留所属根句柄、显式入 Job、退出/Job 清空证据；不是安全沙箱 |
| [claude-desktop-live.mjs](tests/claude-desktop-live.mjs) | 短时 MCP **发现**专用入口；不能直接作为完整任务入口 |
| [mcp-entry.ts](packages/service/src/mcp-entry.ts)、[mcp-session.ts](packages/service/src/mcp-session.ts) | 有界 stdio MCP、协议状态和每连接诊断 |
| [mcp-read-client.ts](packages/service/src/mcp-read-client.ts) | 固定 project/resource/本机服务的合成只读桥 |
| [claude-read-connector.test.ts](tests/claude-read-connector.test.ts)、[编译走查](tests/claude-read-walkthrough.mjs) | 合成读取、撤权、越权、通知、报告并发、重连和零写入 |
| [完整交付](evidence/claude-desktop/COMPLETION.md)、[真实逐次报告](evidence/claude-desktop/real-attempt-report.json)、[预检](evidence/claude-desktop/preflight-report.json) | 历次失败、修复、第十二轮真实成功与限制 |

### 5.2 核实本机实际第三方配置

1. 前提是用户已使用 **CC Switch → me → 路由**。不要要求官方订阅登录，也不要把空测试 profile 没有连接配置当作原客户端未登录。
2. 只读核对实际目录映射。该机器的 Local/Claude、Local/Claude-3p 是重解析目录，先解析目标，再核对选中配置库；不能从网上教程推定最终路径。
3. 对固定版本，真正的第三方用户目录位于测试 `LOCALAPPDATA/Claude-3p`，选中条目由 `configLibrary/_meta.json` 决定。仅 `--user-data-dir` 不足以保证 3p 配置落在预期目录。
4. 核对 CC Switch `live-state` 中 Desktop 为 proxy/attached，proxy_route 指向 me 的 provider ID；只查询该 provider 的名称和路由元数据并固定摘要。旧 settings 的 official 值和 DB 的 is_current 单独不能代表活动路由。
5. 路由描述严格为 `source_library`、`metadata_sha256`、`selected_sha256`、`cc_switch`；后者包含 `database`、`live_state`、`live_state_sha256`、`provider_id`、`provider_name`、`provider_meta_sha256`。它是本地预检输入，不含明文密钥，也不构成运行时上游网络强制绑定。
6. 读取配置元数据与复制凭据分别核对授权。已验证路径只把选中**回环 gateway**连接和令牌副本放进临时 profile，不读取上游 provider 密钥、不复制聊天/cookie、不改原配置。敏感文件留在忽略目录，不打印其内容。

### 5.3 建立临时窗口和 MCP 发现

1. 固定官方 Desktop `5.11492.2` 的 EXE/ASAR 摘要；启动配置比 DSH 多 `node`、`server` 两项，均为已核验绝对路径。
2. 启动前记录 Claude/DSH 进程身份；发现已有 Claude 就拒绝独立启动，由用户正常退出后重新预检，不接管或关闭原实例。
3. 创建标准 `USERPROFILE/AppData/Roaming` 和 `AppData/Local`，用 host 的 `--known-folders` 核对原生解析路径。只改环境变量、不建目录曾导致 `Failed to get appData path`。
4. `prepareClaudeThirdPartyProbe` 准备受限副本；`checkPreparedProbe` 在启动前再次核对固定源配置与 me 路由，发生漂移则清除副本并保留错误。
5. 使用 .NET host 保留**实际启动返回的根进程句柄**并显式加入 Job；同时观察 root exit、Job empty、host exit 与前后清单。不能把管道 close、间接 Job 状态或 PID 消失当完整清理证明。
6. 原 Desktop 主动调用本地 MCP server 的 initialize/initialized、工具/资源/prompts发现。此时 `tool_calls=0` 完全可能，不能报模型任务成功。

准备工具的普通本地构建：

```powershell
npm run build:runner
npm run build
```

以下入口**另需真实启动和指定 gateway 凭据复用授权**，默认只做 60 秒发现，成功发现后就收束：

```powershell
npm run test:claude:live -- --allow-claude-desktop-probe --config "<启动配置绝对路径>" --third-party-route "<路由描述绝对路径>" --allow-third-party-credential-reuse --output "<不存在的绝对证据目录>"
```

纯空工具发现的 `server` 指向 [claude-mcp-server.mjs](tests/claude-mcp-server.mjs)。若验证已编译只读桥的发现，`server` 指向 `dist/packages/service/src/mcp-entry.js`，并添加 `--read-connector-config "<合成只读配置绝对路径>"`。这是两种不同配置，不能将其参数混用。

### 5.4 从“发现工具”走到“真实读一次任务”

短时发现脚本仍使用单一 `--report` 且发现后立即关闭，**不能直接加一条 prompt 就称完整验收**。第十二轮使用的人工 UI 验收组装脚本位于本机忽略目录，不是仓库已交付的通用命令；新克隆不能依赖它存在。应使用上表中已提交模块重建受审查的验收入口：

1. 建独立合成库，用现有 fixture 创建计划/任务；apply_plan 后该任务实际状态是 `queued`，不要把它改成 ready 来迎合测试。
2. 启动现有 HTTP 群服务，仅监听回环。自动分配端口使用 [listenLoopback](packages/service/src/loopback-listener.ts)；不要取消认证，也不要关闭 Fetch 端口保护。
3. 把临时 grant/policy 收窄为 `read_resource` 和该 task/acceptance 资源，记录到期时间；token 只存本地受控配置，不进参数、prompt、stdout或 Git。
4. 配置只读桥的全部顶层字段：version=1、target=`claude_desktop`、固定 service_origin/project_id/token/task_ids、execution_ids=[]、allow_message_poll=false、egress。token 为该次合成授权对应的服务令牌，仅存受控本地文件；egress 内严格只有 data_class=`synthetic_only`、provider_fingerprint 和 expires_at。真实数据不得借此声明冒充合成数据。
5. MCP 启动参数使用 `--config <本地配置> --report-dir <已存在的本次专用目录>`。Desktop 会为发现与任务分别启动连接；每个连接建立自己的报告，不能删除发现报告或允许两进程覆盖同一报告。
6. 用固定版本 host 启动全新 3p 测试窗口，限定测试时长（历史人工验收上限 600 秒，配置 660 秒过期），保留退出/撤权/凭据清理路径。将原 profile 与测试空 profile 的区别预先说明，空历史不等于历史被删除。
7. 通过允许的原生窗口工具，在确认 Gateway、正确模型及合成任务范围后，只发送该次已授权的一条请求。请求要求仅调用 `agent-weave-probe/task_get` 一次，参数仅为合成 task UUID；不读取项目文件、不浏览、不调用其他工具、不自动重试，失败必须报错。
8. 如果出现安全/隐私权限框，由用户亲自选择 Allow once。及时确认窗口仍存在；窗口已退出后不能继续要求用户点击。不得改配置、调用内部 IPC/CDP或换工具绕过权限。
9. 同时核验 MCP `tool_calls=1`/`tool_errors=0`、服务恰好一次读取正确 task、返回状态 queued，以及原窗口最终回复同一 ID/状态。模型自述、工具菜单、HTTP200 单独均不足以通过。
10. 结束后核对所属根退出/Job为空/host退出/原客户端不变；撤销临时 grant、清空服务 token、清除复制的 gateway令牌，对已停止自有 profile 做精确令牌扫描，核对原配置摘要。退出未知时不能宣称已清理，也不能清理活动目录。

第十二轮实际成功：一条用户 prompt、一次真实 task_get、一次服务读取；roots变化通知一次，两条连接 fault=null/EOF=true，根 exit0。原配置保持，369 个自有文件扫描无令牌残留。整段历史累计三条用户 prompt；Desktop 还可能自动执行一 token 的连接探测，因此**总推理次数/费用未知，不能写成零**。这些单次授权已经使用。

### 5.5 必须带到 Codex 接入的经验

| 遇到的问题 | 根因/处理 | 不能采取的做法 |
| --- | --- | --- |
| 空 profile 看起来需要官方登录 | 缺少用户实际第三方连接；先核实本机配置 | 切官方模式、要求重登、读旧聊天补上下文 |
| 主进程退出与管道关闭不同步 | 分别观察实际句柄、exit、streams、Job和host | 把 stdout close 或一个 PID 当完整撤写证明 |
| 发现成功但任务说工具不可用 | 第二个 MCP 进程与第一个争用独占报告 | 删旧报告、吞写入错误或把发现当任务通过 |
| 合法 roots 通知让连接退出 | ready状态下严格校验后记数，不申请客户端文件或扩大资源范围 | 一律忽略未知通知或放宽初始化顺序 |
| 无提示词也可能产生费用 | Desktop有自动连接探测；未知按未知登记 | 用零用户prompt推断零模型调用/零费用 |
| 合成测试偶发超时 | 保留原日志；资源争用实验后限制文件并发为2；原DSH监控失败的精确触发仍未证实 | 删断言、随意加超时、无限重跑到绿 |
| 本机首次HTTP请求4ms就失败 | 本机动态端口范围从1024起；复现10080被Fetch拒绝；自动监听改选高位端口 | 改系统端口设置、绕过Fetch保护；反推原失败必为10080 |
| appData/输出目录不存在 | 核对Windows原生目录解析；创建父目录且独占新尝试目录 | 覆盖旧证据、把所有失败泛称登录问题 |
| Desktop遥测上报403 | 与实际MCP及任务结果分别记录，尚未修复 | 隐藏日志，或把遥测失败误称工具失败/已全通过 |

## 6. 交给 DSH 的 Codex 实施目标

### 6.1 目标与完成层次

**完成官方 Codex 的平台接入最小闭环，至少达到“可信运行控制＋真实独立会话＋一次平台只读工具往返＋可核对的关闭与撤权”，不能只交学习总结、启动脚本或握手成功。** 同时为完整生产接入提供逐项能力矩阵和明确的下一阶段入口。

具体结果应包括：固定安装/配置指纹，W08授权体系内的启动与状态记录，真实新会话和运行ID映射，真实授权任务与工具回执，零额外模型回合的进度查询，未知结果保守处理，退出/撤权证据，以及 DSH/Claude 的回归保护。

这个最小闭环不自动授予严格文件写入或完整 L1–L3。若用户需要已有 Codex 桌面聊天附着，必须另行验证该能力；独立 app-server 新 thread 不能冒充。遇到权限/能力前置条件缺失，在已授权范围内继续工程工作，同时只询问具体缺口，不反复确认整个方案，也不以改换客户端完成目标。

### 6.2 先做只读核实，再选入口

1. 核实本机 Codex 实际发行来源、EXE/CLI路径、版本、摘要、Windows执行域、现有进程与配置根；不要只凭 PATH 中某个 `codex` 名称推定其与桌面客户端相同。
2. 只读必要配置元数据，区分官方账户、第三方提供方、代理与实际活动选择器。不输出密钥、不读取用户 thread/session历史；也不能把 Claude 的 CC Switch me 配置推定为 Codex 配置。
3. 调查官方 stdio app-server 是否是这个本机原客户端可支持的接口。`--version`、`--help`、schema生成也会执行程序，先核对已授权的操作范围；文档存在不等于本机支持。
4. 真实 profile隔离、账户/配置复用与所需最小凭据分别说明。不能照搬 DSH 的环境变量或 Claude 的Windows目录布局，也不能因独立空配置报未登录而判断原客户端失效。
5. 先在 `plan/` 写 Codex 阶段计划，绑定实际版本/schema、拟发送方法、工作目录、外发合成内容、费用未知项、停止条件与证据。保持已确认架构，不构建管家、不重做UI。

本轮于2026-11-16实际读取的官方入口：

- [Codex App Server](https://learn.chatgpt.com/docs/app-server)，由 `https://developers.openai.com/codex/app-server/` 重定向取得。文档描述默认stdio JSONL，initialize→initialized、thread/start、turn/start、流式事件和turn/completed；遵循JSON-RPC语义，但在线消息省略通常的`jsonrpc: "2.0"`字段，不能照搬MCP报文。WebSocket仍标为实验性且不受支持，本项目优先验证stdio。
- [Codex MCP](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)，由 `https://developers.openai.com/codex/mcp/` 重定向取得。描述Codex作为MCP客户端连接stdio/HTTP服务器，以及config.toml中的MCP配置。共享配置会影响其他客户端，不能直接改写用户全局配置或按教程自行重启。

这些是接口候选依据，**不是本机版本结论**。生成类型/JSON Schema必须匹配实际执行的固定版本；不要照抄在线文档的模型名或未知实验字段。旧 `codex mcp-server` 也不能当成已核实入口。

### 6.3 按阶段实施，不跨越证据门槛

| 顺序 | DSH 要完成的工作 | 交付判据 |
| --- | --- | --- |
| C1 只读预检 | 固定原客户端身份、配置/账户元数据、实际支持接口、现有进程保护 | 脱敏manifest；列明确定事实、未知、拟操作和缺失授权 |
| C2 合成实现 | app-server协议状态机、固定启动器、授权/CAS/幂等、有限输出和超时；未知结果不自动重发 | 先红后绿回归；无真实客户端/模型参与；错误与退出证据分离 |
| C3 真实握手 | 获对应授权后新建独立运行环境，仅协商初始化与允许的能力查询 | 真实响应、安装/schema摘要、原客户端未动；不把握手当任务 |
| C4 真实任务与工具 | 获新会话/凭据/一条合成任务授权后，原Codex新thread/turn调用平台受限task_get并准确回复 | 原生结构化工具事件、MCP、服务读取、最终回复相互对应；不使用假结果 |
| C5 平台闭环与生命周期 | 映射native thread/turn与platform runtime/binding；纯读状态、撤权、关闭、断线/失联；忙碌输入/取消/恢复各自测试 | 代码实际复用W08权限和事实投影，不停在独立脚本；无会话时不伪造session ID；未知不解锁 |
| C6 验证与交付 | 全量回归、受影响原生回归、编译真实使用顺序走查、源设计和脱敏证据 | 明确完成/未完成，配置变化使资格待复验；签出/推送可核验，无秘密或用户数据 |

真实取消、恢复、第二条prompt或额外工具任务属于独立动作；先核对是否被具体授权覆盖，不用“完成接入”无限扩大计费调用。合成失败测试可以继续，真实测试缺授权时不能伪造PASS。

### 6.4 可复用什么，以及需要改什么

- 复用 `DshRuntimeController` 的设计：持久启动意图、异步前后复验、只读查询、独立撤权维护、配置失效、当前live handle与历史PID分离；不要把DSH协议类型直接改名后使用。
- 复用现有服务的 grant∩policy∩run∩资源ACL、task投影、执行feed、错误和分页校验；模型参数不能指定URL、凭据、project或另一个安全域。
- 现有 `McpReadClient` **严格要求 target=`claude_desktop`**，配置和类注释也明确是合成验收桥。Codex不能假报Claude身份。需要先加正反例，再显式支持Codex目标或提取共享只读层，保持不同目标配置/能力/证据可区分，不删除target校验。
- 使用独立报告目录承载多个MCP连接；保留合法通知处理和非法帧拒绝。所有stdout只输出协议，日志另存、脱敏、有界。
- 当前只读桥有1000帧/1MiB等验收限额与短期声明式egress，不是生产长期连接。若要扩大作用域，先补服务签发的披露授权、provider变化失效与受保护凭据，不能只放宽常量或把synthetic_only改名。
- 进度优先读取平台已记录的结构化事件。`thread/read`即使是官方只读方法也只能用于本次获准会话，不可读私有历史；`thread/resume`、`turn/start`、`turn/steer`、`turn/interrupt`都不能偷偷夹带在查询中。
- 普通消息、回答有效等待请求、批准权限、取消回合分别实现。app-server某些方法可以直接执行命令或影响外部进程，默认不开放通用RPC透传、任意shell或实验接口。
- 所属新进程可按实际句柄收束；附着会话只断开连接。协议interrupt回执不等于子进程/写入能力已撤销，仍按09/12核对，严格写入未通过时维持只读资格。

### 6.5 不得遗漏的验收用例

- 固定配置缺失/漂移、哈希变化、重复启动action、权限先撤回/异步途中撤回、旧回执不重启。
- 正确初始化、早到/重复响应、合法已支持通知、非法/超限/截断/无效UTF8、错误回执、超时与stdio断开；不能给所有未知通知统一成功。
- task_get的真实服务读取、跨project/resource拒绝、撤权/到期拒绝、错误不能伪装为空结果、读进度零写入和零prompt。
- 一条真实合成任务与精确工具/服务/回复对应；grant中的合成任务ID由可信侧固定，结果必须来自服务。
- 重连、取消、恢复、活动等待回答、未知发送结果与忙碌消息分别给出实测或NOT_RUN，不合并成“支持”。
- 原客户端进程与原配置保持，用户历史未读，凭据未进入stdout/报告/提交；退出未知时仍有可观察故障。
- DSH原有初始化/会话测试与Claude连接器测试继续通过，schema4/core1.0/001–004、旧包与WPF行为不因Codex接入被破坏。

## 7. 授权、验证命令与交付方式

### 7.1 本文不是新的真实操作授权

| 操作 | 工作方式 |
| --- | --- |
| 阅读源码/设计/已脱敏证据、写代码文档、合成测试、普通可逆开发 | 按既定范围直接推进 |
| 只读实际配置元数据 | 只取必要字段，避免输出秘密与读取历史；记录证据来自本机还是官方资料 |
| 启动/重启/接管真实客户端，建会话，复制凭据，发送模型任务，窗口操作 | 核对已有具体授权；缺失时只询问这一操作、数据范围、费用与清理方式 |
| 现有用户实例、私有历史、系统身份/ACL/网络策略 | 没有对应授权不操作；不得以换工具绕过限制 |
| 提交/推送本仓库 | 用户已授权；先验证、审查暂存与远端、扫描秘密，再正常推送并核对提交；不force、不覆盖他人历史 |

既往DSH初始化/新会话授权与Claude各单次任务授权仅对应已记录尝试，不能转授给Codex。DSH作为实施者处理工程任务的调用，也不能把被测Codex的费用默认为同一授权或零费用。

### 7.2 默认检查不启动原 Agent

从正确仓库根目录执行；Node要求24.14+且主版本24，使用锁定依赖。当前机器曾使用 `D:\新建文件夹\node.exe`、`D:\PiData\apps\Git\cmd\git.exe`、`D:\UAV\conda\python.exe` 与仓库 `.tools/dotnet/dotnet.exe`；先检查实际存在，不把这些路径当通用安装要求。

```powershell
# 普通服务/合成协议检查；包含构建runner测试宿主，不启动真实DSH/Claude/Codex。
npm run verify
npm run test:native
npm run test:native:package
npm run test:claude:read:walkthrough

# 定位接入回归时可单独运行；控制文件并发，所有用例仍须执行。
node --test --test-concurrency=2 tests/dsh*.test.ts tests/claude*.test.ts

# 修改plan源章后重建派生文件，再只读检查。
& 'D:/UAV/conda/python.exe' -X utf8 -B plan/tools/test_p0_readiness.py -v
& 'D:/UAV/conda/python.exe' -X utf8 -B plan/tools/verify_design.py --refresh-combined --write-report --refresh-manifest
& 'D:/UAV/conda/python.exe' -X utf8 -B plan/tools/verify_design.py
```

需要自定义路径时，测试使用 `BROKER_GIT` 指向已核验Git、`TEAM_TEST_NODE` 指向已核验Node；不要重用HOME/CODEX_HOME等系统变量存放临时脚本值。`test:native:package`在没有旧包的克隆中不能伪造通过；先如实报告缺少本机验收工件。

真实入口的 `--allow-*` 开关只防误运行，不替代人的授权。**当前没有 `test:codex:live` 命令**；DSH应在完成实现和测试后增加明确opt-in入口，默认verify不得调用它。

### 7.3 每一阶段提交什么

1. `plan/`内的Codex阶段计划与源章更新、生成后的合订/报告/摘要；本文只同步入口与已验证步骤。
2. Codex专用控制/协议模块、必要的共享层改动、合成故障夹具、回归及编译走查。若仅有实验工具，应如实标注，不能称生产适配器。
3. 按尝试独占保存原始证据，公开报告只放版本/摘要、授权范围、请求计数、工具/服务/结果对应、退出/清理、测试命令/退出码与限制。真实客户日志、profile、DB、会话、凭据及第三方源码不上传。
4. 新建Codex证据目录默认为Git忽略；先审查脱敏文件，再修改白名单仅放行必要摘要。不能将整个evidence目录解禁。
5. 同一数据域/账号/工具/权限/版本下的证据才可形成资格。报告明确 `PASS_SYNTHETIC`、`PASS_REAL`、`NOT_RUN`、`UNVERIFIED`、失败/阻塞；不拼接不同配置声称联合验收。
6. 对暂存的实际blob做秘密/二进制/路径/链接扫描，检查远端及提交范围；推送后核对远端SHA。作者自检写为作者自检，不冒充独立审核。

## 8. 可直接交给 DSH 的任务指令

> 你接手 Agent Weave 的 Codex 接入开发。请先完整阅读仓库根 connect.md、AGENTS.md、plan/项目交接说明.md 与 plan/README.md，再按 connect.md 学习 W11/W12 的 DSH 接入、W13 的 Claude 原客户端接入源码和实际证据。
>
> 你是实施者 DSH，目标是把用户实际的官方 Codex 接入当前平台；不要重新做 DSH 模型接入，不要替换成普通模型 API/SDK，不要构建管家。保留原生WPF、UI最后及既有数据/授权/隔离要求。
>
> 先确认checkout包含56b9c6a基线及本交接提交，保护原工作区改动；只读核实本机Codex身份、版本、配置方式和可用官方协议。优先验证官方stdio app-server＋本地MCP的组合，但必须证明它与指定原客户端的关系。独立官方新会话与已有桌面聊天附着分别登记，不得偷换目标。
>
> 在plan内维护阶段计划，复用W08的授权/CAS/幂等/只读状态与现有受限工具服务。先写能复现缺陷的合成测试，再实现固定启动、初始化、会话/回合绑定、工具读取、结构化进度、撤权及所属进程关闭；未知不解锁，不用通用RPC、跳过校验、隐藏报错或假数据凑成功。
>
> 在具体授权覆盖后，完成真实独立会话中的一条合成任务，调用平台task_get并准确回复；以原生事件、MCP计数、服务读记录和结果共同验收。随后核对退出、凭据清理和原配置/原进程保持。只读进度不得启动/续跑/打断模型，不读取私有历史。新启动、新会话、凭据复用、模型费用、窗口/OS操作若缺具体授权，只询问缺失项，同时继续不依赖它的工程工作。
>
> 不要只交教程、握手或脚本就结束。交付可复用的平台接入模块、合成与真实证据、能力矩阵、全量及受影响原生回归、编译用户路径走查，并明确仍未通过的生产/自动驱动/Windows隔离项目。每阶段修根因、重验、更新源设计与脱敏记录；检查暂存与远端后可正常提交推送，核对远端SHA。禁止force push、上传秘密/历史/运行库或自动扩大模型调用。管家保持不构建。
