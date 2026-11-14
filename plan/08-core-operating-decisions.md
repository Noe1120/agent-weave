# 08 核心运行决策：记录、权限、适配器、版本与协调员

版本：v1.4，日期：2026-11-14。本章回答六项实施前必须确定的运行问题。它是设计约束，不代表相关代码或真实 agent 兼容测试已经完成。

## 1. 群聊记录怎么保存

### 1.1 不把所有内容混成一张“聊天表”

平台至少分开保存五类数据：

| 数据层 | 保存内容 | 用途 | 可见性 |
| --- | --- | --- | --- |
| Chat Record | 原始消息、回复、编辑版本、撤回标记、话题关系 | 还原群聊和用户意图 | 按消息 audience/ACL |
| Collaboration State | 成员、职责、任务、依赖、领取租约、状态投影 | 驱动协作和查询进度 | 按群/项目/成员权限 |
| Project Memory | 已确认目标、接口、规范、决策、变更影响 | 给 agent 提供稳定上下文 | 按 decision audience |
| Execution Evidence | run、工具事件、权限请求、检查、提交、产物 | 证明实际发生了什么 | 按任务、成员和敏感权限过滤 |
| Audit Record | 权限变化、导出、批准、删除、控制操作 | 安全追踪和故障调查 | 默认仅用户/维护角色 |

群聊是原始事实来源之一。项目记忆是经过确认的派生事实；任务状态是服务根据事件和产物生成的状态；agent 自己在消息里说“完成”不能覆盖这些权威记录。

### 1.2 推荐的本地存储结构

第一版采用“SQLite 权威状态 + 文件对象目录 + 事件 outbox”，不采用把所有状态都塞进 prompt 或只保存聊天摘要的方式。

- 短文本消息、消息 revision、成员关系、任务、决策版本和状态投影存 SQLite。
- 大文件、图片、日志、补丁、测试报告和导出包存受控对象目录，数据库保存 digest、大小、类型、归属和访问范围。
- 每个对象按内容摘要寻址，先写临时文件、校验摘要，再在事务中登记引用；避免数据库已经显示成功但文件还没有写完整。
- 检索在服务端受控存储中进行：先按主体和 audience 限定候选记录，再排序、摘要或生成输入。私密内容不能进入其他成员可访问的公共索引、缓存或摘要；同一服务内部是否物理分索引属于实现选择，不以 UI 遮挡替代授权。
- 消息写入、可见范围 ACL、内部事件和 outbox 在同一事务中提交；之后由 outbox 生成用户流和 execution_grant 限定的 agent 流；同成员的公开/私密执行不共用数据域。
- 修改消息产生新 revision，原 revision 保留；撤回保留 tombstone，已经发生的代码或外部操作不会因为撤回而自动回滚。

初期数据库放在本地应用数据目录，只允许群服务读写。不要把 SQLite 放在网络共享盘，也不要让 agent 直接连接数据库。以后支持多人或多设备时，再迁移 PostgreSQL/对象存储，保留相同领域接口。

### 1.3 定向消息如何存

用户单独 `@Codex` 的消息仍然写入同一个数据库，但记录自己的 `audience_ref`、ACL 版本和可见事件流。共享数据库不等于所有记录对所有成员可读。

定向消息的正文、附件、引用、回复、摘要、全文索引、缓存、上下文快照、原生输入和导出都继承同一个 audience。未被选中的 agent 不收到“有一条私信”的占位事件、未读变化、活动提示或内部序号缺口。

如果用户要把私信中的某一段内容公开，平台创建新的公开消息或公开决策对象，并在发送前显示将公开的内容和受众。原私信继续保持私密，公开副本不能附带私信原文的可访问链接或隐藏溯源。

### 1.4 保留、备份和查询

建议默认保留群消息、确认决策和验收证据直到用户删除；详细运行日志保留 14 天，事件重放窗口保留 90 天，最终工作区至少保留 7 天。失败或状态未知的工作区不能按成功任务自动清理。

导出根据当前操作者权限生成；普通 agent 不能导出整个数据库。备份是系统级操作，必须同时包含平台 DB/对象/ACL、全部所需本地 Git 对象/任务 refs/检查点，以及受控 index/dirty/允许保留的未跟踪成果，不包含可用凭据。备份固定对象防 GC，并在原仓库不可用的环境恢复验证；不能只保存提交哈希。恢复后撤销旧 grants/leases，重新核对活动 run、代码成果和 ACL，不自动重放历史指令，详见 04 §11、09 §6。

