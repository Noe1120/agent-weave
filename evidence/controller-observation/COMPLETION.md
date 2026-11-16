# W19 控制器只读观测桥合成集成

日期2026-11-16；D盘主工作区；基线e010ee9。

CodexRuntimeController.connectionObserver可信工厂固定所属instance、原生thread摘要、控制grant快照，逐次检查现有adapter_read/policy/run/resource和controller.read所属句柄状态；兼容W17只读task授权。工厂与回调均无启动/turn/心跳/停止操作。仅development_fixture来源；official_codex明确拒绝。没有通用HTTP自证接口，没有读取原客户端私有历史。

平台native_binding不冒充原生thread；工厂另固定thread摘要验证会话连续性，不返回thread/消息/密钥。关闭、run未知、epoch变化、grant/policy撤销、instance/thread/config变化、不同controller均拒绝。旧grant不因此解锁或变更业务任务。W17资格保持synthetic_only。

## 验证

- npm run verify **595/595**，0失败/0跳过，本阶段新增13项。Codex runtime34项+connection-task43项=77项专项通过。
- 编译后JS、真实回环HTTP、真实本项目合成子进程：主人邀请/兑换→合成控制器initialize/thread→观测工厂→W17 grant→100次读取0DB写入/0turn→关闭自有夹具→旧task token拒绝，task仍draft/run仍active→撤销登记。不等同真实原客户端验收。
- `node tests/controller-observation-walkthrough.mjs`在npm run build后复现；全量回归亦跑原有厂商协议夹具，无真实模型。
- 原生14/14+1静态；旧schema2便携包989文件；P0文档13/13；设计58文件/57摘要通过。正式190AT+60CA仍NOT_RUN。

## 根因与修复

最初编译用户顺序真实时钟下出现GRANT_REVOKED，而固定时钟测试正常。追踪至W17在observe调用前取鉴权时间，observe完成时已跨毫秒，observed_at略大于旧time，被误判未来。新增可控时钟每次observe推进1ms的回归，红灯复现相同错误。修复改为observe完成后取checkedAt，再校验未来/30秒陈旧/期限/时钟回拨；不增加容忍窗口，不跳过检查。原未来时间反例仍通过。

第二次走查暴露脚本从旧示例迁移留下observation变量引用；改为实际observe(id)结果后通过，保留失败日志。首轮新工厂缺失红灯与这些失败均在.runtime/w19，未覆盖原日志。SQLite实验警告保留。

作者自检，非独立审核。0真实原客户端启动、0付费模型、0窗口点击/系统策略；HANDOFF SHA256仍9E057D55395FAABD77A175B64042F18DF24A7AC53334C10A0A370D3F06DF0586。数据库schema/迁移/用户配置/旧包不改。

## 下一真实门槛

新隔离home、固定Codex/CC Switch路由、一次合成只读task_get、同次联合撤权与所属进程退出/凭据清理。需新的具体客户端/必要凭据复用/外发/费用token上限授权，旧单次许可不复用。真实模式的代码门仍关闭；授权后仍需先落实受信数据分类和固定配置约束，不直接取消source检查。

DSH生产initialize-only、Claude长期controller、attached_session、Windows隔离、原生点击、生产在线/离机灾备、签名安装升级及250正式产品验收不因本阶段升级。管家不构建。
