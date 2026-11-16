# 02 数据、状态与接口契约

> W18：主人显式reinvite采用旧登记/成员双CAS，在单事务内撤销旧登记并签发新pending邀请；失败回滚，同action只重取有效pending邀请，不续旧task grant。只读登记原因和替代关系不暴露秘密，不把registered当在线。见[W18](W18-CONNECTION-REINVITE.md)。

> 2026-11-16 W17：可信进程内签发连接约束的单任务只读 grant，复用既有 policy/run/resource ACL，不自动扩权；每次授权重新检查登记/成员/配置和新鲜会话观测，失联后不得自动复活。只允许合成数据，默认无进程内验证器（含重启）时拒绝；不增加公共签发入口或迁移。设计与验证范围见 [W17](W17-CONNECTION-TASK-ACCESS.md)。

> 2026-11-16 W16：成员连接登记子阶段使用现有 resources/OwnerAuth，无迁移。邀请只可兑换固定成员/配置的登记凭据；登记凭据只可读取自身状态，不能用于 execution_grant、runtime_control、消息或任务读取。主人 Cookie/CSRF 与邀请/连接 Bearer 分离，邀请单次兑换与 CAS 撤销均在事务中完成。成员 revision、有效期和签名键变化使旧登记失效；registered 不等于原客户端在线。详见 [W16](W16-CONNECTION-REGISTRATION.md)。

> 2026-11-16 W15：新增 runtime/0.1 后端边界，沿用现有 adapter_runtime 资源与 schema4。只读 `GET /v1/projects/:project/runtimes/:runtime` 使用 adapter_read；生命周期 `POST /v1/runtimes/:target/{start|close}` 另需 runtime_control 且经原控制器鉴权。成员/run 从认证上下文派生；task 引用逐次校验权限。只投影状态、版本、指纹、原生 thread 摘要和退出观察，不返回原生标识/消息/路径/凭据；状态读取无 DB 写入、无原客户端操作。详见 [W15](W15-RUNTIME-GATEWAY.md)，不修改 core/1.0。

> 2026-11-14：开发实现增量：W09在现有resources表保存任务DAG、不可变输入快照与授权资料；Broker/排队/评审等待重新校验完整上游版本。核心wire与迁移不改，详见W09-DEPENDENCIES-KNOWLEDGE.md。

本文件规定领域行为，示例是设计契约，不是已实现接口。运行连接器详见 03，恢复与安全见 04。最小跨模块结构已在 contracts/core.schema.json（core/1.0）冻结为设计基线，配套正反例与第 12 章状态/等待规则；完整 API 的 OpenAPI、传输绑定与生成客户端类型仍由 P0 扩展并验证，不能把设计 Schema 当成已实现接口。

## 1. 全局不变量

- INV-01：所有协作对象有群/项目归属，身份来自认证上下文；工具参数中的 sender_id 不能冒充身份。
- INV-02：一个 task 最多有一个有效领取租约；同一 native session 最多一个活动 turn。
- INV-03：用户已收到“保存成功”的消息，在正常恢复中必须存在；确认点在数据库事务提交后。
- INV-04：内部群事件按 room_seq 排序；用户端按用户可见流、agent 端按 execution_grant 可见流使用递增 stream_seq 和授权绑定 cursor，不暴露定向事件造成的全局序号缺口。
- INV-05：外部消息/事件允许至少一次投递，处理方必须去重；外部命令不宣称 exactly-once。
- INV-06：每次执行记录上下文版本、输入、原生会话和实际工作区；完成状态关联可核查产物。
- INV-07：租约过期不能证明旧进程停止；无法证明旧写入者停止或写能力已可靠切断时，受影响逻辑路径跨全部 worktree 隔离，禁止新写入者。
- INV-08：群消息和 retrieved content 是工作输入，不能覆盖权限与群治理规则。
- INV-09：记忆摘要是派生结果；事实必须可追踪原文和确认记录。
- INV-10：取消、移除成员、撤销授权后，不接受其旧 fencing epoch 推进任务状态。
- INV-11：单独 @ 的 message、回复、附件和派生记录只对 audience 允许的主体可见；共享数据库不意味着共享全部记录。
- INV-12：progress_query 不向活动 run 发 prompt/steer/cancel/restart，不创建额外 agent 回合，不因查询修改任务状态、租约或工作区。保存私密询问与回执不算任务副作用。

- INV-13：同 project_id/canonical_repo_relative_path 跨所有 worktree 最多一个有效写入者，生成/重命名/删除也必须受控。
- INV-14：任务文件修改必须与 change_id、前后 digest、Markdown 和 checkpoint 关联；提交存在不代表已验收，记录/恢复未完成前不交接。
- INV-15：协调员输出只是建议或带来源的报告；真实派工经过服务的权限、依赖、幂等和预算检查。
- INV-16：agent 每次读写采用成员策略 ∩ 服务端执行授权 ∩ 资源 ACL；member_id、run_id、session_id 均不能自行充当授权。
- INV-17：handoff_ready 与 accepted 分离；执行使用一致项目快照和完整变更集依赖，失效依赖阻止后续写入和合并。
- INV-18：continuation_reply 只回答匹配的活动等待请求，不能充当新任务、权限批准或无关运行输入。
- INV-19：完整灾备必须闭合平台状态、所需 Git 对象/引用和受控 dirty 成果；原仓库不可用时仍应能恢复。
- INV-20：所有 Agent run、子任务、求助和重试继承服务确定的 root_workflow_id；预算与停滞计数不能靠派生任务清零。
- INV-21：验收标准、真实候选、环境和检查 profile 共同绑定证据；作者修改候选测试不能自动修改生效验收。
- INV-22：human_run 与 agent run 使用同一逻辑单写者和交接约束；管家报告与阅读回执不能代替实际版本同步。
- INV-23：数据库/缓存/端口/浏览器等资源有归属和使用规则；未知资源不能直接清理或假定可安全复用。
- INV-24：数据读取、网络连接、数据发送、发布分别授权；外发检查在构建/发送模型上下文和其他外部请求前执行。


- INV-25：Coordinator Service 是权威，LangGraph 只持久化流程与引用；进度查询零模型调用，图故障不阻断基础控制。
- INV-26：一般委派不扩大私信受众；披露批准绑定精确载荷/目标/用途/服务方，干净协作执行不得继承私密 checkpoint。
- INV-27：所有计划结构变更按项目计划头及读写集合 CAS 原子应用；业务 action_id 跨图/attempt 去重，不按新 grant 重新执行。
- INV-28：RAG/Embedding/checkpoint 是受控数据通道；关键约束固定加载，撤权优先于索引刷新和图恢复。

- INV-29：计划应用、管家流程结束、计划执行收束是三种状态；部分执行按依赖影响闭包处理，停止不自动回滚成果。
- INV-30：等待注册与当前条件检查原子化；等待消费与恢复意图原子化；图/外部动作仍需稳定 action 幂等与对账。
- INV-31：完整计划聚合只向有全部范围权限的主体返回；局部视图不能泄漏隐藏任务计数、状态或私密阻塞原因。

## 2. 存储约定

ID 使用不可预测的 UUID；所有时间戳存 UTC，显示使用用户时区。事件 seq / revision 在 JSON 中以十进制字符串传递，避免前端整数范围问题。数据库比较使用数值，不用字符串字典序。

