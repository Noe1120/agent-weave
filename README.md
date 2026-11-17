# Team · 原生 Windows 工作台

## 最新验证 · W24 真实无模型生命周期通过（限定本次固定配置）

已按本次单独授权完成一个新隔离Codex 0.167.0-alpha.3.2实例及一个thread：真正桥初始化/工具发现各1次，工具调用0、turn=null、generation=0、回环provider请求0。桥stdin_eof=true且自然exit0；持有Windows实际进程句柄证明relay先自然exit0，再关闭Codex根进程并观察exit0/非强制。原客户端清单保持，未读取用户历史/复用provider凭据/改CC Switch。删除隔离home能力配置1份（桥配置由工厂另清除），限定扫描75文件零残留。

全量675/675（0失败/0取消/0跳过），原生14+1、旧包989文件、P0 13项及设计校验通过。本次授权已使用，不追加实例或turn；没有付费调用。见[真实记录](evidence/codex-relay-binding/NO-MODEL-ACCEPTANCE.md)与[脱敏报告](evidence/codex-relay-binding/no-model-report.json)。**W20仍FAILED**：此次证明新方案的固定配置无模型收尾，不是旧联合验收补签，也不证明所有重连/崩溃情形。下一关为同配置真实单任务只读＋撤权＋严格退出联合验收，涉及必要provider复用和一次计费turn，须另有具体授权/预算，当前不执行。HANDOFF冻结，管家未构建。

## 当前阶段 · W24 原客户端 relay 绑定准备（离线完成，真实验收待授权）

在D盘主工作区继续完成W23/W24：平台拥有真正MCP桥，Codex仅通过固定relay入口连接；新增默认关闭的`relay_binding`与`prepareClient`，不替换原客户端、不切换既有接入。未认证显示waiting，未消费能力到期明确失败；有序关闭必须取得桥EOF/exit0、外部relay独立OS退出证明，再关闭自有宿主。合成走查完成实际本项目任务读取与凭据清理，不代表真实Codex已通过。

最终`npm run verify` **673/673**，0失败/0取消/0跳过；编译工厂专项14/14、编译启动器禁止spawn预检PASS，原生14+1、旧包989文件、P0 13项、设计63文件/62摘要通过。修复能力过期后ready悬挂与未绑定误显示open等根因，没有放宽校验。见[W24方案与装配步骤](plan/W24-CODEX-RELAY-BINDING.md)及[分层证据](evidence/codex-relay-binding/COMPLETION.md)。HANDOFF保持冻结。

下一步需要新的具体授权：一个新独立Codex实例、一个新thread，仅无模型生命周期验收；空home、回环拒绝模型端点、不复用provider凭据、不发送turn、不接管旧实例。先准备并验证单次opt-in实测装配，再运行一次；失败不自动重试。重点验证原客户端实际relay启动/重启行为、Windows持句柄退出顺序和临时配置副本清理。当前尚未启动此实测；W20真实联合验收仍**FAILED**，不以合成结果追认。管家未构建，Windows隔离实测继续暂缓，真实点击/生产灾备/签名升级及250项产品验收仍未完成。

## 当前阶段 · W23 受信桥运行装配（合成完成）

W21/W22模块已纳入service构建，增加固定入口/代码摘要、最小环境、授权复查、所属进程关闭与临时凭据清理；不自动启用、不启动原客户端/模型。全量667/667，工厂编译专项12/12，原生14+1、旧包989文件、P0通过。修复报告硬链接接受、abort首次原因覆盖和认证未就绪即返回的问题；失败反例保留。方案见[W23](plan/W23-OWNED-BRIDGE-RUNTIME.md)。HANDOFF冻结，W20失败结论不变，管家不构建。下一步继续原客户端配置/生命周期组合的离线准备，不在这里等待重复确认。

## 当前阶段 · W22 认证本机转发（离线合成完成）

已在W21上完成最小单连接认证转发、单实例绑定、双向上限/背压、断线和崩溃后旧能力拒绝。实际合成链为stdio relay子进程→认证回环连接→平台监督器→本项目MCP桥→CoreService任务读取；严格验证桥→relay→所属Node宿主关闭顺序。仅tests装配，不启动原客户端/模型，不改生产启动器、UI或管家；HANDOFF冻结，W20真实FAILED不变。

