# W14 Codex 接入·真实闭环完成记录（2026-11-16）

作者自检记录。**不冒充独立审核。**

## 1. 结论摘要

| 项目 | 结果 |
| --- | --- |
| 真实 initialize（本机固定 CLI 子进程、空 CODEX_HOME、无凭据） | PASS_REAL |
| 真实原生 thread（客户端签发 UUIDv7，平台只投影 SHA-256） | PASS_REAL |
| 一条真实 turn | PASS_REAL_CLIENT（模型为本地回环桩） |
| 一次真实平台只读工具往返（`task_get`） | PASS_REAL |
| 1000 次纯只读进度 | PASS（DB 写入 0） |
| 所属进程退出与对账 | PASS（exit 0、`forced=false`、`exit_observed=true`） |
| 原客户端进程 | 12 → 12，未变 |
| 真实厂商模型 turn | NOT_RUN |
| 已有桌面聊天附着（`attached_session`） | NOT_RUN |
| Windows 强制隔离 / 原生 UI / 完整 L1–L3 | NOT_RUN / UNVERIFIED |

真实运行总状态：`REAL_CODEX_TOOL_ROUND_TRIP_PASS`（见 `real-attempt-report.json`）。

## 2. 真实运行做了什么

1. `codex app-server generate-json-schema --out <临时目录> --experimental`（exit 0）取得该版本自己的协议 schema，用来核实并纠正此前的文档推断。
2. `codex --version` / `app-server --help`：`codex-cli 0.167.0-alpha.3.2`，`app-server` 为 experimental 子命令。
3. 用固定 `codex.exe`（SHA-256 已固定）+ 每次新建的隔离 home 启动 `app-server`；只发送 `initialize`、`initialized`、`thread/start`、`turn/start`。`turn/interrupt` 本轮未对活动 turn 发送。
4. 平台侧：合成 in-memory 库（项目/成员/任务/grant/scope）、本机回环 HTTP 服务、平台自己的 stdio MCP 只读桥（`target=codex`，临时令牌只落在本次独占目录）。
5. 一条合成指令要求客户端只调用 `task_get` 一次；客户端真实经 MCP 调用桥，桥经 HTTP 读取平台任务，返回 `draft`；原生 agent message 复述同一任务 ID 与状态，turn `completed`。
6. 结束后关闭所属子进程（exit 0、非强制），并核对原客户端进程清单未变。

## 3. 关于模型桩（必须如实说明）

本机没有向任何厂商 provider 发送请求。为了让“真实客户端 + 真实协议 + 真实 MCP + 真实平台服务”这段闭环可以在零成本、零凭据下被观察到，harness 启动了一个**本地回环 Responses-API 桩**（`tests/codex-mock-provider.mjs`，`127.0.0.1`）：

- 它只做两件事：从客户端**自己声明的工具列表**里挑出带 `task_get` 的那一个；把真实工具结果回读后生成一句终稿。
- 它不发任何外部网络请求、不含任何凭据、不产生费用。
- 因此“模型推理”这一段不是真实厂商模型；**客户端、协议、MCP 传输、平台服务、工具调用与结果都是真的**。

空 home 且无 provider 时的真实 turn 也已实测：客户端回落到默认 OpenAI Responses WebSocket 端点，退避重试 7 次后 `turn/completed` 为 `failed`（stderr 已留证）。这是诚实的失败记录，不是配置错误。

## 4. 真实运行暴露并修复的缺陷（按根因）

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| initialize 报文被拒（若按在线文档写） | 该版本信封**没有** `jsonrpc` 成员 | 出站不再写 `jsonrpc`；入站容忍 `"2.0"`、拒绝其他值 |
| 初始化投影拿不到版本号 | v1 `InitializeResponse` 只有 `codexHome/platformFamily/platformOs/userAgent` | 投影改为真实字段；缺失即协议故障 |
| `turn/completed` 被当作 completed | `TurnStatus` 含 `inProgress`，此前默认映射为 completed | 只有 completed/failed/interrupted 改变投影，`inProgress` → running |
| 真实客户端要求人工审批 | `thread/start` 未设 `approvalPolicy`，默认 `on-request` | 平台线程固定 `approvalPolicy:"never"` + read-only 沙箱；服务器请求仍一律拒绝并计数 |
| 工具调用被拒 `unsupported call: mcp__agent_weave_probe__task_get` | 该版本把每个 MCP server 收成一个 `namespace` 工具 | 调用改为 `{namespace:'mcp__<server>', name:'<tool>'}`，从客户端声明里解析，不硬编码 |
| 桥返回 `tool_errors=1` | 模型桩抽 task id 时命中对话里另一个 UUID | 只取平台指令中 `task_id <uuid>` 的值 |

## 5. 验证命令与结果

| 命令 | 结果 |
| --- | --- |
| `node --test tests/codex*.test.ts` | 35/35 |
| `npm run verify` | 474/474，0 失败 0 跳过 |
| `npm run test:native` | 14/14 C# + 1 项 WPF 静态 |
| `npm run test:native:package` | 旧 0.3.0 包 989 文件 PASS |
| `plan/tools/test_p0_readiness.py -v` | 通过 |
| `plan/tools/verify_design.py`（刷新 + 只读） | 通过；250 AT/CA 仍 NOT_RUN |
| `npm run test:codex:live -- --allow-codex-app-server-initialize --allow-codex-new-thread --allow-codex-synthetic-turn ...` | `REAL_CODEX_TOOL_ROUND_TRIP_PASS` |

原始日志（本机、默认 Git 忽略）：`2026-11-16-synthetic/` 下 `verify-full-after-real.log`、`native-*-after-real.log`、`design-*-after-real.log`；真实运行的逐次报告在 `.runtime/evidence-codex-*`。

## 5.2 真实厂商模型支线（授权后 7 次尝试，预算内停止）

操作者要求「继续接入，费用 10 元以内」。使用其本机 CC Switch 回环路由（provider 段复制进全新的隔离 home，凭据不入任何报告），发起 4 次真实 turn，合计 **142,225 tokens**，全部 turn 完成、桥全部握手成功，但**一次都没有平台工具调用**。逐次结果与根因见 `vendor-attempt-report.json` 与 W14 §5.2。结论：该模型下客户端只提供 code 模式工具面，MCP 工具只能经 `functions.exec` 的 `tools.*` 调用，模型四次都没进入；同一客户端在无模型元数据时会直接暴露 `mcp__agent_weave_probe` 命名空间并调用成功。平台验收对每次尝试都判 FAIL，没有一次记成成功。预算未超，之后不再花钱。

## 6. 仍未完成（需要新的具体授权）

1. **真实厂商模型的工具调用**：已按授权尝试（142,225 tokens），止于模型侧工具选择，见 §5.2。可选下一步：固定线程工具面（需先验证可用开关）、换用直接暴露 MCP 工具的路由、或把该行为单列为资格项。
2. **已有桌面聊天附着**：未实现；独立新 thread 不能冒充。
3. **真实 turn/interrupt、忙碌排队、取消后的恢复**：只有合成覆盖。
4. **Windows 强制隔离、原生 UI、点击/视觉验收、完整 L1–L3**：UNVERIFIED。
5. **生产化**：受保护凭据存储、邀请/披露、长期连接与外发策略、客户端升级后重验。
