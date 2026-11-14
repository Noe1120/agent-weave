# W11 DSH ACP 初始化生命周期

日期：2026-11-15（Asia/Tokyo）。状态：COMPLETE（initialize-only限定范围，非完整Agent接入）。已获用户确认；按 writing-plans / executing-plans / TDD 在本任务内实施，不另调模型或子智能体。

## 目标与边界

将真实初始化探针接入现有 TypeScript/SQLite 适配层：可信配置固定官方 Desktop 附带的 ACP CLI，启动独立空数据目录，initialize-only，持久化能力观测，授权只读投影、关闭和断线处理。不是已有桌面会话附着，不创建/读取会话，不发送 prompt；管家、UI、Windows 身份/ACL、灾备、安装升级均不在本阶段。

已有 W08 adapter_binding 绑定真实会话，要求 session_id；本阶段没有会话，不能填写假 ID。因此新增同一授权体系下的 adapter_runtime 资源，不放宽 W08 会话契约。新控制器与现有 AdapterRegistry 共用 adapter_configure/adapter_read、grant/policy/run/resource 闭包。无公共 HTTP/MCP 入口；不扩大 grant，不开放派工。

## 实现选择

- packages/service/src/dsh-acp.ts：仅 initialize 的有界 JSONL 传输；只保留白名单能力字段，有限 stdout/stderr/超时，错误可见。关闭仅 EOF 与所属 child handle 的超时终止，不按持久 PID 杀进程。进程退出不当作 Job 已空或严格撤写证明。
- 同文件提供可信 officialDshLauncher：固定程序名/CLI 相对路径，程序与 app.asar SHA256 双校验，独立新目录、最小环境、官方遥测关闭；普通登记不能注入命令/环境。配置摘要绑定版本、二进制/归档与启动政策。
- packages/service/src/dsh-runtime.ts：先事务登记启动意图/幂等回执，再执行；异步后复验授权/世代，授权撤销后在独立维护周期（默认250ms）关闭本控制器所属连接，启动前及初始化后另行复验。ready 仅表示初始化连接；所有会话/模型/写入能力保持禁用且资格 UNVERIFIED。当前控制器失去所有权或重启后显示 unknown，不凭旧 PID 重启/终止。
- read 只读已有事实，不触发探针、续跑、模型或 DB 写入；进度与维护对账分离。意外断开不自动重连，不释放任务写锁或改变任务完成状态。
- 临时真实探针仍需显式脚本参数，默认 verify 只跑夹具，禁止自动调用真实客户端。

## 执行清单

- [x] 读取当前设计和真实 initialize 证据；保留源工作区未提交设计改动；适配层基线 45/45。
- [x] RED/GREEN：传输合法响应、畸形/重复/超大/错误/超时/断线/退出异常；任何场景仅发 initialize。
- [x] RED/GREEN：固定启动配置与双哈希、独立目录、环境白名单、授权撤销前不 spawn。
- [x] RED/GREEN：授权、CAS、幂等、持久登记、只读零写、关闭、撤权、配置/控制器失效、失败不重启；不修改 run/锁。
- [x] 用编译后的控制器完成真实 DSH initialize→多次读取→关闭；确认只发 initialize、原 DSH 进程不变。
- [x] 全量 verify、原生与旧包回归、设计/P0离线校验；作者自检与证据归档。更新交接和 README，不把初始化当 L1/L2/L3 或 OS 门槛 PASS。

## 验证命令

npm run test:dsh；npm run verify；npm run test:native；npm run test:native:package。真实 walkthrough 必须另行手动传入经过核查的本地配置；不用真实数据库/旧会话。

## 发布与保护

用户在原工作区更新的管家章节仅作为需求上下文，本隔离分支不将这些未提交改动代为提交。只提交本阶段代码、设计计划和审核过的摘要；运行库/空 home 生成物/数据库/raw stderr 一律不上传。接口、schema4迁移、原生源码和旧便携包保持不变。


## 真实使用顺序与接口