建议 SQLite 开启 foreign_keys、WAL 和适当 busy_timeout；采用单业务写入服务。建议 synchronous=FULL，并按实际存储性能验证，不能宣传对损坏磁盘或断电的绝对保证。同步和 checkpoint 参数写入运维配置。

大附件不存表内；存本地受控目录，按 sha256 摘要寻址，数据库存元数据/归属。原生凭证放操作系统凭证存储，数据库只存 secret_ref。索引、日志和备份都受访问控制。

## 3. 最小逻辑模型

| 表/集合 | 主要字段 | 约束与索引 |
| --- | --- | --- |
| users | id, display_name, status | 本地版仍有固定已认证 owner |
| agent_profiles | id, provider, connector_type, config_ref, secret_ref | 密钥不直接存 config |
| projects | id, canonical_repo_path, default_branch, config_revision | 活跃 repo 实体唯一；Windows 路径规范化 |
| rooms | id, project_id?, owner_id, status, policy_revision, seq | MVP project_id 至多一个活跃主群 |
| memberships | id, room_id, principal_id, kind, role_revision, status | 活跃成员唯一；按 room_id 索引 |
| member_roles | member_id, revision, description, allowed_scopes, source_message_id | 追加版本，不原地覆盖历史 |
| connector_instances | id, profile_id, device_id, capability_revision, observed_at | capability 含检测来源、版本和过期时间 |
| native_sessions | id, member_id, connector_id, native_id, status, audience_digest, isolation_profile, grant_lineage | 原生会话与进程/缓存按执行安全域隔离；私密会话不可改为公开执行 |
| execution_grants | id, member_id, connector_id, run_id, run_epoch, native_binding, allowed_data_scopes, resource_scope, actions, state, policy_revision, egress_policy_ref, expires_at, revoked_at | 服务签发、逐请求求交集；凭据仅存摘要；bootstrap 凭据不能读业务数据 |
| invitations | id, room_id, token_hash, expires_at, max_uses, revoked_at | 一次性兑换由事务保护 |
| threads | id, room_id, kind, task_id?, participants, round_limit, deadline, state | discussion 或 task；按群校验参与者 |
| help_requests | id, task_id, origin_run_id, target_member_id, question, expected_output, state | 关联等待图；防循环 |
| messages | id, room_id, thread_id, author_member_id, kind, intent, requires_agent_action, audience_scope, acl_version, revision, created_at | author 和有效 audience 由服务校验；room/时间分页必须先授权 |
| message_revisions | message_id, revision, body, attachment_refs, edited_at | 原始版本可追踪；撤回留 tombstone |
| audience_members | resource_type, resource_id, principal_id, access, acl_version | 显式 direct ACL；不得从同名/同 profile/群管理员身份推导 agent 权限 |
| message_recipients | message_id, member_id, receipt_status | 联合唯一；投递目标不能超出 audience，但仅被允许读取不代表一定唤醒 |
| access_cursors | room_id, principal_id, grant_id?, feed_id, delivered_seq, read_seq, processed_seq | agent 必须绑定 grant/native binding/ACL 版本；用户 UI 独立流；游标不可跨执行复用 |
| tasks | id, room_id, project_id?, root_workflow_id, owner_id?, kind, status, version, acceptance_revision, scenario_refs, requirement_refs, scope, audience_ref | 状态变更 CAS；按 room/status/owner 索引 |
| task_dependencies | task_id, prerequisite_id, required_outcome | 联合唯一；同项目；有向无环 |
| runs | id, task_id?, thread_id?, root_workflow_id, actor_kind, attempt, trigger_event_id, connector_id?, grant_id, status, epoch, validity, snapshot_id, environment_id, configuration_ref | task/attempt 唯一；actor_kind=agent/human，human 无模型 connector；所有 Agent 执行归 root；validity 独立 |
| leases | resource_type, resource_id, holder_run_id, epoch, expires_at, state | 同资源最多一个 active；epoch 单调增长 |
| workspaces | id, project_id, run_id, path, branch, base_commit, input_snapshot_id, materialization_digest, isolation_profile, state | path/branch 唯一；状态含 quarantined；不得只同步单个接口文件 |
| policy_revisions | id, subject_id, revision, actions, resource_scope, audience_rule, conditions, expiry, approved_by | 默认拒绝，具体 run 记录实际版本 |
| file_leases | project_id, canonical_path, run_id, epoch, expires_at, base_digest, file_revision, state | 跨 worktree 唯一有效持有者；路径前缀/rename 锁集合原子检查 |
| file_versions | project_id, canonical_path, revision, digest, change_id, commit_id?, audience_ref | 记录可交接版本，写前检查实际基线 |
| edit_journal | op_id, run_id, lock_set, intended_digests, parent_commit, phase | DB/文件/Git 断点对账；不假设共享事务 |
| change_records | change_id, run_id, path_deltas, markdown_ref, check_refs, audience_ref, status | 代码和记录同步登记；私有记录不写公共仓库 |
| checkpoints | id, changeset_id, parent_commit, commit_id, kind, state | op_id/change_id 去重；检查点可恢复性与变更集验收分开 |
| changesets | id, project_id, producer_run_id, base_commit, source_commit, tree_digest, manifest_ref, readiness, review_state, validity, audience_ref | 不可变内容；包含 change_ids、完整 path delta、契约版本、依赖闭包；状态与内容分开 |
| changeset_dependencies | consumer_run_id, input_snapshot_id, upstream_changeset_id, source_commit, consumption_mode, authorization_ref, validity | 明确 accepted/speculative；跨任务传递失效；不可只存文件 digest |
| input_requests | id, run_id, run_epoch, grant_id, native_request_id?, kind, expected_responders, audience_ref, schema_ref, state, expires_at | 服务登记；原生等待点已证实；普通回答与 approval 分开 |
| input_replies | id, request_id, author_id, payload_ref, idempotency_key, delivery_state, native_receipt_ref? | 一个请求只接受一个最终回答；未知投递结果须对账 |
| writer_reconciliations | id, project_id, affected_paths, old_run_id, old_epochs, revocation_evidence, process_evidence, journal_watermark, state | 完成三项证据才可重新授予写 epoch；新 worktree 不是解除依据 |
| backup_manifests | id, cut_id, db_digest, object_manifest, git_roots, dirty_snapshots, pins, closure_status, restore_evidence_ref? | COMPLETE 要求对象闭包和隔离写入切点；缺失内容只能 INCOMPLETE |
| coordinator_settings | room_id, member_id, display_name, model_profile_id?, delegation_policy_ref | 名字可变、ID 稳定；模型可选 |
| progress_reports | id, requester_id, visible_scope, observed_watermark, report_ref, source_refs | 按请求者可见数据输出，给模型的范围再与协调员权限求交集 |
| decisions | id, room_id, topic_key, audience_ref, current_revision | room/topic_key/audience 唯一，私有决定不改公共版本 |
| decision_revisions | decision_id, revision, state, content, sources, confirmed_by | proposed/confirmed/superseded；确认有权限 |
| context_snapshots | id, room_id, task_id?, grant_id, audience_digest, acl_version, visible_watermark, role_revision, decision_versions, constraint_versions, acceptance_revision, scenario_refs, input_changesets, tree_digest, manifest_hash | 不可变；权限过滤在检索/总结前执行，引用可读源内容 |
| artifacts | id, room_id, task_id, run_id, type, digest, locator, metadata, audience_ref | 产物目录不可由 caller 任意指定 |
| integration_candidates | id, project_id, milestone_id, task_ids, base_commit, candidate_commit, tree_digest, contract_refs, acceptance_revision, environment_revision, status | 每项目单活动集成；变化使相关检查过期 |
| check_runs | id, candidate_id?, run_id?, tree_digest, requirement_refs, acceptance_revision, contract_refs, profile_digest, environment_revision, runner_config_ref, exit_code, log_artifact_id, validity | unknown 不算通过；代码/标准/环境/profile 改变须重验 |
| approvals | id, run_id, native_request_id, action_hash, state, expires_at | 相同授权不可用于不同操作 |
| events | room_id, room_seq, id, type, entity_id, payload_ref, audience_ref, actor, trace_id | 内部排序；room_seq 不给普通客户端 |
| access_event_feed | feed_id, principal_id, grant_id?, room_id, stream_seq, event_id, projection_ref | feed/stream_seq 唯一；agent 流先按执行授权过滤，再编号和输出；用户流独立 |
| status_projections | run_id, state, stage?, checkpoints, blockers, observed_at, source_ref, audience_ref | 从已有运行事件派生；UNKNOWN 为真实可见状态 |
| inquiries | id, room_id, author_id, target_member_id, target_run_id?, message_id, kind, status, observed_at? | 继承定向权限；进度查询不启动 agent run |
| deferred_inbox | id, member_id, message_id, expected_run_id?, intent, process_after, state | 忙碌提问/新指令排队，默认当前任务完成后处理 |
| outbox | id, event_id, destination, attempts, next_attempt_at, status | 投递唯一键、指数退避 |
| inbox_dedup | consumer_id, event_id, result_ref | 联合唯一 |
| idempotency_records | principal_id, grant_id?, room_id, operation, key, request_hash, response_ref | 授权范围参与唯一键；缓存响应逐次复核，不能同成员跨执行取回私密响应 |
| usage_records | root_workflow_id, run_id, reservation_id?, source, actual_or_estimated, tokens?, cost?, currency?, rate_version? | 未知为 null；不能以 0 表示未知 |
| audit_records | id, actor, action, target, outcome, trace_id, time | 与群公开事件分开存储敏感细节 |
| root_workflows | id, project_id, user_goal_ref, policy_revision, budget_limits, state, stall_counters, resume_decisions | 服务派生 root；active/suspected_stall/expansion_paused/draining/completed/cancelled；不把暂停当停止证明 |
| budget_ledger | id, root_id, run_id, operation_id, reservation, actual_usage_ref?, settlement_state | 原子预留/去重结算；unknown 不释放为零；累计保留历史 |
| module_contracts | id, project_id, module_owner, integration_owner, decision_revision_ref, consumer_refs, compatibility_evidence | 契约正文复用版本化 decision，不维护另一份事实；消费者变更校验 |
| integration_milestones | id, root_id, scenario_revision, scope, owner_id, contract_refs, candidate_ref, acceptance_ref, state | 按纵向可用流程分段；模块完成与里程碑完成分开 |
| acceptance_revisions | id, parent_id?, scope_ref, criteria, protected_check_refs, confirmation_ref, state | 内容不可变；作者不能自批弱化；修改走独立 approval/decision |
| scenario_revisions | id, parent_id?, actor, preconditions, actions, expected_results, exception_cases, non_goals, sources | 绑定需求/验收；mock 与真实场景证据分开 |
| user_reviews | id, kind, source_ref, audience_ref, scenario_ref, candidate_ref, environment_revision, decision, affected_scope | kind=assumption/feedback/experience_acceptance；not_reviewed 非接受；理由可追溯 |
| environments | id, task_id, run_id, revision, manifest_ref, seed_ref, state | 重置前锁定并验证；物理实例/namespace 和访问范围一致 |
| runtime_resources | id, kind, environment_id, root_id, run_id, canonical_locator, instance_identity, access_mode, lease_ref, state, retention_until, pins | 包括 DB/cache/port/browser/account/process/storage；复用前核对，不能自报路径执行删除 |
| human_interventions | id, user_id, human_run_id, scope, affected_refs, base_snapshot, checkpoint_ref, changeset_ref, state | 先 draining 和撤写证明再 editable；实际 diff 超范围不能静默应用 |
| consumer_syncs | change_id, consumer_run_id, successor_run_id?, notified_at, read_at, materialized_snapshot, constraint_check_refs, revalidation_refs, state | 通知/已读/实际物化/重验分开；权限内投递 |
| configuration_manifests | id, client_versions, model_identifier?, prompt_digest, tool_schema_digest, context_rules, policy_ref, environment_ref, fingerprint | 不可得字段为 unknown；配置变化使行为资格待复验 |
| behavior_evaluations | id, evaluation_root_id, suite_revision, baseline_fingerprint, candidate_fingerprint, run_refs, metrics, qualification | 记录所有重复样本；关键项失败禁升级，不选最好结果 |
| cleanup_jobs | id, resource_ids, eligibility_snapshot, policy_revision, authorization_ref, evidence_archive_refs, state, result | prepare/eligible/deleting/verified/tombstoned；锁/进程/依赖/pins 复查 |
| egress_policies | id, revision, subject_scope, destinations, operations, purposes, data_classes, limits, approval_rules | 独立于 read/network；默认拒绝未授权数据类别/目的地 |
| egress_operations | id, root_id, run_id, grant_ref, policy_revision, resource_manifest, recipient, purpose, action_hash, outcome, receipt_ref | 发送前授权；日志无敏感正文，unknown 不盲重试 |
| coordinator_profiles | member_id、model_profile_ref、delegation_policy_ref、enabled | 显示名与身份分离；模型关闭不关闭基础服务 |
| coordinator_workflows | root/request/thread/run、graph/profile revision、grant/security_domain、state、lease | 同 thread 单推进者；不能以 room_id 共用全群图记忆 |
| coordinator_plans | id/revision、context_snapshot、expected_plan_token、read/write_set、policy/disclosure/acceptance refs、state | 不可变修订；验证通过不等于已应用 |
| coordinator_actions | project_id、action_id、payload_digest、plan_revision、commit_cursor、receipt_ref、dispatch_ref | project_id + action_id 业务唯一；重放读取先按当前授权 |
| delegation_policies | id/revision、grantor/member、allowed_actions/members/scope/root、limits、events、expires、revoked | propose_only 默认；模型不可扩权；派送前重新验证 |
| disclosure_revisions | id/revision、private_source_ref、payload/attachments_digest、recipients、purpose、provider_policy_ref | 来源审计保持私密；批准的副本有独立 audience |
| disclosure_approvals | disclosure_revision、payload_digest、actor、expiry、state | 与计划批准区分；对象变更/撤销后不继续派送 |
| project_plan_heads | project_id、internal_revision、last_applied_plan_ref | 任务结构修改共享 CAS；内部计数不暴露给无权客户端 |
| reassignment_requests | task、old/new_owner、expected_version、control_ref、handoff_evidence、state | 活动任务不能只更新 owner，等待实际撤写/交接 |
| model_profiles / model_probes | provider/base_url/model、secret_ref、revision、capabilities、evidence、egress | 与工作 Agent 档案分离；生成与 Embedding 各自验证 |
| knowledge_sources / chunks | source/revision、ACL/audience refs、digest、chunk/embedding/index refs、status | 复用项目来源，不另造已确认事实；返回前复核权限 |
| knowledge_index_jobs / revisions | source_event/revision、profile、state、published_revision | 可靠队列、原子发布，重建不回滚原始业务记录 |
| plan_executions | id/root、current_plan_ref、scope_revision/task_scope、failure_policy、lifecycle/dispatch_gate/health/outcome、aggregate_revision、control/budget refs | 12 §3 分轴状态；与任务同一服务权威，不把 applied 当成功 |
| plan_scope_revisions | execution_id/revision、obligations/tasks/acceptance/dependencies、previous_ref、disposition_refs | 不可变范围；取消义务须需求批准，不删失败项伪造完成 |
| workflow_waits | wait/workflow/run/epoch/step、grant/security_domain、target/predicate/min_revision、deadline、internal_cursor、state/resolution/revision | 12 §5；注册检查原子化，终态不复活 |
| continuation_inbox | workflow/wait/resolution、continuation_id、processing_lease、checkpoint_ref、state | 逻辑恢复意图唯一，图重入不代表外部 exactly-once |
| coordinator_reports | workflow、scope、observed_at、source_refs、audience、kind | 事实/推断/建议/未知分开；报告不是任务状态 |

