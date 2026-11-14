# P0 探针准备与执行门槛计划

> 执行者：按已确认范围在当前会话内完成文档准备；本轮不使用子 Agent。后续实际实现按 executing-plans 分任务推进，不能越过本单的启动、环境、费用与外发门槛。

**Goal:** 修正已确认的三处设计歧义，给 P0 的真实客户端/隔离/管家/异常流程验证提供明确、可追溯且默认不执行的探针规格。

**Architecture:** 既有 01–12、core/1.0 和 AT/CA 仍是规则来源；本单编排准备流程，[p0-probe-manifest.json](validation/p0-probe-manifest.json) 保存步骤、前置条件、判据和证据要求。历史静态安装观察、可复用 NOT_RUN 模板、一次真实运行证据分开存放；不新增产品运行器，不凭文档通过冻结真实接口或授予客户端资格。

**Tech Stack:** Markdown/JSON；已有 Python 3.9.13 + jsonschema 离线设计工具；新增标准库 unittest 回归检查。不安装依赖，不运行 Node/客户端进程，不访问模型服务。

**Spec:** [项目交接说明](项目交接说明.md) §4/5/6/8；[05 阶段门槛](05-delivery-acceptance.md)；[09 隔离与恢复](09-review-closure-and-gates.md)；[11 管家](11-coordinator-agent.md)；[12 协议闭环](12-protocol-closure-and-validation.md)。

修订：p0-preparation-1，2026-11-14，Asia/Tokyo。用户已确认需求基线及文档/探针准备方向；**不是客户端启动授权**，也没有产生模型/API、系统变更、真实数据外发或发布授权。历史确认单中的“待用户确认”保留为当时的记录，不回写历史证据。

## 1. 全局约束

- 保留 Codex、Claude Desktop、DeepSeek Harness 原客户端身份；不以 Claude Code/SDK/管家 API 替代目标。
- 本轮仅完成文档/声明式探针/离线检查。真实产品 190 AT + 60 CA 全部 NOT_RUN；兼容资格 UNVERIFIED，核心契约 NOT_FROZEN。
- 私密信息及所有派生内容受当前授权交集约束，同成员不同执行不可串域；查询进度零新增模型调用，不打断工作。
- 同项目逻辑文件跨所有 worktree 单写者；旧写能力未知时不交锁；只分进程、目录或 worktree 不构成完整安全边界。
- 客户端响应、真实受控产物、隔离和恢复使用同一配置 fingerprint；变更主体/入口/客户端/插件/工具链等需复验。
- 无实际运行器/授权/环境/证据时保持 NOT_RUN；没有独立审核时不标 oracle 已验收。不根据静态安装版本推断运行能力。
- **G1 未通过，不开放真实多 Agent 写代码**。三 Agent 协作前置不会因本轮离线检查通过而消失。
- 本单的工作完成只代表准备材料交付；完整 OpenAPI/传输认证/类型/DB 迁移和服务语义仍属 W03 的实现与冻结工作。

## 2. 本轮文档准备任务

### Task 1：定点修订与回归

**Files:** 修改 `04-reliability-security-operations.md`、`README.md`、`validation/protocol-fixtures.json`；新增 `tools/test_p0_readiness.py`。

**Consumes:** core/1.0 的严格对象白名单、plan_progress.lifecycle 枚举、交接 §4.1 的唯一阅读顺序。

**Produces:** 三处一致性修订；可重复离线检查；PF-04 时序断言，suite revision=protocol/1.1、fixture revision=2。业务版本、33 FR、250 产品用例及安全门槛不变。

- [x] 保存修改前全部设计文件和 Prompt.md 的副本/摘要，不初始化 Git 或覆盖既有证据。
- [x] 先运行 12 项回归检查，观察已知问题和缺失清单产生预期失败。
- [x] 明确 core/1.0 未知字段/版本/枚举拒绝；其他协议仅按显式协商处理可忽略扩展。
- [x] PF-04 使用合法状态 stopping，独立表达撤权/对账完成前不得 closed 或交接新写者的时序要求。
- [x] README 不再维护第二套阅读顺序，直接引用交接 §4.1。

### Task 2：P0 清单与证据合同

**Files:** 新增本单及 `validation/p0-probe-manifest.json`；更新 README、交接、12 章材料表和 CHANGELOG。

**Consumes:** 三客户端各 11 个 COMP 探针、已有 wire/PF/CQ/效率材料、AT/CA、用户“不要随意启动/调用”限制。

**Produces:** 16 个具体探针规格，其中前 11 个分别覆盖三个原客户端，共 33 个 COMP 条目；管家独立，实际结果空白。