## 2. Agent 权限如何设置

### 2.1 用五个维度组合权限

权限不能只写成“Claude 负责前端”这种自然语言。每次工具调用同时经过以下五层判断：

1. **身份**：是谁在调用，来自哪个 agent profile、connector 和具体群成员。
2. **受众**：这条消息、任务、文件或决策允许谁读取。
3. **职责**：该成员在当前群被分配了什么角色和负责范围。
4. **能力**：连接器真实支持什么操作，例如读文件、写文件、运行检查、取消或恢复。
5. **运行范围与批准**：本次 run 能访问哪个目录、哪些命令 profile、多少预算，是否需要用户批准。

运行范围由服务签发的 execution_grant 强制绑定 member/run/epoch/native binding/数据域，不能由客户端自行选择 session_id。每个调用实际执行成员策略 ∩ execution_grant ∩ 资源 ACL，结合当前撤销状态校验。任何一层没有通过，服务拒绝操作。自然语言角色、agent 的自我介绍、用户在消息里写的“已批准”都不能替代服务端权限。

### 2.2 建议的权限对象

```text
Policy = Subject + Audience + ResourceScope + Action + Conditions + Expiry
```

示例：

```json
{
  "subject": "member_codex",
  "room_id": "room_shop",
  "resource_scope": {"paths": ["backend/**"], "tasks": ["task_api"]},
  "actions": ["message.read.audience", "task.read", "workspace.read", "workspace.write", "checks.run:backend"],
  "conditions": {"requires_active_lease": true, "worker_network": "off"},
  "egress_policy_ref": "approved_provider_policy",
  "expires_at": "2026-11-13T12:00:00Z"
}
```

示例 worker_network 约束工具 Worker 的网络，不代替模型服务方的数据外发授权。读、连网、发送数据和发布是不同能力，见 10 §10。

实现时权限名称应使用稳定枚举或版本化 policy schema，不使用任意字符串拼接命令。默认拒绝，明确允许后才开放。

### 2.3 可供用户选择的角色模板

| 角色模板 | 默认可做 | 默认不能做 |
| --- | --- | --- |
| Planner | 读公开项目上下文、提议计划、创建草案任务、提出依赖 | 直接写业务代码、改权限、合并、发布 |
| Implementer | 读授权上下文、领取指定任务、读写指定目录、运行批准的检查 | 读取其他私信、改群权限、合并主分支、读取凭证 |
| Reviewer | 读任务产物和检查结果、提交评审、创建返工意见 | 修改作者工作区、直接批准自己的结果、发布外部系统 |
| Coordinator | 读群公开状态和任务投影、生成报告、提议派工和求助 | 读取默认私信、提高预算、绕过审批、直接部署 |
| User/Owner | 管理成员、职责、策略、预算、合并和导出 | 仍需确认外部 provider 的账号权限是否允许相应操作 |

用户可以复制模板创建自定义角色，但每个自定义权限必须说明范围、有效期、是否需要批准和验收用例。角色描述和真实 policy 同时展示，避免“界面说可做、服务实际拒绝”或相反。

### 2.4 权限和上下文的关系

成员可以读取某群，不表示它可以读取该群所有消息；成员可以读取任务，不表示它可以读取任务中的私密询问；成员可以读工作区，不表示它可以运行命令。

上下文服务先按主体、execution_grant、audience、资源 ACL 和当前 policy 过滤，再检索、摘要、生成 embedding 或构建 prompt。缓存、feed 和 cursor 包含 grant、原生绑定和 ACL/policy 版本；同成员的公开执行不能查到旧私密执行的数据。权限撤销后，读取、重放、缓存命中、附件下载和恢复都再次检查。

## 3. Agent 接口参数不一致怎么解决

### 3.1 不要求所有 agent 暴露相同的原生参数

平台定义自己的**规范化协作接口**，每个 agent 使用独立 adapter 做映射。用户看到的是稳定的任务、消息、文件、检查、取消和结果概念；Codex、Claude Desktop、DeepSeek Harness 的 provider 参数保存在各自 connector 配置里，不混成一个虚假的“通用参数表”。

内部规范化请求应包含：