最终全量`npm run verify` **654/654**（0失败/0跳过），新增专项及编译桥走查各29/29；原生14+1、旧包989文件、P0 13项、设计61文件/60摘要通过。反例发现并修复输出累计上限、超时监听清理、连接重置分类、最终写出错误被closed吞掉及relay退出原因丢失；失败日志保留，没有放宽断言。见[W22方案](plan/W22-LOCAL-BRIDGE-RELAY.md)及[完成记录](evidence/bridge-relay/COMPLETION.md)。

下一入口是受信生产装配准备（固定入口/秘密传递/所属进程生命周期），先合成验证；真实客户端无模型验证和付费联合验收仍各需新的具体授权。本轮不证明厂商自动重启行为、Windows身份隔离或生产发布资格，250项AT/CA仍NOT_RUN。

## 当前构建 · W21 桥生命周期离线原型

已实现平台持有真正MCP桥的tests原型：停止准入→排空在途→真正桥EOF/exit0证明→关闭自有宿主。14项专项覆盖正常顺序与故障；合成操作路径使用本项目桥/HTTP授权读取/SQLite任务，宿主是独立Node夹具，不是原客户端。编译桥专项14/14；不接真实启动器、不调用模型。方案见[W21](plan/W21-BRIDGE-SUPERVISION.md)，分层证据见[完成记录](evidence/bridge-supervision/COMPLETION.md)。W20 FAILED保留，HANDOFF冻结，管家不构建。

下一入口：受认证本机转发端、单实例绑定、背压/断线及崩溃恢复的离线合成装配。本轮尚无这些生产传输能力，不代表真实Codex收尾已修复；新增真实客户端无模型验证和付费联合验收仍分别需要具体授权。下方W20及两次诊断是历史记录，不作为继续消耗旧授权的依据。

最终全量`npm run verify` **625/625**（0失败/0跳过），编译桥专项14/14，DSH会话专项37/37，原生14+1、旧包989文件、P0 13项、设计60文件/59摘要通过。保留编译桥13/14及一次全量624/625失败记录：分别定位到宿主超时用例拒绝订阅时序/预算、DSH持管道用例误压根退出预算，稳定复现后仅修测试装配，未隐藏错误或改变生产关闭逻辑。250项AT/CA仍NOT_RUN。

## 最新验证 · thread/unsubscribe不能解决MCP收尾

用户新批的单实例无模型实验已完成：对本次自有thread发送一次thread/unsubscribe，收到unsubscribed；随后观察10秒，桥未退出。再关闭宿主，宿主exit0/非强制，桥仍exit1、stdin_eof=false。无turn（generation0/turn=null）、无工具调用、本地provider请求0、未复用用户凭据。临时配置删除2份，75文件扫描零残留，原客户端清单不变。**该候选方案未通过，不合入生产关闭路径，不追认W20通过。**

下一步不再盲试重复启动：需要明确是否采用平台持有MCP桥进程/stdio并协调排空、EOF和退出对账的方案；先离线设计与合成验证，再申请必要的真实实测。既有strict EOF/exit0门槛保留。证据见[unsubscribe验证](evidence/codex-joint/UNSUBSCRIBE-DIAGNOSIS.md)。README实时更新，HANDOFF冻结，管家不构建。

本轮回归611/611，0失败/0跳过；原生14+1、旧包989文件、P0 13项、设计59文件/58摘要通过。生产关闭行为未改，候选失败记录完整保留。

## 最新诊断 · W20 MCP退出（无模型，已执行）

本次新授权仅启动1个独立Codex实例并创建1个thread；没有prompt/turn、没有复用provider凭据。本地拒绝端点请求数0，MCP工具调用0。通过退出前持有Windows进程句柄观测：发出宿主stdin EOF后，**MCP桥exit 1（10:39:50.621Z），宿主exit 0（10:39:50.655Z）**，桥报告仍stdin_eof=false/fault=null，宿主非强制退出。这排除了“桥只是还没退出”解释，证明宿主正常退出不能代表MCP正常收尾；尚无厂商内部调用栈，不把exit1单独断言成具体TerminateProcess调用。

