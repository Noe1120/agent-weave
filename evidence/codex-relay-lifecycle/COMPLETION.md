# W26 生命周期服务组合（2026-11-17）

限定结果：service内组合与合成集成完成；没有新增真实客户端/模型任务。官方启动器与HTTP默认注册不变，生产OS观察器和安全home清理器尚未装配。W25实测不自动适用于此新组合，W20历史FAILED保留。

## 实现与验证

- composeCodexRelayHandle统一关闭准入、桥排空/EOF、独立relay证明、宿主退出及清理责任。查询克隆、授权丢失拒绝新操作；未知宿主退出保留closing且不清home。
- 新专项12/12；W25编译链2项随全量通过。全量npm run verify：689/689，0失败、0取消、0跳过；生成/格式/类型/编译/本机HTTP冒烟通过。
- npm run test:native：14/14 C#与1项WPF静态；旧schema2包989文件保持；P0 13项通过。没有窗口点击验收。
- 编译用户路径：node tests/codex-joint-live.mjs --fixture --relay --output <全新目录>，10项检查全部通过，SYNTHETIC_REHEARSAL_PASS。一次合成task读取、1000次只读进度、撤权后拒绝、桥EOF/exit0→Windows实际句柄relay exit0→Node宿主exit0/非强制；扫描4文件零残留。这是实际平台服务/桥及Node协议替身，不是模型选择或厂商验证。
- 本地日志在.runtime/w26：red、unknown-red、observer-red、early-observer-red、handle-final、verify-final、native、package、p0、walkthrough。原始运行目录/凭据不上传。

## 根因记录

1. 未知宿主退出被包装状态误报closed：以exit_observed门控，负例保留。
2. close期间观察器完成，晚到处理和正常关闭同时dispose：将晚到责任限定为等待已放弃，恰好一次回归。
3. 宿主早退先完成cleanup，随后观察器返回泄漏：独立cleanupStarted标志转交晚到句柄，红测0≠1后修复为1。
4. 搬迁关闭内核后精确故障码属于service而非旧helper；负例仍要求CODEX_RELAY_CLOSE和failed，无放宽成功条件。

作者自检，不称独立审核。HANDOFF摘要保持9E057D55395FAABD77A175B64042F18DF24A7AC53334C10A0A370D3F06DF0586。下一入口为所属home配置清理及OS观察器的受信产品装配；先做合成反例，实际客户端/凭据复用需新增具体授权。Windows隔离暂缓、管家不构建、UI最后，250 AT/CA仍NOT_RUN。