```json
{
  "schema_version": "3",
  "room_id": "room_uuid",
  "member_id": "member_uuid",
  "run_id": "run_uuid",
  "root_workflow_id": "workflow_uuid",
  "environment_id": "environment_uuid",
  "configuration_fingerprint": "sha256_config",
  "acceptance_revision": "acceptance_3",
  "execution_grant_id": "grant_uuid",
  "input_snapshot_id": "input_snapshot_uuid",
  "input_changeset_ids": ["changeset_uuid"],
  "intent": "task_instruction",
  "task": {"id": "task_uuid", "goal": "...", "acceptance": ["..."]},
  "context_snapshot_id": "ctx_uuid",
  "workspace": {"path": "...", "base_commit": "...", "write_scope": ["backend/**"]},
  "input": [{"type": "text", "content_ref": "..."}],
  "policy_ref": "policy_uuid",
  "egress_policy_ref": "egress_policy_uuid",
  "deadline": "2026-11-13T12:00:00Z"
}
```

adapter 将它转换为 provider 的具体调用：

| 平台概念 | Codex | DeepSeek Harness | Claude Desktop |
| --- | --- | --- | --- |
| 启动/会话 | app-server thread/turn | ACP session/prompt | 原客户端中的显式 MCP 参与会话，能力取决于实测 |
| 新输入 | adapter 生成 provider 输入 | ACP prompt | message_wait/工具调用或用户继续会话 |
| 取消 | provider 支持的 cancel；需实测 | 区分 prompt cancel 与 session close | 不能假定平台可控制原客户端当前回合 |
| 文件写入 | 受控 workspace 或原生能力 | 受控 workspace 或 ACP 工具 | 优先平台 broker；否则只能标记为外部直接写入 |
| 进度 | 结构化事件投影 | ACP 事件投影 | 已观察事件/缓存状态，不能为查询额外打断会话 |
| 用量 | 实际可取才显示 | 实际可取才显示 | 未知时显示未知 |

原生协议依据见 [E01][E03][E05][E06]。ACP 初始化本身就包含协议与能力协商 [E06]。这张表是适配方向，不是对任一版本能力的承诺。每个 provider 的 adapter manifest 必须记录支持、拒绝和未验证字段。

### 3.2 Adapter 契约

每个 adapter 实现同一组控制面方法：

```text
probe() → capability_manifest
connect()
start(run_envelope)
send_input(input_envelope)
respond_input(request_id, reply_envelope)  // 只响应已验证的等待点
cancel(target, mode)
resume(run_id, checkpoint?)
reconcile(native_session_id)
close(native_session_id)
```

统一事件包括 `started`、`message_final`、`tool_activity`、`approval_requested`、`input_requested`、`input_resolved`、`checkpoint`、`artifact_proposed`、`completed`、`failed`、`state_unknown`。provider 特有事件保留在命名空间内，不能被强行翻译成不存在的事实。

参数映射采用以下规则：

- 必填字段缺失：在 adapter 前校验并返回 `VALIDATION_FAILED`，不启动 agent。
- 可选字段不支持：按 manifest 选择忽略、降级或阻止，并在 UI 说明。
- 语义不同的操作：单独建枚举，例如 `prompt_cancel` 与 `session_close`，不使用一个模糊的 `stop`。
- 能力不确定：显示 `unverified`，不能按 `supported` 处理。
- 版本变化：connector manifest、协议 schema 和契约夹具一起升级；旧版本不静默接收新必填字段。
- 错误和重试：统一错误码，但保留 provider 原始错误；没有幂等能力的外部写操作不能盲目重试。

为每个 adapter 保留录制的协议样例、模拟器和契约测试。先用模拟器验证平台状态机，再用真实 Codex、Claude Desktop、DeepSeek Harness 做兼容性验收。

### 3.3 用户可配置的 agent 参数

界面分三层：平台通用参数、provider 配置、运行时覆盖。

- 平台通用参数：职责、任务范围、并发、预算、上下文来源、自动回复策略。
- Provider 配置：实际客户端/协议、启动参数、认证引用、工作目录策略、支持的模型或 profile。
- 运行时覆盖：只允许修改 manifest 声明可覆盖的字段，保存 run 快照。

不把某个 provider 的 `temperature`、特有 reasoning 参数或窗口参数强行暴露给所有 agent。用户只能看到当前连接器真实支持且经过验证的选项。

## 4. 是否自动用 Git 记录版本

### 4.1 结论：代码项目默认使用 Git 检查点，但不每次输入都自动提交

