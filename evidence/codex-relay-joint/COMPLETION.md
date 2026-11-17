# W25 同配置真实单任务、撤权与严格退出联合验收

**PASSED_FIXED_CONFIG**。用户单独批准一个新实例、一次合成task_get turn、既有provider临时复用、30,000 tokens软停止、金额UNKNOWN、失败不付费重试。实际只运行一次；授权已消耗。

## 固定配置与实际路径

官方Codex 0.167.0-alpha.3.2，exe SHA256 4b3286e35d7fe866c6b0eb3f07d7a4cdb5e96489576170dfd6b3a15aa1c67382；本机配置只读确认custom/gpt-6.1-sol/http://127.0.0.1:15721/v1，监听所属程序为cc-switch。未读聊天、不改路由/原配置，不切官方登录。只将必要provider字段/令牌写本次隔离home，provider重试为0，工具命名空间direct_only mcp__agent_weave_probe。

与W20不同：真正MCP桥由平台拥有stdio，原Codex创建固定relay，控制grant撤销触发tests受信关闭组合，先桥排空/EOF/exit0，再relay实际Windows句柄退出，最后原生宿主关闭；不删除或放宽旧EOF断言。生产控制器默认行为未改。

## 同一次运行事实

时间2026-11-17T10:22:14.689Z—10:22:25.822Z；10项判定全部通过，原样脱敏报告见[real-attempt-report.json](real-attempt-report.json)。

| 步骤 | 结果 |
| --- | --- |
| 主人邀请/兑换 | 真实本机HTTP/CoreService/WorkspaceService，synthetic_only测试数据 |
| 原生thread与任务授权 | 新thread确认，W17单任务grant绑定实际控制器观测 |
| 真实模型工具往返 | task_get恰好1次、tool_errors=0；服务确实读取grant内task |
| 原生结果 | 同task 3a6201d6-b4d2-4fbe-86f9-66a40134ef10及draft，generation1 completed |
| 只读 | 1000次进度查询零DB写入；一次实际资源读取零写入，task/run保持原值 |
| 撤连接 | 原task grant直接服务及任务relay均404；不是追加模型turn来验证 |
| 撤控制grant | 进度GRANT_REVOKED，controller维护触发关闭并达到closed |
| 真正桥 | stdin_eof=true、fault=null、自然exit0/exit_observed/非强制 |
| relay | 停止前持Windows实际句柄，exit0观察于10:22:24.7593744Z |
| 宿主 | 10:22:24.816Z才发关闭，实际自有ChildProcess exit0/非强制/fault=null |
| 保持 | 原12客户端进程清单相同，用户config SHA256前后相同 |
| 清理 | 工厂删除bridge.json；另删隔离home配置1份，限定78文件零provider/业务token/relay能力残留 |

本次用量18,196 tokens（输入18,084，输出112），阈值30,000未触发；阈值是软停止，金额UNKNOWN，不声称费用未超。未调用新模型回合、未读原会话、未清理原实例。

## 回归与错误处理

- npm run verify 677/677，0失败/0取消/0跳过；生成/格式/类型/编译冒烟通过。
- 新增2项合成回归：完整联合流程（实际桥/relay/HTTP及Windows句柄、客户端/模型为明确夹具）；缺relay独立退出证明即使宿主exit0也必须失败。
- 旧W20合成模式单独通过，没有用其合成结果代替真实记录。
- 原生C#14+WPF静态1、旧包989文件、P0 13项、设计64文件/63摘要通过；非原生点击验收。
- 首次全量因新MJS helper的TS7016缺声明失败，补显式类型声明后重跑，不关strict、不加忽略、不删断言。脚本--relay尚不存在时新流程测试先失败，再完成实现。

本地原始日志.runtime/w25/red.log、specialist.log、verify-preflight.log（类型错误）、verify-final.log、legacy.log、rehearsal.log、vendor-console.log、native.log、package.log、p0.log；真实目录vendor-once保留report/turn-attempt/relay-exit/桥报告等，authorization-used.json防止重复尝试。作者自检，不是独立审核。

## 限定结论与下一步

本次在新relay配置下完成真实只读任务＋撤权＋正常收尾闭环。旧W20 FAILED保留，既往默认配置失败不追认。尚未交付长期自动连接/附着、产品默认启用、全故障族或L1–L3完整资格；仍需受信产品装配的合成开发。Windows强制隔离暂缓，原生点击、生产灾备/签名升级、250项产品验收未完成，管家不构建。HANDOFF摘要保持9E057D55395FAABD77A175B64042F18DF24A7AC53334C10A0A370D3F06DF0586。
