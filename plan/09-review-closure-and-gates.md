# 09 评审修订：执行隔离、版本依赖与恢复门槛

现行版本：v1.4，日期：2026-11-14（Asia/Tokyo）；本章六项规则首次于 v1.3 引入。本章将六条评审转为实施规则；02–08 的对应正文已同步修改。这里的部署 profile、字段与验收步骤是设计决定，全部产品测试仍为 NOT_RUN。

## 1. 评审处置与追踪

| 评审问题 | 修订结论 | 契约与主要章节 | 新增反例验收 |
| --- | --- | --- | --- |
| 换 worktree 重试与全项目单写者冲突 | 新目录不能解除逻辑路径隔离，恢复必须有实际撤权和对账证据 | 02 §6、04 §6、08 §5、本章 §2 | AT-79–80 |
| 同成员跨执行读取私信 | 每次工具调用绑定服务签发的 execution_grant；原生上下文同样分域 | 02 §3/9、03 §10、07 §3、本章 §3 | AT-81–83、AT-105–106 |
| Windows 强制隔离缺少部署决定 | 采用 Win-SID-Broker-1 作为首先验证的基线；失败即禁止写入资格 | 03 §9/12、04 §4、本章 §4 | AT-84–86 |
| 文件交接缺少完整版本依赖 | 完整 changeset + 一致快照；可交接、验收、依赖有效性分开 | 02 §12、04 §5、08 §5、本章 §5 | AT-87–92、AT-107 |
| 备份不覆盖全部代码成果 | 平台状态、Git 对象/引用、dirty 成果三部分闭合 | 04 §11、08 §1.4、本章 §6 | AT-93–97 |
| 等待回答与不打断规则死锁 | continuation_reply 只恢复被绑定的活动等待点 | 02 §4/11、03 §3、07 §6、本章 §7 | AT-98–104、AT-108 |
| 实施次序 | 最小强制写入、执行隐私与恢复先于多成员协作 | 05 §1–3、本章 §8 | AT-109–110 |

本章原修订覆盖 FR-01–FR-21 与 AT-01–AT-110；v1.4 的新增运行风险见 10，当前总需求/验收以 01/05 为准。没有通过写入/隐私门槛的客户端不能因已能发送 MCP 消息而获得对应资格。

## 2. 失联写入者与重试的唯一规则

### 2.1 安全与可用性的取舍

逻辑锁键始终为 project_id + canonical_repo_relative_path，包含所有 worktree、可写 overlay 和被允许的生成候选区。旧写入者超时并不释放资源。新 worktree 只能用于只读诊断，不能在这些路径继续代码修改；无关路径可以在权限与版本依赖均有效时继续。

只有同时满足下列条件，Recovery Coordinator 才能解除隔离：

1. 旧 run/grant 的新写请求已被拒绝；Broker 队列中的旧 epoch 请求全部取消或核对终结。
2. 原进程已确认停止，或有证据证明它所有相关写入通道均已切断；包括子进程、现有句柄、可写临时副本、插件和桥接服务。仅撤销 token、关闭 UI、修改 DACL、发出 cancel 或结束一个 PID 均不能单独作为证明。
3. 已对账 journal、实际文件 digest、index、commit/ref 和未完成记录；每个操作被归类为已应用、未应用、需修复或隔离产物，不存在未裁决写入。
4. 待重试的输入快照与 changeset 依赖有效，路径基线、权限和任务状态重新核验。

可靠切断写能力可以使仍存活的只读进程不再阻塞，但必须提交边界证据。以“进程应该已经停了”为由创建新 epoch 不合格。

### 2.2 恢复顺序

held/recording → reconciling → quarantined（证据不足）或 reconciled → released → 新 grant/新 epoch/新 attempt。租约状态与 edit journal 阶段分开保存。

服务先停止相关新派工、隔离逻辑路径，再撤权/停止与核对；记录 writer_reconciliation_id、受影响路径集合、旧 run/epochs、观察时间、进程启动身份、隔离 profile、写通道撤销证明、journal watermark 和恢复决定。恢复决定采用 CAS，只有一个恢复者可发新 epoch。