原12进程保持，2份临时配置已删除、75文件扫描零桥凭据残留，未读取原聊天或全局provider配置。原诊断报告误将initialize计入requests，导致no_turn=false：已用真实本项目协议夹具复现并纠正计数（initialize独立，thread/start使requests=1），保留原报告、不再启动真实客户端补测。另修复测试读取活跃report引起Windows rename竞争：用MCP ping协议屏障替代轮询；12次合成重复通过。详见[退出诊断](evidence/codex-joint/EXIT-DIAGNOSIS.md)。W20真实联合验收仍FAILED，不拼接无模型证据升级；HANDOFF保持冻结，管家不构建。

本轮全量610/610（0失败/0跳过）、原生14+1、旧包989文件、P0 13项及设计校验通过。固定本地schema存在thread/unsubscribe，可作为下一无模型收尾实验候选；尚未调用，不声称已修复真实退出。

## 当前构建 · W20（真实只读/撤权闭环已验证，严格收尾验收未通过）

用户同意沿用现有CC Switch路由、必要凭据复用至新隔离home、一个自有Codex实例、最多一次合成task_get turn、联合撤权/退出/清理；30,000 tokens软停止，失败不付费重试。不动已有实例/历史/全局配置，不改HANDOFF.md。先零成本回归与只读本机配置摘要核对，再消耗本次授权；金额UNKNOWN。

已完成一次真实原客户端/真实模型运行：邀请→兑换→自有thread→W17最小任务grant→task_get恰好1次、0工具错误→原生复述同task与draft→turn completed→撤销连接后旧task授权拒绝→撤销控制grant后closed、exit0、非强制。用量18,205 tokens（输入18,087/输出118），金额UNKNOWN，未触发30,000软阈值。原12个客户端进程清单与原配置摘要未变，删除2份配置副本，限定目录扫描2,524文件零凭据残留。

**严格判定仍FAILED：** MCP桥的最终记录`stdin_eof=false`。宿主退出不等于桥优雅收尾；后续只读复查没有本次bridge进程、报告也未更新。已用零费用本项目MCP子进程对照验证：stdin.end正常留下EOF，强制终止留下false；实际厂商内部如何终止子进程尚无直接证据，不能冒称已证明根因或改PASS。授权已消耗，未追加原客户端启动/模型turn。详见[W20](plan/W20-CODEX-JOINT-ACCEPTANCE.md)及[证据](evidence/codex-joint/COMPLETION.md)。下一决策是是否另行授权**无模型**的自有Codex thread＋MCP退出诊断；现阶段不自动重跑计费验收。

预检另修复Windows JSON UTF-8 BOM解析问题，保留启动前失败记录（0客户端/0turn）；独占marker已移到实际start前，修复后才执行上述唯一真实turn。原失败报告的source_config_unchanged=false来自未采集摘要，不是原配置被改写；不覆盖旧证据。HANDOFF.md保持不变。

最终回归：`npm run verify` **608/608**，0失败/0跳过；原生14+1、旧包989文件、P0 13项、设计59文件/58摘要通过。合成通过不覆盖上述真实桥EOF失败。

## 当前阶段 · W19（控制器观测桥合成集成已完成）

已有Codex控制器→W17只读授权的观测桥已完成合成集成：固定所属instance/thread，逐次校验实际控制器持有的夹具进程状态，不发turn。全量595/595（0失败/0跳过，本阶段新增13项），相关专项77项、编译HTTP走查、原生14+1、旧包989文件、P0文档13项和设计校验通过。修复了同步观测跨毫秒导致误判未来时间的问题，保留未来/过期检查。仅development_fixture，真实客户端模式明确拒绝；不是上线资格。W18已发布e010ee9，HANDOFF.md保持不变。见[W19](plan/W19-CONTROLLER-OBSERVATION.md)与[证据](evidence/controller-observation/COMPLETION.md)。

以上W19描述保留历史范围；W20新增单次受信验收许可并实际运行，当前结果见本页顶部。DSH/Claude长期控制器、Windows隔离、真实点击、生产灾备和签名升级仍未完成；管家仍暂停。

## 当前阶段 · W18（登记诊断与重新邀请已完成）

