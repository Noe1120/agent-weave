# W14 Codex app-server 接入（真实闭环已通过，生产资格未升）

> 2026-11-16，Asia/Tokyo。基线 `4949a2f`（connect.md 交接提交），本条在隔离分支 `feat/claude-desktop-mcp-probe` 上实施。
> **状态：平台 Codex 接入基础＝完成（真实客户端、协议、MCP 桥、平台服务、生命周期）；本地模型桩工具往返＝PASS_REAL_CLIENT_WITH_LOCAL_MODEL_STUB；真实厂商模型工具往返＝FAILED_AT_MODEL_TOOL_SELECTION（8 次尝试，160,090 tokens，预算内停止）——不能宣称 Codex 全部接入完成。** 已用本机固定 `codex.exe`（`0.167.0-alpha.3.2`）完成真实 initialize、真实原生 thread、真实一条 turn、真实一次平台只读工具往返（`task_get`）、1000 次纯只读进度、所属进程正常退出、撤权与关闭对账；原 12 个客户端进程前后不变。厂商模型支线的 4 次真实 turn 全部**没有**调用平台工具（桥每次握手成功、`tool_calls=0`），平台验收逐次判 FAIL，没有把任何一次写成成功。

Spec：connect.md §6（C1–C6）、[03 §4](03-agent-integration.md)、[09](09-review-closure-and-gates.md)、[12](12-protocol-closure-and-validation.md)、[W08](W08-ADAPTER-FOUNDATION.md)、[W11](W11-DSH-ACP-LIFECYCLE.md)、[W12](W12-DSH-SESSION-PREFLIGHT.md)、[W13](W13-CLAUDE-DESKTOP-MCP-PROBE.md)、根 AGENTS.md。

## 1. 目标与达成边界

最小闭环按 connect.md §6.1。本轮达成与未达成：

| 项 | 结果 |
| --- | --- |
| 固定身份/配置指纹 | 已固定：MSIX `OpenAI.Codex 26.1103.4239.0`、CLI `0.167.0-alpha.3.2`、`codex.exe` SHA-256、启动前后哈希与授权复核 |
| 真实 initialize | **PASS_REAL**（本机 CLI 子进程，空 `CODEX_HOME`，无凭据） |
| 真实原生 thread | **PASS_REAL**（客户端签发 UUIDv7 thread；平台只投影 SHA-256，`session_id` 恒 null） |
| 一条合成 turn | **PASS_REAL_CLIENT**（turn `completed`；模型为本地桩） |
| 一次平台只读工具往返 | **PASS_REAL**：真实客户端经 stdio MCP 调 `task_get`，平台 HTTP 服务返回 `draft`，原生 agent message 复述同一任务 ID 与状态 |
| 纯只读进度 | **PASS**：1000 次读取，DB 写入 0 |
| 关闭/退出 | **PASS**：exit 0、`forced=false`、`exit_observed=true`；原客户端进程 12→12 |
| 撤权 | 合成回归覆盖（真实运行中未撤权） |
| 真实厂商模型调用平台工具 | **FAILED_AT_MODEL_TOOL_SELECTION**（8 次，见 §5.2；预算内停止；客户端未向该模型声明 MCP 命名空间） |
| 已有桌面聊天附着 `attached_session` | NOT_RUN，且不以新 thread 冒充 |
| Windows 强制隔离 / 原生 UI / 完整 L1–L3 | NOT_RUN / UNVERIFIED |

## 2. C1 只读预检：本机事实（脱敏）

证据：`evidence/codex/preflight/2026-11-16-readonly/` 下 `preflight-summary.json`（脱敏摘要）与 `schema-summary.json`（由客户端自己生成的 schema 归纳）。

| 对象 | 已核实事实 |
| --- | --- |
| 桌面原客户端 | MSIX `OpenAI.Codex` `26.1103.4239.0`，`OpenAI.Codex_26.1103.4239.0_x64__2p2nqsd0c76g0`，主进程 `app\ChatGPT.exe` |
| CLI | `...\OpenAI\Codex\bin\f71a721e0e6193a9\codex.exe`，369,018,160 字节，SHA-256 `4b3286e3…c67382`，`codex-cli 0.167.0-alpha.3.2` |
| 用户配置 | `C:\Users\1\.codex\config.toml`：`model_provider="custom"`、回环 `127.0.0.1:15721`、`wire_api="responses"`；**bearer token 未读取、未打印、未复制** |
| 运行中实例 | 预检与两次真实验收均为 12 个（`ChatGPT.exe` 11、`codex.exe` 1），前后完全一致 |
| 客户端自带 schema | `codex app-server generate-json-schema --out <dir> --experimental` exit 0；ClientRequest 248 / ServerRequest 42 / ServerNotification 185 / ClientNotification 1 |