进程核对要覆盖整个执行身份，不仅是主 PID 或一个 Job Object。无法列清写入集合时先隔离项目。超过运维等待时限显示 BLOCKED，需要处理旧执行环境；超时不会改变正确性条件。用户可以终止隔离环境后重新核对，不能通过“忽略警告”绕过约束。

迟到结果只作为隔离证据保存，不能覆盖权威文件版本或自动完成任务。读诊断、查看进度和导出可恢复证据不要求抢占锁。

## 3. 执行级授权与私密上下文

### 3.1 授权主体和凭据

有效权限 = 当前成员策略 ∩ execution_grant ∩ 资源 ACL ∩ 当前撤销状态；操作还须满足租约、版本与能力条件。MCP 的 session handle 只用于关联，不是认证；实现授权的服务应逐请求验证 [E09]。

成员注册凭据只交给可信 Enrollment/Runner Host，不能被工作模型、shell 或 MCP 工具读取。它只能申请服务端批准的执行绑定，不能直接读消息、附件或任意签发更大范围 grant。平台不得因“拥有成员 token”就允许调用者自行选择 private/public 范围。

无代码的群参与/规划同样登记协作 run；owner 的纯进度查询仍走服务授权，不创建 agent run。调度器先预留 queued run，必要时签发只可领取指定任务的 dispatch grant；它的 run_epoch 尚未生效、没有工作写权。领取事务分配实际 lease epoch 并激活该 run，可信 controller 再换取 active grant，防止“要先有 grant 才能创建 run”的循环。新原生连接由可信启动映射完成绑定后才开放工具。

Agent 工作端只持有本次执行的短期凭据。受保护的连接或凭据绑定 member、connector、run/epoch、原生 session/turn、允许的操作、数据范围、资源范围、期限和策略 revision。请求自带的 ID 必须与服务映射一致，不能覆盖映射。凭据只在安全配置/受限 IPC 中传递，不放 prompt、命令行或日志。

示例是服务内 grant 记录，并非把 JSON 原样交给客户端作为凭证：

```json
{
  "grant_id": "grant_public_b",
  "member_id": "member_codex",
  "connector_instance_id": "connector_b",
  "run_id": "run_b",
  "run_epoch": "9",
  "state": "active",
  "native_binding": {"session_id": "native_b", "turn_id": "turn_b"},
  "token_resource": "collaboration-gateway",
  "allowed_data_scopes": ["room:alpha:group"],
  "resources": {"tasks": ["task_b"], "paths": ["backend/**"]},
  "actions": ["message.read", "workspace.read", "workspace.patch"],
  "policy_revision": "12",
  "expires_at": "2026-11-14T10:30:00Z"
}
```

allowed_data_scopes 是本平台的数据范围，token_resource 是鉴权目标；不能把 OAuth token 的 aud 与消息 audience 混为一谈。run_b 即使属于收到私信 A 的同一 member，也不能读 direct:A。访问不存在与无权资源采用一致外部错误，避免探测记录是否存在。

### 3.2 所有读取通道一致

执行凭据用于历史、单 ID 查询、搜索、附件、导出、上下文、MCP poll/wait、状态、SSE、对象引用和重连。用户 UI 使用独立的 owner 授权；不能把 UI 的成员完整历史原样转发给工作端。

幂等响应、feed/cursor/cache/index 查询作用域包含 principal、grant、原生绑定、数据范围、ACL/policy revision；同一成员的不同 grant 不共享私密结果。过滤在摘要、检索排序和对外序号分配前完成；长连接每次发包复核撤销与期限。附件下载须受网关再次鉴权，避免可转发且长期有效的裸文件路径。续期不能扩大范围；扩权创建新 grant 并重新评估上下文。

恢复、重放和 reconnect 也使用同一规则，旧 cursor 不可换取更宽范围。原 run 失联重试须撤销旧 grant、使用新 attempt；不能拿旧 native session 的历史伪装成干净公开上下文。

