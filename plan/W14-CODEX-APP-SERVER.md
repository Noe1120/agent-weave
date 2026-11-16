# W14 Codex app-server 接入（候选协议实现与真实门槛）

> 2026-11-16，Asia/Tokyo。基线 `4949a2f`（connect.md 交接提交），本条在隔离分支 `feat/claude-desktop-mcp-probe` 上实施。
> **状态：IMPLEMENTED_SYNTHETIC。** 固定启动器、有界 app-server 协议状态机、W08 授权/CAS/幂等控制器、MCP 只读桥的 Codex 目标与 30 项合成回归已实现并通过。本机真实握手、新 thread、合成 turn、原客户端工具往返**全部 NOT_RUN**：本轮没有获得对这些操作的具体授权，也没有实现凭据复用路径。原客户端未被启动、附着、读取或改写。

Spec：connect.md §6（C1–C6）、[03 §4](03-agent-integration.md)、[09](09-review-closure-and-gates.md)、[12](12-protocol-closure-and-validation.md)、[W08](W08-ADAPTER-FOUNDATION.md)、[W11](W11-DSH-ACP-LIFECYCLE.md)、[W12](W12-DSH-SESSION-PREFLIGHT.md)、[W13](W13-CLAUDE-DESKTOP-MCP-PROBE.md)、根 AGENTS.md。

## 1. 目标与不得越过的地方

最小闭环按 connect.md §6.1：固定身份/配置 → 合成协议与授权回归 → 获准的真实握手 → 新 thread 中的一条合成任务 → 一次平台只读工具读取与可核对回复 → 纯只读进度 → 关闭/撤权/凭据清理。

本轮完成后仍未成立的：

1. 官方 app-server 的**真实** initialize、thread/start、turn/start 回执与 schema（本机版本未运行）。
2. 原 Codex 新 thread 调用平台 `task_get` 的一次真实往返（需要新 thread/凭据/一条合成任务三项授权，且当前模块不提供凭据配置路径）。
3. 已有 Codex 桌面聊天的附着（`attached_session`）。独立 app-server 新 thread 不能冒充。
4. Windows 强制隔离、原生 UI、原生点击/视觉验收、完整 L1–L3。
5. 费用与上游网络：任何真实 turn 都可能经配置的 provider 产生请求与费用，本模块不推断为零。

## 2. C1 只读预检：本机事实（脱敏）

证据：工作区 `evidence/codex/preflight/2026-11-16-readonly/preflight-report.json`（默认 Git 忽略，按白名单放行脱敏摘要）。

| 对象 | 已核实事实 | 不能据此声称 |
| --- | --- | --- |
| 桌面原客户端 | MSIX 包 `OpenAI.Codex` `26.1103.4239.0`，`OpenAI.Codex_26.1103.4239.0_x64__2p2nqsd0c76g0`，主进程 `app\ChatGPT.exe`，预检时 11 个 ChatGPT 进程在运行 | 安装存在不等于已被本平台接入 |
| CLI 运行体 | `C:\Users\1\AppData\Local\OpenAI\Codex\bin\f71a721e0e6193a9\codex.exe`，369,018,160 字节，SHA-256 `4b3286e35d7fe866c6b0eb3f07d7a4cdb5e96489576170dfd6b3a15aa1c67382`；`config.toml` 的 `CODEX_CLI_PATH` 指向它 | 该 CLI 与桌面 app 的同版本绑定关系未证明 |
| 配置 | `C:\Users\1\.codex\config.toml`（3,463 字节）`model_provider="custom"`、`base_url=http://127.0.0.1:15721/v1`、`wire_api="responses"`、`requires_openai_auth=false`；存在 bearer token（**未读取、未打印、未复制**）；已配置 MCP `node_repl` 与若干插件 | 回环 gateway 的上游与计费归属未知；该配置不是本模块使用的配置 |
| 运行中实例 | 预检时 `ChatGPT.exe` 11、`codex.exe` 1、`codex-computer-use*` 2、`codex-windows-sandbox-service` 1 | 不得接管、重启或结束这些实例 |
| 静态字符串 | 固定 CLI 内 `app-server` 命中 1007、`codex app-server` 17、`thread/start` 37、`turn/start` 29、`turn/completed` 3、`thread/resume` 22、`turn/interrupt` 6、`item/tool/requestUserInput` 3 | 只证明二进制内含相关代码与字符串，不证明本产品可用的入口、字段或 schema |

未知项（保持未知）：真实 initialize 结果字段、本机 schema、`turn/start` 的 input 形状、turn 事件名、approval/requestUserInput 的原生 ID 格式、真实 turn 的请求与费用。**本轮没有执行 `--version`/`--help`/schema 生成**，因为那同样会执行程序；需要另行授权的一次执行。

## 3. 协议候选与不变量