对 Git 项目，建议平台默认启用自动版本记录；对非 Git 项目，平台提供内容摘要快照，并在用户明确同意后初始化 Git。自动版本记录的目标是可恢复、可比较、可追责，不是把每个字符都提交成一次 commit。

### 4.2 版本生命周期

1. **导入基线**：记录当前 branch、HEAD、工作区状态、未跟踪文件和 dirty digest。若用户有未提交改动，先显示并要求选择保留原样、建立基线快照或单独创建任务；禁止自动 reset、clean 或 stash 覆盖。
2. **任务分支/工作区**：每个写入任务创建独立 worktree 和任务分支。平台记录 `base_commit`、分支、成员、run 和写入范围。
3. **自动检查点**：任务开始记录基线；一次逻辑变更实际落盘后，在里程碑、交接前或用户要求保存时创建本地 checkpoint。取得锁、收到自报进度、没有 diff 都不单独触发 commit。可恢复但未通过检查的 WIP 可以提交到任务分支，并明确标记未验收；短时间的小修改合并为一个 checkpoint，不自动 push 或 merge。
4. **变更文档提交**：Workspace Manager 冻结候选 diff，生成变更记录 Markdown，一起创建 checkpoint；记录失败则保留文件与锁并显示待恢复，不宣布交接完成。文档记稳定 change_id 和 parent commit；新 commit hash 在提交成功后回填数据库，避免要求文件包含它自身所在 commit 的哈希。
5. **集成候选**：将多个任务组合到专门的 integration branch/worktree，在候选 commit 上运行检查。
6. **合并与回退**：默认由用户确认合并；合并记录 `merged_commit`。回退创建新的 revert/repair commit，不能默认强制推送或覆盖用户其他改动。

建议 commit message 包含稳定元数据，例如：

```text
feat(backend): implement login endpoint

Task: task_api
Run: run_uuid
Agent-Member: Codex backend
Base-Commit: git_hash
Contract-Version: api-contract@5
Change-Record: docs/changes/2026-11-13-task_api-run_uuid.md
```

平台不能伪造模型作为 Git 作者。可以使用明确的 `platform-checkpoint` 身份，并通过 trailers 记录 agent member；签名、作者和用户账号单独显示。

### 4.3 Git 自动化边界

默认禁止自动执行：`reset --hard`、`clean -fd`、强制推送、覆盖用户未提交改动、删除未知文件、修改 Git hooks 或向远程发布。依赖安装、测试和生成文件遵循项目 policy；凭证、日志密钥、私有配置和大对象按 `.gitignore`/敏感文件扫描处理。

如果任务不是代码写入任务，可以只创建事件和文档产物，不伪造 commit。Git 记录版本不能替代数据库备份，也不能记录外部 provider 的所有副作用。

## 5. 同一文件同一时间只允许一个 agent 写入

### 5.1 锁的是项目逻辑文件，所有 worktree 共同遵守

强制独占键为 `(project_id, canonical_repo_relative_path)`；不能把 worktree 的绝对路径作为唯一键，否则两个分支的同名文件仍会同时被修改。不同文件可以并行，同一逻辑文件同一时刻只能由一个有效 member/run 修改。Git worktree 提供版本隔离，不能代替这个项目级写锁 [E10]。

锁记录 holder、task/run、lease_id、单调 epoch、截止时间、开始 digest、权威 file_revision 和原因。数据库事务保证唯一有效写入者；所有写入同时检查租约、epoch 和 expected_digest。锁等待只公开持有者有权公开的信息，不能泄露私密任务的标题或指令。

Windows 路径先解析到受控仓库，再规范化相对路径、分隔符和平台大小写语义。目录、重命名和删除也要参与：rename 同时锁旧路径和新路径；目录操作与后代文件存在锁冲突；二进制/新建文件同样受控。路径别名、hard link、junction/symlink 不得绕过锁；不能安全映射时拒绝操作。

### 5.2 只能通过平台 Broker 修改，不能以 worktree 或监视器豁免

严格写入模式要求：agent 对托管项目及其他工作区无直接写权限；patch、文件生成、重命名和会写项目的命令都经过 Workspace Broker 或经验证的同等 OS 隔离。能够执行任意 shell 的原客户端若能绕过 Broker，数据库锁只是建议，不能宣称满足用户的独占要求。