### 3.3 原客户端的实际限制

公开执行不得复用读过私信的原生上下文、工作目录、工具缓存或可访问的客户端记忆。每个执行安全域使用独立运行实例/受保护配置与数据目录；如果同一宿主跨聊天共享记忆或无法可信绑定工具调用，不能只传 session_id 解决问题。

Claude Desktop 等客户端若只支持一套应用级 MCP 凭据：该实例只能固定到一个窄数据域，禁止由聊天参数切换授权。需要另一个范围时使用经验证的隔离实例/身份；做不到就只允许公开数据范围，定向执行标记 CAPABILITY_UNAVAILABLE。不得先让它读私信，再声称新建聊天已清除全部记忆。

公开输出必须来自未含私密输入的执行。需要发布已有私密成果时走用户授权的公开副本流程，再进入新的公开快照；仅更改输出 audience 不构成去密。已经发送给外部 provider 的内容不能保证收回。

## 4. Windows 隔离部署决定：Win-SID-Broker-1

### 4.1 首先验证的实际配置

G0 首先验证 Windows 原生的独立安全主体 + NTFS 受保护目录 + Broker 独占权威写入方案。它是选定的验证基线，不是已通过的兼容方案。管理员安装/更新可创建专用身份和 ACL；日常服务与 agent 均不得以管理员权限运行。

| 进程/身份 | 可读 | 可写 | 必须不可访问 |
| --- | --- | --- | --- |
| Group Service 专用服务 SID/账户 | 协作 DB、受控对象、策略和其必要凭据 | DB、对象、审计、授权记录 | 不承载 agent shell，不向 worker 发 owner 凭据 |
| Workspace Broker 独立服务 SID/账户 | 签发给它的动作票据、受控仓库、变更证据 | 权威 repo/worktree、journal、检查点 | 无任意群历史读取权；不能替 caller 自行扩权 |
| Runner Controller 可信进程身份 | 连接配置、授权绑定、执行环境清单 | 生命周期记录、受控启动配置 | 原生模型/插件不能继承 controller 句柄和凭据 |
| 每个执行安全域的低权限 Worker SID/账户 | 明确发布的只读项目快照、必要 SDK/工具链 | 自己的 profile/cache/temp；获锁的隔离候选区 | 其他 worker、服务 DB/对象、token 库、主仓库、其他 worktree、主用户目录、Git 管理元数据 |
| 用户 UI/桌面桥 | owner API 返回的授权视图 | 用户设置与 UI 缓存 | 不给模型借用 UI 会话或文件句柄 |

这里的执行安全域按 run 与原生上下文绑定，不得仅因 member 或 audience 相同就让并发 run 共用 Worker SID、可写目录或凭据。身份复用必须等旧进程/句柄已核对、旧 grant 作废、历史/缓存隔离清理完成；否则创建新身份或使用独立隔离环境。

实际路径由安装器登记在 deployment-manifest，不能由请求者传绝对路径任意选择。目录关闭宽泛继承并明确 allowlist；身份不得具有修改受保护目录 DACL/所有者、调试服务进程或取得管理员令牌的权限。要实测从 worker 对这些路径的 open/read/write/rename/delete/硬链接/重解析点行为。Windows DACL 基于访问令牌参与对象访问判断 [E16][E18]。

Broker 通过带身份验证的受限 IPC 接受细粒度命令，重复验证 grant、逻辑锁、epoch、路径、digest 和批准的检查 profile。不能暴露以服务身份执行任意 shell 的接口。网络能力也按 profile 限制；阻止 worker 经文件共享、WSL 主机挂载、其他本地服务或桌面自动化入口借用更大权限。

### 4.2 实际文件修改路径

