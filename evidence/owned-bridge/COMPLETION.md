# W23 受信桥运行装配

由bd57585继续，在D盘工作区将三个既有模块迁入service构建（非复制），新增固定relay入口及createOwnedBridgeFactory。默认不注册HTTP/原客户端/UI，不调用模型。HANDOFF摘要仍9E057D55395FAABD77A175B64042F18DF24A7AC53334C10A0A370D3F06DF0586。

## 验证

- npm run verify：667/667，0失败0跳过，格式/类型/生成/编译冒烟通过。
- 工厂专项12/12；W23_COMPILED=1为12/12，其中正常工厂/桥/relay使用dist，代码变更反例故意复制源码。不把测试HTTP/CoreService装配称整套生产部署。
- 原43项搬迁回归保持，另加报告硬链接拒绝1项。
- 原生14+1、旧包989文件、P0 13项通过；设计校验另见plan报告，250项NOT_RUN不变。

正常顺序：固定本地入口及摘要→复查授权→新独占目录/固定合成配置→启动桥→认证relay ready→合成task_get→1000只读状态/无额外DB写入→桥exit0/EOF证据→relay exit0→宿主回调退出证明→只删除bridge.json。用户marker及最终report保留。未知宿主/撤权/abort均不得记closed；失败清理自有句柄不改变验收。

## 根因与反例

原型最终报告缺lstat检查，硬链接也可通过：增加单链接普通文件和64KiB上限，定向红绿。abort/stop竞态首次原因被后续断线覆盖：保留首次错误并阻止迟到成功。工厂启动在relay认证前返回：立即stop稳定得到RELAY_NOT_OPEN，改为有界等待认证ready并复查授权；没有把认证当MCP初始化。未初始化stop必须真正失败。初次verify的两处import格式失败已修正常格式，未关闭校验。

原始日志：.runtime/w23/owned-red.log、hardening-red.log、readiness-red.log、verify.log（格式失败）、verify-final.log（667通过）、compiled.log、native.log、package.log、p0.log。仅作者自检，无独立审计。

## 限制

完整性固定当前Node及service目录代码，不是签名/全依赖供应链验证；lstat与spawn间同用户竞争仍需Windows隔离，不据此开启真实写入或私密执行。工厂直接拥有relay stdio，不代表厂商会正确启动/退出该relay。正式Codex配置及受信生命周期组合另行准备。原客户端启动0、模型0、用户凭据复用0；W20仍FAILED，管家未构建。