这些是逻辑对象，不要求逐个独立建表或拆服务；可复用 decision/approval/leases/artifacts 表保存类型化记录，但不得丢失约束。shared memory 不另设“唯一大 prompt”字段。

## 4. 任务和运行状态

### 4.1 Task

```text
draft → ready → in_progress → in_review → ready_to_merge → completed
           ↘ blocked ↗           ↓
                           ready（附返工意见）
任一非终态 → cancelled
```

- draft：尚未确认目标/验收或尚未授权执行。
- ready：必要前置条件已满足，等待有效成员领取；有依赖未满足时为 blocked。
- in_progress：至少有一个当前有效执行 run；历史尝试可同时存在。
- in_review：产物已提交，检查和评审正在进行。生效 acceptance_revision 不能由作者修改候选测试自动替换；检查绑定真实候选/环境/profile。
- ready_to_merge：代码类任务通过当前验收/场景要求的组合检查，等待集成；需要阶段体验的候选还应有匹配版本的 user_review。文档类任务可从 in_review 验收后 completed。
- completed：代码类任务记录 merged_commit 和验证结果；非代码任务记录 accepted_artifact 和验收者。
- cancelled：停止继续推进；已有代码和已发生的外部操作保留审计，不自动回滚。

blocked 必须记录 reason、等待对象和 return_state；解除阻塞时复核依赖和版本。task.kind 决定是否需要合并，不能把文档任务误判为缺少 Git commit。