- [x] 每项写明输入、前置、依赖、至少三个实际步骤、通过标准、失败/停止条件、证据和验收引用。
- [x] 明确执行授权字段、fingerprint 字段、合成数据和脱敏证据规则，默认 automatic_execution=false。
- [x] 写出四异常流程草图及用户访谈记录要求，但不代填参与者或反馈。
- [x] 完成导航/维护命令及派生材料更新，验证新增文件均纳入清单。

### Task 3：离线交付验证

**Files:** 由工具生成 `完整方案.md`、`verification-report.json`、`SHA256SUMS.txt`；证据另存工作区 evidence/p0/2026-11-14-p0-preparation。

- [x] 运行 12 项离线回归并确认全通过；在独立副本植入 7 类旧状态/弱授权/漏探针等负例，均被准确拒绝。
- [x] 更新合订/校验报告/摘要，再执行只读校验，确认命令未改变文件。
- [x] 比对修改前快照，列出实际改动；确认未改 Prompt.md、core Schema、验收定义、兼容资格或产品测试状态。

这些勾选仅记录本轮文档准备，不能作为第 4 节任何实际探针的 PASS。

## 3. 启动前登记及授权合同

### 3.1 已知入口仅作观察参考

2026-11-14 的只读观察记录位于 `D:\Users\1\Desktop\team\evidence\p0\2026-11-14-launch-paths`。未将观察结果填入原 compatibility-matrix 的运行资格；未来启动前重新比对摘要。

| 目标 | 静态观察入口 | 已观察版本 | 尚未证明 |
| --- | --- | --- | --- |
| Codex | `D:\Users\1\Desktop\Codex.lnk` → `OpenAI.Codex_2p2nqsd0c76g0!App`；CLI 独立位于 `C:\Users\1\AppData\Local\OpenAI\Codex\bin\f71a721e0e6193a9\codex.exe` | 桌面包 26.1103.4239.0；CLI 上轮记录 0.167.0-alpha.3.2，本轮未执行 | app-server 运行资格、Desktop 与 CLI 绑定，不等于接管现有聊天 |
| Claude Desktop | `D:\Users\1\Desktop\Claude.lnk` → `Claude_pzs8sxrjxfjjc!Claude` | 应用包 5.11492.2.0 | 实际 MCP/主动响应/逐执行隔离；PATH 的 claude 是 Claude Code，不替代 |
| DeepSeek Harness | `D:\Users\1\Desktop\DeepSeek Harness.lnk` → `D:\dsh-home\launcher\DeepSeek Harness Launcher.exe`；开始菜单直指 `D:\deepseek\DeepSeek Harness.exe` | 0.2.1-rc.3 | Launcher 实际环境与转发、ACP 入口/版本；不得擅自绕过启动器 |

这些是观察版本，不是“最新版本”判断或生产版本选定。应用包中的 version、原生运行协议版本、平台 core/1.0 和探针 suite revision 是不同概念。

### 3.2 每次实际执行必须有的授权记录

执行前由用户或已有有效授权的控制主体给出以下字段，形成有有效期、精确范围和撤销机制的授权引用；本单本身不签发该引用：

| 字段 | 要求 |
| --- | --- |
| entrypoint / account_reference / session_scope | 具体入口链、匿名认证/计费类型、专属测试会话；不接管当前私人会话 |
| synthetic_dataset_digest | 合成输入/文件/假秘密摘要，不夹带真实项目数据、历史聊天或可用凭据 |
| allowed_tools / environment | 允许的工具、测试目录、SID/ACL/IPC/网络/子进程与故障注入边界 |
| egress_destinations | 可发送的数据类别、精确服务方/目的地和用途；读取、联网不是发送/发布许可 |
| budget_limit / timeout | 单次与累计费用/重试上限、时间盒；未配置不是无限，unknown 成本不是零 |
| stop_conditions / approver / expires_at | 触发停止的条件、批准者、有效期及撤销；不因超时强制交锁 |

系统账号/ACL/网络调整与 API/Embedding 需要各自授权；Embedding 不继承生成模型授权。密钥通过安全配置进入受控进程，不填入 Markdown/JSON/prompt/图状态/日志。

### 3.3 环境、合成输入和同配置证据

- 基线使用 `validation/protocol-fixtures.json` 的 baseline-1；它的四份文件内容和 SHA256 已定义。私密反例使用 `SYNTHETIC_PRIVATE_ALPHA_NO_REAL_SECRET`，明确是假标记。
- 测试环境须可恢复，并隔离日常项目、凭据、缓存、浏览器/测试账户和其他应用进程。当前用户拥有较高工具权限，不代表被测 Worker 可以继承这些权限。
- fingerprint 必须含 compatibility-matrix 已有全部配置字段，并增加入口链摘要、suite/core/授权/数据版本。前后都记录；不同配置样本不拼接成资格。
- 未实现服务/Broker/适配器或未定义认证/传输时，先完成对应工作包；不为填表模拟出一次原客户端成功。
- 运行证据复制设计模板后另存，包含授权引用、实际步骤/结果、执行人/时间、文件/事件/费用/缺陷和摘要。原 NOT_RUN 模板不覆盖。