本轮新增的**真实**协议事实（取代此前的文档推断）：

1. **信封无 `jsonrpc` 成员**：请求 `{id,method,params?}`、响应 `{id,result}`、错误 `{id,error:{code,message,data?}}`、通知 `{method,params?}`；带 `"jsonrpc":"2.0"` 可被容忍，其他值被拒。
2. **`initialize`** params 需要 `clientInfo{name,version}`（`capabilities` 可选，键为 `experimentalApi` 等）；响应 v1 为 `{codexHome,platformFamily,platformOs,userAgent}`，**没有** `protocolVersion`；随后客户端只接受一次 `initialized` 通知。
3. **`thread/start`** params 全部可选（`cwd`、`approvalPolicy`、`model`…）；响应必须含 `thread`（`id` 为 UUIDv7）及 `approvalPolicy/approvalsReviewer/cwd/model/modelProvider/sandbox`。
4. **`turn/start`** params 必需 `{threadId,input:[{type:"text",text}]}`；`TurnStatus` 枚举为 `completed|interrupted|failed|inProgress`；**`inProgress` 不是终态**。
5. **MCP 工具暴露形状**：客户端把每个 MCP server 收成一个 `type:"namespace"` 工具 `mcp__<server>`，其 `tools` 里才是各函数的参数。可接受的模型调用是 `{type:"function_call", namespace:"mcp__<server>", name:"<tool>", arguments:"{...}"}`；扁平名 `mcp__server__tool` 会被拒为 `unsupported call`。
6. **空 home + 无 provider 的真实 turn 会诚实失败**：客户端回落到默认 OpenAI Responses WebSocket 端点，退避重试 7 次后 `turn/completed` 状态 `failed`（本机 stderr 已留证）。

## 3. 实现（不变量的实现方式）

| 不变量 | 实现 |
| --- | --- |
| 只四条固定客户端请求 | `initialize`、`thread/start`、`turn/start`、`turn/interrupt`（外加一次 `initialized` 通知）；无通用请求、无 shell、无 `thread/resume`、无 `thread/read`、无 `turn/steer`、无 `command/exec` |
| 有界 | stdout 1 MiB、单帧 256 KiB、stderr 64 KiB、入帧 5,000、出帧 1,000；请求 20 s；关闭 5 s 后仅强杀本次自有句柄 |
| 帧校验 | 对象必需；`jsonrpc` 缺省或 `"2.0"`；响应 id 必须等于唯一待决 id；result 与 error 互斥；UTF-8 必须合法 |
| 服务器请求一律拒绝 | 审批、`requestUserInput`、elicitation 等以 `-32601` 拒绝并计数（本次真实运行 `refused_server_requests: 0`，因为线程策略为 `approvalPolicy:"never"` + read-only） |
| 未知通知不升级 | 未识别通知只计数（≤20 类）；只有 `turn/completed` 的三个终态值会改变投影 |
| 未知结果不重发 | 超时/无终态一律 `unknown`，不复用 action、不重试、不按旧 PID 杀进程 |
| 配置只来自可信侧 | 隔离 home 里只写：回环模型端点、平台自己的 stdio 桥、固定非秘密默认值；无用户 config/凭据/插件/市场/MCP 复制 |

## 4. 已实现文件

| 文件 | 内容 |
| --- | --- |
| `packages/service/src/codex-app-server.ts` | `officialCodexLauncher`（四项必需配置 + 可选 `model_provider`/`bridge`；绝对路径、非链接、父目录可信、启动前后哈希与授权复核；隔离 home；`codexHomeConfig` 只生成回环 provider 与平台桥）；`CodexAppServer` 有界 JSONL 与四条固定请求；`statistics.last_agent_message` 保留有界终稿用于验收 |
| `packages/service/src/codex-runtime.ts` | `CodexRuntimeController`：`adapter_runtime`（`target="codex"`）、幂等/CAS、原生 thread 摘要、turn 投影、`turn/interrupt`、关闭、撤权维护、`last_agent_message` 只读投影 |
| `packages/service/src/mcp-read-client.ts` / `mcp-session.ts` | `target` 支持 `claude_desktop`/`codex` 并保留校验；连接报告记录 target |
| `tests/codex-app-server.test.ts`（11）、`tests/codex-runtime.test.ts`（16）、`tests/codex-read-connector.test.ts`（4）、`tests/codex-launcher-config.test.ts`（4） | 35 项合成回归 |
| `tests/fixtures/codex-app-server-fixture.mjs` | 22 种合成模式（含真实信封、错 id、`inProgress` 非终态、服务端请求、超限、断流） |
| `tests/codex-mock-provider.mjs` | 本地回环 Responses 桩：只做“挑选客户端声明过的工具 → 发一次调用 → 回读真实结果”，不联网 |
| `tests/codex-live-walkthrough.mjs` | `npm run test:codex:live`，三级独立开关；默认 verify 不调用 |

