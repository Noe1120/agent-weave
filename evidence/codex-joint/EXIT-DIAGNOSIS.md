# W20 MCP退出诊断（无模型）

2026-11-16；基线a60b984；用户明确同意仅一个新隔离原客户端、无模型thread/MCP退出诊断。工作区D:/Users/1/Desktop/team。

## 观察结果

- 官方Codex固定hash/version不变。新home只写合成回环provider和桥；未读或复制用户provider凭据、全局配置或私有历史。没有turn/start调用；本地拒绝端点实际请求0，MCP工具调用0。
- 桥initialize/tools/list正常。关闭前用Windows Get-Process打开实际进程句柄并持有到WaitForExit，分别观察原客户端和其新建MCP子进程；身份来自本次独占bridge配置及父exe SHA256，排除原12客户端PID。不是轮询不到PID就认定退出。
- 10:39:50.609Z对宿主stdin.end；桥退出观测10:39:50.6215507Z，exit_code=1；宿主退出观测10:39:50.6558310Z，exit_code=0。时间是观察完成时间，不声称精确内核退出时间。宿主forced=false，原桥最终报告stdin_eof=false、fault=null、工具调用0。
- 原12进程清单不变。删除bridge与home配置2份，扫描75文件零随机桥凭据残留。进程句柄观察器均正常结束。不改OS身份/ACL，不构建管家，不更新HANDOFF。

**判断：** 异常发生在宿主退出触发的MCP子进程收尾边界；桥不是尚未退出，而是已以非零码退出且没有保存EOF/错误记录。与直接终止对照一致，但没有厂商调用栈/系统调用跟踪，不能仅从exit1证明具体TerminateProcess调用，也不能排除其他原生终止路径。仍不满足严格EOF收尾要求，不改旧W20 FAILED。

## 实施中发现并处理的问题

1. 诊断配置最初给model_provider.base_url加/v1，违反已有synthetic-provider仅origin校验，在launch前被拒；空data目录证实0客户端，失败目录保留为preflight-origin-invalid。仅修正传参为origin，不放宽生产校验，随后使用本次唯一真实实例。
2. 原诊断报告no_turn=false来自脚本误要求statistics.requests=2。源码initialize独立握手，计数器只计后续thread/start，实际应为1。新增真实本项目协议夹具反例复现false，修复判定并保留generation=0、turn=null、last_method=thread/start、tool_calls=0检查。**未重写原诊断报告，也未启动第二真实实例。** 真实原始报告因此保持DIAGNOSTIC_FAILED；这项计数错误不意味着发送了模型turn。
3. 原有EOF对照测试读取活跃report时出现MCP_REPORT_WRITE/MCP_IO。Windows打开文件与原子rename并发冲突，增加stderr采集后复现。测试改用已初始化通知后的ping响应作为协议屏障，不再竞争读取；12次连续合成重复通过。诊断活跃读使用.NET FileShare.ReadWrite|Delete，不干扰rename。未改变生产桥写入或吞掉错误。

## 下一步与限制

下一实现方向：由所属运行控制器协调桥停止接收工具请求、排空在途读取、等待桥EOF/确证退出，再关闭宿主；或利用固定客户端已验证的正常thread卸载接口。必须先核实固定协议和实现可行性，不能假设不存在的shutdown RPC、信任PID文件、杀原实例、忽略非零退出或把“无残留”当优雅关闭。

只读检查此前固定客户端导出的本地schema确认存在`thread/unsubscribe`：参数仅threadId，响应status为notLoaded/notSubscribed/unsubscribed。该schema只证明接口存在，不证明会优雅关闭MCP；本次没有调用。下一最小实测可在另批的一个无模型实例中，先对自有thread unsubscribe、观察桥进程退出，再关闭宿主；不读用户thread，不使用archive/delete。

本轮只交付诊断与测试工具，没有给生产关闭路径补假成功。新的实际客户端收尾复验仍需另批；付费模型授权没有追加。合成/无模型/既往付费记录分开，Windows强制隔离、原生点击、250产品验收不升级。检查结果在exit-verification.json；原始脱敏报告在exit-diagnostic.json。作者自检非独立审核。