连接器要通过 write_enforcement 测试才能成为严格写入成员。无法限制直接写入的客户端可以作为只读/方案/评审成员；如确需它写代码，必须补充实际隔离能力后再开放。独立 worktree 不构成豁免，文件监视器只能侦测违规，不能防止同时写入。发现未授权写入立即隔离目录并停止该路径的交接。

构建、格式化、包管理器和代码生成也可能改文件。已知修改集合一次性原子申请锁，不能持有 A 再无限等待 B；未知写入集合在生成前必须按明确策略独占整个项目，或先把写集合限制到可验证的路径范围再原子获锁；候选区中的项目文件同样计入逻辑单写者，不能先无锁生成再声称导入时有锁即可。受限沙箱不能写回其他 worktree。检查过程的临时输出使用单独目录。

### 5.3 修改、记录、版本和交接形成一个可恢复流程

1. 由已验收基线和完整 changeset 闭包构造一致 input snapshot；默认不消费 WIP。显式允许 speculative 时记录授权、上游 source commit、契约版本和消费者 run。接口类型、实现与迁移同属一个变更集时不得仅同步一个文件。
2. 核验实际项目树、依赖有效性和 dirty 状态，再原子领取全部写集合的锁，校验 file_revision、digest 和 snapshot。不能拿到锁后沿用旧 worktree 覆盖新版本；已有 dirty 成果先快照/检查点，不覆盖。
3. Broker 预写 edit journal（op_id、原/目标 digest、锁 epoch、受影响文件、input snapshot），应用补丁并检测实际变更；多文件部分失败保持恢复状态。
4. 运行批准检查，生成结构化 change record 与相同 audience 的 Markdown；每次逻辑变更使用唯一 change_id。
5. Workspace Manager 串行管理 Git：冻结实际 diff，仅提交预期路径和记录，核对 parent/ref/index，不纳入无关 staging；ref 更新使用 compare-and-swap 等价校验 [E14]。
6. 创建 checkpoint，登记完整 changeset/source commit/tree、路径 revision、检查和记录；事务标 readiness=handoff_ready 后才释放已完成写操作的锁。review_state 仍可能为 pending，不自动成为 accepted。
7. 投递授权的 change_available，包含完整变更集和同步动作。忙碌执行在自然点读取；下一次写入前必须校验有效依赖，而不能只依据已读 Markdown。

DB、文件与 Git 不共享原子事务。按 op_id/digest/parent/head/journal 对账，不重复应用或提交。逻辑路径租约状态为 held/recording → reconciling → quarantined 或 reconciled → released；不能因超时或新建 worktree 跳过撤写能力证明、进程核对和 journal 对账，规则见 02 §6、09 §2。

handoff_ready、accepted、valid 分别表示可恢复交接、验收结论、依赖有效性。默认后继写入等待最新 WIP 验收；显式 speculative 消费才可提前开始。上游拒绝/替换/撤销导致下游传递 stale，写入和合并事务立即拒绝失效依赖；重新快照/rework 和检查后才能继续。回到 accepted 内容也必须记录新的 discard/repair 版本，不能静默倒退 file_revision。完整交接与集成竞态见 09 §5。

人工修改也通过 human_run 接管已冻结范围的逻辑锁，实际 diff 经同一检查点/变更集交接。通知由服务证据生成，消费者物化完整新快照并完成重验后才能恢复；没有 diff 不伪造 commit，越范围或绕入口直改进入核对。完整步骤见 10 §4。

### 5.4 Markdown 记录格式与隐私

公开变更使用唯一文件，例如 `docs/changes/2026-11-13-task_api-change_uuid.md`；受限记录存服务的私有对象目录，不放在所有 agent 可读的仓库。记录至少包含：

- change_id/changeset_id、时间、task/run、成员、base commit、input snapshot 和依赖 changesets。
- 修改路径与修改前/后 digest、相关接口版本。
- 经允许公开的目的、具体行为变化、受影响任务与兼容性。
- 检查结果、未运行的检查、已知问题及证据引用。
- 下一位修改者需要同步的完整变更集/一致快照、consistency_group、readiness/review/validity、回滚/修复建议；source commit 由提交后 DB 映射提供。

生成文档与代码一起提交时，文档不嵌入自身 commit hash，也不为自身计算会变化的自摘要；实际提交映射在数据库和状态卡片中显示。静态文档可用 change_id 查找提交或直接通过 Git 历史定位。