默认由 agent 提交 patch，Broker 写受控项目。需要生成器/检查命令时，由 Runner 在独立 Worker 身份内执行，输入为只读快照，输出位于隔离候选区。Broker 生成的变更 Markdown 路径也预先纳入锁集合（change_id 使路径唯一），不是绕过锁的例外。生成器产生的项目文件仍计入逻辑写入集合，已知集合先原子获锁；未知集合默认持有项目级独占锁，确定输出并对账后才能释放。不能借“候选文件”名义允许旧写入者与新任务同时修改同一路径。

编译缓存和纯日志输出若明确不属于项目成果且不会回写项目，可使用独立临时命名空间。将候选成果导入权威 worktree 前，Broker 核对实际 diff/允许集合、授权和变更集基线；目录交换、符号链接和临时文件替换也要受控。

进程用受限 token 启动，记录 Job Object 和执行身份，禁止已知 breakaway，并观察子进程/服务调用。Job Object 提供进程管理能力，文档也列出脱离与子进程例外；不能当作完整安全边界或唯一停止证明 [E17]。

撤销先封锁 Broker/grant，再收敛正在执行的操作；核对并终止相关 worker、子进程和外部写入桥。对仍可能拥有可写句柄的目录保持隔离，不能认为修改 ACL 即已切断全部旧句柄。无法证明时按 §2 阻塞。

### 4.3 原客户端与替代部署

普通主用户下运行、能任意调用 shell/插件的原客户端不能直接升级为严格写入成员，也不能访问平台私有 DB 或通用凭据。原客户端必须在隔离身份下运行并通过工具链、登录、UI、缓存及 IPC 兼容测试。

AppContainer 是候选增强机制，官方说明其隔离目标与资源限制 [E15]；是否适合这些原客户端必须实测，不能仅给 profile 命名为 sandbox 就宣布通过。若 Win-SID-Broker-1 无法满足原客户端隔离，可另立 ADR 验证独立 Windows VM：不映射主机可写项目/凭据、不共享剪贴板秘密、仅开放受控网关，并重跑同一矩阵。这是显式部署变更，不静默换成 Claude Code/API。

### 4.4 G0 必交付的攻击性验证

输出 isolation-deployment-decision，包含实际账户/SID、进程父子关系、目录 ACL、IPC 和网络规则、启动参数、允许工具、取消/撤权证据以及例外。使用测试秘密与测试仓库，至少尝试：

1. 从 shell、插件、生成器直接访问其他 worktree、DB、私密快照、旧 token 与 Git 对象。
2. 通过路径别名、junction、hard link、共享目录、WSL、子进程和预先打开的句柄绕过锁。
3. 在取消、服务重启、休眠恢复后继续写入，或重放旧凭据/动作票据。
4. 同成员的私密 A 与公开 B 共享应用配置时尝试历史/附件/工具越权。

任一相关通道未受控，write_enforcement 或 execution_isolation 就是 FAILED/UNVERIFIED；保留对应受限模式，禁止宣传已经满足原定前端/后端职责。全部结果当前为 NOT_RUN。

## 5. 从文件交接提升到一致变更集

### 5.1 三种状态分别表达

| 维度 | 状态 | 含义 |
| --- | --- | --- |
| readiness | preparing / recording / handoff_ready / quarantined | 文件、journal、记录与提交是否一致、可恢复 |
| review_state | pending / accepted / rejected | 对固定提交与验收标准的评审结论 |
| validity | valid / stale / superseded / revoked | 依赖/契约/策略是否仍有效，是否仍可消费或合并 |

handoff_ready 允许保存、查看授权记录和释放已完成操作的写锁，但不自动允许下游开发或合并。accepted 也不保证对任意新集成基线都有效；最终组合检查仍绑定候选提交。

默认新任务从已验收集成基线开始。若路径最新 revision 来自尚未验收的 WIP，后继写入等待其 accepted，或者用户在范围内显式允许 speculative 消费；不能偷偷切回旧 digest 覆盖。纯只读观察 WIP 不算开发授权。

### 5.2 交接对象与同步单位

Changeset 是完整逻辑变更集：change_id 列表、生产 task/run、base/source commit、结果 tree digest、完整 path deltas（含 rename/delete）、契约版本、检查证据、audience 和依赖闭包。接口类型、后端实现、迁移与必要配置若共同构成一个契约变更，属于同一个 consistency_group；不得拆一个类型文件交给下游。

