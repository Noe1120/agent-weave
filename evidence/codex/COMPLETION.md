# W14 Codex 接入·合成阶段完成记录（2026-11-16）

作者自检记录。**不冒充独立审核。** 真实客户端/模型操作：0。

## 1. 本轮实际做了什么

按根 connect.md §6（C1–C6）接手 Codex 接入，完成 C1 只读预检与 C2 合成实现，并把 C5 的可实现部分（授权/CAS/幂等、原生 thread 与 turn 投影、只读进度、关闭、撤权维护、忙碌与 interrupt）在合成层面接上 W08 体系。C3/C4 真实握手与真实任务仍为 `NOT_RUN`：缺少对这些操作的具体授权，且启动器固定使用空 `CODEX_HOME`，不存在凭据复用路径。

## 2. 本机只读预检（C1）

已固定并脱敏保存在 `preflight-summary.json`：

- 桌面原客户端：MSIX `OpenAI.Codex` `26.1103.4239.0`（`OpenAI.Codex_26.1103.4239.0_x64__2p2nqsd0c76g0`），主进程 `app\ChatGPT.exe`。
- CLI：`C:\Users\1\AppData\Local\OpenAI\Codex\bin\f71a721e0e6193a9\codex.exe`，369,018,160 字节，SHA-256 `4b3286e3…c67382`。
- 配置元数据：`model_provider="custom"`、回环 `http://127.0.0.1:15721/v1`、`wire_api="responses"`、`requires_openai_auth=false`；bearer token 存在但**未读取、未打印、未复制**。
- 在运行实例（预检时）：`ChatGPT.exe` 11、`codex.exe` 1、`codex-computer-use*` 2、`codex-windows-sandbox-service` 1。本轮未启动、未接管、未重启、未结束任何实例。
- 二进制静态字符串仅作候选依据（`app-server` 1007、`thread/start` 37、`turn/start` 29、`turn/completed` 3、`turn/interrupt` 6 等），**不**证明本机协议字段或可用入口。

完整本地副本 `preflight-report.json` 含逐进程标识，仅留本机。

## 3. 合成实现（C2/C5 合成部分）

| 文件 | 变更 |
| --- | --- |
| `packages/service/src/codex-app-server.ts` | 新增。`officialCodexLauncher` 严格四项配置、非链接与父目录可信校验、启动前后哈希与授权复核、空 `CODEX_HOME`、固定参数 `["app-server"]`；`CodexAppServer` 有界 JSONL（1 MiB/stdout、256 KiB/帧、64 KiB/stderr、5000 入帧、1000 出帧、20 s 请求、5 s 关闭后仅强杀自有句柄），仅四条固定请求，服务器发起请求一律 `-32601` 拒绝并计数 |
| `packages/service/src/codex-runtime.ts` | 新增。`CodexRuntimeController` 复用 `adapter_runtime` 资源与动作幂等/CAS，绑定原生 thread（只投影 SHA-256 摘要），`session_id` 恒 `null`，能力全关/`UNVERIFIED`，固定 `synthetic_task_get/1` 指令且任务必须在 grant 内，interrupt/关闭/撤权维护，超时与无终态一律 `unknown` |
| `packages/service/src/mcp-read-client.ts` | `target` 支持 `claude_desktop` 与 `codex`，保留枚举校验（其他值拒绝） |
| `packages/service/src/mcp-session.ts` | 统计记录 `target`，两个原客户端的证据不可合并 |
| `tests/*`、`tests/fixtures/codex-app-server-fixture.mjs` | 30 项合成回归 + 19 种合成模式 |
| `tests/codex-live-walkthrough.mjs`、`package.json` | `test:codex`、`test:codex:live`（三级独立开关，默认 verify 不调用） |

## 4. 验证结果（作者执行）

| 命令 | 结果 | 日志 |
| --- | --- | --- |
| `tests/codex-app-server.test.ts` | 10/10 通过 | `2026-11-16-synthetic/green-app-server.log` |
| `tests/codex-runtime.test.ts` | 16/16 通过 | `2026-11-16-synthetic/green-runtime.log` |
| `tests/codex-read-connector.test.ts` | 4/4 通过 | `2026-11-16-synthetic/green-read-connector.log` |
| `codex*.test.ts` + `claude*.test.ts` + `dsh*.test.ts` | 196/196 通过 | `2026-11-16-synthetic/green-combined-codex-claude-dsh.log` |
| `npm run verify` | 469/469 通过（0 失败 0 跳过） | `2026-11-16-synthetic/verify-full.log` |
| `npm run test:native` | 14/14 C# + 1 项 WPF 静态 | `2026-11-16-synthetic/native-regression.log` |
| `npm run test:native:package` | 旧包 989 文件 PASS | `2026-11-16-synthetic/native-package.log` |
| `plan/tools/test_p0_readiness.py -v` | 通过（exit 0） | `2026-11-16-synthetic/p0-readiness.log` |
| `plan/tools/verify_design.py`（刷新+只读） | 通过；250 AT/CA 仍 `NOT_RUN` | `2026-11-16-synthetic/design-refresh.log`、`design-verify.log` |

首次实现的真实失败（未改成通过）：transport 首轮 8/10、runtime 首轮 9/16、connector 首轮 3/4；原因见 [W14 §5](../../plan/W14-CODEX-APP-SERVER.md)。另在补 `wrong-id`（请求待决期间收到别的 id 响应）模式时发现原覆盖不足，已加入回归。

失败红日志未持久化，原因是当时的失败运行输出只在交互会话中显示；本记录如实标注，不伪造红日志。曾两次尝试通过重新注入缺陷复现红日志，第一次注入未复现（测试已改为等待原生标识），第二次命中覆盖缺口并促成了上述回归补充。

## 5. 未做与不能声称的

- 真实 `initialize`、真实新 thread、真实合成 turn、真实 `task_get` 往返：`NOT_RUN`。
- 已有 Codex 桌面聊天附着（`attached_session`）：未实现，且不以新 thread 冒充。
- 凭据复用路径：未实现。空 home 启动器无法完成真实模型 turn。
- Windows 强制隔离、原生 UI、原生点击/视觉验收、完整 L1–L3：未变，`UNVERIFIED`。
- 真实模型请求与费用：本轮 0 次；未来真实 turn 的费用未知，不推断为零。
- 原客户端进程与配置：未读取其会话/历史/数据库，未改写。

## 6. 下一步需要的具体授权（只问缺项）

1. 启动本机固定 CLI 的 `app-server` 子进程并只发送一次 `initialize`（空 home、无凭据、单次）。
2. 允许执行 `codex --version` / `--help`（会执行程序），用于固定真实版本与入口。
3. 若需真实 thread：单独授权 `thread/start`。
4. 若需真实 turn 与平台工具往返：授权凭据复用（把获准的 provider 配置与令牌副本放进自有临时 home）＋ 一条合成任务 ＋ 费用未知的确认。