私信原文、附件、引用和未经许可的摘要不能因为“记录变更”自动公开。公开代码/文档的范围必须来自用户已授予的产物发布策略或一次明确决定；没有授权时，保存私有记录并等待决定。共享仓库的不同分支不提供保密边界，需保密的源代码/记录必须在独立受控存储或仓库中处理，不能依赖隐藏分支名。

其他 agent 获取变更记录后，在自然处理点读取并记录 read/ack；需改同文件时还必须同步实际版本。跨文件接口影响保留集成测试；独占锁不能消除所有语义冲突。

## 6. 是否需要自带的群管理员 Agent

### 6.1 结论：需要“协调员能力”，但不能只依赖一个模型 agent

建议采用两层：

1. **Coordinator Service（平台协调服务）**：确定性、始终存在，负责任务状态、依赖、文件锁、进度投影、预算和权限。它不需要模型，不会因为模型胡说而改变事实。
2. **Coordinator Agent（可选但推荐）**：群里的一个系统成员，名字由用户自定义，例如“项目管家”“小管家”或“PM”。它负责理解自然语言、组织计划、总结进度、提出派工建议和提醒风险。

不能让“管理员 agent”单独承担数据库一致性、权限判断、真实进度统计或停止其他 agent 的责任。它是一个有权限边界的协调成员；平台服务才是最终权威。

### 6.2 用户如何使用

用户可以发送：

> `@项目管家 汇报各个 agent 的任务进展`

如果这是定向询问，只有用户和项目管家可见。请求先识别为 progress_query，使用 Coordinator Service 根据既有状态生成确定性报告，显示在可自定义名称的“项目管家”入口下，并标明“平台状态报告”。默认不调用任何模型，也不向正在工作的成员追加输入。报告根据请求者有权看到的任务状态、run 事件、检查结果、文件锁和产物证据生成：

- 当前权限范围内的任务数、已完成、执行中、阻塞、待验收和未开始；注明统计范围、快照时间和未知状态，不把部分可见任务称为全项目。
- 每个 agent 当前负责的任务、最后观测时间、最近检查点和阻塞原因。
- 真实已完成的里程碑和仍未知的信息。
- 依赖关系、文件锁等待、接口版本过期和集成风险。
- 建议的下一步，并区分“建议”和“已执行”。

平台状态报告不逐个向其他 agent 提问；观测不足就列明未知和最后更新时间。用户需要本人解释时才生成定向排队问题，等待该成员当前任务自然结束。

用户要求模型分析进度、解释风险或提出计划时，另建只读/规划请求，目标是被 @ 的协调员模型，未被 @ 的工作成员不收到这条询问。这类请求可能有额外调用成本，UI 与纯进度查询区分。模型输入权限是用户可读范围、协调员自身被授权范围与本次授权的交集，不能继承用户的全部权限。用户可看到的私密任务汇总卡片由服务直接生成给用户，不把它塞给协调员模型。统计百分比只可标作“已验收任务数/统计内任务数”，不代表实际工作量比例；无可信估计不生成 ETA。

### 6.3 管理员 Agent 的默认权限

| 能力 | 默认规则 |
| --- | --- |
| 读取群公开消息、公开任务和项目状态 | 允许 |
| 读取定向私信 | 禁止，除非用户显式授予某个范围和期限 |
| 生成进度/风险说明 | 纯进度用服务固定报告；模型分析使用只读快照，必须引用范围和观测时间 |
| 提议任务、依赖、职责和派工 | 允许创建草案；默认需要用户确认才能生效 |
| 在用户已授权规则内自动分配子任务 | 可选，记录 policy 和因果消息 |
| 直接修改代码 | 默认禁止；需要显式 implementer 权限和独立任务 |
| 修改成员权限、提高预算、读取凭证 | 禁止 |
| 合并主分支、发布外部系统 | 默认禁止，需要用户操作或独立审批 |
| 询问正在工作的 agent | 只能排队，不得用 prompt 打断其当前任务 |
| 停止/取消任务 | 只有用户明确授权的 control policy 才能执行 |

协调员的自然语言输出不能替代任务状态。它给出的进度比例、风险评级和预计时间必须有来源；没有来源时显示未知或建议，不编造数字。

### 6.4 管理员 Agent 是否第一版就做

