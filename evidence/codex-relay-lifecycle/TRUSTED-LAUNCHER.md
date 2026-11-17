# W29 受信原客户端启动装配（合成）

新增officialCodexRelayLauncher与共享createCodexRelayLifecycle。显式受信构造，不自动注册HTTP；不换厂商身份、不提供自由命令。官方启动器可选prepare/attach/abort钩子，在配置生成后、spawn前捕获本次清理；授权变更拒绝时删配置，已启动宿主仅在退出确证后清理，未知保留。准备捕获本身失败则保留不可信文件并报错，不绕过路径校验强删。

子进程观察器仅接真实持有ChildProcess和固定relay入口。持父Process.Handle、唯一匹配父PID/Node可执行文件/精确命令行、持子句柄后二次核验父子及启动顺序，再ready与实际exit证明；无匹配/多匹配/父退出拒绝。此机制不是Windows强制隔离，不能阻止恶意同用户进程。

## 分层证据

- 七项新增专项：prepare后撤权不spawn且清配置；实际Node协议父进程启动真实relay，正常/撤权均桥→relay→宿主严格退出并删home配置，generation0；未授权构造零尝试、缺安装时桥配置清理、provider摘要变化拒绝、错误target拒绝；子进程唯一/错误入口/多匹配三项。
- 编译预检node tests/codex-trusted-preflight.mjs：只用Node副本与合成token，官方launcher在spawn前撤权，home_and_bridge_capabilities_cleared=true，client_processes_started=0/model_calls=0。
- W29_COMPILED=1专项使用dist生产模块/relay，Node宿主仅为协议夹具。完整W25业务合成流程继续验证邀请/单任务授权/只读进度/撤权，不冒充模型调用。
- 原生与包/设计/全量最终结果见根README和W29计划；原始日志.runtime/w29不上传。无窗口点击、原历史读取或新增原客户端/模型操作。

## 失败与修复

1. hook红测因旧启动器忽略第二参数而未拒绝；加入prepare与清理后通过。红测只运行本次Node副本，不是官方客户端。
2. 重新构造底层launcher会重新固定provider摘要，使原配置改动漏检；用合成配置修改复现（pin-red），现在桥准备前后与构造时base fingerprint比较，不创建桥来掩盖变化。
3. 泛用桥工厂接受其他target，但Codex组合不应接受；target-red证明漏校验后增加codex硬门，不改泛用桥规则。

当前只完成合成装配，实际厂商relay命令行是否精确匹配、同配置退出与新home清理仍需新的独立无模型实测；W25单次许可已耗尽，不追认历史真实成功适用于新实现。下一决策只涉及一个新实例/一个thread、空home/拒绝provider、无turn/无凭据复用/不碰旧实例，失败不自动重试。W20历史失败保留，AT/CA未升级，管家不构建，HANDOFF冻结。
