# W20 thread/unsubscribe无模型验证

2026-11-16；基线24f70a7；D:/Users/1/Desktop/team。用户另行批准一个新隔离原客户端实例、一个无模型thread、对该thread取消订阅并观察MCP关闭。没有provider凭据复用、旧会话读取、模型turn、原实例操作、OS策略修改。

## 结果：候选失败

固定原客户端exe SHA256不变。桥初始化和tools/list成功。10:55:59.312Z发出thread/unsubscribe，响应status=unsubscribed。之后观察10秒，桥仍未退出，报告EOF=false。10:56:09.658Z才关闭宿主stdin；桥退出观测10:56:09.667Z、exit1；宿主退出观测10:56:09.721Z、exit0、forced=false。时间是观察时间而非精确内核事件时间。

两个实际进程句柄均在unsubscribe之前打开、持有至退出；不是仅凭PID消失推断。桥最终initialized=true/tool_calls=0/tool_errors=0/fault=null/stdin_eof=false。协议requests=2/responses=2/last_method=thread/unsubscribe/generation=0/turn=null，initialize握手独立计数。拒绝端点请求0。

原客户端清单保持。配置副本2份已删除，限定目录75文件扫描无随机桥token残留。没有第二次真实实例或模型调用；没有任何用户全局配置/私有历史读取。

**结论范围：** unsubscribe确认不等于本次配置下10秒内MCP正常退出，不能解决已观察的宿主退出时桥exit1问题。不能据此断言所有版本永不关闭，也不能仅凭exit1推断内部TerminateProcess调用。无模型实验不替代付费同配置联合验收，W20原FAILED保持。

## 工具与测试

- tests/codex-unsubscribe-probe.mjs仅诊断使用：记住它自己start返回的thread，禁止外部指定thread；没有thread/已发送/发生turn均拒绝；发送前标记已使用，未知结果不重发。
- 使用现有transport的内部request发送固定thread/unsubscribe，没有把通用RPC或新方法暴露到生产服务、controller或HTTP，生产关闭路径未变。字段来自此前固定客户端导出的本地Schema。
- 新增协议夹具验证错误thread拒绝、正确自有thread一次unsubscribe、无turn和重复拒绝。先UNIMPLEMENTED红灯，后绿灯；完整回归结果见unsubscribe-verification.json。
- 原始脱敏实测报告unsubscribe-diagnostic.json保留DIAGNOSTIC_FAILED，失败项graceful_bridge_exit没有删除。

## 下一决策

直接EOF与先unsubscribe两条路径均未满足严格正常收尾。建议停止此类重复原客户端尝试，先确定平台是否持有桥进程与stdio的生命周期，设计停止准入→排空在途→关闭stdio→确认桥exit0/EOF→关闭宿主的监督流程。必须保持原客户端身份，不能以代理ACK冒充桥EOF，不能关闭已有客户端，也不能把故障隔离与Windows强制隔离混淆。先做离线设计及合成验证；真实复验需对应授权。本轮未实现该架构变更。
