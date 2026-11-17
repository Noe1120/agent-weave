# W28 Windows持句柄退出观察器

承接W26/W27最小受信装配缺口。用固定PowerShell/.NET观察程序，在确认预期进程启动ticks后保留实际Process.Handle，输出ready；waitExit只等待该句柄并报告真实exit code，不以PID消失/socket EOF证明退出。dispose只结束本模块自有观察程序，绝不结束被观察目标。长任务期间不设固定60s生命周期期限；建立观察有界，关闭等待由W26控制。

入口observeWindowsExit({pid,startedTicks})只供受信进程内装配；startedTicks必须来自独立OS发现，不接HTTP、不接受客户端自报PID、不执行自由命令。它本身不负责发现原客户端子进程或验证祖先关系，下一装配必须在父句柄仍持有时限定唯一relay及其OS身份；不能用这个函数任意宣称relay归属。相比搬整个测试helper/全局扫描，先抽出持句柄小部件可直接测试，范围更小。该原语不是Windows强制隔离部署，不改账户/ACL/网络。

## 执行清单（inline executing-plans/TDD）

- [x] tests/windows-exit-observer.test.ts：只启动自有Node夹具；获取其OS启动ticks，建立观察→结束夹具→真实exit；错ticks拒绝；dispose后目标仍存活；重复dispose幂等。先缺模块红测。
- [x] packages/service/src/windows-exit-observer.ts：固定PowerShell路径、固定脚本、数字参数验证、限量JSONL解析、ready/exit严格判据，错误安全码；不写临时脚本/报告，不启动原客户端。
- [x] W25合成helper的自有relay观察改用生产原语（保持原真实分支不追加运行），编译集成/全量/原生/设计检查，README与证据，HANDOFF不变。

默认官方启动器不启用；真实新装配仍需要单独授权实测。Windows隔离暂缓，管家不构建，250产品验收不升级。

最终W27/W28合并验证：702/702，0失败/0取消/0跳过；原生14+1、旧包989、P0 13项、设计67文件/66摘要；编译合成用户流程10项检查通过。Git扫描与远端以实际执行结果为准。
