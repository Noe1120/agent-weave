# W34–W36 单任务授权、执行与恢复回执

目标：实现 W33 之后主人已确认的单任务规则；不配置或启动本机客户端。Node/TypeScript + 现有 SQLite resources，不迁移用户库。

1. W34：主人 cookie + CSRF 批准或撤销；按项目/runtime 读状态。批准明确 connection、task、runtime、配置指纹、Codex、路由、模型、软阈值及绝对过期时间。重放同一批准返回原状态，不重置。注册/任务失效即拒绝。注册凭据不授予控制权。
2. W35：在 start 现有事务内校验控制 grant、task ACL、成员、受信 launcher 元数据并消费，再允许 spawn。只允许同任务一个 turn；消费、失败、撤销、过期均不允许重新启动。维护循环独立于进度查询，失权/用量达到软阈值走所属关闭路径。默认服务仍无启动器，不从 HTTP 接受命令行或凭据路径。
3. 用 Node 夹具走批准→启动→任务→只读查询→关闭，以及换任务/换配置/重复/撤销/过期反例。构建、全量、原生/旧包和设计检查分别记录；无真实操作、费用、OS 隔离或产品资格升级。

## 已实现的接口（仅后端）

| 操作 | 入口 | 条件及结果 |
| --- | --- | --- |
| 批准 | `POST /v1/console/task-authorizations/approve` | 主人会话、同源、CSRF；明确 `project_id, connection_id, task_id, runtime_id, target, configuration_fingerprint, route, model, soft_tokens, expires_at`。仅 Codex、回环路由；阈值 1–30,000 tokens、到期最长 5 分钟，且不晚于登记凭据到期。runtime ID 是一次操作的幂等键。同 ID 改参数拒绝。 |
| 撤销 | `POST /v1/console/task-authorizations/revoke` | 主人给出 `project_id, runtime_id`。可重复；不能恢复旧许可。 |
| 查看 | `GET /v1/console/projects/{project}/task-authorizations/{runtime}` | 主人只读。`execution` 仅投影同一所属实例的持久结果；未启动为 null，缺少现场证明的活动状态为 unknown。用量没有记录时为 null，不当作 0。 |
| 执行 | `POST /v1/runtimes/codex/start`、`POST /v1/runtimes/codex/approved-turn` | 原有 runtime_control、adapter_configure、run、policy、ACL 校验仍在。只有受信装配的单任务 profile 才能消费主人许可；开发夹具单独标识。turn 沿用 `synthetic_task_get/1`，不接受自由提示词；没有自动重试。 |

启动许可与任务读凭据不是同一个东西：W17 仍需单独签发受控的只读 grant，并核对获准任务。官方 relay 从已固定的 provider 内容及桥配置导出非敏感元数据；多任务、可轮询消息或带 execution 的桥不能用此入口。到阈值只保证在用量上报后请求关闭，不是硬限额；停止/关闭请求不是退出证明。

## 实施与复验

- W34 先验证未批准不能启动、主人写入需要 CSRF、撤销/过期和重放。W35 用自有 Node 子进程验证并发重放只启动一次、换模型或任务拒绝、启动失败不能再试、阈值及控制授权撤销导致所属关闭。测试曾发现只在 HTTP 守门不足，已在控制器事务里消费；维护期间也复核 runtime_control。不改原校验。
- W36 通过主人回执核对已观察退出及匹配代次的用量，不泄漏原生文本。正常重开保留未用批准；测试备份恢复到新目录后，签名键变化使原登记和授权失效。为避免额外授权的只读 grant 读到另一任务，观测携带固定任务并在每次 grant 校验时匹配。
- 编译走查：`node tests/runtime-walkthrough.mjs --owner-task`，未授权拒绝→邀请/兑换和主人批准→启动及幂等重放→100 次只读进度→一个夹具 turn→主人核对退出与用量→第二次 turn 拒绝。另跑无该参数的原有走查。夹具只演练协议，不证明厂商选择了工具；发布默认仍没有管理员配置的真实启动器。W33 已消费的计费许可不再执行。
- 类型检查暴露了三个显式 `undefined` 与精确可选属性不符的问题；调整为无值时不构造属性，保留严格检查。未改 schema、真实凭据或既有包。
- 官方来源即使在进程内直接调用控制器 `start` 也不能绕过许可。W33 报告是历史固定配置证据，其旧付费脚本不是新产品入口，不为复用脚本保留旁路。恢复后的真正活动进程、私有数据外发和桌面点击均不在本轮范围。