主人连接诊断与显式重新邀请已实现：区分成员变化、签名键变化、邀请/凭据到期和撤销；原子替换旧登记，失败回滚、同动作重试、不复活旧任务授权。全量582/582，连接相关78项通过（本轮新增24项），编译HTTP走查、原生14+1与旧包989文件检查通过。工作区仍为D盘，HANDOFF.md冻结；0原客户端启动/模型调用/窗口点击，不变更Windows隔离、不构建管家。见[W18](plan/W18-CONNECTION-REINVITE.md)及[证据](evidence/connection-reinvite/COMPLETION.md)。

下一步自动推进真实控制器只读观测桥的**合成集成**；实际原客户端与计费模型仍不启动。登记诊断不是客户端实时健康，重新邀请不是重新授权执行任务。

## 当前阶段 · W17（合成只读授权内核已完成）

在 `D:\Users\1\Desktop\team` 继续连接管理后端：受信会话观测与单任务只读 grant 绑定，连接撤销/过期/成员变化/会话失联后逐次拒绝读取，服务重启后不自动恢复授权。先做合成数据验证，不启动原客户端、不调用模型、不开放写入或私密执行。计划：[W17](plan/W17-CONNECTION-TASK-ACCESS.md)。

本轮按用户要求暂停 `HANDOFF.md` 更新，实时进度以本 README 为准。验证：全量 `npm run verify` **558/558**（0失败/0跳过），含41项新增专项；编译后真实回环 HTTP 走查完成邀请→兑换→可信合成授权→100次连接与任务读取（0写入）→撤销→旧token拒绝。原生14+1、旧包989文件、P0文档13项及设计校验通过。见[交付证据](evidence/connection-task-access/COMPLETION.md)。

**范围限定：**可信进程内准备 policy/run/resource ACL，再签发最长5分钟的单任务只读授权；无公共签发/派工接口，不自动把任务草稿变成执行任务。会话观测目前是合成装配，不是已接通真实 controller；不证明原客户端在线或生产外发资格。schema4、旧包和用户数据库未改。

**下一阶段：**连接状态/失败原因的主人只读投影与显式重新授权流程，然后接入真实控制器并按具体授权验收。Windows 隔离部署/实测继续暂缓；附着会话、原生点击、生产在线/离机灾备、签名安装升级仍待交付；190 AT + 60 CA仍NOT_RUN，原生 UI 最后，管家不构建。

最新阶段：[W16 连接登记](plan/W16-CONNECTION-REGISTRATION.md)。主人可创建限成员/配置邀请、兑换登记凭据、查询与撤销；凭据仅可读自己的登记状态，不是任务授权或原客户端在线证明。无新数据库迁移，不启动原客户端；Windows 隔离实测暂缓，管家未构建。

最新后端增量：[W15 受保护运行管理](plan/W15-RUNTIME-GATEWAY.md)。既有 DSH/Codex 控制器可通过显式可信装配接入 HTTP 生命周期通路；默认服务仅可读取已获授权的运行记录，不自动启动原客户端。状态与控制使用不同权限；未知状态不自动恢复。生产连接管理、Windows 隔离和原生点击仍需完成，管家未构建。

**0.3.0：WPF 原生界面，独立窗口和任务栏入口，不使用 Electron、WebView 或浏览器内核。** 保留原 W03 核心服务和 W04 的本地工作台能力；不是已经接通原 Agent 的完整产品。

## 仓库与当前状态

仓库保存源码、设计和[已审核的阶段文本证据](evidence/README.md)，不附带SDK、node_modules、数据库、第三方研究副本或便携包。新克隆请先按下方“开发构建”准备固定运行时并运行验证；不要把本机已有的artifacts路径当成仓库内下载文件。

当前已继续完成[W08能力与适配基础](plan/W08-ADAPTER-FOUNDATION.md)、[W09依赖与授权资料](plan/W09-DEPENDENCIES-KNOWLEDGE.md)、[W10本机离线灾备基础](plan/W10-OFFLINE-RECOVERY.md)，停在管家Agent之前。后续工作直接沿用[AGENTS.md](AGENTS.md)，不重复确认既有要求。

## 原客户端接入交接 · 2026-11-16

