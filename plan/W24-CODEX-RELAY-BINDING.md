# W24 原客户端relay绑定准备

## 本轮具体授权 · 2026-11-17

用户已批准一次独立Codex无模型生命周期验收：新隔离实例及一个thread，不发送prompt/turn、不复用用户凭据、不读取历史、不改CC Switch或现有实例；验证桥/relay退出顺序，仅清理本次自有进程与配置，失败不自动重试。授权仅用于tests/codex-relay-acceptance.mjs的--allow-one-no-model-relay，独占.runtime/w24-live/owned-once，不能重复执行。HANDOFF仍冻结。

先用--synthetic完整演练同一装配（本项目协议夹具＋真实relay/桥＋Windows退出句柄），验证缺授权拒绝、同目录重复拒绝、正常收尾及清理，再执行唯一真实尝试。无工具任务的此次探针不需要业务数据库：配置使用随机合成资源ID与拒绝HTTP端点，任何HTTP请求都计数并使验收失败；不冒称真实task_get。实际只允许MCP初始化/工具发现，无turn/工具调用。原客户端重启行为只能记录本次可观察事实，不证明永久不会重启。报告仍与W20分开。

## 范围

紧接W23自主推进，不等待普通开发确认。目标是让原客户端使用固定本项目relay入口，而真正桥仍由平台拥有。只做代码与合成验证，不启动Codex、不用用户provider凭据、不发turn。

最小方案：复用W23工厂增加prepareClient，不复制桥/协议。返回固定Node/relay入口与唯一TEAM_RELAY环境，以及ready、snapshot、stop(waitRelayExit,closeOwnedHost)、abort。此模式relay由原客户端创建，平台没有其直接ChildProcess；必须由受信装配传入独立OS退出证明，不能把socket EOF或自报退出当真实exit。abort只清理平台所属桥/监听与凭据，不杀原客户端或按旧PID杀relay。

Codex配置新增可选relay_binding，只含经校验的descriptor。仅生成固定相邻bridge-relay-entry.js配置，不能让操作者提交任意命令/环境。与旧bridge互斥；不切默认接入。启动前仍检查原客户端固定摘要、独立home和授权，额外固定relay入口摘要并检查路径。原provider/第三方路由/code_mode行为保持，不新增请求。

## 实施（executing-plans/TDD，内联）

1. 先写工厂prepareClient合成测试：从返回固定命令/环境启动独立Node relay，真实MCP初始化/只读task、桥关闭→实际relay close证明→所属宿主回调。缺证据/未知退出拒绝；两个模式共享逻辑，旧12项保持。
2. 先写codexHomeConfig与officialCodexLauncher预检反例：descriptor格式、环境键、旧bridge互斥、入口固定、凭据不出现在参数/快照；新模式启动前未授权应零启动。实现只有新配置路径，不替换原默认。
3. 新增一次无模型验证所需的离线装配说明，列出下一真实门槛：一个新独立Codex、一个thread、无turn/无provider复用、回环拒绝模型端点、真实OS relay退出证明、原实例清单不变及清理。该真实操作仍需具体新授权，不能沿用过去已消耗的授权。
4. 全量、编译路径、原生/旧包、设计校验、脱敏证据与README、暂存扫描普通推送。W20 FAILED不升级。

## 资格边界

prepareClient不验证外部回调的真实性，受信装配必须真的持有OS句柄；测试用实际ChildProcess close作证。原客户端是否自动重启relay、配置env是否按固定版生效、根退出与后代退出顺序都需真实无模型测试，不从合成测试推断。Windows隔离暂缓，管家未构建。

## 离线装配与下一真实门槛

此处是受信装配顺序，不是启动授权，也不是已运行的原客户端验收脚本。当前默认服务不注册此工厂。