第一阶段先实现 Coordinator Service 和固定格式进度报告，并提供可自定义名字的协调员入口；完整交付包含 11 的用户 API 管家方案。模型可配置/关闭，不是系统基础控制的必需条件，但不能以只做固定报告冒充完成全部管家功能。C0–C4 与 P0–P4 的对应见 11 §21。

随后加入 Coordinator Agent，用它处理：自然语言计划拆分、任务依赖解释、跨成员总结、风险说明、用户追问。它的所有动作调用平台工具，平台校验权限、依赖、写锁和状态；它不能直接写 SQLite、绕过 broker 或自行发起任意 shell。

名称仅用于显示与 @ 选择，后台使用稳定 member_id；更名不得改变权限、历史归属或订阅。Coordinator Agent 启用时由用户自己的 API 模型/配置驱动，本设计不强制具体服务方或模型 ID。如果它不可用，群聊和真实任务仍可继续，进度仍可通过平台报告查看。它不应成为系统单点故障。

### 6.5 防止协调员循环和过度派工

协调员输出区分 `report`、`proposal`、`action_requested` 和 `action_completed`。只有 action_requested 经服务授权才会申请动作；action_completed 是真实服务回执，不作为自动派工触发器；agent 说“我已经分配了任务”不代表任务真的创建。

协调员及其派生任务统一计入 server-issued root_workflow，累计预算、失败与返工，不能靠换任务名重置。设置最大讨论轮次、派工深度、并发槽、预算和截止时间；无可验证进展时停止自动扩展，先汇总证据再由用户决定恢复，详见 10 §5。它不能读取自己生成的报告再把报告当新需求无限循环；每个动作带 causation_id、correlation_id 和幂等键。用户可一键暂停协调员而不停止正在工作的其他 agent。人工改动汇报依赖服务计算的 diff/影响集，用户反馈关联实际预览/场景版本；模型共识、已读回执均不能代替验收。

### 6.6 管家专项基线（v1.5）

具体采用用户自带 API + LangGraph + 受限 ReAct + 授权 RAG，见 11。保留用户分工决定权：默认 propose_only，bounded_auto 需要可撤销的明确策略；换负责人、改接口、改验收与提预算不是普通拆任务。私密请求转多人任务先批准指定内容副本，再在干净执行内提交；派工批准不代表转发私信。跨图/人工任务更新统一按计划头 CAS 和资源版本提交；活动任务换人必须先交接，业务动作跨 attempt 去重。共享状态只复用 02/09/10，不另建管家版的锁、预算或 human_interventions。

## 7. 推荐的完整默认方案

- 群聊记录采用 SQLite + 对象目录 + outbox，消息、记忆、任务、运行证据和审计分层保存。
- 权限采用身份、受众、职责、能力、服务签发 execution_grant/批准五层组合；默认拒绝，用户可自定义角色。
- 所有 agent 通过 adapter 接入统一内部契约；provider 特有参数保留在 adapter manifest，不强行统一。
- Git 项目默认自动创建安全检查点和任务分支；不自动 reset、clean、强推或合并；非 Git 项目先用快照，初始化 Git 需用户同意。
- 同一项目逻辑文件跨 worktree 强制单写者；通过 Broker/实际隔离防止绕过；完成版本与 Markdown 后交接完整 changeset/一致快照；未验收消费须明确授权，上游失效阻止下游写入/合并。
- 协调员采用“确定性 Coordinator Service + 可自定义名称的 Coordinator Agent”；平台服务管事实，agent 管自然语言规划和汇报。

这六项决定为群聊协作与项目交付定义了实施边界：聊天有原始记录和私密范围，agent 有明确权限和统一接入方式，代码有可恢复版本，文件修改有独占责任和可读变更记录，项目进度有稳定的协调中心。

## 8. v1.6 计划、锁调度与管家质量衔接

计划执行状态由服务按 12 §3 聚合，与管家分析状态分开；暂停新增、停止在途和代码撤销是不同操作。部分失败默认只隔离受影响链，范围/审批/预算变化需重新验证。

12 §6 补充完整集合原子获锁、未知输出项目锁排空及 ticket/aging，任何公平性策略都不能强抢未知旧写者。性能目标由固定工作负载验证，不承诺多成员必然线性加速。

管家质量按 12 §7 的证据/遗漏/依赖/授权/未知评分，不以消息数、计划格式或成员共识验收；当前公开样本和参考判断仍需人工审阅及真实运行。