**下一位实施者 DSH 请从 [connect.md](connect.md) 开始。** 文档整理 W11/W12 的 DSH 接入方法、W13 的 Claude Desktop＋CC Switch me 路由接入步骤、真实验收与失败经验，并给出 Codex 接入任务和完成判据。DSH 是开发实施者，Codex 是被接入对象；本轮只整理文档，不启动原客户端。

当前 DSH 已验证初始化及独立空会话；Claude 已完成一次真实合成 task_get 往返，仍不是完整生产连接器。Codex W14 已由 DSH 完成固定配置下的一次真实单任务只读往返（22,331 tokens，金额 UNKNOWN）；历史默认配置失败不追认修复，真实厂商同次撤权未执行，另由零成本夹具覆盖。详见 [W14](plan/W14-CODEX-APP-SERVER.md)。原生 UI 最后，管家不构建。

## 管家方案版本

用户已确认修改后的[管家方案](plan/11-coordinator-agent.md)及关联源章为最新版（coordinator-core-review-1），本分支已纳入；这是设计确认，不是开始构建管家的授权。后续接入顺序以最新交接和 connect.md 为准，原生UI最后设计。

## DSH 接入增量 · 2026-11-15

已实现[W11初始化生命周期](plan/W11-DSH-ACP-LIFECYCLE.md)：固定官方DeepSeek Harness安装，独立空home，ACP initialize、能力观测、授权只读状态和所属进程关闭。编译后控制器已用本机0.2.1-rc.3完成真实初始化→1000次读取（零DB写入）→正常退出；没有会话、prompt或模型调用，也没有附着已有Desktop聊天。

这是可信进程内后端模块，**不是已接通真实任务的完整Agent，也未接入UI/HTTP/MCP**。原生界面和旧包不变，资格仍UNVERIFIED。默认验证只跑合成夹具；真实走查必须显式授权并传入固定配置。详见[阶段交付](evidence/dsh-lifecycle/COMPLETION.md)。

[W12独立新会话探针](plan/W12-DSH-SESSION-PREFLIGHT.md)已按单独授权完成：真实initialize → session/new（空MCP）→ session/close → EOF退出0，原6个Desktop进程未变。没有prompt或旧凭据；这是独立验收工具，生产适配器仍只开放initialize，执行资格未升级。证据见[evidence/dsh-session](evidence/dsh-session/COMPLETION.md)。

## 打开本机已有便携包

双击 **`artifacts/Team-0.3.0-win-x64/Team.exe`**。整个目录需放在一起；这是自包含 Windows x64 便携开发包，不要求安装 Node、.NET、npm 或浏览器，不需要输入地址或配对码。未签名，不是正式安装器；不要关闭系统防护。

- 左侧选择/新建项目，右侧切换对话和任务草稿。
- 成员和进度按需打开。界面保留必要错误和真实状态，不重复铺满说明标签。
- Ctrl+N 新建项目；Ctrl+F 搜索；Ctrl+Enter 保存消息；F5 刷新；Tab 切换控件。
- 默认数据在 `%LOCALAPPDATA%\Team\core.sqlite`。关闭窗口结束自己的本地服务，重开沿用数据库。
- 已有数据库可用 `Team.exe --data "D:\absolute\core.sqlite"` 显式打开。先关闭旧服务；不自动移动、复制、覆盖旧库，也不悄悄回退到空库。禁止网络共享盘。

详细说明：[原生应用](packages/desktop/README.md)。设计与边界：[W05 原生阶段](plan/W05-NATIVE-DESKTOP.md)。唯一设计维护目录是 [plan](plan/README.md)。W05-NATIVE 是本轮交付名称，**不代表原 WBS 的受控执行/恢复门槛已经通过**。

## 0.3.0便携包当前能力

