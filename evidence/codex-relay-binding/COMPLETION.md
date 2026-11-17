# W24 原客户端 relay 绑定准备：限定离线完成

工作区D:\Users\1\Desktop\team，承接W23提交7115b60。原客户端启动0、模型调用0、用户凭据复用0、窗口操作0。HANDOFF保持SHA256：9E057D55395FAABD77A175B64042F18DF24A7AC53334C10A0A370D3F06DF0586。

## 实际交付

- createOwnedBridgeFactory.prepareClient复用已有桥/认证端点，提供固定relay命令与一次环境能力，平台不拥有原客户端创建的relay。未绑定为waiting，独立exit回调结果进入只读快照。abort只清理自己直接拥有的桥/端点与bridge.json，不按外部PID杀进程。
- officialCodexLauncher增加严格可选relay_binding，只允许port/instance/token；固定相邻编译relay入口、启动前摘要复验，与旧bridge互斥。环境能力不出现在命令参数或状态快照。原provider/code_mode/默认启动方式不改，没有默认注册到HTTP/UI。
- 未消费端点能力到期主动拒绝ready，避免永久悬挂；认证、失败与dispose清理计时器。
- 编译启动器配置预检脚本只使用Node副本作为待验证文件，在spawn前第三次授权检查拒绝；验证relay-only的隔离配置确实写入并删除能力副本。未执行该副本，也未运行厂商程序。

## 验证分层

| 层次 | 实际结果 |
| --- | --- |
| 全量npm run verify | 673/673，0失败、0取消、0跳过；类型/格式/生成/构建/编译冒烟通过 |
| W24新增 | 工厂2项、配置3项、端点过期1项；原回归保留 |
| 编译工厂专项 | W23_COMPILED=1，14/14；正常工厂/桥/relay来自dist，变更拒绝反例用独立源码副本 |
| 编译配置预检 | PASS，client_processes_started=0，model_calls=0，relay_only_config_written=true，capability_copy_removed=true |
| 原生回归 | C# 14/14 + WPF静态1/1；不是点击或视觉验收 |
| 旧包回归 | 989文件PASS；未重打包、未升级用户数据库 |
| P0/设计 | P0 13项；设计63文件/62摘要PASS；AT190/CA60仍NOT_RUN |

合成用户操作顺序：创建合成任务/受限只读grant → prepareClient等待 → 用返回的固定入口启动实际Node relay → MCP initialize/initialized → task_get返回真实服务任务 → stop排空 → 桥EOF与exit0 → 实际relay ChildProcess close证据 → 所属宿主回调 → closed与临时业务凭据删除。客户端与宿主仍是测试装配，不能称原生厂商实际操作。

## 错误、根因与处理

- 外部relay退出没有快照：补外部回调返回的exit记录，仍由既有端点严格验证code0/exit_observed/非强制。
- 未消费能力过期后ready不settle：初始用例悬挂，核实后仅停止所属测试runner；加入3秒上界复现失败，随后补实际expiry拒绝，未取消超时断言。
- 未认证prepareClient误显示open：waiting断言复现失败后修正投影，不把配置生成或监听成功当上线。

本地原始日志：.runtime/w24/config-red.log、external-exit-red.log、expiry-bounded-red.log、waiting-red.log及对应green；最终verify-final.log、compiled-final.log、compiled-preflight-final.log、native.log、package.log、p0.log、design.log。不上传原始运行目录。仅作者自检，没有独立审核。

## 未交付与下一门槛

此阶段只完成默认关闭的代码及离线准备。尚无W24真实原客户端验收脚本运行，也未证明厂商是否自动重启relay。真实装配必须在停止前持有Windows relay进程句柄，不能相信socket或自报exit；外部回调本身是受信边界，并非进程身份认证器。

工厂仅删除自己的bridge.json；原客户端隔离home含一次relay能力的config.toml必须由单次验收装配另行删除和限定扫描，当前启动器不自动代清理。代码摘要不是供应链签名，不消除同用户TOCTOU，不构成Windows强制隔离。默认服务没有自动启用本功能。

下一步另行获得一次独立Codex无模型生命周期操作授权，再准备并验证显式单次装配：空home/回环拒绝provider、一个thread、无turn/无provider凭据复用、独立OS退出证明、原清单不变、仅清理自有目录，失败不自动重试。即使该无模型实测通过，也不追认W20联合验收通过；W20仍FAILED。Windows隔离实测暂缓，UI点击/生产灾备/签名升级未交付，管家不构建。