## 4. 探针目录与依赖

每项的可执行步骤和判据见 [机器可读清单](validation/p0-probe-manifest.json)，字段 `steps`、`pass_criteria`、`fail_or_stop_conditions`、`evidence_required` 不能省略。这里只索引，不重定义另一套操作流程。acceptance_refs 表示关联与证据去向，不声称一个探针就覆盖整项 AT/CA；阶段验收仍按原用例的全部要求执行。

| ID | 探针 | 目标/依赖 | 当前状态 |
| --- | --- | --- | --- |
| P0-01 | 原客户端身份、入口与会话范围 | COMP-1, COMP-2, COMP-3；依赖 P0-12 | NOT_RUN |
| P0-02 | 任务派发与服务签发的执行绑定 | COMP-1, COMP-2, COMP-3；依赖 P0-01 | NOT_RUN |
| P0-03 | 受控产物与跨 worktree 逻辑单写者 | COMP-1, COMP-2, COMP-3；依赖 P0-02 | NOT_RUN |
| P0-04 | shell、插件、生成器与路径旁路 | COMP-1, COMP-2, COMP-3；依赖 P0-03 | NOT_RUN |
| P0-05 | 同成员私密 A 与公开 B 的执行隔离 | COMP-1, COMP-2, COMP-3；依赖 P0-02 | NOT_RUN |
| P0-06 | 进度查询零模型调用与普通输入排队 | COMP-1, COMP-2, COMP-3；依赖 P0-03 | NOT_RUN |
| P0-07 | 等待请求、定向回答与恢复能力分项 | COMP-1, COMP-2, COMP-3；依赖 P0-02 | NOT_RUN |
| P0-08 | 撤权后的真实写能力与旧句柄 | COMP-1, COMP-2, COMP-3；依赖 P0-03 | NOT_RUN |
| P0-09 | 失联、停止与重启对账 | COMP-1, COMP-2, COMP-3；依赖 P0-08 | NOT_RUN |
| P0-10 | 首次模型输入及工具外发边界 | COMP-1, COMP-2, COMP-3；依赖 P0-02 | NOT_RUN |
| P0-11 | 完整检查点与原仓库不可用时恢复 | COMP-1, COMP-2, COMP-3；依赖 P0-09 | NOT_RUN |
| P0-12 | core 契约冻结与服务语义故障清单 | PLATFORM；依赖 无探针前驱，仍需前置授权/环境 | NOT_RUN |
| P0-13 | 用户 API 管家的最小合成能力与成本 | COMP-4；依赖 无探针前驱，仍需前置授权/环境 | NOT_RUN |
| P0-14 | 管家委派、披露、并发与 RAG 恢复 | COMP-4, PLATFORM；依赖 P0-12, P0-13 | NOT_RUN |
| P0-15 | 质量 oracle、留出题与效率阈值预登记 | QA, PRODUCT；依赖 无探针前驱，仍需前置授权/环境 | NOT_RUN |
| P0-16 | 四异常用户流程低成本理解验证 | PRODUCT, QA；依赖 无探针前驱，仍需前置授权/环境 | NOT_RUN |

前 11 项以三目标原客户端分别执行，映射 COMP-1/2/3-P1…P11；不能只测其中一个后推断另外两个。P0-12 是实际契约/服务语义验证，不是当前离线 Schema 通过的别名。P0-13/14 属管家链，不能替代工作客户端资格。

建议批次：先准备 W03 候选、隔离部署/授权及 oracle/异常 UX；实际服务就绪后执行 P0-12；获对应授权后，各原客户端按依赖完成同配置链，管家 C0 独立评估。P0-11 在 G0 链证明最小真实产物与恢复，P1 必须完成完整备份/人工介入/预算/验收保护的 AT-109 闭环；P0-14 的实际图服务故障随 C1/C2 实现验证，P0-15 的质量/效率运行随 P2 完成。**阶段标注不能将 G0 的强制边界后移。**

无授权、无实际执行器或无参与者是未执行的原因，填写 NOT_RUN；执行后按真实结果判定通过/失败/未知，不把缺前置写成产品缺陷或 PASS。安全边界实测失败则阻止该资格；完整目标需自主代码协作而只能人工继续时，按原设计报告完整目标 G0=BLOCKED，由用户决定需求变更。

## 5. PF-04 时序绑定说明

本轮把非法的描述性状态拆为合法 DB 枚举和独立时序断言；不增加 core 枚举，不缩短停止条件。

