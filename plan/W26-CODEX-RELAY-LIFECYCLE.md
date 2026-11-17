# W26 Codex受信生命周期服务装配

承接W25下一入口，用户要求无需普通开发确认持续推进。采用范围受限方案：将已验证的关闭组合提炼成service内类型化CodexHandle包装器，保留已有控制器和官方启动器，不默认注册HTTP/UI，不接受JSON自由命令、不启用真实客户端。直接改所有控制器影响过大，直接搬tests的PID查询/合成分支也不合适；只共享关闭/故障传播内核，OS句柄观察与临时home清理由受信装配明确提供。

## 接口与责任

packages/service/src/codex-relay-handle.ts提供composeCodexRelayHandle({host,bridge,observeRelay,cleanup,stillAuthorized,deadlineMs})。host是真正CodexHandle；bridge为prepareClient结构化接口；observeRelay在新thread/relay认证后返回持有OS句柄的waitExit与dispose，不接受客户端自报PID；cleanup只负责该次所属home能力/凭据副本，bridge.abort负责桥自身配置。不保证回调真实性，可信启动装配必须证明其实现。

关闭门同步阻止新thread/turn/interrupt，正常顺序为桥排空/EOF→外部relay退出→宿主退出→配置清理→包装closed。未知退出不调用home清理、不冒充closed；失败保留安全错误码，主机早退清桥；所有准备/关闭/清理操作有界。所有查询返回克隆，不能靠统计对象反向改原宿主。准备后授权变化拒绝并关闭，不自动重启。

## 执行计划（内联executing-plans/TDD）

- [x] 新增tests/codex-relay-handle.test.ts：12项实际Node协议夹具/桥/relay测试，正常退出、未知/强制relay证据、观测失败、清理失败、未建thread关闭、授权变化、宿主早退与只读查询；先缺模块失败，再实现最小内核。
- [x] W25 helper改为消费service包装器，删除其重复关闭逻辑；保留Windows观察器与合成MCP逻辑在tests。旧W25完整合成流程与缺证明负例重跑，不重跑厂商。
- [x] 全量verify 689/689、编译路径10项检查、原生14+1/旧包989、P0 13项、证据及README。扫描与远端结果以实际Git执行为准。HANDOFF冻结。

## 根因与结果

未知宿主退出曾错误投影closed，已将exit_observed纳入终态判据。关闭期间等待观察器曾双释放，根因是晚到处理和正常关闭同时拥有dispose；现在只在等待已超时/放弃时由晚到路径释放。另发现宿主在观察器准备中早退时，cleanup先结束会漏掉随后返回的句柄；新增cleanupStarted所有权交接，晚到返回由准备路径释放，回归从0次释放失败转为恰好1次。均保留红测日志，不删断言。

W25负例错误码从验收helper专有码改为service的CODEX_RELAY_CLOSE，仍断言精确失败码、桥failed与宿主exit0不能抹除故障。编译后的合成用户顺序走查完成邀请/兑换/任务读取/只读进度/撤权/严格退出/清理；这是Node原协议替身，不是原客户端或原生点击。

## 边界

W25单次实际通过只属于原验收配置，W26不能追认新包装器已真实验证。Windows产品OS观察器、生产安全home清理器与官方启动装配仍需下一子阶段，不用受信回调接口冒充已上线。真实新增操作/凭据复用/计费权限均已消耗；管家不构建，Windows隔离暂缓，250产品验收不升级。