Input Snapshot 是实际供运行使用的一致项目树，包含 accepted_base、完整选入的 changesets/source commits、顺序/依赖关系、契约版本、最终 tree digest 和输入授权。源提交还带其他未授权或未选变更时，不可整提交导入；应先由受控流程形成独立完整 changeset 并重新检查。

Workspace Manager 在无 dirty 冲突的受控环境中构造完整树，验证依赖闭包和契约，记录真实 materialization digest；所有前置均可读才可授权消费。不能只复制最新文件或任意 cherry-pick 半个变更集。已有 dirty 工作必须先检查点/快照，迁移形成新变更，不覆盖用户成果。

只读快照的复制是版本物化，不是新的项目逻辑修改：它不能发布成果、取得写入资格或更改已有可写 worktree。之后的修改/rebase/repair 必须锁定全部实际写集合；同步不能绕过路径单写者约束。

### 5.3 WIP 与下游失效

speculative 消费必须记录授权来源、上游 changeset/source commit、消费者 run/snapshot、要求的契约与后续验收条件。Task DAG 仅表达工作先后，不能替代这个产物依赖图。

上游被 rejected、superseded、revoked 或依赖基线变更时，服务在同一状态变更链中使传递消费者 validity=stale，并阻止新写入、交接、验收和合并。Broker 每次写入与集成事务重新验证当前依赖版本；不能只等异步通知到达。已在执行的工具操作进入收敛/核对，已有产物保留为隔离 WIP；不把业务失效伪装成进度查询中断。

恢复下游必须选择新的完整快照，rebase/rework 形成新 changeset，重新执行受影响检查。上游被拒绝后若下一位需要回到 accepted 内容，由 Broker 在锁下创建可追踪的 discard/repair 版本迁移，生成新 file_revision 与记录；不能重用旧 epoch 或悄悄倒拨 revision。

集成队列冻结候选、依赖闭包和 expected integration HEAD；检查后如任一变化，拒绝旧结果直接合并。拒绝纯机械认为“Git 没冲突即安全”。

## 6. 备份必须能重建全部受管成果

### 6.1 三部分闭包

| 部分 | 必须包含 | 完整性判断 |
| --- | --- | --- |
| 平台状态 | DB 一致快照、对象/附件/记录、ACL、schema、恢复必要配置 | manifest 引用对象全部存在且摘要一致；可执行凭据不入包 |
| 已提交成果 | 所需本地提交/树/blob、任务引用、检查点、集成候选、运行基线与 detached HEAD | DB 引用的每个提交及其所需历史均能在空仓库恢复；临时保留 ref 固定不可达成果 |
| 未提交成果 | 各受管工作区的 staged/unstaged 差异、索引条目/阶段/模式、删除/重命名、允许保留的未跟踪文件、必要二进制内容 | 能重建基线 + index + working tree；不仅保存一份文本 diff |

Git bundle 主要封装 Git 对象/引用，不保存完整工作区与索引状态 [E19]。若采用 bundle，必须补充 dirty snapshots；独立完整包或增量链的全部前置都进入同一备份闭包，不能依赖原仓库或远程还存在。

枚举数据库提交引用以及所有受管 worktree/任务 refs，不仅当前分支，也不以远端已推送为前提。允许保留的未跟踪文件采用明确清单；被排除的密钥、缓存和大文件列明原因。未跟踪源文件无法判定是否必要时，备份不能宣称无损完整。

LFS 实际对象与子模块所需仓库/提交/dirty 状态若属于支持范围，也必须进入闭包，只有 pointer/gitlink 不合格。第一版可以拒绝这类仓库的严格可恢复接入，但必须在导入时说明；不能导入后才把相关内容静默排除。

### 6.2 一致备份流程