本阶段只提供可信进程内的 DshRuntimeController，不挂到服务 main、HTTP/MCP 或 WPF，不存在“打开旧包就能用DSH”的承诺。普通查询不可顺带发现或启动客户端。

1. 操作者先核查官方安装身份、EXE与app.asar的SHA256，再由可信组装代码调用 officialDshLauncher。配置只允许 installation_root、data_root、client_version、executable_sha256、archive_sha256 五项；目录必须为绝对路径，data_root预先存在且在安装目录外。客户端版本是已核查的固定配置，不是网络查询到的“最新版本”。
2. 独立测试平台中的grant/policy必须事先包含runtime_id和scope_id。start采用expected_revision=0与唯一action_id，先持久登记，再在每个异步边界复验；回执accepted只表示动作已接纳，不表示客户端成功或任务完成。
3. read返回授权范围内已有状态和白名单能力声明。session_id为null、资格UNVERIFIED、全部执行能力禁用；重复查询不写数据库，不发RPC，不续跑。
4. close仅对当前控制器持有的独立子进程发stdin EOF。超时最多终止该live handle，结果unknown，绝不作为Job已空或Windows隔离证明；旧启动回执重试不重启。
5. 控制器重启不接管旧PID。失联/权限变化/管道EOF/非法后续帧不能继续报告ready，且不自动解锁、不改变任务验收状态。

编译后真实走查须先获对应授权，再手动运行（CONFIG与OUTPUT替换为已核查绝对路径，OUTPUT必须尚不存在）：

    npm run build
    npm run test:dsh:live -- --allow-dsh-initialize --config CONFIG --output OUTPUT

verify和test:dsh只使用合成子进程，绝不默认启动原客户端。原始配置、独立home、stderr日志均留本机且不进入Git。stderr至多保留64KiB，记录写入失败会显式报DSH_DIAGNOSTIC_WRITE，不把内容塞入公共状态。

## 根因修复与保守边界

- 原W10停稳校验不识别adapter_runtime，活动连接能被误判为可备份：先复现，再要求initialize-only、正常closed、观察到退出、非强制、退出码0。ready/unknown/无退出证明均拒绝。尚无退出证明的启动前失败资源也保守阻止备份，暂不提供自动清除/人工绕过入口；不为恢复可用性削弱门槛。
- 初始化成功Promise不代表当前传输仍健康：同批重复帧可能先resolve再出错；后续协议故障和响应管道EOF也可能早于进程退出。新增纯内存status检查，发布ready前复核，只读投影立即降为unknown，不等关闭超时，也不通过查询写库。
- EOF回归为明确标注的合成流事件注入；真实客户端正常EOF退出另有独立走查证据。两者不混称真实客户端故障验收。
- 路径/双哈希/最小环境与DSH_PERMISSION_MODE不等于OS沙箱。运行前核验无法防御同身份恶意并发替换安装文件；Windows SID/ACL/网络强制隔离仍未验证，不开放执行。
- 固定安装改变必须重新核查配置并用新runtime_id登记，不原地更新或复用旧实例。失败不自动重试，不读旧Desktop历史或凭据。

## 下一阶段门槛

当前只批准initialize生命周期。session/new、session/list/resume、prompt、账户认证/模型费用及真正客户端任务验证尚未授权或完成；不能因能力声明支持就自动调用。管家设计只读不构建；Windows强制隔离、原生点击验收、生产在线/离机灾备、签名安装和升级仍需各自交付与证据。250项AT/CA、客户端L1–L3、OS隔离和正式冻结状态不升级。


## 收尾验证

317/317 Node测试（其中49项DSH）、14/14原生逻辑组、1项WPF静态检查、989个旧包文件、12/12 P0离线测试通过。编译后旧适配和依赖/授权检索/离线恢复走查通过。真实DSH编译走查：1次initialize、1000次读取零DB写入、EOF正常退出0、旧回执不重启、撤权读取拒绝；原6个Desktop进程不变。具体摘要见[evidence交付](../evidence/dsh-lifecycle/COMPLETION.md)，不是窗口点击或模型任务验收。
