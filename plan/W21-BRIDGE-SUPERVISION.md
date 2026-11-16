# W21 桥生命周期所有权：离线设计与合成验证

## 授权与边界

用户同意平台管理MCP桥生命周期方向，先离线设计与合成验证。本轮0原客户端、0模型、0用户provider凭据、0窗口/系统策略操作。HANDOFF冻结，README更新。W20付费与两次无模型真实记录保持FAILED，不拼接成通过。本轮实现仅在tests下，生产Codex启动/关闭不变。

## 方案比较与选择

1. 继续由厂商启动桥、依赖EOF或unsubscribe：两条真实路径均未满足桥exit0/EOF，不继续猜测关闭时序。
2. **平台拥有真正MCP桥的子进程句柄和stdio**：客户端经薄转发端接入，桥读取能力仍由W17 grant验证。平台先关闭准入，等待已接收请求完成，再对真正桥stdin发送EOF，验证真正桥报告和OS退出，最后关闭自有宿主。采用此方向做离线纵向原型。
3. 平台仅通知桥自行退出或超时强杀：不能证明排空和正常EOF，不能作为成功路径。强制终止只能是带失败证据的资源清理。

选择2的代价是增加转发端及传输绑定。原型先验证平台真正持有stdio这一关键前提，不提前实现公网服务或不可验证的客户端资格。独立原客户端身份保留，桥监督器不是模型/SDK替身。

## 数据流和信任

目标：原客户端stdio薄转发端 → 单实例认证本机通道 → 平台监督器 → 真正MCP桥stdin/stdout → 现有授权HTTP服务。只有真正桥持有单任务read token，转发端只持短时单实例连接能力，不能拿控制grant或任意命令。真实接入前必须验证通道认证、一次绑定、大小/背压限制、断线/重连拒绝、转发端自身退出及是否触发客户端自动重启。客户端杀掉转发端不能被当成真正桥正常收尾。

本轮合成路径：测试代码作为客户端，调用监督器严格request/notify接口；监督器持有由测试装配启动的本项目MCP桥ChildProcess；真正桥访问本项目合成资源HTTP服务。测试宿主是单独Node夹具，不是Codex。**不交付跨进程转发端与真实启动器装配，不宣称端到端生产连接完成。**

## 状态和顺序

- open：允许MCP请求/通知，验证JSONL和64KiB输入帧、128KiB输出帧、1MiB总输出、最多64个在途；本机方法不具备外部身份，未来入口另鉴权。
- draining：stop同步设置关闭准入；拒绝一切新请求和通知，不缓存到新会话。已经转交的请求须收到相同id响应后才结束；error响应也完成该请求，不伪造业务成功。重复stop复用同一个Promise，宿主关闭最多一次。
- eof：仅排空成功后stdin.end；等待ChildProcess close，而不是只等exit或判断PID消失。读最终报告必须在close后，避免Windows活跃文件rename竞争。
- bridge证明：exit code=0、signal=null，且报告initialized=true/stdin_eof=true/fault=null、工具错误数=0。任意缺失/损坏/不满足均失败，不能由监督器补写EOF。
- host：只在桥证明通过后调用明确拥有宿主的关闭回调；回调须返回exit_observed=true/code=0/forced=false。异常、超时、未确认都不记closed。
- closed：上述条件全部成立；快照只读，不推动状态或触发额外请求。
- failed：保存首次明确原因（协议、进程、排空超时、桥证据、宿主退出），拒绝新请求，禁止自动重发/重新启动；未证明桥退出时不关闭宿主作为“成功”。测试finally仅清理自有夹具，强杀不改failed。

停止时撤销业务grant与资源排空分开：授权一旦撤销，每次真实服务读取必须按现有策略拒绝。排空不延长grant，不重试被拒请求，也不解除写锁。过期/失联/强制退出不表示停止成功。

## 接口（离线原型）