1. 建立 backup cut，暂停新写入授予、版本交接、ref 更新、数据删除和 GC；等待已受控操作收敛，隔离无法证明停止的写入者。无法获得一致切点时返回 INCOMPLETE，不输出成功标记。
2. 对账 journal，冻结受管 index/worktree 状态，生成不可变 dirty snapshots；未完成操作可在明确恢复状态下纳入，但不能存在未知并发修改。
3. 固定所有必需 Git roots/临时备份 refs、对象引用和 dirty 对象；备份 pins 持久化并纳入崩溃恢复，直到包完成或受控放弃前禁止回收。外部 Git/维护进程不能绕过同一暂停边界。
4. 使用 SQLite 一致性备份机制保存同一切点的 DB，复制对象与 Git 闭包到 staging。数据量大时可以先生成本地不可变 cut 并验证后恢复业务，再把已固定内容复制到备份位置。
5. 校验摘要、Git 对象/引用可恢复性、dirty/index 重建、所有 DB 引用和增量前置；写 manifest 和 COMPLETE 标记，以原子完成动作发布。中途故障只留下 INCOMPLETE。
6. 完成后释放相应 pins；备份产物仍按保留策略保护。副本落在同一损坏磁盘上不满足整盘灾备要求。

manifest 记录 cut/time、schema、DB/object 摘要、Git object format/refs/commits、快照基线、索引条目与工作树清单、LFS/子模块覆盖、排除项、恢复所需工具版本、加密方式和完整性结论。源路径只作历史定位，恢复不得硬编码依赖它。

### 6.3 灾难恢复验收

在原仓库路径不可访问、无远端网络、无原对象缓存的干净环境：验证包 → 恢复 DB/对象 → 重建仓库和任务 refs → 重建 worktree/index/dirty → 重连任务/changeset/checkpoint → 校验摘要与 ACL。只验证 SQLite 能打开不算通过。

新环境重新签发身份与凭据，旧 grants/leases 全部失效；原活动 run 为待核对状态，不自动执行历史输入、Git hooks、依赖脚本或发布操作。只从受控配置 allowlist 恢复必要信息。恢复报告逐项列出保留和排除成果。RPO/RTO 仍是 04 的待测目标，不能由文档完整性代替恢复演练。

## 7. 等待输入的恢复，不等于打断任务

### 7.1 三条输入通道

| 输入 | 目标与动作 |
| --- | --- |
| progress_query | 状态服务读取已有事实；即使 run 正在 waiting，也不替用户回答或批准 |
| 普通问题/新指令 | 不注入当前任务，进入 deferred_inbox 等自然结束 |
| continuation_reply | 绑定服务登记且仍有效的 request_id，仅送入匹配的 waiting_user/waiting_peer 等待点 |

用户通过问题卡片“回答此问题”或明确回复关联 request 的消息发送。自由文本“允许”不能仅凭措辞推断它对应哪一个等待点，更不能默认批准权限；存在歧义时不执行。UI 可以让用户选择正在等待的请求。

### 7.2 请求与答复生命周期

Input Request：pending → answering → resolved；或 pending → expired/cancelled；投递结果无法确定进入 delivery_unknown 待核对。答复到达不等于原生端已消费，run 仅在实际恢复证据到达后离开 waiting。

请求登记 run/epoch、grant、native_request_id、等待 kind、schema、responders、audience、deadline。服务确认真实等待能力后才发布可回答卡片；不能仅抓取“你觉得呢”文本就置 waiting。

答复验证：请求仍 pending、run/epoch 未更换、回应者有权、内容符合 schema、范围能进入原执行授权、未过期、idempotency_key 一致。采用 CAS 只接受一个最终答复，重复同内容返回同结果，冲突返回 INPUT_REPLY_CONFLICT；错误 run/epoch、失效请求返回 INPUT_REQUEST_STALE，不自动转换为任务。

