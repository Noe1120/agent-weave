# W07 开发运行器与退出对账 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 将W06同步Broker连到实际开发进程，覆盖受控启动、授权patch、只读进度、停止/超时/失联/重启对账和用户路径走查；原生UI继续延后。

**Architecture:** RunnerController持有执行grant与DB权威，固定配置/哈希的开发worker只提交JSONL事件。独立.NET RunnerHost复用现有ProcessJob，先纳入Job再发送启动输入；停止时先撤grant、再终止并查询Job活动进程数。持久化日志与读投影不调用worker；真实原客户端入口一律未启用，不把开发worker冒充客户端。

**Tech Stack:** 现有Node24.14.0/TypeScript/SQLite、.NET10.0.404、Windows Job Object；无新包依赖。

**Spec:** plan/02、03、04、05、09、12；W06-CONTROLLED-BROKER.md；用户已授权继续普通可逆开发，遇错查根因，UI最后。

## Global Constraints

- 不启动原Agent、不调用模型API、不更改Windows账户/ACL/网络策略。真实目标仍Codex/Claude Desktop/DeepSeek Harness。
- Development-only进程以当前用户运行，不宣称安全沙箱；Job只是所属进程生命周期控制。
- 无公开Runner HTTP/MCP入口。worker拿不到grant/token、DB或Broker项目路径；这不等于它在同用户OS下无法探知路径。
- 限定UTF-8 JSONL/64KiB frame、逐运行事件上限、超时和bounded诊断；异常必须可见，不能通过静默截断变成功。
- 取消先撤执行授权，未知退出/恢复不能释锁；进程完成与任务通过验收分开。
- 001–003不改，只新增004；旧0.3.0便携包不重发，新增schema不能被旧包打开。
- 源码快照在evidence/w07/2026-11-14-runner/before；无主Git仓库，不伪造提交；仅作者自审。

## Task 1 — 持久化协议与固定开发入口

Files: runner-protocol.ts、runner.ts、004_runner.sql；修改domain.ts/store.ts；tests/runner.test.ts、runner-helpers.ts。

Interfaces: `RunnerController(store,broker,profile,now?)`；`start(token,{execution_id,claim,adapter:'development_fixture',input,timeout_ms})`；`read(observerToken,project,id)`；`stop(observerToken,project,id)`；`recoverOrphans()`可信进程恢复调用。

- [x] 写RED：真实客户端名称、任意路径/命令/未知字段、配置哈希变化在派工前拒绝；无进程、无claim效果。
- [x] 004记录execution/state/run/grant/scope/claim/profile指纹、events序号/摘要/ack；执行ID与run唯一，重试不启动第二进程。
- [x] start按runner_start和Broker授权求交，观察/停止使用独立supervisor授权；撤worker不剥夺主人查看故障的能力。
- [x] frame严格验证、单调序号、相同事件重放相同ack，payload变化拒绝；worker不能伪造宿主退出证明。

## Task 2 — Windows生命周期宿主与Broker联动

Files: packages/runner/RunnerHost.csproj、Program.cs；增强packages/desktop/Core/ProcessJob.cs；runner-host.ts；tests/fixtures/runner-worker.mjs、runner-process.test.ts；scripts/build-runner.ps1。

- [x] 写RED：启动后真实worker提patch并得到真实checkpoint；progress读操作不增加worker输入、DB事件或模型调用。
- [x] 宿主隐藏启动、参数数组、最小环境、私有cwd；固定worker在收到begin前不执行任务，Job.Add成功后才发送begin。
- [x] ProcessJob增加终止/ActiveProcesses核对，宿主输出独立exited证明；主worker成功还需完成事件、合法权限与Broker.finish才进入in_review。
- [x] 测试stop/timeout/畸形输出/过量输出、主worker退出但孙进程仍活、宿主异常死亡、控制器EOF；只回收所属进程，不杀用户已有Node/Agent。
- [x] 未观察到可信Job空证明则UNKNOWN并保留锁；即便已知开发进程结束，取消claim仍保留锁等待正式恢复，不自动给另一任务。

## Task 3 — 恢复、真实流程走查与全量回归

Files: tests/runner-walkthrough.mjs、tests/fixtures/runner-controller-crash.ts；README与plan源章/派生文件、evidence记录。

- [x] 实际控制器进程强制退出后重开DB，活动执行标UNKNOWN、撤权并隔离；不按旧PID杀进程/重派工/释放锁。
- [x] 走查：创建任务→启动→看进度→修改/checkpoint→待评审；另一路停止后仍能看见原因和保留证据；重试不产生重复执行。
- [x] 全部Node/编译冒烟、原生14组回归、Runner宿主构建/格式、P0与设计检查；原UI布局与旧包哈希保护。
- [x] 交付统计/变更清单/真实日志；产品250 AT/CA、客户端兼容/OS隔离/正式冻结状态不提升。

## 后续门槛

本阶段仅完成真实开发进程链路。实际客户端接入前仍需固定版本官方协议、同配置能力矩阵、首次外发授权和Win-SID-Broker-1探针；不以Job/单用户fixture代替强制隔离。后续继续依赖/授权资料/管家/灾备，原生UI最后。

## 参考项目研究补充 · 2026-11-14