评审可建立独立的只读子任务，使用自己的领取租约；不得与作者争用父任务的写入租约。父任务由服务根据验收证据推进。允许迁移在服务中集中定义，不由客户端任意 PATCH status。返工创建新的 run attempt，不修改旧 run 的结论。

### 4.2 Run

```text
queued → starting → running → succeeded
                       ↔ waiting_peer
                       ↔ waiting_user
                       → cancel_requested → cancelled
starting/running/waiting_* → failed 或 lost
```

run.succeeded 仅表示一次尝试成功提交结果，不等于 task.completed。waiting_user / waiting_peer 必须关联尚有效的 input_request（审批另关联 approval），不能仅从文本问号推断。等待期间 runner 续租；普通询问不唤醒，匹配的 continuation_reply 只恢复该等待点。答案失效/投递未知按 09 核对，不排到任务结束之后。

lost 表示无法确认原进程/会话状态。取消请求超时也可进入 lost，不假装取消成功。late report 只作为历史证据接收，不自动推进被取消或已重新分配的任务。

lost 的核对结果单独记录。若发现原尝试已结束，可补充其最终证据；若需要继续执行，先确认没有竞争写入者，再创建新 attempt 与新 epoch。迟到旧尝试永不自动恢复对任务的控制权。

### 4.3 Workspace 与 Approval

Workspace：creating → ready → busy → retained → archived；异常可进入 quarantined。archived 必须有明确保留/快照策略；不得默认删除用户原仓库。

Approval：pending → approved / denied / expired / revoked。审批绑定动作摘要、目录、run 和过期时间；动作变化产生新请求。不要把一次“允许本次写入”扩张成永久允许任意命令。

### 4.4 v1.4 运行与交付状态

Root Workflow、Environment、Human Intervention、Cleanup 的完整状态见 10。它们不替代 task/run/file lease 状态：人工介入先冻结影响范围并对账，human_run 才能获新 epoch；停滞只停止扩展不能谎称进程结束；环境 ready 必须实测资源归属；清理进入 eligible 前必须排除活动/未知状态和恢复引用。

里程碑的验收绑定 scenario/acceptance/candidate/environment。模块通过、模型共识、用户读过预览或 sync 回执均不直接推动完成；user_reviews 中仅明确的有效体验验收支持对应用户场景通过。

## 5. 消息、投递和幂等

发送消息的原子事务：检查身份/群权限 → 校验 intent、audience 与 idempotency key → 插入 message/ACL → 分配内部 room_seq → 写 event/outbox → 为有权用户/执行授权构建各自可见事件流 → 写幂等响应 → 提交 → 返回消息 ID 和调用者 cursor。progress_query 设 requires_agent_action=false，只进入状态查询服务和用户侧回执流，不进入目标 agent 的工作收件队列或活动 turn 的默认 polling/注入结果；audience 可读不等于必须实时投递。其他指令按忙闲状态进入允许的执行/排队路径。

事务提交前不返回 accepted。UI 断线重发使用相同 key，得到同一 message_id；相同 key 对应不同正文报 IDEMPOTENCY_CONFLICT。建议普通 HTTP 幂等记录保留 7 天；run 触发和外部副作用去重记录至少保留整个任务生命周期，归档前不能过期。

outbox worker 提交后投递，失败重试；收件者按 event_id 去重。发送成功但 ACK 丢失时会重投，这是正常行为。调度器用 (trigger_event_id, target_member_id, action_type) 唯一键避免重复创建 run。

面向已授权接收者的事件示例（契约版本 2，seq 是其可见流序号，非内部 room_seq）：

```json
{
  "schema_version": "2",
  "event_id": "evt_uuid",
  "room_id": "room_uuid",
  "feed_id": "recipient_feed_uuid",
  "seq": "1042",
  "type": "task.assignment_changed",
  "entity_id": "task_uuid",
  "entity_version": "7",
  "actor_member_id": "user_member_uuid",
  "causation_id": "msg_uuid",
  "correlation_id": "workflow_uuid",
  "trace_id": "trace_uuid",
  "occurred_at": "2026-11-13T03:00:00Z",
  "data": {"owner_member_id": "codex_member_uuid"}
}
```

group audience 的事件才可广播给所有有权群成员。direct 事件只进入发送者的用户流及指定成员中获准读取该 direct 范围的执行流，不给其他 agent 发消息、未读增长、预览、附件信息或“有一条私信”的占位事件；其房间公开更新时间也不因私信变化。payload 中的引用、causation_id、trace_id 和对象元数据须逐项授权，内部 room_seq 永不作为普通客户端 cursor。授权不只在投递时检查，还在读取、缓存命中、重放和恢复时重查。

