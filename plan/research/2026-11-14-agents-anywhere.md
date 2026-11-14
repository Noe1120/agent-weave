# Agents Anywhere：本机 Agent 接入借鉴评估

日期：2026-11-14（Asia/Tokyo）。范围：用户提供参考项目后的定向源码阅读；不是全仓安全审计、运行验收或客户端兼容资格。

## 结论

值得借鉴的是 **本机 Connector 与 Runtime 的边界、Codex 桌面会话跟随、DSH 插件桥、能力与事件契约**。不建议整个平台移植，也不改变现有 WPF + 本地服务 + SQLite + Broker 的简单架构。

本次固定 `main` 提交 `aa12e7a2c181df29c0cf0a88959dccbefef45a92`，提交时间 2026-11-14 01:42:47 +08:00。此提交说明为 2.2.0 发布准备，desktop-workbench/package.json 为 2.2.0，但 README 下载入口仍展示 2.0.3。这里评估的是源码快照，不把主线实现当作已发布或已在本机通过验收。

## 1. 三个目标不能混为一谈

| 目标 | 参考项目的实际路径 | 对 Team 的价值与限制 |
| --- | --- | --- |
| Codex | 独立 app-server 通路；桌面/IDE 另有 IPC owner/follower 通路。Windows 使用命名管道；方法版本表从具体桌面/扩展版本提取。 | 有价值的“跟随原桌面会话”研究线索，不是只有另开 CLI。但内部协议版本敏感，尚未验证本机安装版本，不应假定是稳定官方公共接口。 |
| Claude | Claude Agent SDK turn loop，创建 ClaudeSDKClient；README 明示 Claude Code。 | 可借鉴事件、审批、状态转换，但不满足指定原版 Claude Desktop 身份。不能静默替换目标。 |
| DeepSeek Harness | 在 DSH 内的插件通过原生会话服务接入，Connector 使用 BridgeClient 通信；文档分别说明第三方 DSH Desktop 与 DeepSeek 官方 Harness Desktop。 | 原客户端插件桥值得优先评估；不能把两个 Desktop 产品视为同一身份。本次没有安装插件、调用 bridge 或确认官方接口适用范围。 |

证据入口：`connector/connector/runtimes/codex/ipc/{paths,service,versions,control}.py`、`runtimes/claude/{README.md,sdk/client.py}`、`runtimes/dsh/{discovery.py,bridge/client.py}`、`dsh-bridge-next/{README.md,src/host/dsh-runtime/native.ts}`。

## 2. 值得吸收的具体规则

### A. 先区分连接和托管，再谈启停

参考项目把 Provider 的发现/配置校验/实例创建，与 Runtime 的会话读写分离；Codex 有明确 follower 身份。因此 Team 的未来适配器要区分：

- `owned_process`：平台自己创建并掌握生命周期的进程树。W07 开发夹具属于此类。
- `attached_session`：用户原客户端持有的会话，平台只是经明确授权连接。断开连接不等于中断回合，中断回合也不等于退出整个原客户端。

这是从源码对 Team 推导出的设计建议；研究后W07只实现了 owned_process 开发运行器，**attached_session 仍不是已经实现的接口**。不能把 W07 Job Object 的终止方法用于任意附着客户端；原客户端仍持有的直接文件写权限，也不能靠断开连接证明已撤销。

### B. 观察不能顺手接管

Codex reader 使用 `thread/read`，源码明确避免为读取权限设置调用会取得 writer lock 的 `thread/resume`。IPC start-turn 结果不明时使用明确的 unknown 错误，不自动重发。

Team 保留更严格边界：用户的进度查询只读平台投影；后台适配器可在授权范围独立同步观察。读接口不发送 prompt/steer/resume/interrupt，不自动唤醒客户端，也不借读取遍历无关历史。

### C. 能力必须真实且细分

参考项目 RuntimeCapability 分别记录 supported、available、allowed 和 unavailable_reason；服务端以有效能力约束操作，未实现方法明确 unsupported。

Team 可复用此语义，**不把连接成功等同所有能力通过**：发现、只读、发送、审批、输入恢复、取消分别登记，并绑定实际原客户端版本、实例、会话与证据。能力声明只是上限，动作仍须与既有 grant/policy/run/resource 求交，不能由模型或 worker 自报扩大权限。

### D. 原生业务身份保持稳定，历史与实时共享投影

参考项目 Timeline 文档以原生会话/回合/工具调用业务身份统一实时与历史；contentHash 表示条目状态而非通用身份，不能按正文相同合并不同调用。

Team 可据此补充事件来源、原生 ID、序号、快照版本和幂等收据，测试实时事件后回读历史、断线重放、同内容不同调用。消息、等待回答、审批仍为独立通道；Agent 的“做完了”不能代替 Broker checkpoint 和平台验收。

### E. 世代、配置摘要和不明结果是恢复的一部分

参考项目 switch_fence 持久化单调 switchRevision，报告 configDigest 和每个 Connector 进程的新 instanceId，防止旧配置操作覆盖新配置。

Team 不另造复杂配置框架：在现有 run_epoch、请求摘要与日志上保留这一原则。配置改动后的旧事件/回执不得重新取得写权限；未知结果不得当失败后盲重试，更不得当已停止后释放锁。

## 3. 不直接照搬的部分

