# W23 受信桥运行装配

## 目标与选择

用户要求持续推进到需要具体决定为止。承接W22，将已验证的监督器/转发端迁入service源码并提供默认不启用的受信装配，避免复制另一套协议。只新增固定本项目Node入口，保留原客户端身份；不启动原客户端、不用模型、不改UI、数据库或管家。Windows强制隔离仍暂缓。

选择：直接改所有控制器会扩大影响；保留tests永远无法交付；采用三个模块原位迁入service、测试改import，加一个明确拥有子进程的工厂。工厂不接受任意命令/参数/环境、不读取用户配置，不与HTTP/原生UI自动注册。后续Codex控制器组合必须验证不绕过现有授权及unknown锁规则。

## 装配边界

- 固定相邻mcp-entry、bridge-relay-entry与当前Node。工厂创建时固定Node和本项目运行目录内全部TS/JS文件摘要；每次启动复验，拒绝链接/硬链接、文件替换和新增代码。摘要是本地完整性检查，不是发布签名或防同用户TOCTOU。
- 输入为绝对dataRoot和McpReadClient可验证的synthetic_only配置；每次调用明确stillAuthorized，创建目录/启动前复查。全新独占目录，配置wx，终态只删除本次固定配置文件、不递归删除目录或证据。
- 默认最小环境，不继承NODE_OPTIONS/provider/API密钥。业务token仅桥配置，relay能力仅一次环境，stdio直接给受信调用者；本模块不向原客户端注入配置，不接管旧PID。
- 状态只读、单次关闭Promise；桥→relay→宿主顺序验证。失败关闭端点并以自有句柄清理子进程，清理不能改变失败判定。未观察退出不能假定资源停止。配置清理失败显式报错。
- 报告只能读本次新目录固定report.json，lstat普通单链接/大小校验后读取；既有报告不得复用。当前同用户本地测试不构成Windows强制身份隔离。

## 实施计划（executing-plans，内联，无子agent）

1. 将tests/bridge-supervisor.ts、bridge-relay.ts、bridge-relay-io.ts移到packages/service/src同名文件，改现有相关测试import；保留43项既有行为回归。新增bridge-relay-entry.ts替代测试启动入口的生产等价。不移动故障fixture。
2. `owned-bridge.ts`导出`createOwnedBridgeFactory({dataRoot, config})`，返回fingerprint与`launch(stillAuthorized)`；handle提供input/output、snapshot、stop(closeHost)、abort。先测拒绝非法配置/路径/授权/代码变化，再最小实现。
   ```ts
   const factory = createOwnedBridgeFactory({dataRoot, config});
   await assert.rejects(factory.launch(()=>false), /BRIDGE_AUTHORIZATION_CHANGED/);
   assert.deepEqual(readdirSync(dataRoot), []);
   ```
3. 真实编译工厂→桥/relay→合成HTTP/CoreService任务→零写入进度→有序stop；错误/撤权/启动失败/未知宿主/重复关闭与凭据清理分别验证。运行不调用厂商。
4. 同期补监督器最终报告单链接/类型/大小检查测试，再实现；保留所有既有反例。全量verify、原生、旧包、P0/设计，README及脱敏证据，扫描提交普通推送。

## 不可混淆

服务源码可构建不等于客户端接入已验收；W20仍FAILED。原客户端无模型实测与付费联合测试要各有新授权。真实厂商控制器组合、系统ACL、签名发布和用户点击不从本阶段合成结果推定通过。

## 执行结果

全量667/667，新增工厂12项、报告硬链接1项；原43项搬迁回归保持。工厂编译入口专项12/12（负例代码变更仍使用独立源码副本，正常生命周期使用dist工厂/bridge/relay）。原生14+1、旧包989文件、P0通过。报告链接和abort/stop首因覆盖先红后绿；启动函数过早返回导致立即停止RELAY_NOT_OPEN，改为等待认证ready后再返回，不伪装成MCP初始化完成。未初始化立即stop仍因真实桥exit1拒绝。首次verify发现两个迁移import格式问题，正常格式化后重跑，不关闭检查。临时源码副本只在.runtime/w23，不上传。