SSE 使用绑定主体、execution_grant（agent 必需）、native binding、feed 与权限版本的不透明 cursor/Last-Event-ID 续读；同一成员的另一次执行也不能复用 cursor 读取事件；可重复但不丢已保留的可见事件。超出保留窗口返回 RESYNC_REQUIRED，先取当前快照再读之后事件。直播 UI 数据和数据库持久化数据以事件版本合并，客户端不能用迟到事件覆盖较新状态。

## 6. 领取、租约与停止后的权威

调度器先创建 queued run reservation 和仅用于领取的 dispatch grant（不授予文件写权）；task_claim 在一个事务内校验 task.version、身份/执行范围、未取消、依赖满足、无 active lease → 写 owner 与 lease → 分配更大的 epoch → 激活预留 run、写 outbox → 提交。可信 controller 将 dispatch grant 换成绑定实际 epoch 的 active execution_grant，旧领取凭据不可用于工作写入。同 key 领取只返回同一次运行，不能重复创建 run。

建议默认心跳 15s，租约期限 90s，连续 3 次心跳丢失标记 suspect；真实期限以兼容测试调整。服务校验时间，连接器不能自行延长 expires_at。系统时钟大幅变化触发核对，不能直接把全部任务重派。

所有任务写回必须携带 run_id、lease_id、epoch 和 expected_task_version。旧 epoch 报 LEASE_STALE。注意：fencing 能阻止平台状态写回，不能阻止一个失控进程继续写磁盘。

因此租约过期后先撤销旧执行的写入授权并核对原会话、进程树和 journal。不能确认旧写入者停止或已被可靠切断实际写入能力时，受影响逻辑路径在所有 worktree 保持 quarantined；仅允许创建只读诊断副本，禁止换目录继续修改相同路径。完成写能力撤销证据、进程核对、journal/文件/Git 对账后，才可授予新 epoch、新 attempt 并重试。旧目录不自动合并。原生外部客户端无法核对时显示阻塞，不能以用户点击“重试”或租约超时跳过门槛。状态与反例见 09 §2。

## 7. 共享记忆与上下文

记忆进入生效状态的流程：先对源内容及目标受众做授权 → 带引用的候选事实 → 用户或有权限的确认者 → 对应 audience 的新 decision revision → 对该 audience 更新版本并发布影响事件。direct 内容及其摘要/嵌入/任务描述不能自动进入群公共记忆。用户明确发布选定内容时，创建新的公开对象；不向其他成员附带私有原文链接或元数据。

群内总结不能直接成为确认事实；存在冲突的结论显示冲突，保留原文并请求明确取舍。成员不应把另一 agent 的推测转述成已确认要求。

执行前生成 context snapshot：

```json
{
  "snapshot_id": "ctx_uuid",
  "room_id": "room_uuid",
  "task_id": "task_uuid",
  "root_workflow_id": "workflow_uuid",
  "acceptance_revision": "acceptance_3",
  "constraint_versions": {"no-new-dependency": "2"},
  "scenario_refs": ["scenario_create_item_v2"],
  "execution_grant_id": "grant_uuid",
  "input_changesets": [{"id": "cs_uuid", "commit": "git_commit_hash", "mode": "accepted"}],
  "tree_digest": "git_tree_hash",
  "audience_digest": "authorized_scope_hash",
  "acl_version": "3",
  "visible_watermark": "opaque_recipient_cursor",
  "role_revision": "3",
  "decision_versions": {"api-contract": "5", "scope": "2"},
  "base_commit": "git_commit_hash",
  "sources": [{"type": "message", "id": "msg_uuid", "revision": "1"}],
  "included_artifact_digests": ["sha256_value"],
  "manifest_hash": "sha256_value"
}
```

实际 prompt/输入序列存受控快照或可重建 manifest；不要求保存模型内部推理。快照必须能说明本次读到哪些文本、图像引用与文件版本。

上下文先按成员、execution_grant、原生绑定、消息 audience、资源 ACL 和当前授权版本过滤，再做检索、排序、摘要和 prompt 构建；不得先全群总结再删私信。缓存键包含主体、execution_grant、原生绑定、audience/ACL/policy 版本和可见 watermark。随后优先顺序：平台治理与权限边界 → 当前任务/验收 → 当前有效决策/契约 → 必要依赖产物 → 最新相关消息 → 检索历史。按 adapter 已知限制设置预算并保留输出余量；未知窗口用保守可配置值，不假定所有模型一样。

初期用结构化过滤和全文检索；向量检索以后增加，作为候选召回而非事实判定。summary 保存可见范围、覆盖的 watermark、来源和生成版本；只能取回当前执行 grant 与成员权限交集内的历史。provider 的私人历史和隐藏记忆不自动导入。

新决策发生在 run 启动后，服务判断是否使当前输入契约/changeset 依赖失效；受影响任务 context_stale、run.validity=stale，Broker 和集成事务立即拒绝后续无效写入/交接/合并。在途操作进入核对，产物保留。通知只发给有权限者，不泄漏私密失效原因；异步通知延迟不能使旧授权继续放行。无关问题/新指令仍排队，进度查询不触发任何控制；依赖失效与权限撤销是独立的安全事件。继续前需新一致快照、impact review 与必要检查，不能仅改快照号码。

### 7.1 记忆生命周期与实体事实

本节为共享契约；管家实现算法见 11 §13。新增字段为待实现的逻辑设计，不修改当前 core/1.0 wire Schema、数据库迁移或原客户端接口；落地前需定义内部版本化 Schema 和相应校验。记忆不是额外业务权威，关系数据库、向量索引、文件索引或缓存的选型不能改变确认和可见性规则。

| 类型 | 生效依据与范围 | 更新和失效 |
| --- | --- | --- |
| 用户偏好 | 明确原话及任务/项目范围；跨项目复用需用户明确选择 | 临时偏好不得推广为永久规则；更正创建替代关系 |
| 项目事实/决定 | 有权限者确认的需求、接口、验收或服务事实引用 | 绑定有效 revision；旧版保留历史但不作为当前要求 |
| 执行观察/经验 | 实际回执、失败证据和适用环境 | 可按授权记录观察；不自动成为已确认决定或永久禁令 |
| 实体与依赖知识 | 项目、文件、符号、接口、成员等稳定 ID 与源版本 | 名称不是身份；重命名、删除、变更使相关派生项重建或失效 |
| 临时工作记忆 | 单次图状态、未决问题及会话摘要 | 按执行域和保留规则处理；不能替代任务状态或审批账本 |

可复用记录至少携带 memory_id、kind、source_refs/revisions、scope、audience/resource_acl_refs、status、valid_from/valid_until 或适用版本、confirmation_ref、supersedes_ref、review_or_expiry_condition。缺少有效期不代表永久有效；读取时仍核对来源、适用版本和当前授权。相同来源版本与范围可去重，存在相反结论则保留冲突，不能按相似度或最后写入者擅自裁决。

“记住”先确定内容和作用域；高影响决定沿用本节确认流程。“更正”关联被替代记录并触发受影响上下文失效。“忘记/不再使用”记录可用性撤销，阻断后续检索、摘要和恢复输入，再清理索引/缓存等派生项。删除业务记录与停止个性化复用分开；若涉及有效需求或必需审计，解释影响并走对应变更/保留流程，不能用忘记操作绕过验收或删掉已执行事实。界面区分已停止使用、清理待完成和按已说明规则保留的最小审计引用；不承诺收回已发送的外部副本。