## 5. 验证结果

| 检查 | 结果 |
| --- | --- |
| Codex 回归组（5 个文件，`--test-concurrency=2`） | 54/54 通过（协议 15、控制器 22、连接器 4、启动配置 7、验收计划 6） |
| `npm run verify` | 493/493 通过，0 失败 0 跳过（含格式/类型/构建/冒烟） |
| `npm run test:native` | 14/14 C# + 1 项 WPF 静态 |
| `npm run test:native:package` | 旧 0.3.0 包 989 文件 PASS |
| 设计校验 | `test_p0_readiness.py` 与 `verify_design.py` 通过；250 AT/CA 仍 NOT_RUN |
| 真实 initialize / thread / stub turn / tool round-trip | 逐级独立目录：initialize `level_status=PASS`(4 项)、thread `PASS`(14 项)、stub turn `PASS_REAL_CLIENT_WITH_LOCAL_MODEL_STUB`(19 项) |
| 真实 vendor turn | `FAILED_AT_MODEL_TOOL_SELECTION`（18 项检查，`bridge tool_calls=0`，17,865 tokens） |

真实运行的关键计数：`bridge.initialized=true`、`bridge.tool_calls=1`、`bridge.tool_errors=0`、`bridge.fault=null`；模型桩 2 轮（1 次工具调用 + 1 次终稿）；原生 agent message 摘要与 grant 内任务 ID 一致；turn `completed`；exit 0 且非强制；原客户端 12→12。

本轮修复的缺陷见 §5.3。首次实现与真实首跑暴露的缺陷（保留，不改成通过）：信封字段（`jsonrpc`、`protocolVersion`）与文档不符；`inProgress` 曾被误映射为 completed；`thread/start` 缺 `approvalPolicy` 会走人工审批；MCP 工具名形状被猜错两次（先扁平名被拒，再 namespace 名被接受）；task id 抽取曾命中无关 UUID 导致桥按范围拒绝（`tool_errors=1`）。以上均按根因修复并补回归。

## 5.2 真实厂商模型支线（8 次尝试，预算内停止）

操作者授权「继续接入，费用 10 元以内」。使用其本机 CC Switch 回环路由（provider 段复制进每次全新的隔离 home，凭据从不进入任何报告），共发起 8 次真实 turn：

| 次 | tokens | 结果 |
| --- | --- | --- |
| 1–5 | 88,445 | turn completed、桥握手成功，模型始终误调其他工具（含逐字给出 `functions.exec` 代码的那次） |
| 6 | 17,985 | 换用目录内第二个真实模型 `gpt-6-astra`：同样只有 code-mode 工具面，误调 `wait` |
| 7 | 17,863 | 用客户端 `exec` 文档的规范化标识符 `tools.mcp__agent_weave_probe__task_get`，仍误调其他工具 |
| 8 | 17,865 | 修复后的验收脚本：18 项检查、清理完整、进程不变；`bridge tool_calls=0` |

合计 **160,090 tokens**。费用按客户端记录只报 token，金额为 **UNKNOWN**（该 route 的账单在本机不可观测，不做单价估算）。

**第 8 次同时给出决定性证据**（取自客户端自己的隔离 home rollout，零成本）：该模型收到的工具只有三个命名空间 `functions`/`clock`/`collaboration`，`mcp__agent_weave_probe` **没有被声明**（`mcp_namespace_declared=false`）。`functions.exec` 的说明写明嵌套工具在 `tools` 对象上（例 `await tools.mcp__ologs__get_profile(...)`），也就是说平台工具只可能存在于 exec 内部，且不作为独立函数声明。

三类情况据此区分：