1. **桌面壳**：desktop-workbench 明确是 Electron web workbench shell，不符合用户要求的原生 UI；继续 WPF，UI 最后设计。
2. **云/移动/终端全栈**：参考架构经过 Server 与 Connector，会话和附件可按功能经服务端传输/存储。Team 当前本地目标不需要引入整套云账户、远程终端、PostgreSQL/Redis 或跨端框架。
3. **替换客户端与自动 fallback**：存在 app-server/SDK/托管安装能力不意味着允许替换用户指定原客户端；发现版本不匹配时应关闭对应能力并展示原因，而不是自动换身份。
4. **线程写锁不等于项目文件单写者**：参考项目 Codex 的 writer lock 针对会话；DSH discovery 元数据明确 `sameSessionWriterLimit=1`、`crossProcessWriterExclusion=False`。不能用它证明跨 worktree 的项目逻辑路径独占，更不能证明 Windows 强制隔离。
5. **连接和权限展示不等于强制隔离**：现有 Broker 锁、grant、权限派生与 Win-SID-Broker-1 门槛保持。若原客户端仍可绕过 Broker 直接修改文件，严格写入资格不得启用。
6. **不无脑复制协议边界**：例如该 Codex IPC framing 上限为 256MiB，是外部兼容选择，不应直接覆盖本阶段 64KiB 开发 worker 帧限制。未来外部适配器应单独验证真实帧/快照大小、内存预算与分页/拒绝策略。

## 4. 对当前构建顺序的建议

1. 继续完成 W07 自有开发进程的生命周期、撤权、未知结果及恢复证据；不宣称它等同原客户端接入。
2. 下一适配阶段优先研究 Codex 的只读桌面跟随与 DSH 的原客户端插件桥；先固定版本、最小权限和协议证据，再安排明确授权的本机探针。不要为了检测而自动启动/重启/安装/接管客户端。
3. Claude Desktop 维持独立待验证项；不以此项目的 Claude SDK 结果替代。
4. 在上述门槛通过前，只显示真实已实现能力；WPF UI 仍最后设计。不为参考项目新增云端依赖或改变产品目标。

## 5. 本次证据与未执行项

- 只读取公开源码，保存固定提交与 25 个定向阅读文件的 SHA256。
- 证据：`evidence/research/2026-11-14-agents-anywhere/source-records.json`；浅克隆源码在同目录 `source/`。
- 未安装依赖、未执行参考项目代码/测试、未启动任何原 Agent、未读本机 Agent 私有历史、未调用模型/API、未修改系统隔离策略。
- 此次没有实现适配器，没有执行原客户端/原生 UI 端到端验收；产品250 AT/CA仍 NOT_RUN，兼容与强制隔离仍 UNVERIFIED。
- 研究进行时，W07仅新增协议/准入校验与两个单测，RunnerController、原生RunnerHost和完整走查尚未完成。研究结束后已继续完成自有开发进程运行器及验证，现状见[W07实施记录](../W07-DEVELOPMENT-RUNNER.md)；这不改变本次静态研究的证据边界，也不意味着原客户端附着已实现。

## 固定源码引用

- [README.md](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/README.md)
- [desktop-workbench/package.json](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/desktop-workbench/package.json)
- [docs/codex-ipc-takeover.md](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/docs/codex-ipc-takeover.md)
- [docs/runtime-protocol/README.md](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/docs/runtime-protocol/README.md)
- [docs/runtime-protocol/timeline-identity.md](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/docs/runtime-protocol/timeline-identity.md)
- [docs/api/capabilities.md](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/docs/api/capabilities.md)
- [connector/connector/runtime_protocol/provider.py](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/connector/connector/runtime_protocol/provider.py)
- [connector/connector/runtime_protocol/protocol.py](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/connector/connector/runtime_protocol/protocol.py)
- [connector/connector/runtime_protocol/host.py](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/connector/connector/runtime_protocol/host.py)
- [connector/connector/runtime_protocol/models.py](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/connector/connector/runtime_protocol/models.py)
- [connector/connector/runtime_protocol/supervisor.py](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/connector/connector/runtime_protocol/supervisor.py)
- [connector/connector/runtime_protocol/switch_fence.py](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/connector/connector/runtime_protocol/switch_fence.py)
- [connector/connector/runtimes/codex/ipc/paths.py](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/connector/connector/runtimes/codex/ipc/paths.py)
- [connector/connector/runtimes/codex/ipc/service.py](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/connector/connector/runtimes/codex/ipc/service.py)
- [connector/connector/runtimes/codex/ipc/control.py](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/connector/connector/runtimes/codex/ipc/control.py)
- [connector/connector/runtimes/codex/ipc/versions.py](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/connector/connector/runtimes/codex/ipc/versions.py)
- [connector/connector/runtimes/codex/ipc/framing.py](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/connector/connector/runtimes/codex/ipc/framing.py)
- [connector/connector/runtimes/codex/sessions/reader.py](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/connector/connector/runtimes/codex/sessions/reader.py)
- [connector/connector/runtimes/claude/README.md](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/connector/connector/runtimes/claude/README.md)
- [connector/connector/runtimes/claude/sdk/client.py](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/connector/connector/runtimes/claude/sdk/client.py)
- [connector/connector/runtimes/dsh/discovery.py](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/connector/connector/runtimes/dsh/discovery.py)
- [connector/connector/runtimes/dsh/bridge/client.py](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/connector/connector/runtimes/dsh/bridge/client.py)
- [dsh-bridge-next/README.md](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/dsh-bridge-next/README.md)
- [dsh-bridge-next/src/host/dsh-runtime/native.ts](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/dsh-bridge-next/src/host/dsh-runtime/native.ts)
- [server/agent_server/services/effective_capabilities.py](https://github.com/anywhere-labs/Agents-Anywhere/blob/aa12e7a2c181df29c0cf0a88959dccbefef45a92/server/agent_server/services/effective_capabilities.py)