`BridgeSupervisor(child, {reportPath, deadlineMs})`；`request(method, params): Promise<unknown>`；`notify(method, params): void`；`stop(closeHost): Promise<void>`；`snapshot(): {state, pending, fault}`。child是刚启动的自有进程句柄，reportPath仅测试装配的新目录，非任意客户端输入。无PID接管、进程搜索、命令透传、自动恢复。request只承担MCP传输，现有McpSession继续负责工具及参数白名单。

## 验证与实施步骤

本会话按writing-plans/executing-plans内联执行，用户规则禁止默认子agent；不另建工作区以免再次偏离指定D盘。

1. 创建`tests/bridge-supervisor.ts`与`tests/bridge-supervisor.test.ts`。先写排空顺序及失败用例并观察红灯；构造真实Node MCP子进程，初始化后执行真实HTTP task读取。关键断言：
   ```ts
   const pending = supervisor.request("tools/call", {name:"task_get", arguments:{task_id}});
   const stopping = supervisor.stop(closeOwnedHost);
   await assert.rejects(supervisor.request("ping", {}), /BRIDGE_NOT_OPEN/);
   assert.equal(hostCloseCalls, 0);
   releaseHttp();
   await pending; await stopping;
   assert.equal(supervisor.snapshot().state, "closed");
   ```
2. 最小实现pending请求账本、严格帧解析、输出上限、draining同步拒绝、排空/退出截止时间、报告读取和宿主结果判定。不改生产类。实现顺序：`draining → await pending → stdin.end → await close → read report → closeHost → closed`，每个await共享有界停止期限；catch保留fault并拒绝账本中未完成请求。
3. 反例覆盖：未知响应ID/损坏JSON/超限输出、桥提前exit、挂起请求排空超时、exit0但缺EOF、非零退出、宿主未知退出、重复stop和只读快照。正常路径用真正项目MCP桥，不使用自造PASS报告；故障fixture只用于注入指定错误。
4. `node --test tests/bridge-supervisor.test.ts`专项绿灯后跑`npm run verify`、原生14+静态、旧包文件核验、P0/设计刷新与只读检查。保存脱敏证据；作者自检不称独立审核。stage扫描和普通推送，HANDOFF摘要核对不变。

## 阶段出口与下一入口

出口只为“已批准架构方向的离线原型验证”。必须分别列出真正项目桥、测试宿主、平台HTTP/DB、故障fixture证据。不升级任何原客户端或OS资格。下一阶段先实现受认证本机转发端和合成断线/背压验证，再讨论一条新的无模型真实客户端装配验证授权；付费联合验收仍需单独授权。

## 执行记录与原型限制

已实现上述tests原型及14项专项回归。正常路径使用本项目MCP桥子进程、真实CoreService授权读取和SQLite合成库、测试HTTP路由及独立Node宿主；不是原客户端。首次未实现时测试红灯，补实现后通过。编译桥专项首次13/14：宿主超时用例的500ms共享期限先在桥退出处耗尽，且拒绝处理器注册过晚；改为3000ms并立即注册拒绝断言，仍必须观察HOST_EXIT_TIMEOUT及迟到成功后failed不变。未改生产关闭逻辑、未放宽EOF/exit0或错误断言。完整命令与最终结果见[脱敏证据](../evidence/bridge-supervision/COMPLETION.md)。

作者自检确认：本原型不提供外部身份认证、跨进程relay、输入通知累计限流/写入背压、open阶段逐请求期限、崩溃重启恢复或生产报告路径归属验证；reportPath来自本次受信新测试目录。编译专项只将真正MCP子进程换为dist入口，监督器/HTTP装配仍为测试代码，不称全编译生产走查。正式装配前必须补齐这些边界。历史W20及两次真实无模型退出失败证据保持不变；管家未构建。

重跑全量另发现已有DSH held-pipe测试将正常根退出预算压成300ms，可误触强杀。以600ms延迟根退出的夹具稳定复现后，将该用例恢复探针正常5000ms预算、后代继续持管道9000ms，保留exit0/非强制/streams_closed=false全部断言。仅修测试装配，不改DSH真实探针和生产行为；失败及修复证据分别登记。