- 新建和选择项目群；登记 Codex、Claude Desktop、DeepSeek Harness 身份、名称、职责；编辑、停用、恢复成员。
- 保存公开/定向普通消息、稳定历史分页、字面搜索。成员明确未连接；不会发送到原客户端。
- 创建、编辑、归档/恢复任务草稿，保留负责人和验收条件；不伪造执行或审批。
- 只读进度，不发 prompt/continuation、不调用模型。
- 消息输入按项目保留；切项/刷新/重连不把私密接收人变成群聊。负责人停用后不能静默取消分配。
- revision CAS 防止覆盖新版本；冲突保留表单输入，可显式读取新版本。不确定提交锁定原内容和 action_id 重试；保存成功但刷新失败单独说明。
- 配对通过所属子进程私有管道，cookie/CSRF 仅进程内存。双实例同库拒绝打开。正常关闭、意外退出均回收所属服务，不杀其他 Node/Agent。

## 管家之前的新增后端基础

- 能力登记严格区分声明/可用/授权/资格；配置变化失效、撤权重查、幂等/CAS。本地detach只改变平台连接引用，不能杀原客户端；发送/回答/审批/打断未实现即拒绝。
- 任务依赖DAG和完整changeset输入快照；上游失效阻止Broker继续写入/交付、保留锁和成果。授权资料检索在排序前过滤ACL及来源，无Embedding/模型调用。
- 本机停稳development仓库的SQLite一致备份、Git对象/index/staged/unstaged/二进制闭包，校验后只恢复到新目录；旧凭据撤销，不自动恢复执行。
- 这些都是可信进程内开发入口，**没有挂到UI或公共HTTP/MCP**，不代表真实Agent已连接。生产在线灾备/离机加密/安装升级、实际原客户端与OS隔离仍未完成。
- 验证命令：npm run test:adapter、npm run test:foundations；编译走查：npm run test:adapter:walkthrough、npm run test:foundations:walkthrough。证据目录必须新建，不能覆盖旧结果。
- [实施范围](plan/PRE-COORDINATOR-FOUNDATIONS.md) · [阶段交付](evidence/pre-coordinator/2026-11-14/COMPLETION.md)。管家方案以用户确认的coordinator-core-review-1为准，实施仍暂缓，原生UI最后设计，旧便携包未重发。

## W07 当前源码：开发进程运行器

在W06 Broker基础上，已构建可信进程内RunnerController和独立.NET RunnerHost：固定开发worker启动、授权补丁/真实Git检查点、幂等事件回执、只读进度、停止/超时/异常退出与重启对账。只接受 development_fixture，不是原Agent接入或公共派工接口。

- 成功需完成事件、退出码0、可信Job空和有效Broker授权，最终只进入 in_review，不冒充任务已验收。
- 停止/失败先撤权并回收所属进程，逻辑锁保留隔离；任务仍running/WIP。未知退出不等于停止，不用旧PID杀进程或自动重派工。
- 合成走查已覆盖成功、停止、畸形输出；真实原客户端、OS强制隔离和原生点击验收尚未通过。UI布局未改，仍最后设计。
- **当前源码数据库schema 4；上方0.3.0便携包仍schema 2、未重发。不要用旧包打开升级库，也不要用新源码试开用户实际数据库。** 本轮测试只使用独立合成库/仓库。

开发验证：npm run test:runner；编译后端走查：npm run test:runner:walkthrough（RUNNER_EVIDENCE需指定一个不存在的新目录，避免覆盖证据）。详见[W07计划与结果](plan/W07-DEVELOPMENT-RUNNER.md)、[交付记录](evidence/w07/2026-11-14-runner/COMPLETION.md)。没有公开Runner HTTP/MCP入口或UI派工按钮。

## W06 前序后端构建（UI 暂停设计）

已新增**开发态受控写入闭环**：任务 CAS 领取、跨工作目录逻辑路径单写者、授权交集、before digest、真实文件/Markdown/diff/journal/Git checkpoint、崩溃重放与待评审交接。代码只通过可信进程内 DevelopmentBroker 使用；没有挂载 HTTP/MCP，没有接到原生界面的真实派工按钮。

- SQLite 新增003迁移，001/002字节不变。租约过期、失联、撤权只隔离并保留锁，不视为停止证明。
- 独立新建合成仓库；不能接管已有用户仓库。只支持 UTF-8 文本及删除、每次最多128文件/1MiB；每个工作目录同时一个claim。新功能不构成G0/G1、操作系统隔离或真实原客户端兼容证据。
- 本阶段**没有重新发布便携包**；上方0.3.0包保持原样。W06当时源码为schema 3，W07现为schema 4，旧0.3.0包只认识schema 2；不要拿旧包打开已升级库。测试只用独立临时数据库，不打开/升级用户的实际数据库。
- 运行 npm run test:broker 或 npm run test:broker:walkthrough。后者保存自建测试仓库、journal与changeset，目录由BROKER_EVIDENCE指定；不保存token/测试数据库。

