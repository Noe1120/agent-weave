# W21 平台持有MCP桥：离线验证

## 结论与范围

完成用户批准的离线设计及合成原型验证；不代表真实Codex收尾已修复。工作区为D盘主目录，HANDOFF.md未修改。W20真实联合验收及其两个无模型退出实验仍为FAILED。本轮0原客户端启动、0模型调用、0用户凭据复用、0窗口操作、0系统隔离策略变更；未构建管家。

设计源：plan/W21-BRIDGE-SUPERVISION.md及03 §16。实现只在tests/bridge-supervisor.ts、tests/bridge-supervisor.test.ts、tests/fixtures/bridge-fault.mjs；生产启动器、生产关闭逻辑、数据库schema、旧便携包均未改。

## 操作顺序验证（合成用户路径，不是窗口点击）

1. 在新临时目录创建合成任务和限定read grant，启动本项目MCP桥子进程。
2. 初始化、通知initialized、ping屏障后发起真实task_get；测试HTTP路由刻意暂停在途读取。
3. stop同步阻止新request/notify；连续1000次快照只读，宿主关闭次数仍为0。
4. 放行HTTP，CoreService读取授权内的真实合成记录，桥返回同task ID与draft；恰好1次成功读、数据库total_changes不增加。
5. 等响应排空后向桥stdin发送EOF；必须等OS child close、退出0/无signal及最终桥报告initialized/EOF/无fault/无工具错误同时成立。
6. 之后才关闭单独Node测试宿主并核对退出；重复stop复用同Promise，宿主关闭仅1次。

真正项目桥和CoreService是被测实现；HTTP装配及Node宿主是合成夹具，不是Codex。故障脚本仅注入反例，其自造不合格报告从不用于成功路径。W21_COMPILED=1仅将桥换为构建后dist入口，不能称整个生产连接器已编译集成。

## 故障覆盖

14项覆盖正常顺序、排空超时、桥提前退出、未知响应ID、畸形JSON、输出超限、缺EOF、非零退出、缺最终报告、EOF后不退出、pending/输入上限、宿主超时及迟到成功、宿主退出未知、排空期间撤权。失败不自动重试/重启、不跳过错误、不声称closed；test finally清理所属夹具不改变失败判定。撤权用例真实拒绝服务读取，不延长grant，不释放业务写锁。

## 失败与根因

- 初始未实现的红灯日志保留在.runtime/w21/red.log。
- 编译桥专项首次13/14，HOST_EXIT_TIMEOUT用例却先遇到BRIDGE_EXIT_TIMEOUT：500ms共享截止期在并发回归负载下不足以让正常桥退出，拒绝处理器也注册过晚。
- 修复测试时序：立即订阅拒绝，正常桥允许3000ms共享停止期限；宿主仍故意不返回，必须收到HOST_EXIT_TIMEOUT，迟到success不得改变failed。修复后14/14。未删除或弱化相关断言，未修改生产代码。原失败日志保留在.runtime/w21/compiled-journey.log。
- 首轮全量625/625后，重新全量出现624/625，已有DSH held-pipe用例的forced意外为true。追踪probe代码确认300ms同时限制正常根进程退出和后代持管道；短期限可能先执行kill，不能把此时forced=true归咎为产品错误。8次低负载观测中根退出均早于期限；给夹具根退出显式600ms延迟后，稳定复现相同断言失败。修复测试预算：只有真正ignore-eof用例保留300ms，held-pipe回到探针默认5000ms；后代持管道延至9000ms，仍须观察根exit0/非强制且streams_closed=false。所有断言保留，不改真实探针或生产行为。诊断、定向红绿和全量失败日志保留。

## 验证记录

最终测试计数、命令、退出状态和本地原始日志SHA256见verification-summary.json。原始日志留本机.runtime/w21，不上传临时配置/数据库。作者自检不是独立审核；原生自动化回归不是实际点击。250项AT/CA保持NOT_RUN，客户端完整资格与Windows强制隔离不升级。

最终npm run verify为625/625，0失败/0跳过，含格式、类型、契约生成、构建和编译冒烟；W21编译桥14/14，DSH会话37/37，原生14/14加1静态，旧包989文件，P0 13项，设计60文件/59摘要通过。HANDOFF SHA256为9E057D55395FAABD77A175B64042F18DF24A7AC53334C10A0A370D3F06DF0586，与开工前一致。

## 下一入口

受认证本机薄转发端与单实例绑定、输入背压及累计上限、断线/重连拒绝、open请求超时、监督器崩溃恢复与报告归属验证，先离线合成实现/验证。尚未接入原客户端启动器。完成该装配后，新的真实原客户端无模型测试及任何付费联合测试分别核对具体授权，不沿用已消耗的一次授权。
