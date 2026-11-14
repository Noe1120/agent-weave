# W07 开发运行器与退出对账：阶段交付

日期：2026-11-14（Asia/Tokyo）。**限定开发范围已完成并验证；完整产品未完成。**

按用户最新要求先完成当前构建，没有转去上传仓库。原生UI设计继续延后，不启动原Agent、不调用模型、不改变Windows身份/ACL/网络策略。本记录为作者自检，不是独立代码审查或安全认证。

## 1. 实际完成

- 在W06 DevelopmentBroker之上新增可信进程内RunnerController、严格JSONL协议及独立.NET RunnerHost。唯一启用的适配器是development_fixture，绑定模式为owned_process；没有任意命令入口、真实客户端适配器、HTTP/MCP派工接口或UI执行按钮。
- 固定路径/哈希配置在领取前及spawn前校验；worker在Job分配成功后的begin输入之前不执行任务。进程只获得最小环境和独立scratch cwd，不接收执行token、DB或Broker仓库路径。当前用户OS访问能力仍在，绝非安全沙箱。
- 004迁移持久化执行与事件；稳定执行ID和序号/载荷指纹约束重试，重复patch复用同一Broker action/回执，不重复Git检查点。未知字段、原客户端身份、越权patch、伪造退出、乱序、非UTF-8及输出超限显式失败。
- 独立supervisor授权读取/停止，逐次校验scope及派生资源权限；read只读DB，不发IPC、不改事件或触发模型。进度标注worker_reported。
- 停止、超时、撤权、过期先撤执行grant，再终止所属进程树，原生宿主查询Job空作为退出观察。宿主死亡/控制器崩溃后未知执行隔离保留锁，重启不自动派工、不按旧PID杀进程。
- 只有完成事件、退出0、可信Job空、当前授权与Broker.finish都成立时，执行才succeeded、任务才进入in_review；成功记录与释锁同一事务。停止/失败仍保留running/WIP任务及隔离锁，不伪装任务取消、交接或验收通过。

## 2. 从用户动作顺序走查的结果

使用最终编译服务、独立合成数据库/仓库和真实开发子进程，依次执行可信任务准入、启动、查询、写入/检查点、待评审；另行覆盖停止及坏输出。不通过UI或原Agent，不能称为完整原生用户验收。

| 场景 | 执行状态 / 原因 | 任务状态 | 保留逻辑锁 | 可信Job空 |
| --- | --- | --- | --- | --- |
| 正常完成 | succeeded | in_review | 0 | 是 |
| 运行中停止 | stopped / USER_STOP | running/WIP | 3 | 是 |
| 畸形输出 | failed / PROTOCOL_JSON | running/WIP | 3 | 是 |

正常路径保留2个真实Git提交（初始+补丁）、实际文件、Markdown、diff、journal与changeset。重复start不产生第二执行；连续20次进度读取不增加数据库变更。停止后撤销worker授权，合法观察者仍可读取故障与保留证据。

最新证据：[report.json](walkthrough-closeout/report.json)、[journal](walkthrough-closeout/journal.json)、[changeset](walkthrough-closeout/changeset.json)、[走查日志](walkthrough-closeout.log)。前序walkthrough-final/和walkthrough-verified/保留历史，不用旧证据替换当前结果。

## 3. 找到根因后修复，而非跳过检查

| 问题 | 根因与处理 | RED / GREEN |
| --- | --- | --- |
| 输出洪泛最终错误被遮蔽 | 重复ACK积压，宿主退出后管道关闭覆盖原输出超限；改为ACK前计量全部帧/字节并及时停止，保留原生退出证据 | faults-first-run.log / green-flood-transaction.log |
| 成功记录失败后已经释锁 | Runner持久化与Broker.finish不在同一事务；可信回调现在处于释锁事务内，写库失败整体回滚并隔离 | faults-first-run.log / green-flood-transaction.log |
| spawn后写库失败丢失回收责任 | live handle及退出promise登记太晚；现先登记生命周期再进行可失败写入，异常进入撤权/停止 | red-startup-cleanup.log / green-startup-cleanup.log |
| 迁移RED测试遗留打开的DB | 意外成功的Store在断言抛错前未关闭；现在显式close后再断言失败 | red-migration.log、red-migration-assertions.log / green-migration.log |

原迁移/冒烟测试仅将当前schema数量3→4、未来未知版本4→5；历史回滚断言保留。没有删除失败断言、跳过用例或隐藏SQLite实验性警告。

## 4. 验证结果