实现计划：[W06](plan/W06-CONTROLLED-BROKER.md)。测试与边界：[交付记录](plan/W06-CONTROLLED-BROKER.md)。后续继续运行器/安全接入、依赖与恢复、附件/授权检索、管家等后端工作，原生UI最后设计。

## 开发构建

实测 Windows 11 x64，Node **24.14.0**、TypeScript **5.9.3**、.NET SDK **10.0.404** / Windows Desktop Runtime **10.0.15**。SDK 仅在 `.tools`，无系统安装；固定官方 ZIP 及 SHA512，版本见 `global.json`。

新克隆需先准备Node 24.14.0与Git并放入PATH；原生测试显式使用当前Node路径，不依赖作者机器目录。以下命令验证源码，不要求已有便携包：

```powershell
$env:TEAM_TEST_NODE = (Get-Command node -ErrorAction Stop).Source
$env:BROKER_GIT = (Get-Command git -ErrorAction Stop).Source
npm ci --ignore-scripts --no-audit --no-fund --registry=https://registry.npmjs.org
npm run bootstrap:native
npm run verify
npm run test:native
```

旧包完整性检查仅适用于本机已有完整0.3.0包：运行npm run test:native:package。仓库不附带该包；未持有该包不是源码测试失败，也不要为凑齐此检查覆盖旧包。新发布需单独版本、迁移与打包验证。

`build:native` 发布自包含 .NET 运行时，并复制固定 Node、已编译服务与锁定的生产依赖；不包含 web 资源、测试浏览器、SDK、数据库、凭据或证据。`package-manifest.json` 对全部分发文件逐项校验 SHA256；许可保留在包内。

### 保留的旧 Web 调试入口

`packages/web` 未删除，仅保留开发/回归用途，不是交付给用户的前端。`npm start` 仍启动旧调试服务，默认 `.runtime/core.sqlite`、127.0.0.1:4317，终端产生一次性配对码；`npm run pair` 需相同 CORE_DB。**原生应用不使用这套手工流程。**

## 安全与执行边界

- 主人控制面保持 Origin + Cookie + CSRF；core/feed 保持 Bearer 且拒绝 Cookie。原生界面没有绕过认证，没有直接操作业务表。
- 服务环境白名单，不继承模型 API 密钥等无关环境；Job Object 和 stdin EOF 管理所属进程生命周期，不是 Windows 安全沙箱。
- 消息按纯文本渲染；无第三方 CDN、模型请求或遥测。未知提交不靠吞异常或新 action_id 重试处理。
- Node SQLite 仍是实验性 API，警告没有关闭，原生应用“关于”可查看服务诊断。stdout 中的短期配对 secret 不存日志；stderr 有界留在内存，不混入消息正文。
- 既有 001–003 SQLite 迁移不变，W07仅追加004。损坏/冲突的库报错，不重建覆盖；应用完全关闭后再备份数据库与仍存在的 WAL/SHM。
- 只适用于可信的本地单用户环境；不宣称独立安全审计、跨账号隔离、生产级灾备或公网适用。

## 检验与证据

[W05 阶段记录](plan/W05-NATIVE-DESKTOP.md) 区分服务/原生核心测试、包检查和真实桌面操作。**Computer Use 未获准读取 Team 窗口，本轮不能宣称完成了真实点击走查，也没有伪造截图。** 原生窗口可启动、子进程可回收已另行记录。

```powershell
$env:TEAM_TEST_NODE = (Get-Command node -ErrorAction Stop).Source
$env:BROKER_GIT = (Get-Command git -ErrorAction Stop).Source
npm run verify
npm run test:native
# 设计校验需使用已安装jsonschema的Python环境
python -B plan/tools/test_p0_readiness.py -v
python -B plan/tools/verify_design.py
```