回答继承请求 audience，不扩大权限。公开请求的私密回答若不能被当前公开 run 读取，先由用户明确发布所选答案，或另行变更任务和新建授权上下文；不能把原始私信塞进公开执行。peer 回复同样按请求、被授权响应者和执行范围校验，求助等待图同时包含 task 与文件锁依赖；若同伴需写正在持有的路径，先完成受控检查点并交接，或将求助限制为只读。无法安全释放时显示阻塞，不持锁无限等待对方写同一路径。

input_reply 不能批准 shell、网络、文件或预算权限。权限请求走 approval 并绑定具体动作。等待期间继续心跳；deadline 到期或依赖取消后，显式报告阻塞/失效，并按 adapter 支持的方式结束等待，不依赖一个永远不会结束的 deferred 队列。

### 7.3 Adapter 的真实能力

manifest 独立声明 can_request_input、can_accept_input_reply、can_resume_waiting_operation、input_reply_mode、pending_request_recovery、reply_idempotency；每项记录 supported/unsupported/unverified 及实际版本。

Codex 官方文档列出实验性 tool/requestUserInput，详细段落又引用 item/tool/requestUserInput，并描述 serverRequest/resolved 用于答复或清理挂起请求 [E01]。因此固定发行版后从其实际 schema 生成映射，保存原生 request ID，测试响应与清理竞态及原生超时自动清理；请求已被原生端清理时使平台请求失效，不把迟到回答发成新输入；不凭文档标题自行猜一个 RPC，也不以普通 turn input 冒充请求响应。

本次读取的 DeepSeek ACP README 将 elicitation 列为不支持 [E05]。这个 bridge 的原生输入请求能力不能标 supported；若要通过平台 help 工具等待/取回答，必须另验完整等待与恢复语义，作为单独模式。原生不支持且替代模式未验证时，任务标记需要人工继续/能力阻塞，不能向活动 prompt 强塞答案或静默重启。

投递前写入 durable reply/outbox；断线后先核对原生 pending/resolved 状态。不具备去重或查询能力时，未知结果不得盲目重发；保留 delivery_unknown，由明确恢复策略处理，避免同一回答产生两次行为。

## 8. 实施门槛与本次交付边界

修订后的阶段是：契约基线 → P0 三客户端可行性与隔离攻击测试 → P1 单 Agent 纵向安全原型 → P2 三 Agent 真实协作 → P3 完整交互与运维 → P4 安装交付。详细 WBS 以 05 为准。

v1.4 另外要求人工接管、受保护验收、环境/root 账本和首次外发边界随首个相关原型验证；详见 10 与 05，不能推迟到全面协作之后。

P1 必须实测领取任务、受控写入、记录与检查点、进程/服务崩溃、路径隔离、重新授权与恢复、私密 A/公开 B 隔离，以及从完整备份恢复。最小 Broker、OS 边界、锁和检查点恢复不能留到 P2 之后补。

G0 报告必须回答：每个指定客户端能否可信绑定执行范围；能否可靠控制写通道和生命周期；输入请求能否正确继续；失败时何种职责被阻塞。三 Agent 演示不能掩盖某一成员其实由替代模型完成。

本次只完成文档修订与静态一致性检查；没有创建产品进程、安装客户端、运行攻击测试或恢复原型。设计仍有待实证的条件，不能承诺开发时不会出现新问题。

v1.5 将用户 API 管家合入 11；其 C0–C4 与上述 P0–P4 同期衔接，不取代任何原客户端/写入/恢复门槛。私密派工采用新的执行域，计划并发/图恢复不能放宽本章安全规则。

## 9. v1.6 联合验证与故障证据补充

本章六项底层不变量不变。12 §2 将原客户端响应与实际 Windows 隔离放进同一配置 fingerprint 的连续验证；未通过不能开放所需写入/私密资格。12 §3–5 将多任务部分执行及等待注册/消费变成明确协议，新增材料用于 P0/P1，而非推迟到完整 UI 后。

G0 同时要求 Schema/状态/认证绑定无冲突并冻结；G1 包含 PF 故障样本和真实单成员恢复；G2 包含锁效率、管家质量和受影响范围恢复。新增样本是测试定义，不是本章安全门槛已通过的证明。