用户指定 Agents Anywhere 后完成[定向源码研究](research/2026-11-14-agents-anywhere.md)。W07仍只管理自己启动的开发进程。未来原客户端 `attached_session` 与当前 `owned_process` 必须区分：断开附着不杀客户端，不把会话断开当作写权撤销或 Job 空证明。此补充是实现约束；W07自有开发进程已实现，附着适配器仍未实现，也不开放原客户端启动/探针/安装权限。

## 实施结果 · 2026-11-14

**状态：开发态限定范围已实现并验证；不是产品G0/G1或原客户端验收。** 本阶段没有新增依赖、修改WPF布局、重发便携包、启动原Agent、调用模型或改变Windows安全策略。源码schema 4；既有0.3.0包schema 2，禁止降级打开数据库。

### 可信进程内接口与安全边界

- RunnerController(store, broker, profile, now?)；start(token, request)、read(observerToken, projectId, executionId)、stop(observerToken, projectId, executionId)、recoverOrphans()、shutdown()。recoverOrphans仅供可信单控制器启动，不是可供外部调用的恢复接口。
- start只接受execution_id、claim、adapter、input、timeout_ms。claim包含project_id/workspace_id/scope_id/claim_id/expected_task_revision/lease_ms；adapter固定development_fixture，input仅固定scenario枚举。timeout_ms在200与lease_ms之间，lease_ms最多300000。不能传任意命令、环境、cwd或原客户端名称。
- profile由可信装配代码指定dotnet、node、host、deps、runtime、worker的绝对路径及SHA256，以及scratch_parent；派工预检查与claim后启动前再次验哈希。worker不接收执行token、DB位置、Broker仓库路径，但同用户进程仍有OS访问能力，因此不是强制隔离。
- worker帧仅progress/patch/complete；严格字段、UTF-8、64KiB单帧、4096字节进度文本、序号1–256。控制器逐运行计入重放总计256帧/1MiB；同序号同载荷返回相同ack，改载荷拒绝，服务端稳定派生Broker action_id。
- supervisor读/停止权限与worker授权独立，逐次检查scope/task/candidate和依赖引用的可见性。read只读DB，无IPC或DB写入；报告中的worker_reported不等同平台证明。
- 只有complete事件、退出0、原生Job空证据和Broker.finish同时成立才记succeeded并进入in_review。停止/失败保留锁与running/WIP任务；UNKNOWN不能证明停止，重启不自动恢复执行、不用陈旧PID杀进程。

### 根因与回归

1. 输出洪泛令重复ACK积压，EPIPE曾遮蔽原始输出上限错误；改为ACK前计量所有帧/字节并及时停止，保留原生退出证据。
2. Runner成功记录与Broker交接原来不在同一事务；注入写库失败可留下已释放claim。现在可信finish回调在释放事务内记执行成功，任何失败整体回滚并隔离。
3. spawn后持久化失败曾未登记进程生命周期，shutdown无法等待并回收；现在先保存内存handle/退出promise，再进行可失败的持久化，异常进入撤权/停止路径。用真实独立控制器进程回归，不靠mock掩盖。
4. 初次迁移RED测试在意外打开Store后未关闭导致清理失败；测试用例现显式关闭意外成功的Store再断言。被拒绝清理的历史临时目录保留，未重试删除，不包含在交付/上传清单。

详细红绿日志在工作区 evidence/w07/2026-11-14-runner；作者自审，不冒称独立审查。

### 验证与复现

- npm run verify：177项Node测试、0失败/0跳过；9个契约生成物无漂移，格式/类型/旧Web语法、RunnerHost构建、编译服务与回环/迁移/端口关闭冒烟通过。SQLite实验性警告保留可见。
- npm run test:native：14/14 C#组及1项WPF静态测试；npm run test:native:package：旧包989个文件哈希通过、包内无数据库。没有重新打包。
- RUNNER_EVIDENCE指定一个不存在的新目录后运行npm run test:runner:walkthrough。最后一次编译后端走查在 evidence/w07/2026-11-14-runner/walkthrough-closeout：成功→in_review/0锁；停止→USER_STOP/3锁；畸形输出→PROTOCOL_JSON/3锁。三者均有可信Job空观察，失败仍保留隔离。
- plan/tools/verify_design.py重建合订/报告/摘要后只读复核；plan/tools/test_p0_readiness.py -v验证12项离线准备检查。250项AT/CA仍NOT_RUN，客户端/OS隔离仍UNVERIFIED，正式冻结仍NOT_FROZEN。
- 完整交付、变更摘要、保存性检查及命令日志以工作区 evidence/w07/2026-11-14-runner/COMPLETION.md 为索引。

### 尚未完成与进入下一阶段的条件

当前无原客户端适配器、公开派工接口或UI执行按钮。没有验证附着会话、强制写权限撤销、完整灾备/生产升级/跨任务依赖、授权检索或管家；也未进行原生窗口点击/视觉验收。接下来先准备能力登记与接入边界，只有取得固定版本协议证据、获准的最小合成数据/操作范围及同配置探针结果后，才启用相应原客户端能力。先补后端、最后设计原生UI。

用户提供Noe1120/agent-weave后要求先完成本阶段。本轮未进行远端检查、Git初始化或上传；后续上传需排除第三方研究checkout、运行凭据/数据库和构建缓存，先检查远端内容，不强制覆盖。