| 检查 | 结果 | 当前日志 |
| --- | --- | --- |
| npm run verify | 177/177 Node测试，0失败/0跳过；比W06新增27项 | [verify-closeout.log](verify-closeout.log) |
| 契约/格式/类型/旧Web语法/编译冒烟 | 9个生成物无漂移；编译服务、schema 4及回环端口关闭通过 | 同上 |
| RunnerHost构建 | 0警告、0错误 | 同上 |
| npm run test:native | 14/14 C#组 + 1项WPF静态检查 | [native-closeout.log](native-closeout.log) |
| 旧便携包 | 989文件通过既有manifest；包内0数据库；未重建 | [package-closeout.log](package-closeout.log) |
| 编译后端走查 | 成功/停止/畸形输出三条路径通过 | [walkthrough-closeout.log](walkthrough-closeout.log) |
| P0离线准备 | 12/12，非真实客户端探针 | [p0-closeout.log](p0-closeout.log) |
| 设计重建与只读复核 | 44文件/43摘要条目、33 FR、190 AT+60 CA定义完整 | [design-refresh-closeout.log](design-refresh-closeout.log)、[design-verify-closeout.log](design-verify-closeout.log) |

机器可读结果：[verification-summary.json](verification-summary.json)。所有开发测试与250项产品验收分开登记。

## 5. 修改范围与保存性

源码/文档基线139文件，现157文件；**新增18、修改19、删除0、原样120**。详细相对路径及前后SHA256见[changed-files.json](changed-files.json)，完整当前清单见[source-manifest.json](source-manifest.json)。不计入node_modules、SDK、dist、artifacts、bin/obj、运行数据或evidence目录；这不是可直接上传的全目录许可清单。

主要实现：packages/service/src/runner.ts、runner-protocol.ts、runner-host.ts、migrations/004_runner.sql；packages/runner/Program.cs与RunnerHost.csproj；scripts/build-runner.ps1；Runner测试/夹具/编译走查。既有Broker追加可信生命周期核对与事务内成功回调，domain/store接入004；ProcessJob仅增加Terminate/ActiveProcesses能力。

保存检查：[preservation-check.json](preservation-check.json)。139份before快照哈希一致；47个受保护文件保持字节一致，包括001–003迁移、契约/生成物、验证矩阵/语料、原生界面与测试、旧Web及依赖固定文件。WPF布局不改；ProcessJob是明确的附加核心能力变更，已有14组原生回归复验通过。原0.3.0包依既有manifest校验通过。

同步了根README、plan导航/交接、03/04/05源章、W07计划、CHANGELOG及Agents Anywhere研究的后续状态；合订版/报告/摘要由工具重建，不手写派生文件或提升验收状态。研究只参考固定提交的定向源码，没有执行或导入参考实现。

## 6. 明确未完成与操作边界

- 250项AT/CA仍NOT_RUN；原客户端兼容和OS强制隔离UNVERIFIED；正式契约冻结NOT_FROZEN。
- 原始Codex、Claude Desktop、DeepSeek Harness未启动/调用；不以Claude Code/SDK代替Claude Desktop。未来attached_session与owned_process分开，断开会话不等于终止客户端或撤销写权。
- 当前是合成开发进程，未完成原客户端自动派工、强制写权撤销、跨任务依赖交接、授权检索、管家、费用核算和完整灾备。没有承诺任意应用的安全启动隔离。
- 原生UI未进行点击/视觉走查，先前Team窗口Computer Use权限限制不绕过。UI设计按用户要求延后。
- **源码schema 4；旧0.3.0便携包schema 2。没有发布新包，没有打开/升级用户实际数据库；禁止用旧包打开升级库。**
- 先前被拒绝的清理不再尝试：W04的qa-runtime证据、C:\Users\1\AppData\Local\Temp\team-w03-RQjouN，以及本阶段RED迁移测试遗留的C:\Users\1\AppData\Local\Temp\team-w03-ZePDSS。它们被保留、未绕过工具重试，不进入源码/分发/上传清单。
- 用户授权后续上传Noe1120/agent-weave，但最新指示优先完成当前构建。本轮没有访问远端、初始化工作区Git、提交或推送。第三方参考checkout及其嵌套.git不能作为我们的源码上传，合成证据仓库也需另行筛选。

## 7. 下一阶段进入条件

先准备原客户端能力登记与适配边界，再按明确授权范围开展固定版本、最小合成数据、同配置的探针。Codex只读跟随与DSH原客户端插件桥仅是研究线索，Claude Desktop单独验证；连接成功不等于发送/审批/取消/写入都可用。只读观察不resume/接管，不确定发送不自动重试。

真实写入资格仍须满足P0/G0/G1、执行grant与资源边界、外发授权和Win-SID-Broker-1的可靠证据。其余后端依赖/授权资料/管家/灾备继续逐阶段实现，原生UI最后设计。后续上传先检查远端现有状态、许可证、体积与敏感内容，不强制覆盖。
