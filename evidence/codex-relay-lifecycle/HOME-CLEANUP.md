# W27 所属home配置清理

只提供受信装配回调，不默认接入官方启动器、不启动原客户端/模型。captureCodexHomeCleanup捕获固定dataRoot/codex-init-*/home/config.toml的身份、祖先目录身份、SHA256；清理前复验，拒绝越界/链接/替换/缺失，只unlink固定配置，成功调用幂等。不是递归清理或全目录残留扫描，不声称抵抗恶意同用户并发路径替换的Windows强制隔离。

新增9项真实临时文件系统测试：正常且保留成果、错误布局/越界、硬链接、联接点、配置内容/身份/目录变化、消失、捕获后硬链接；9/9通过。W26十二项桥/relay测试接入真正清理回调，正常退出配置删除、未知宿主退出配置保留分别断言。红测为新模块缺失，未降低断言。

编译启动器预检使用Node可执行文件副本，在spawn前撤销授权：确认官方启动器产生的隔离home布局/relay配置可由新清理器清除，client_processes_started=0、model_calls=0。不是原客户端实测。编译W25用户顺序合成流程再次SYNTHETIC_REHEARSAL_PASS（10项检查），不追认新生产资格。

日志位于.runtime/w27；全量与设计最终结果以根README与阶段计划为准。HANDOFF冻结、W20 FAILED不变、W25原单次授权已消耗、Windows隔离暂缓、UI最后、管家不构建、250项AT/CA仍NOT_RUN。下一入口是产品Windows OS观察器及可信启动装配，真实新增操作仍需具体授权。

全量首次697/698：bridge-supervisor的exit故障负例实际先命中300ms排空超时，而非预期早退。根因是测试把Node冷启动时间算入排空预算，未等夹具就绪；加入400ms确定性启动延迟复现同一错误（startup-red），再让故障夹具在监听完成后写stderr readiness屏障，测试收到后才发送请求/启动排空。300ms原断言与生产deadline均不变，无新增生产重试，15项监督器专项全部通过（startup-green）。这不是扩大超时或同时接受两种错误。
