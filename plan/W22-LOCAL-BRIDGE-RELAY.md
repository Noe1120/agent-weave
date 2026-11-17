# W22 认证本机转发：离线合成装配

## 目标和最小方案

承接已批准的W21下一入口，构建tests范围内可实际运行的本机转发链，不启动任何原客户端/模型，不改生产启动器、UI、数据库或管家。HANDOFF冻结，README更新。当前为连接传输架构增量，用户已明确授权自主实现该下一阶段，不再重复询问普通实现细节。

比较：命名管道还需Windows ACL专门验证；HTTP轮询增加请求和断线判断；选用Node内置net的127.0.0.1临时TCP连接，单一长连接、严格JSONL、随机一次能力绑定。无新依赖、不支持公网、重连、自动重试或任意命令。回环能力鉴权不是同用户恶意进程隔离，真实身份/ACL资格不升级。

## 信任、传输和关闭

- 端点生成256位随机token和随机instance，带最长30秒绑定期限，仅内存存在；首次auth同时匹配instance/token/期限才消费能力。拒绝错误/过期/重复绑定，未认证者不能操作桥。凭据通过自有子进程最小环境传给relay，不写用户配置或报告。
- relay只持本机能力，不持HTTP任务token/provider凭据。首帧auth，服务ready后才接受stdio；逐帧rpc/ack，通知也ack但不写到客户端stdout。保留原JSON-RPC响应id/error，禁止重放同id（会话累计有界）。本阶段最多1个在途，避免另建并发调度器。
- 双侧输入严格UTF-8/JSONL和完整终止，64KiB请求、128KiB响应、1MiB累计/方向。等待写回调后才读下一帧；停读施加背压，写出/响应有界期限，超时明确失败，不把截断当正常EOF。输入通知也受累计额度控制。
- 客户端stdio结束只表示不再发送，relay发送sealed并继续等平台关闭，不直接退出。平台stop同步关闭准入，等待已接收帧的响应写出，调用W21桥排空/EOF/真实close及最终报告核验；仅桥证明通过后发送closed给relay，验证所属relay正常退出，再关闭所属合成宿主。
- 意外TCP断开、relay崩溃、桥协议错误或请求/写出超时导致失败；不自动重发，不关闭宿主伪装成功。所属句柄清理与验收分开。监督器崩溃后relay非零退出；新端点生成新身份，旧能力不能恢复，旧运行保持unknown且不释放锁。这里“恢复”是安全拒绝续接，不实现自动接管旧PID。
- 报告路径仍仅来自新受信测试目录，真实部署报告归属/ACL和厂商自动重启行为另阶段验证，不在本轮虚构生产保证。

## 内联实施计划

按executing-plans/TDD执行，不用子agent，不另建工作区。

1. `tests/bridge-relay-io.ts`：`readFrames(readable, frameLimit, totalLimit)`、`writeFrame(writable, value, deadlineMs)`。先写畸形/截断/大小/累计/慢写回归，观察红灯，再实现有界读写。
   ```ts
   await assert.rejects(collect(readFrames(Readable.from(['{"x":1}']), 64, 128)), /RELAY_TRUNCATED/);
   await assert.rejects(writeFrame(blocked, {}, 50), /RELAY_WRITE_TIMEOUT/);
   ```
2. `tests/bridge-relay.ts`：`openRelayEndpoint(supervisor, {deadlineMs, ttlMs})`返回descriptor、snapshot、stop、dispose（仅夹具清理）；`runRelay(descriptor, input, output)`仅连接固定回环地址。`tests/fixtures/bridge-relay.mjs`运行该函数，错误仅输出固定错误码并exit1，不输出载荷/能力。先写错误凭据/绑定重放/期限/stdio顺序测试再实现。
3. `tests/bridge-relay.test.ts`：新临时配置与本项目MCP桥+CoreService合成任务+真实relay子进程+Node宿主，验证完整task_get/状态/零额外写入/关闭顺序。撤权/断线/超时/旧身份重启拒绝和监督器崩溃分别作为失败反例。使用编译桥入口再走查一次，不宣称全生产装配。
4. 全量verify、原生14+静态、旧包、P0/设计生成及只读检查；作者自检、脱敏证据、暂存扫描及普通推送。失败先根因后最小修复，不修改范围外代码来凑绿灯。

## 阶段出口

仅认证本机传输离线合成通过；W20真实FAILED和250项NOT_RUN不变。正式客户端装配仍需下一阶段固定入口/凭据传递/生命周期组合及新的具体无模型启动授权；计费联合验收另行授权。

## 实施与自检记录

已实现6个tests文件（传输、帧读写、两组测试和两个子进程入口），无生产文件或新依赖修改。29项专项覆盖真实项目桥/合成HTTP任务往返、进度零写入、在途排空、停止后新请求拒绝、真实relay和Node宿主顺序退出、撤权、一次绑定/错凭据/过期/静默/重放、旧能力跨重启拒绝、relay及端点进程实际崩溃、畸形/截断/累计超限、慢写/输出错误与关闭竞态。Windows回环和能力口令不构成同用户隔离。

发现并修复：输出等待超时未释放监听器；输出方向缺累计上限；Windows强杀relay导致ECONNRESET需要明确映射为断线；closed与最终stdout失败竞态不能吞掉写错误。各自先用失败反例定位，再修实现。撤权测试最初遗漏initialized通知，得到协议错误而不是工具错误；补正确握手后才测试真实撤权，未改生产MCP状态机。初次红灯时装配失败前未注册finally导致测试挂起，已把清理注册提前；仅终止已核对为本次测试runner的进程，未处理原客户端。类型检查的联合键和子进程stdio类型问题在测试中修正。

作者自检不是独立评审。正常链使用本项目MCP及CoreService；崩溃端点fixture只抛错误、不产生桥成功证明。编译专项只替换MCP为dist入口，不声称监督器/relay已进入产品分发。恢复仅失败关闭准入、旧身份拒绝，无自动重启、旧PID接管或自动重派工。生产配置交付、报告归属/ACL、原客户端生命周期和自动重启行为仍须后续验证。

收尾自检补严未知relay退出错误码断言，发现W21监督器会将不认识的RELAY错误归一为BRIDGE_STOP_FAILED；在本轮relay回调边界先保留原始安全错误码再向监督器传播，未修改W21实现。对应定向红绿日志单独保留。
