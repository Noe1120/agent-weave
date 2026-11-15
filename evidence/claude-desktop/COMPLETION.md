# W13 Claude Desktop当前交付记录

日期：2026-11-16（Asia/Tokyo）。状态：**真实本地MCP握手/工具发现与合成只读桥已通过；完整Claude任务接入尚未完成。** 不将工具发现写成模型实际执行。

## 根因与实际完成

- 保留官方Claude Desktop 5.11492.2身份、签名与固定EXE/ASAR摘要，不替换为Code/SDK/API。前四次失败和首次遗留清理原始记录保留。
- 本机只读核实CC Switch 4.0.16配置DB中的Desktop provider、选定3p配置库及所属回环gateway；仅配置元数据，不读取聊天/请求历史、不输出密钥。旧official/direct选择字段不代表完整活动路由。
- 根因是独立空profile未带实际第三方连接，且固定Desktop将3p userData移到LOCALAPPDATA/Claude-3p。已纠正“需官方登录”推断，不改用户模式，不索取官方订阅登录。
- 第五次真实空MCP握手通过；第六/七次真实编译只读桥握手及tools/resources/prompts发现通过，**tool_calls均为0**。第七次使用最终构建，早期构建摘要独立保留。
- 每次只复用选中本机gateway令牌到新标准Windows profile，不复制上游provider秘密、历史或cookie。原四份配置摘要不变、原六个DSH进程不变；根句柄退出、Job为空、host退出均确认。回收是强制终止，不是Desktop正常EOF，也不是OS隔离。
- 三个测试profile的复制令牌已清除，180/315/318文件的精确令牌扫描均0匹配/0未读；扫描仅覆盖自建已停止目录。临时服务grant撤销、配置token清空。

## 源码与用户路径检验

- 固定范围stdio桥提供task_get、project_progress与可选message_poll；不开放写入/shell/控制/模型调用。服务逐次复核grant、policy、run与资源ACL，拒绝模型指定URL/token/project。新增task第七类安全投影，core/1.0及schema4/001–004不变。
- **仅用于合成验收**：synthetic_only/provider_fingerprint为可信配置声明，尚不提供服务端生产分类或实际provider网络绑定。不能配置真实私密数据或宣称生产外发安全；生产邀请/受保护凭据/原生会话绑定未交付。
- 全量verify **419/419，0失败/0跳过**；Claude专项 **63/63**。构建/类型/格式/生成与编译冒烟通过。默认verify不启动真实Agent。
- 编译stdio走查：连接→读取任务→20次只读进度→EOF→重连→再次读取及20次进度→撤权拒绝→EOF，零读取写入。合成客户端，不是原生点击或模型操作。
- 原生 **14组C# + 1项WPF静态**通过；旧包 **989文件**通过。设计/P0结果见[验证汇总](verification-summary.json)。
- 预启动错误清除复制凭据有红绿回归，清除错误不吞掉。首轮OpenAPI路由数旧断言失败及首轮走查错误ready预期均保留；task路由为有意新增，apply_plan后实际契约仍queued，没有改状态机或删安全校验。

## 尚未完成及明确入口

真实Desktop的一次模型工具往返/消息回复、自动唤醒、忙碌排队、切会话/最小化、取消恢复，以及同配置私密隔离和Windows强制隔离未验收；原生WPF点击、生产注册/安装升级仍未交付。**L1–L3不升级，250 AT/CA保持NOT_RUN，管家未构建。**

下一具体验收需在新测试profile通过获准窗口操作发送一条合成task UUID请求，由现有CC Switch provider调用task_get并复述状态；不接触已有对话，不改原配置。仍需具体窗口与一次模型任务/费用授权；此前窗口访问拒绝不能通过内部IPC/CDP/其他点击工具绕过。无支持的驱动接口时保留能力阻塞，不用Code或直接API替代。

[作者自检](author-self-review.json)不是独立审核；无网络/文件访问审计。只上传五份脱敏文本，profile/配置/数据库/原始诊断/第三方源码不上传。详见[W13计划](../../plan/W13-CLAUDE-DESKTOP-MCP-PROBE.md)、[真实尝试](real-attempt-report.json)和[本机预检](preflight-report.json)。

发布前复验新增定位DSH合成测试时限问题：正常流程三个RPC均已确认，但测试辅助统一只给300ms EOF退出时间；32路并发复现31通过/1个DSH_EOF_TIMEOUT（实际exit0但超时已触发，仍正确判失败）。增加600ms延迟EOF的确定性红绿回归，普通退出使用已有探针默认5秒预算；故意忽略EOF/后代持管道的故障用例仍300ms、原失败断言保留。37项会话回归及32路并发通过；不修改生产DSH控制器或协议辅助，也没有新增真实DSH调用。原始复验失败/压力复现均保留，不能把旧失败日志改成通过。

另一轮全量复验触发W07 flood退出竞态：原生host因输出超限退出时，控制器仍在写ack，输入EPIPE先到使RunnerHost停止读取stdout，丢失后到的独立Job-empty/exit证据。确定性回归复现后，输入故障保持可见，但继续严格解析独立输出；只有完整合法exited及host退出0才能保留证据。畸形输出/缺失证据仍UNKNOWN；controller保留实际输出超限根因，任务仍失败、grant撤销、锁隔离，不把错误改成成功。新增输入故障/同时输出损坏两条回归，原flood失败断言不变。仅修改W07开发运行器，不扩大原客户端或OS资格。