`initialize → initialized → thread/start → turn/start → （事件）turn/completed`；`turn/interrupt` 只在已有 native turn 标识时发送。依据 connect.md §6.2 的两个官方页面，以及本机二进制的静态字符串；**不是本机实测结论**。

必守不变量（已由回归锁定）：

| 不变量 | 实现 |
| --- | --- |
| 只四条固定客户端请求 | `initialize`、`thread/start`、`turn/start`、`turn/interrupt`；无通用 `request`、无 shell、无 `thread/resume`、无 `thread/read`、无 `turn/steer`、无 `command/exec` |
| 有界 | stdout 1 MiB、单帧 256 KiB、stderr 64 KiB、入帧 5,000、出帧 1,000；请求 20 s；关闭 5 s 后仅对本次自有句柄强杀 |
| 帧校验 | 必须是对象；`jsonrpc` 可缺省或 `"2.0"`（官方在线示例省略该字段），其他值判 `CODEX_PROTOCOL`；响应 id 必须等于唯一待决 id；同时含 result 与 error 判故障；UTF-8 必须合法 |
| 服务端请求一律拒绝 | 服务器发起请求（审批、`requestUserInput` 等）以 `-32601` 拒绝并计数，绝不授予，也绝不当作成功 |
| 未知通知不升级为成功 | 未识别通知只计数（上限 20 类），`turn/completed` 才改变 turn 终态；无终态事件时 turn 停在 `requested`/`unknown` |
| 未知结果不重发 | 超时一律 `unknown`；不复用 action、不自动重试、不按旧 PID 杀进程 |

## 4. 已实现内容

| 文件 | 内容 |
| --- | --- |
| `packages/service/src/codex-app-server.ts` | `officialCodexLauncher`（严格四项配置：`installation_root`、`data_root`、`client_version`、`executable_sha256`；绝对路径、非链接、父目录可信、启动前后复核哈希与授权；每次启动新建空 `CODEX_HOME`，参数固定 `["app-server"]`）；`CodexAppServer` 有界 JSONL 传输与四条固定请求 |
| `packages/service/src/codex-runtime.ts` | `CodexRuntimeController`：`adapter_runtime` 资源（`target="codex"`、`mode="app_server_thread"`）、动作幂等与 CAS、原生 thread 绑定、只读状态投影、合成 turn、`turn/interrupt`、关闭、独立撤权维护 |
| `packages/service/src/mcp-read-client.ts` | `target` 扩展为 `claude_desktop` / `codex`（`mcpTargets`），**保留**枚举校验；其他值拒绝，不删除校验、不假报身份 |
| `packages/service/src/mcp-session.ts` | 报告统计记录 `target`，两个原客户端的证据不可合并 |
| `tests/codex-app-server.test.ts`、`tests/codex-runtime.test.ts`、`tests/codex-read-connector.test.ts` | 30 项合成回归 |
| `tests/fixtures/codex-app-server-fixture.mjs` | 19 种合成模式：正常、无 `jsonrpc`、重复/错 id 响应、initialize 错误与鉴权错误、超限帧、stderr 洪水、服务端请求、挂起、早退、非法 UTF-8、非 JSON、turn 失败/无终态、interrupt 无回执、thread 错误、静默 |
| `tests/codex-live-walkthrough.mjs` | `npm run test:codex:live`，三级独立开关（initialize / 新 thread / 合成 turn），独占输出目录，前后原客户端进程清单；**默认 verify 不调用** |

关键设计取舍：

1. **模型参数不进入协议**：`turn` 只能发送模块内固定的 `synthetic_task_get/1` 指令，任务 ID 必须已经在 grant 的 `resource_ids` 内且是可读 `task` 资源，调用方不能提供自由文本、URL、凭据、project 或另一个安全域。
2. **不伪造 platform session**：`read()` 的 `session_id` 恒为 `null`，只把原生 thread ID 的 SHA-256（`native_thread_sha256`）与 turn ID 摘要投影出去；原生值留在 ACL 内资源里。
3. **能力一律关闭**：投影沿用 W08 `capabilities`，全部 `enabled=false`、`reason=UNVERIFIED`；`qualification` 恒 `UNVERIFIED`、`execution_stop_proven=false`。
4. **空 home 起步**：启动器不读用户 `CODEX_HOME`、不读旧会话/数据库、不复制凭据。因此真实 turn 需要另行授权的凭据配置路径（本轮不实现，见 §7）。
5. **不接管桌面实例**：`owned_process` 只覆盖本次启动的子进程；`attached_session` 未实现、也不以新 thread 冒充。

## 5. 合成验证结果