### 7.2 上下文装配与成员交接清单

context manifest 增补 context_policy_revision、model_profile_revision、budget_method、estimated_input_tokens、output_reserve、safety_margin、included_refs、omitted_refs/reasons、summary_revision 和 unresolved_obligation_refs。仅保存调用方有权查看的元数据；原文/工具载荷仍走受控资源。完整请求预算包含系统/用户/历史消息、工具定义/结果和附件的模型计量；精确计数不可得时记录估算依据与未知项，不把字符数冒充准确 token。

输入超限时按 11 §13 裁剪或拆分，保留当前请求、关键约束、未决义务及工具调用/结果关联。强制约束不依赖相似度检索。新需求、更正、撤权和人工代码变更均参与快照有效性判断；旧摘要不能绕过这些检查。

每个执行成员的任务输入清单应包含目标、允许修改范围、需求/接口/验收版本、依赖产物、已批准的相关人工变更、预期输出和阻塞求助入口；记录实际投递 manifest 与目标能力档案。资料引用可按需展开，但执行关键前置必须在相应动作前可合法取得。必要信息不可披露或窗口不足时阻塞/拆分，不能静默删除以完成派发。read_ack、投递成功、实际采用 snapshot、产物通过检查分别登记；不能仅凭已读或“已理解”升级为同步完成。

## 8. REST 与事件接口

路由前缀 `/v1`；常规请求 JSON，认证上下文决定 actor；agent 还必须携带服务签发的执行凭据，所有读取/写入按 grant 复核。分页使用稳定 cursor；所有写操作需要幂等 key 或自然唯一操作 ID。参数校验错误不调用 agent。

| 操作 | 建议接口 |
| --- | --- |
| 群 | POST /rooms；GET /rooms；GET /rooms/{id}；POST /rooms/{id}/archive |
| 成员 | POST /rooms/{id}/invitations；POST /invitations/accept；POST /members/{id}/revoke |
| 职责 | POST /members/{id}/role-revisions |
| 消息 | POST /rooms/{id}/messages；GET /rooms/{id}/messages；POST /messages/{id}/revisions |
| 事件 | GET /rooms/{id}/events?cursor=opaque_cursor，服务绑定当前主体及执行 grant 的可见 feed，支持 SSE 与分页重放 |
| 定向询问 | POST /rooms/{id}/inquiries；GET /inquiries/{id}，进度/只读询问不向 runner 转发提问 |
| 状态 | GET /members/{id}/status；GET /runs/{id}/progress，按资源 ACL 返回观测状态和时间 |
| 文件交接 | POST /projects/{id}/file-locks/acquire-set；POST /file-locks/{id}/heartbeat；POST /changes/{id}/finalize，服务核对版本/记录后释放 |
| 变更与版本 | GET /projects/{id}/changes；POST /runs/{id}/checkpoints，包含 op_id，最终提交由 Workspace Manager 管理 |
| 协调员 | POST /rooms/{id}/coordinator/settings；GET /rooms/{id}/progress；POST /rooms/{id}/assignment-proposals；确认后才执行授权外派工 |
| 发布选定内容 | POST /messages/{id}/publish，用户明确选定内容与目标 audience；不原地公开旧私信 |
| 阅读 | POST /rooms/{id}/cursors，主体/grant/feed 由认证绑定 |
| 执行授权 | 可信控制面 POST /execution-grants；POST /execution-grants/{id}/revoke；普通 agent 不可自行签发 |
| 等待回答 | POST /runs/{id}/input-requests；POST /input-requests/{id}/replies，绑定请求/epoch/响应者，独立于新指令 |
| 变更集依赖 | GET /changesets/{id}；POST /runs/{id}/input-snapshots，校验完整闭包及 WIP 消费授权 |
| 任务 | POST /rooms/{id}/tasks；GET /tasks/{id}；POST /tasks/{id}/claim |
| 执行 | POST /tasks/{id}/runs；POST /runs/{id}/cancel；GET /runs/{id} |
| 租约 | POST /leases/{id}/heartbeat |
| 决策 | POST /rooms/{id}/decisions；POST /decisions/{id}/confirm |
| 上下文 | POST /tasks/{id}/context-snapshots；GET /context-snapshots/{id} |
| 结果 | POST /runs/{id}/reports；POST /artifacts；GET /artifacts/{id} |
| 审批 | POST /approvals/{id}/resolve |
| 集成 | POST /tasks/{id}/verify；POST /tasks/{id}/merge |
| 数据 | POST /rooms/{id}/export；POST /backups；GET /health |
| 阶段集成/验收 | POST /projects/{id}/integration-milestones；POST /acceptance-revisions；POST /acceptance-revisions/{id}/confirm；POST /user-reviews |
| 人工介入 | POST /projects/{id}/human-interventions；POST /human-interventions/{id}/finish；GET /human-interventions/{id}；finish 仅触发对账，不直接恢复 Agent |
| 环境/资源 | POST /runs/{id}/environments；POST /environments/{id}/reset；GET /runtime-resources；写操作需资源租约与 revision |
| 根工作流 | GET /workflows/{id}/progress；POST /workflows/{id}/resume-decisions；Agent 不可自建新 root 清账 |
| 行为回归 | POST /behavior-evaluations；GET /connectors/{id}/qualification；只有验收服务可更新资格 |
| 清理 | POST /cleanup-plans；POST /cleanup-plans/{id}/execute；逐资源复核 eligibility |
| 外发授权 | POST /egress-policies/revisions；POST /egress-operations；后者仅为受控发送入口，不接受任意 URL/payload 绕过检查 |
| 管家流程 | POST /coordinator/requests；GET /coordinator/workflows/{id}；POST /coordinator/workflows/{id}/cancel-analysis；取消分析不取消工作任务 |
| 管家计划 | POST /coordinator/plans；POST /coordinator/plans/{id}/revisions；POST /coordinator/plans/{id}/apply；plan revision/版本 token/action_id 必需 |
| 委派策略 | POST /delegation-policies/revisions；POST /delegation-policies/{id}/revoke；仅授权用户控制面可写 |
| 内容披露 | POST /disclosures；POST /disclosures/{id}/approve；POST /disclosures/{id}/revoke；approve 绑定精确 revision/digest/recipients |
| 再分配 | POST /tasks/{id}/reassignment-requests；不直接重写活动 task.owner |
| 管家模型/知识 | POST /model-profiles；POST /model-profiles/{id}/probe；GET /knowledge/search；GET /knowledge/sources/{id}；能力测试先确认合成调用成本 |

创建 run 通常只允许调度服务或用户，agent 的 task_claim 不允许绕过依赖/预算直接启动别人的进程。merge、approval、角色调整不暴露为每个 agent 默认可用的操作。

写操作响应包含调用者有权看到的 resource_version 与 committed_cursor，不暴露内部 room_seq。建议统一错误：UNAUTHENTICATED、FORBIDDEN、NOT_FOUND、VALIDATION_FAILED、VERSION_CONFLICT、IDEMPOTENCY_CONFLICT、DEPENDENCY_BLOCKED、LEASE_STALE、CAPABILITY_UNAVAILABLE、CONTEXT_STALE、APPROVAL_REQUIRED、BUDGET_EXCEEDED、RESYNC_REQUIRED、PROVIDER_UNAVAILABLE、RUN_STATE_UNKNOWN。分别映射稳定 HTTP 状态，带 retryable 和用户可读说明，不泄露密钥/路径外的信息。

