# Team · 原生 Windows 工作台

**0.3.0：WPF 原生界面，独立窗口和任务栏入口，不使用 Electron、WebView 或浏览器内核。** 保留原 W03 核心服务和 W04 的本地工作台能力；不是已经接通原 Agent 的完整产品。

## 仓库与当前状态

仓库保存源码、设计和[已审核的阶段文本证据](evidence/README.md)，不附带SDK、node_modules、数据库、第三方研究副本或便携包。新克隆请先按下方“开发构建”准备固定运行时并运行验证；不要把本机已有的artifacts路径当成仓库内下载文件。

当前已继续完成[W08能力与适配基础](plan/W08-ADAPTER-FOUNDATION.md)、[W09依赖与授权资料](plan/W09-DEPENDENCIES-KNOWLEDGE.md)、[W10本机离线灾备基础](plan/W10-OFFLINE-RECOVERY.md)，停在管家Agent之前。后续工作直接沿用[AGENTS.md](AGENTS.md)，不重复确认既有要求。

## 管家方案版本

用户已确认修改后的[管家方案](plan/11-coordinator-agent.md)及关联源章为最新版（coordinator-core-review-1），本分支已纳入；这是设计确认，不是开始构建管家的授权。后续继续DSH接入，原生UI最后设计。

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
