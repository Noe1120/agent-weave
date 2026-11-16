# W20 Codex登记与任务只读联合验收

用户在W19后明确同意：现有CC Switch路由、必要配置/凭据仅复用到新隔离目录、一个自有Codex实例、一次合成task_get、撤权/退出/副本清理；30,000 tokens软阈值，金额UNKNOWN，失败不追加付费重试。旧授权不复用。本次不操作已有实例，不读历史，不改变Windows策略，管家不构建，HANDOFF冻结。

## 实施

- 先只读核对固定exe SHA256、provider/model/loopback路由元数据；不输出密钥、不查询原会话。沿用W14成功的gpt-6.1-sol及direct_only mcp__agent_weave_probe，不切官方账户或新API成员。
- W19官方模式默认拒绝保持。新增可信进程内、固定connection/task/configuration/到期的单次合成验收许可；只有对应official_codex实例可以产生观测，禁止第二turn。不是公网/owner HTTP可自证权限。
- 邀请/兑换→原生thread→观测→W17最小task grant存在启动顺序依赖。验收bridge使用无业务权限的随机入口凭据，验收服务仅对固定task GET在grant就绪后转交W17认证；其他路径拒绝。入口凭据不成为控制grant，模型无法获得控制面权限。记录真实服务读取次数。
- 本轮harness只启动一个原客户端实例，不重跑W14独立initialize前置实例。provider retries=0；授权marker独占写入防止误重跑。一次turn开始前所有门必须通过；发生失败仍退出/清理并保留证据。
- 撤销主人连接登记后断言旧task读取拒绝，然后撤销控制grant并通过现有维护路径收束所属进程；必须closed+exit_observed+code0+非强制，不以closing当退出成功。原进程清单及原配置摘要前后一致。
- 清理仅本次专用data_root下的配置/bridge凭据文件，先核实路径、无链接；读取错误算清理失败，不吞异常报告零残留。保存脱敏摘要，原始profile/配置/DB不上库。

## 验证与判定

TDD验证默认拒绝、受限许可、过期/配置/任务不符、第二turn拒绝、alias前置拒绝、清理路径安全；全量服务/原生/P0/设计回归。先合成harness零费用走查，真实运行不以桩代替。成功需一次真实task_get/0工具错误、同task/status原生回复、turn completed、登记撤销拒绝、控制grant撤销退出、原实例/配置保持和凭据副本零残留同时成立。任一不满足如实FAILED或UNKNOWN，不追加付费turn。

本阶段不升级Windows隔离/attached_session/原生点击/250ATCA/生产灾备或签名交付资格。

## 2026-11-16执行结果

一次真实turn已消耗：18,205 tokens，真实task_get=1/errors=0、原生回复匹配、登记撤权拒绝、控制撤权closed/exit0/非强制、原12进程及原配置保持、2份配置删除/2,524文件扫描零残留均成立。严格9组检查中8组通过；桥报告stdin_eof=false使整体FAILED，未删断言、不追认PASS、不付费重试。

只读复查同报告仍false，未发现本次bridge进程。零成本MCP子进程对照：正常stdin.end写入true，abrupt kill保留false。由此把问题定位到原客户端与MCP桥的退出协议/证据边界；未捕获厂商具体终止动作，不能将推测视为已证实根因。下一步需要新的无模型自有原客户端thread/MCP退出诊断授权；若以后需真实模型复验，仍需另批，不能复用本次授权。证据见根evidence/codex-joint。

此前仅启动前BOM解析失败，未创建client-data/turn标记，0客户端/模型。新增反例后修复，不修改原配置；保留原失败报告及原错误的摘要未测量判定。marker移至真实start前独占写入；旧前置marker存档而非删除。