1. 从编译后service导入createOwnedBridgeFactory与officialCodexLauncher。先建立本次新建的合成任务/只读grant、回环HTTP服务及synthetic_only外发声明；dataRoot必须是本次专用的绝对路径。不得读取用户聊天、真实数据库或复制用户provider配置。
2. 调用prepareClient(stillAuthorized)，从返回的launch.env.TEAM_RELAY解析descriptor，并作为relay_binding传入固定官方Codex启动器。仅传port/instance/token；不提供自由命令。准备后尚未认证时snapshot为waiting，不是在线。能力30秒未使用会拒绝ready；失败方必须await abort清理平台自有桥/端点。
3. 必须先取得新的一次真实操作授权，才可启动一个新独立Codex app-server、initialize并创建一个thread。配置仅使用本次回环拒绝模型端点和空home，不复用任何provider凭据，不发turn/start、resume、steer或prompt。回环模型请求应为0；没有请求不等于已用OS网络策略阻断所有厂商网络。
4. 在停止前凭新宿主的亲子关系、创建时间与固定relay入口定位唯一自有relay，保留实际Windows进程句柄。不能仅拿PID或TCP EOF作退出证明；歧义/句柄获取失败必须记失败，不清理其他实例。await prepared.ready只证明认证，不证明MCP初始化；需另外核对真实桥报告initialized与工具发现，不能称模型工具任务成功。
5. 调用prepared.stop(waitRelayExit, closeOwnedHost)：先排空与桥EOF/exit0报告，再relay自然exit0的OS句柄证据，最后自有Codex根进程正常关闭。回调缺失、超时、强制退出、unknown均不得放行；socket自报closed不能代替waitRelayExit。失败abort只清理平台直接拥有的桥/端点，不按PID杀原客户端或外部relay；真实验收装配另须用本次持有的自有客户端句柄完成有界失败清理，保留失败结果。
6. 同时核对原客户端清单前后不变、generation=0/turn=null、模型端点请求0、工具调用0，以及没有创建第二个relay。删除本次隔离home的config.toml（含relay能力副本）和桥配置；限定本次目录扫描残留，不扫描用户历史。工厂只负责自己的bridge.json，**不会代替启动器删除隔离home里的能力副本**。清理/进程退出未知须保留诊断，不伪报PASS。
7. 一次尝试，失败不自动启动第二实例；先保留证据、定位原因。即便通过也仅登记固定版本的无模型生命周期结果，不能追认W20联合验收成功，付费联合验收仍须另有具体授权。

启动前应另备显式opt-in的单次真实验收装配，复用已有watch-owned-exit.ps1的持句柄方式，但不直接重跑历史诊断脚本或复用已消耗attempt目录。当前tests/codex-relay-preflight.mjs只是编译后**禁止spawn**的配置写入预检，不能当真实验收入口。

## 执行记录

实现默认关闭的relay_binding及prepareClient，两模式复用同一工厂和既有监督协议；原bridge/provider/code_mode不变。新增工厂2项、Codex配置3项、端点过期1项。外部relay专项使用实际Node子进程及close事件，正常task_get来自真实本项目HTTP/CoreService；不是原客户端或厂商模型。

发现并复现：未消费能力过期后ready永不settle，导致测试挂起；改为有界3秒测试确认失败，再加实际到期拒绝和dispose/认证时清理定时器。未绑定prepareClient曾显示open，补waiting断言复现并修复状态投影；缺独立外部exit快照也先失败再修复。没有删除断言、放宽退出条件或隐藏故障。日志保留在.runtime/w24。

## 真实无模型结果 · 2026-11-17

本次授权已消耗，只执行一次：10:11:58.972Z至10:12:05.221Z，官方固定0.167.0-alpha.3.2，原入口摘要复验一致。initialize及tools/list各1、tool_calls=0、tool_errors=0；一个thread、generation=0/turn=null，provider拒绝端点0请求。真正桥stdin_eof=true/exit0/非强制；Windows持句柄观察relay exit0于10:12:03.2721856Z，之后10:12:03.328Z发宿主关闭，宿主exit0于10:12:03.3711455Z。无剩余宿主子进程，原客户端清单保持；桥配置工厂删除，隔离home配置另删1份，限定75文件扫描零残留。不是对所有短暂重启或长期行为的监测证明。

单次装配新增2项合成回归（缺授权拒绝、完整退出演练及旧attempt拒绝），全量675/675，原生14+1、旧包989、P0 13项通过；本阶段不修改生产退出协议。报告与限制见根evidence/codex-relay-binding/NO-MODEL-ACCEPTANCE.md及no-model-report.json，原始日志留.runtime/w24-live。新增脚本直接使用已持有ChildProcess仅限诊断，不新增生产PID附着API。

阶段结论PASSED_FIXED_NO_MODEL_LIFECYCLE；W20仍FAILED。下一关是新固定relay配置下的真实只读单任务＋撤权＋严格退出联合验收，必须另有必要provider配置复用/合成数据外发/一次计费turn和token预算授权。当前不运行；Windows隔离、原生点击、生产灾备/签名升级和250项产品验收不升级，管家不构建。
