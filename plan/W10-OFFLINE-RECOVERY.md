# W10 本机离线灾备基础

## 选择与非目标

按PRE-COORDINATOR-FOUNDATIONS.md完成当前开发栈的受限恢复闭环，不是生产在线灾备或WBS W11全部交付。只允许可信本机维护调用createRecovery/verifyRecovery/restoreRecovery；不挂Agent工具、不自动安排备份、不外发、不覆盖实际用户库/旧包。

## 切点与完整性

1. 对存在的schema4数据库持有BEGIN IMMEDIATE写屏障；迁移摘要、完整性、外键先校验。所有run必须closed、claim必须released、无锁或未完成journal。Runner有host/worker PID但缺job_empty证明时仍拒绝，UNKNOWN绝不当停止。
2. 使用独立只读SQLite连接的online backup API取得一致副本，不能只复制主文件。屏障期间普通平台事务不能变更事实。
3. 固定每个受管独立开发Git仓库的HEAD、refs、全部对象（含不可达/仅index引用对象）、原始index、工作树字节。未跟踪文件必须由可信维护参数逐项允许；未允许的文件报错，不悄悄遗漏。
4. 不运行checkout、hooks、filters、外部diff或网络；禁止替代对象库、split index、浅克隆、子模块、链接/硬链接、LFS指针等未实现形态。Git配置/hooks/remote、原客户端状态与OS隔离不在恢复范围。
5. 文件和Git在SQLite异步备份结束后再次核对。副本撤销所有grant/feed、移除配对/会话/签名密钥、失效adapter连接；secure_delete和VACUUM去除旧凭据残留，副本转DELETE journal确保反复校验不会生成WAL/SHM。源库不变。
6. manifest逐文件SHA256、字节数、精确闭包与迁移版本；先验证内容再写COMPLETE标记。失败只留下明确的INCOMPLETE本地材料，不能用于恢复。备份包不允许额外或遗漏的未声明内容。

## 恢复

只接受不存在的新目标目录。消费每个对象前按manifest重新检查字节，恢复全部Git对象与refs/HEAD/index/工作树，运行git fsck并核对状态和对象摘要；随后复制数据库，重映射受管工作区路径并产生新owner签名密钥。保留任务、audience、ACL和历史，但旧token拒绝、run不恢复、锁不擅自释放。最终标记RESTORED_OFFLINE，需重新配对与明确重新授权，不自动启动任何客户端。

## 明确限制

- 仅适用于本机、已停稳的受管development仓库和当前schema4数据形态；不接管现有外部仓库，不复制原客户端配置/凭据。
- 开发态数据库屏障与前后摘要核对不是Windows强制隔离；不能证明任意外部旧进程或恶意写入者已被隔离。活跃/未知工作区直接拒绝，不能据此提升G0/G1。
- 当前实现尚无在线备份调度、离机加密密钥管理、增量链、生产GC pins协议、实际磁盘丢失RPO/RTO测量、安装签名或生产升级资格。这些不能以本机合成恢复代替。
- Git源码历史本身是项目数据，不承诺移除项目历史中的所有秘密。包仅留本机，不能把它当脱敏群导出或自动上传；平台可用凭据不入包。

## 验证与根因记录

tests/recovery.test.ts和编译走查覆盖真实SQLite WAL源、一致写屏障、真实Git与分离的staged/unstaged/二进制、旧token失效、摘要篡改、闭包遗漏、路径越界、现有目标保护、并发改动与未知生命周期拒绝。曾复现只读校验创建WAL旁路文件、异步窗口漏检、manifest可遗漏保留文件、host无退出证据漏拒绝；均增加回归后修复，不删断言。最终执行记录见阶段COMPLETION.md。