| 检查 | 结果 |
| --- | --- |
| `node --test --test-concurrency=1 tests/codex-app-server.test.ts` | 10/10 通过 |
| `node --test --test-concurrency=1 tests/codex-runtime.test.ts` | 16/16 通过 |
| `node --test --test-concurrency=1 tests/codex-read-connector.test.ts` | 4/4 通过 |
| `node --test --test-concurrency=2 tests/codex*.test.ts tests/claude*.test.ts tests/dsh*.test.ts` | 196/196 通过（Codex 新增无 DSH/Claude 回归） |
| `npm run verify`（全量） | 469/469 通过，0 失败 0 跳过；含生成契约检查、格式、类型、Web 语法、构建与冒烟 |
| `npm run test:native` | 14/14 C# 通过 + 1 项 WPF 静态检查通过 |
| `npm run test:native:package` | 旧 0.3.0 便携包 989 文件 PASS |
| `plan/tools/test_p0_readiness.py -v`、`verify_design.py` | 通过；250 AT/CA 仍 NOT_RUN，product_tests=NOT_RUN |

首次实现时的真实失败（保留原因，不改成通过）：transport 首轮 8/10——initialize 错误被误分类为鉴权、超限帧到达时序与 ready 竞争；runtime 首轮 9/16——scope/runtime 的 grant 变更未落库、`turning` 与 `ready` 的忙碌判定顺序、turn 请求标识未落库就断言已确认、`read()` 同步抛出被当作 Promise 拒绝；connector 首轮 3/4——替换式测试没有真正改变 target。补上 `wrong-id`（请求待决期间收到别的 id 响应）模式后才发现原实现缺少该覆盖，已加入回归。作者自检，不冒充独立审核。

## 6. 失败与未知的处理口径

| 情形 | 记录 | 不得声称 |
| --- | --- | --- |
| initialize 被拒 | `CODEX_INITIALIZE_REJECTED`，ready 拒绝，资源 `failed` | 不能说“已连接” |
| initialize 报鉴权 | `CODEX_AUTH_REQUIRED`（空 home 的预期结果之一） | 不能说原客户端失效或登录问题 |
| thread/start 超时 | `CODEX_THREAD_TIMEOUT` + `unknown`（原生侧可能已建） | 不能重试建 thread |
| turn 请求超时 | `CODEX_TURN_TIMEOUT` + turn `unknown` | 不能算一次完成的任务 |
| turn 无终态事件 | `CODEX_TURN_UNKNOWN`，turn `unknown` | 不能按“已完成”汇报 |
| interrupt 无回执 | `CODEX_INTERRUPT_*` + turn `unknown` | 不能当已停止 |
| 断流/非法帧/超限 | `CODEX_DISCONNECTED`、`CODEX_PROTOCOL`、`CODEX_FRAME_LIMIT`、`CODEX_STDOUT_LIMIT`、`CODEX_STDERR_LIMIT` | 不能继续报告 ready |
| 撤权 | 维护周期把连接收束到 `closing`→`closed`，查询转 `GRANT_REVOKED` | 撤 token 不等于物理停止已证明 |

## 7. 下一阶段与所需授权（缺一项只问该项）

| 阶段 | 需要的操作 | 当前状态 |
| --- | --- | --- |
| C3 真实握手 | 启动本机固定 CLI 的 `app-server` 子进程并只做 `initialize`（单次、空 home、无凭据） | NOT_RUN，缺“启动固定 Codex CLI 子进程并初始化”的授权 |
| C3b 版本/schema 只读 | 执行 `codex --version` / `--help` / schema 生成（会执行程序） | NOT_RUN，缺该项执行授权 |
| C4 真实新 thread | 额外授权 `thread/start`；如需 turn，还须授权凭据复用（把获准的 provider 配置与令牌副本放进自有临时 home）与一条合成任务 | NOT_RUN，缺授权且凭据路径未实现 |
| C4b 真实工具往返 | 新 thread 调用平台只读 `task_get` 一次并准确回复 | NOT_RUN（依赖 C4，且需 codex 目标的 MCP 配置） |
| C5 生命周期扩展 | 忙碌输入、取消、恢复、附着会话 | 合成部分已覆盖 turn 忙碌/中断；其余 NOT_RUN |
| C6 交付 | 全量回归、原生回归、编译使用顺序走查、脱敏证据 | 本轮范围 |

## 8. 证据索引

- 预检：`evidence/codex/preflight/2026-11-16-readonly/preflight-report.json`
- 合成与全量日志、阶段说明：`evidence/codex/2026-11-16-synthetic/`（默认 Git 忽略，审查脱敏后按白名单放行）

## 9. 完成判定

W14 交付的是**可测试、会拒绝、能解释原因的 Codex 接入底座 + 一次可被授权调用的真实入口**，不是“Codex 接入完成”。真实握手与单任务往返仍待具体授权；未获授权时不得用合成 PASS 或文档 PASS 代替。