## 9. MCP 工具面

协作工具应小而明确；同一逻辑调用领域服务，不能再实现一套独立状态机。所有返回给模型/原客户端的数据还要在输出前校验其 provider 的 egress policy；MCP stdio 的本机一跳不豁免外发规则。所有调用逐请求验证服务端 execution_grant（成员、run/epoch、原生绑定、audience、资源、动作、时限），与当前成员策略及资源 ACL 求交集。仅有成员/connector 凭据不能读取内容；调用参数中的 session_id 不构成认证 [E09]。

| 工具 | 功能与边界 |
| --- | --- |
| room_get / room_list | 当前身份可访问的群与规则 |
| message_send | 发消息或回复；身份取 token，不接受自报作者 |
| message_poll / message_wait | 只取当前执行 grant 的工作 feed；排除 progress_query/回执及其他会话私信；wait 有超时和取消，不等于保证客户端被唤醒 |
| project_context | 在当前执行范围内读取记忆/来源；快照、附件、历史、搜索和缓存均复核 grant 与 audience |
| member_status / run_progress | 仅读已有状态投影，返回 source/observed_at；不能代理调用工作 agent 或执行命令 |
| task_list / task_get | 看分工、依赖、验收 |
| task_claim / task_heartbeat | 原子领取与续租；返回租约 epoch |
| help_request | 关联任务、问题、期望产物与候选成员；需要暂停时登记 input_request 和等待点 |
| input_request_create / input_reply_submit | 前者只能登记本 run 的已证实等待点；后者绑定 request_id，校验身份/epoch/audience/schema；不授予审批权限 |
| changeset_get / input_snapshot_prepare | 返回获准的完整变更集及一致项目快照；WIP 消费须显式授权与依赖记录 |
| decision_propose | 提交候选决策，默认不能自行确认 |
| artifact_register / task_report | 登记实际产物，不能直接完成任务 |
| workspace_read | 读取获准工作区的文件与版本 |
| file_lock_acquire_set / file_lock_heartbeat | 原子获取/续期项目逻辑路径锁，回传 file_revision 与独立 epoch |
| workspace_apply_patch | 要求有效路径锁集合、epoch、file_revision、expected_digest、op_id；禁止直接写文件绕过 Broker |
| change_finalize / changes_list | 生成/读取按 audience 授权的结构化记录和 Markdown，核对 checkpoint 后交接 |
| project_progress / assignment_propose | 服务输出权限内统计；派工草案经授权和幂等检查才能产生动作 |
| checks_run | 执行受保护检查 profile，绑定候选、标准和环境；返回实际退出码/证据，不接受作者自报 PASS |
| milestone_get / acceptance_get | 读取获准的阶段场景/生效验收，作者无权直接降低标准 |
| environment_get / resource_request | 读取本 run 的环境与申请资源，不能传任意连接串借用他人环境 |
| workflow_progress / intervention_status | 只读根进展或人工介入状态；不自动恢复/抢写 |
| sync_report | 报告物化与检查证据，服务复核后更新同步状态；不能仅凭“已读”清除 stale |
| egress_request | 对具体数据/目的地/用途请求策略决策；批准仍须由受控通道执行，不能获取任意联网权限 |

Desktop 可借助这些工作区工具完成前端文件交付，不以它本身一定拥有任意本地 shell 为前提。checks_run(profile_id) 不接受未经授权的任意命令文本。

## 10. Adapter 契约

控制面逻辑接口：probe、connect、start、send_input、respond_input(request_id, reply)、cancel、resume、reconcile、close。respond_input 独立于一般 send_input/steer，只有已验证的等待点能力才可调用。每项能力有 supported / unsupported / unverified，并包含版本、检测时间和来源。unsupported 不靠静默重启新会话来伪装实现。

状态投影仅消费既有授权事件；查询回执不得被 adapter 当作新 agent 工作项。标准化输出事件：started、text_delta、message_final、tool_activity、approval_requested、input_requested、input_resolved、usage_updated、checkpoint、artifact_proposed、completed、failed、state_unknown。原生事件可加 namespace 保留；不存在的数据不能编造。

协议初始化、权限回调和重连由各 adapter 实现。普通 stdout 必须与协议输出分离；协议帧不完整时缓冲到限额，超限返回可诊断失败。文本中出现“done”不能代替结构化完成事件。

## 11. 定向询问的独立执行语义

intent 包含 progress_query、read_only_question、task_instruction、continuation_reply、control。识别优先使用用户入口与确定性规则；不得把定向正文交给别的 agent 分类。progress_query → 保存私密询问 → 读取授权状态投影 → 返回平台状态回执；整个流程不创建 agent run，也不占用目标工作会话的输入通道。

需要模型本人解释的问题写 deferred_inbox，立即回执“已排队，当前任务继续”；默认在任务自然结束后以授权上下文处理。新指令同样排队。对当前有效 input_request 的 continuation_reply 走独立答复通道，匹配 waiting_user/waiting_peer 时恢复该等待点；失效回答报错且不得转为新任务。只有用户明确要求停止或调整当前任务，才由用户消息进入 control 流程，不能从疑问句推断控制意图。另有已授权策略触发的预算/停滞/安全事件，其因果单独记录，不由进度查询触发。

状态来源过期或不可用时返回最后观测时间和 stale/unknown，不编造百分比、ETA 或实时想法。正常运行事件可以更新状态，但查询不能触发检查命令、额外模型回合或租约变化。

## 12. 文件修改与协调员的补充契约

文件租约与 task lease 分开；租约 key 是项目逻辑路径，不是 workspace 绝对路径。多路径获取原子成功或全部失败，目录操作参与前缀冲突检查。patch/生成/rename/delete 统一写 journal；先准备含完整 changeset 依赖闭包的一致输入快照，再原子锁定写集合、核验版本并应用。不能只拷贝某个文件的最新 digest。

edit journal 提交链为 prepared → applied → recording → committed → handoff_ready；该链的 readiness 不等于 changeset.review_state=accepted。默认只消费 accepted 基线；WIP 需要显式 speculative 授权及依赖，上游失效即阻止下游写入/合并，详见 09 §5。DB、Git 和文件系统间通过 journal、digest 和实际 ref 对账；未到 handoff_ready 不释放路径给下一写入者。仅针对发生 diff 的受控路径创建 checkpoint，记录 Markdown 用 change_id，不嵌入自身 commit hash。更多恢复和隐私边界见 08。

新增错误 ACCEPTANCE_REVISION_STALE、ACCEPTANCE_CHANGE_REVIEW_REQUIRED、ENVIRONMENT_NOT_READY、RESOURCE_BUSY、HUMAN_INTERVENTION_ACTIVE、SYNC_EVIDENCE_REQUIRED、WORKFLOW_EXPANSION_PAUSED、REGRESSION_QUALIFICATION_REQUIRED、CLEANUP_PINNED、EGRESS_NOT_AUTHORIZED、EXECUTION_SCOPE_DENIED、GRANT_REVOKED、INPUT_REQUEST_STALE、INPUT_REPLY_CONFLICT、INPUT_DELIVERY_UNKNOWN、CHANGESET_DEPENDENCY_STALE、SNAPSHOT_INCOMPLETE、BACKUP_INCOMPLETE、FILE_LOCK_BUSY、FILE_LOCK_STALE、FILE_CHANGED_SINCE_LOCK、WRITE_ENFORCEMENT_UNAVAILABLE、CHANGE_RECORD_PENDING、CHECKPOINT_RECONCILE_REQUIRED、DELEGATION_NOT_AUTHORIZED。文件锁忙时只返回调用者有权看到的持有信息。