本机已有旧包时另跑npm run test:native:package；旧Web浏览器回归需先配置PLAYWRIGHT_MODULE为本机Playwright模块绝对路径，再运行npm run test:browser。两者不能冒充原生窗口点击验收。

作者自检，不冒称独立审查。前序证据：[W04](plan/W04-LOCAL-WORKSPACE.md)、[W03](plan/W03-CONTRACT-BASELINE.md)。

## 代码布局

| 目录 | 职责 |
| --- | --- |
| packages/desktop | WPF 窗口、统一表单、原生应用入口 |
| packages/desktop/Core | 所属服务生命周期、认证传输、项目/草稿状态 |
| packages/service | 权威服务/迁移、私有桌面启动、开发Broker与RunnerController |
| packages/runner | 固定开发worker的.NET生命周期宿主，不是安全沙箱 |
| packages/contracts | 契约生成和运行时验证，未放宽原协议 |
| packages/web | 保留的旧 Web 调试界面 |
| tests/desktop | C# 状态、真实 HTTP、进程故障与持久化测试 |
| scripts | 契约生成、服务构建、SDK固定、原生打包 |
| plan | 唯一设计与交接目录 |

## 未通过的产品门槛

**250 项 AT/CA 仍为 NOT_RUN；原客户端兼容 UNVERIFIED；正式契约冻结 NOT_FROZEN。**

W06/W07已提供开发态Broker、逻辑单写者、真实Git证据链和自有合成进程退出对账；这些能力尚未用于真实原客户端。原客户端连接/自动派送、同配置强制隔离与写权撤销、跨任务依赖交接、附件/授权检索、SSE/MCP、LangGraph/RAG管家、费用结算及完整灾备仍待完成。下一步优先准备原客户端能力/适配边界与获准后的P0/G0/G1探针，再推进后端；原生UI最后，真实点击/视觉验收仍需Team窗口操作授权。不能因开发测试通过而提升产品门槛。

## Claude Desktop本地MCP与只读桥 · 2026-11-16

官方Desktop 5.11492.2保持原客户端身份，不要求官方登录。第十二轮已完成一次真实Claude Desktop合成任务往返：沿用CC Switch「me＋路由」，发送一条授权prompt，原客户端调用task_get一次，服务返回queued，窗口复述正确任务ID及状态。任务连接收到一次roots变化通知且无故障，两条MCP连接均EOF；权限响应once由自有日志证实，助手未点击权限按钮。根进程exit0、Job为空、host退出及原客户端清单核对通过，临时凭据清除且369文件扫描零匹配/零未读，原四配置和live路由摘要保持。累计三条用户prompt、一次真实工具读取，总请求/费用及运行时上游仍未知。单任务验收完成不等于生产连接器、自动驱动或Windows强制隔离；管家不构建。

新增task_get、project_progress和可选message_poll，复用服务的grant/policy/run/ACL检查；任务投影是第七类resource/0.1只读投影。没有模型可指定的URL、token、project、shell或写工具。协议读取、撤权、分页、错误处理与编译后重连走查均通过；默认verify不启动原客户端。

这是**合成验收专用桥，不是生产连接器或完整Claude任务接入**。配置中的synthetic_only/provider_fingerprint由可信验收者声明，尚未接入服务端的实际provider外发绑定、生产凭据配置和邀请流程，不可用于真实私密数据。真实Desktop已完成一次合成只读工具往返；生产消息收发、主动响应、窗口切换/最小化、取消恢复和Windows隔离仍未通过。

源码验证：npm run test:claude；编译走查：npm run test:claude:read:walkthrough。后者只建合成库并启动本项目stdio连接器，可用CLAUDE_READ_EVIDENCE指定不存在的新证据目录。真实Desktop入口须保留显式授权开关、固定安装/选中配置摘要与独立profile；不自动改写用户配置。详见[W13](plan/W13-CLAUDE-DESKTOP-MCP-PROBE.md)及[验证记录](evidence/claude-desktop/COMPLETION.md)。

默认npm test使用两个测试文件并发，避免多个Git/.NET/子进程夹具争用资源；所有测试和失败断言仍运行，生产时限不变。并发实验与历史失败见W13验证汇总，不把测试排程当成产品负载资格。