- `db_assertions.plan.lifecycle=stopping` 的观测点：stop 提交、gate 已关闭、A 的真实启动/停止结果尚未对账时。
- `must_remain=stopping`：从 stop 生效到下列四类证据全部成立前，不得将计划写成 closed，也不得交给新写者 epoch。
- `inflight_permits_reconciled`：关 gate 前已签发但回执未知的每张许可都归入对账。
- `process_tree_and_open_handles_reconciled`：核对进程实例/启动时间、所有相关子进程及旧句柄，不以 PID 或 cancel ACK 替代。
- `write_capabilities_revoked`：证明旧执行及其子进程/句柄不再能写受控资源；仅撤 token 不足以证明。
- `journal_and_files_reconciled`：核对 journal、真实文件、dirty/index、检查点及已交付成果，保留已保存内容。
- 四项成立也不自动 closed；还需按 12 §3 收束全部计划义务、费用及未知项。`after_all` 明确此限制。`forbidden_before_all` 中 new_writer_epoch 是禁止事件，不是 lifecycle 枚举。

现有验证器只检查部分静态结构；新增回归检查会核对合法枚举、时序字段和安全门槛。两者都不能证明未来真实进程已经停止。

## 6. 四异常流程的合成草图

以下是供 P0-16 使用的文本草图，不是实时 UI、不是原客户端反馈、也没有用户测试结果。

### UX-01：连接丢失

卡片：**“连接已丢失，执行结果待核对。”** 下方展示有权读取的最后观测时间与已保存检查点；写入能力未知，不显示已停止。可选安全操作为“查看已保存成果”“请求核对”“暂停新派工”；不提供“超时强制解锁”。

访谈任务：请参与者指出已保存部分、不能确定的部分，以及现在能否把同文件交给另一个成员。记录原话，不先解释正确答案。

### UX-02：部分执行与停止

卡片：**“停止请求已受理；部分执行仍在核对。”** 只显示用户有权查看的分支状态，已验收/已保存/未知分别列示；停止不撤销代码，费用 unknown 保留。另设清楚的受控修复入口，不把“停止计划”做成 reset。

访谈任务：请参与者说明哪些结果仍保留、为何不能马上宣布完成，以及何时可以安全继续不相关分支。无完整权限时不展示隐藏分支数量。

### UX-03：人工修改

卡片：**“先冻结修改范围并保存检查点，再进入人工编辑。”** human_run 获独占后才开放修改；完成后展示真实 diff，影响的依赖需同步/重验。收到通知不等于成员已读或已采用新版本。

访谈任务：请参与者解释进入和退出人工编辑的顺序、需要保存什么，以及为什么不能只点“已通知”就继续集成。

### UX-04：私密约束需要跨成员协作

卡片：**“这项协作需要你批准将选定内容发送给指定成员/服务方。”** 展示精确正文、附件版本、接收者、用途及可能接收的 provider；“批准披露”和“批准计划”分别说明，可在同卡确认但分别留回执。拒绝披露不向其他成员透露私密原因。

访谈任务：请参与者指出实际将分享的内容、收件人/服务方，以及只批准计划是否会转发原私信。

P0-16 的真实反馈记录必须包含匿名参与者角色、同意、草图版本、原始选择/说明、误解、修改与复测。现在没有这些数据，不能标 UX 验收通过。

## 7. 离线验证与交付

从工作区运行以下命令；它们都不启动客户端或调用网络/模型。`-B` 防止在设计目录写 Python 字节码缓存。

```powershell
& 'D:\UAV\conda\python.exe' -B 'D:\Users\1\Desktop\team\plan\tools\test_p0_readiness.py' -v
& 'D:\UAV\conda\python.exe' -B 'D:\Users\1\Desktop\team\plan\tools\verify_design.py' --refresh-combined --write-report --refresh-manifest
& 'D:\UAV\conda\python.exe' -B 'D:\Users\1\Desktop\team\plan\tools\verify_design.py'
```

预期：新增 12 项检查全部通过；完整文档检查 PASS、摘要检查 PASS、33 FR / 190 AT / 60 CA，product_tests=NOT_RUN。负例变异验证只在独立证据副本中进行；每个负例必须返回非零，不能动真实客户端或把故障植入设计源。

来源记录不刷新：本轮没有重新获取外部官方页面。实际接入前仍需针对选定版本核对当时官方资料；旧来源内容不是当前能力证明。目录迁移记录也保持历史原状，不重写历史摘要。

本轮交付后可直接进入授权范围内的 W03 详细实现规划/确定性开发准备；首次启动 Agent、模型调用、隔离环境改动前仍须先获得对应精确授权。未满足 G0/G1 时不通过先做完整 UI 或多 Agent 演示绕开门槛。