协调员的 assignment_proposal 使用 expected_task_version、scope、policy_revision 和 idempotency_key；独立的 policy 校验成功后才产生任务或 owner 变更。纯进度请求不创建模型 run；可选模型分析使用仅对该模型授权的冻结快照，不向其他 agent 发询问或调用工作控制接口。

新增/派生任务的 root_workflow_id 由服务根据调用者 run 与用户目标确定；预算预留必须在触发运行、评审或子任务前原子完成。配置/场景/环境/验收 revision 进入 run envelope 和证据绑定；root、环境与数据外发范围不能由 adapter 静默更换。

## 13. 示例：一次求助到合并

对于已公开且允许协作的后端任务：用户授权 → Codex 领取并生成 snapshot → 遇到接口问题发送 help_request → 检测等待图并投递给规划成员 → 提交建议 → 有权限者确认 contract v6 → 相关任务标 stale → 自然处理点同步版本 → 锁定路径并修改 → 登记 Markdown 和 checkpoint → 组合测试与独立评审 → 用户确认合并 → completed。

每一步记录 causation_id 与 correlation_id。查询任务能重建这个过程，不依赖模型复述对话。


## 14. 管家共享契约与冲突规则（v1.5）

本节注册平台对象，算法/模型/检索设计见 11。human_interventions、consumer_syncs、root_workflows、budget_ledger、验收/场景/环境/外发实体继续由原服务维护；不在管家库复制一份权威状态。图 Checkpoint 独立保存流程位置和必要授权数据，不改变业务单写入口。

- 计划状态：draft → validated → awaiting_approval/authorized → applied；可进入 rejected/superseded。授权只对不可变 plan_revision 有效；应用失败保留拒绝/冲突证据，不把 applied 改回未执行。任务创建后未派送是动作/投递状态，不是 run.running。
- 管家流程状态见 11 §7；取消/等待仅约束管家流程。Human Intervention 固定使用 10 的 requested/draining/editable/reconciling/awaiting_validation/completed 及 blocked/quarantined，不接受另一套 ready_for_human/sync_pending 写入同一实体。
- 计划提交契约必须含 action_id、plan_revision、payload_digest、expected_plan_token、expected_resource_versions、read_set/write_set、input_snapshot、policy/approval/disclosure refs。原任务 API、手动角色变更和自动派工均进入同一个计划应用服务；影响任务契约/依赖的 decision/验收变更使相关计划失效。
- 同项目计划头 CAS + 读写集合 + 任务状态 + 根预算预留在同一事务验证；任务/依赖、动作回执与 outbox 一起提交。活跃任务再分配只建控制请求，等撤写和完整交接后才变更 owner/epoch。冲突不能静默覆盖，也不能先执行外部一半再回滚业务表。
- 请求级 idempotency_records 继续绑定当前授权；跨 attempt 的业务去重使用 coordinator_actions(project_id, action_id)。已应用动作先鉴权后查原回执，不因 expected_plan_token 已旧再次应用；新凭据既不扩权，也不创建第二次副作用。
- 普通自动派工授权不含私密披露。disclosure_revisions 与计划批准分别绑定，用户明确批准指定内容后创建独立 audience 副本；从新的干净执行调用派工服务。私密图 checkpoint 不能作为下游上下文。
- 用户控制面才可改模型端点/密钥引用/委派/披露批准；普通 Agent 工具不能调用这些接口自批。自动事件的 actor 来自有效委派策略，root 和 grant 由服务派生，不能以最后一次请求者身份无限续跑。
- 所有 outbox 派送在发送前检查当前 task/plan、撤销、成员能力、disclosure 与 egress；失败保留 dispatch_blocked/unknown，不能谎称已执行。授权撤销不意味着已经发生的动作可被倒转。

管家工具统一由 Tool Gateway 携带可信 run/grant/root；建议能力为 get_project_context、list_member_capabilities、get_tasks/get_progress、search_project_knowledge、get_changeset、propose_plan、apply_authorized_plan、request_help/request_review、publish_change_notice、request_human_takeover、read_action_result。写类工具只发动作请求，最终执行仍由服务校验；公开计划/私密提议不能共用一个不分域的万能 execute 工具。

新增错误：PLAN_STALE、PLAN_CONFLICT、ACTION_PAYLOAD_CONFLICT、DISCLOSURE_APPROVAL_REQUIRED、DISCLOSURE_STALE、DELEGATION_EXPIRED、REASSIGNMENT_REQUIRES_HANDOFF、MODEL_CAPABILITY_UNAVAILABLE、MODEL_OUTPUT_INVALID、RETRIEVAL_INCOMPLETE、INDEX_STALE。拒绝不得泄漏无权计划、收件者、私密任务标题或内部计划计数。

内部最小事件字段：event_id/type、project/root、entity_id/revision、action_id?、causation/correlation、audience_ref、committed_cursor、occurred_at。plan_applied / action_outcome_changed / delegation_revoked / disclosure_revoked / knowledge_source_changed / coordinator_wait_resolved 由可信服务产生；按执行 grant 过滤后才投递，不能订阅全群事件再在模型内过滤。等待绑定 request_id/run/epoch 与预期事件条件；重复事件去重、乱序事件读当前权威状态、迟到取消结果不重新派工；丢失唤醒通过服务对账处理而不是模型周期轮询。

## 15. v1.6 核心协议的唯一衔接

计划部分执行/控制/收束见 12 §3；等待协议见 12 §5。内部 committed_cursor 不出现在 core visible_event，外部使用经执行授权过滤的不透明 stream_cursor。core get_plan_progress 仅在完整执行范围可见时返回聚合；权限不足时拒绝，调用原有逐任务只读接口取得合法子集，UI 明确范围受限，不推导隐藏总数。

core apply_plan 的 plan_ref 指向已持久化的不可变计划，必须含本章 §14 的 payload_digest/read_set/write_set/input_snapshot 及授权绑定；引用结构没有免除这些要求。wire 的 expected_resource_versions 与服务同名版本集合逐项校验。core request_id 是调用追踪 ID；continuation_reply 的 input_request_id 对应原 waiting request，不得混淆。answer_ref 指向通过原消息/输入入口保存的同受众不可变回答对象，服务再校验内容类型、请求绑定和外发。

规范基线：contracts/core.schema.json、contracts/wire-examples.json；故障材料 validation/protocol-fixtures.json。未知版本/字段/枚举拒绝；状态/CAS/ACL 仍由服务语义检查。原有 task/run/input_request 状态不被新 plan_execution 聚合替代。

## W13只读任务投影实施增量（2026-11-16）

resource/0.1新增第七类task投影及GET /v1/projects/{project_id}/task/{id}绑定，只包含status、candidate_ref、inputs_valid、acceptance_ref和公共投影信封。复用既有grant/policy/run/ACL与引用闭包检查，不增加管理写入口，不返回凭据、native binding或任意任务正文。core/1.0及001–004数据库迁移不变。MCP合成验收桥的实施边界见03 §5.1与W13；不能从工具定义推断真实Desktop已经执行任务。
