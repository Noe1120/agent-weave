# W29 受信官方Codex relay启动组合

目标：将W23桥工厂、W26关闭内核、W27固定配置清理、W28持句柄观察组合为默认不注册的officialCodexRelayLauncher。保留官方原客户端身份，不接公开HTTP配置或任意命令，不开启真实运行。仅Node合成与禁止spawn预检；管家不构建、Windows隔离暂缓。

## 最小方案

官方启动器增加可选的受信进程内lifecycle参数（不进入JSON profile）：prepare(workDirectory)在写完新home配置后、spawn前捕获清理；返回attach(host, ownedChild)和abort。捕获成功后准备失败/授权丢失仅清本次配置，捕获本身失败保留不可信文件并报错；所属进程已启动时先关闭并确认退出，未知时保留配置。旧默认启动器不启用这些组合，不改现有profile/控制器协议。

新增Windows子进程观察入口，输入仅真实持有的ChildProcess和固定relay入口；固定PowerShell持父Process.Handle，唯一匹配父PID/Node executable/精确命令行的子进程，持子句柄后复核父子/启动顺序。父进程已退出、无匹配/多匹配、命令不符全部拒绝。不给客户端自报PID/自由命令；严格匹配可能需后续授权实测确认厂商命令行格式，不暗中宽松匹配。

官方组合在launch时prepareClient、解析工厂自有descriptor、创建官方launcher和清理hook；startThread后桥ready再观察relay，关闭复用W26。静态fingerprint绑定官方profile与桥工厂，不使用每次随机token产生新的配置身份。任何失败保持失败，清理错误不吞掉。未装入main默认启动路径。

## 实施（inline TDD）

- [x] 测试受信hook准备后授权丢失不会spawn且配置清除；未知宿主不释放清理由既有W26负例保持。先写失败用例，再最小修改officialCodexLauncher。
- [x] 新子进程观察器用自有Node父/子夹具验证唯一匹配、退出、无匹配、错误入口/多匹配；固定数字与编码路径传参，绝不扫描历史。
- [x] 新官方组合构造/拒绝非法profile/未授权零启动测试；编译禁止spawn路径验证bridge与home配置清理；实际完整Node链验证正常/撤权组合顺序。
- [x] 全量/编译用户路径/原生/包/P0/设计/暂存扫描，README实时更新，HANDOFF冻结。若需真实新配置验证，必须另行授权，不消耗旧W25许可。

最终全量709/709，0失败/0取消/0跳过；编译生命周期3/3、禁止spawn预检PASS、业务合成10项检查通过；原生14+1、旧包989、P0 13项、设计68文件/67摘要。普通推送状态以Git远端核对为准。真实新增客户端/模型调用为0，下一门槛需要新的单次无模型授权。