1. **平台 MCP 桥有问题**——排除。同一桥、同一 grant、同一服务在本地桩模式下产生真实调用（`tool_calls=1`、`tool_errors=0`）。
2. **app-server 未把 MCP 工具暴露给该模型**——证据支持。声明面里没有我们的命名空间。
3. **模型/路由的工具选择面不支持该调用**——证据同时支持。5 种指令（含客户端自己的规范化标识符）都没让模型走进 `functions.exec`。

因此本构建与本研究 route 下，真实厂商模型的平台工具往返做不到；不能把第 3 种情况写成「平台完成」。

## 5.3 本轮修复的实现缺陷

| 缺陷 | 根因 | 修复与回归 |
| --- | --- | --- |
| 验收脚本在 vendor 模式抛 `TypeError: path must be … Received undefined` | vendor 模式没有本地桩，却无条件读 `mockState` | 模式与证据判定抽成 `tests/codex-acceptance-plan.ts`；vendor 模式不读桩日志；`tests/codex-acceptance-plan.test.ts` 覆盖 |
| 第二轮 turn 可能沿用第一轮 completed | 端点只按全局 `turn_state`/最后消息投影 | 传输层为每轮建立 generation + native turn id，只接受匹配 threadId+turnId 的终态；旧终态计数并忽略；最后消息与 token 用量按轮隔离 |
| 读数先于持久化显示 completed，导致 turn 与 BUSY 门竞态 | 投影用实时事实覆盖持久状态 | 投影只认持久状态；实时事实仅用于确认同一 generation |
| unknown 之后仍可用新 action_id 继续发 turn | 没有 unknown 门 | 新增 `CODEX_RECONCILIATION_REQUIRED`；只有「关闭并核对 exit_observed 后重建运行」才能继续；换 action/revision/控制器都不行 |
| turn 超时截止点随 ack 之后计算 | 截止点放在 awaitTurn 内 | 在接受 turn 时固定截止点 |

## 6. 失败与未知的处理口径

| 情形 | 记录 | 不得声称 |
| --- | --- | --- |
| initialize 被拒/鉴权 | `CODEX_INITIALIZE_REJECTED` / `CODEX_AUTH_REQUIRED` | 不能说“已连接” |
| thread 超时/被拒 | `CODEX_THREAD_TIMEOUT`（→unknown）/`CODEX_THREAD_REJECTED` | 不能重试建 thread |
| turn 超时/无终态 | `CODEX_TURN_TIMEOUT` / `CODEX_TURN_UNKNOWN` | 不能算完成 |
| turn 终态 failed | turn `failed`（本次空 home 首跑即如此） | 不能掩盖成握手问题 |
| interrupt 无回执 | `CODEX_INTERRUPT_*` + `unknown` | 不能当已停止 |
| 断流/非法帧/超限 | `CODEX_DISCONNECTED`/`CODEX_PROTOCOL`/`CODEX_FRAME_LIMIT` 等 | 不能继续报 ready |
| 撤权 | 收束到 closing→closed，查询转 `GRANT_REVOKED` | 撤 token 不等于物理停止 |

## 7. 仍未完成（下一步入口）

1. **真实厂商模型的工具调用**：已按授权尝试 7 次（142,225 tokens），全部止于模型侧工具选择，见 §5.2。可选下一步：固定线程工具面（有开关即用，需先验证）、换用直接暴露 MCP 工具的路由、或把「模型是否调用平台工具」单列为行为资格项。
2. **已有桌面聊天附着**（`attached_session`）：未实现，需另行验证；不以新 thread 冒充。
3. **真实 turn/interrupt 与忙碌排队**：仅合成覆盖。
4. **Windows 强制隔离、原生 UI、原生点击/视觉、完整 L1–L3**：UNVERIFIED。
5. **生产化**：凭据存储、邀请/受保护凭据、长期连接、外发策略、客户端升级后重验。

## 8. 证据索引

- 预检：`evidence/codex/preflight/2026-11-16-readonly/{preflight-summary,schema-summary}.json`
- 真实验收：`evidence/codex/real-attempt-report.json`
- 阶段完成记录与日志：`evidence/codex/COMPLETION.md`、`evidence/codex/verification-summary.json`（日志默认 Git 忽略）

## 9. 完成判定

W14 交付的是**真实客户端闭环（握手→原生 thread→一条 turn→一次平台只读工具往返→只读进度→关闭对账）**，模型为本地桩、无外发无计费。真实厂商模型、桌面聊天附着、强制隔离与 UI 仍未完成，不据此升级 L1–L3 或产品验收。
