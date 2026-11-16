# W20 Codex登记与任务只读联合验收

日期2026-11-16，D盘主工作区，基线3b54096。**严格验收FAILED，不宣称本阶段整体或Codex整体接入完成。**

## 已证实的真实结果

固定官方Codex 0.167.0-alpha.3.2 / gpt-6.1-sol / 既有CC Switch custom loopback route，direct_only_tool_namespaces=mcp__agent_weave_probe。必要凭据只写新独立home，未读原聊天、未改全局配置、未接管原实例。

实际一次自有原客户端实例、一次真实turn。主人HTTP邀请/兑换→控制器thread→受信限定许可→W17单task grant→MCP→验收固定路由relay→真实服务读取。relay启动时无业务权限，grant就绪才激活；不向模型交付控制grant。task_get=1、tool_errors=0，服务实际读取=1、读取自身0DB写入，回复匹配task 9d4ed3b8-c50c-4e22-9f60-0d2c3ac1107f/draft，turn completed generation1。1000次controller进度读取0写入，不追加turn。

同次撤销登记后task grant直读及relay都404；撤销控制grant后读被拒，维护路径closed/exit0/exit_observed=true/forced=false。task/run业务内容未变。原12进程清单与原配置摘要保持。两份配置删除；限定目录2524文件扫描零provider/bridge凭据残留；没有跳过未读文件。

用量18,205（输入18,087/输出118），30,000软阈值未触发；金额UNKNOWN，不作硬预算保证。本阶段仅一次真实模型turn，没有付费重试。历史W14累计182,421 + 本次18,205 = 200,626 tokens（记录范围内十次vendor尝试，含历史八次失败）；不是账户总账。

## 未通过项与诊断边界

桥最终initialized=true、tool_calls=1、tool_errors=0、fault=null，但stdin_eof=false。harness要求桥EOF，与其余8组检查一起参与严格判定，故FAILED。后续只读复查桥报告仍false、未发现指向本次配置的node进程；stderr为空。不把宿主exit0替代MCP优雅退出，不修改证据为PASS。

对本项目桥运行零费用对照：初始化后stdin.end会写true并退出；同样初始化后终止子进程保留false。此结果证明报告不会凭空补EOF，也表明仅等待宿主退出不足以证明桥收尾。**真实厂商如何停止该桥进程未直接观测，根因尚未最终闭合。** 后续应在新的具体授权下，只启动无模型自有thread，采集子进程退出顺序/关闭语义；不得自动再跑付费turn或修改验收标准。

## 根因已解决的前置错误

操作profile带UTF8 BOM（EF BB BF），JSON.parse在任何客户端/turn之前失败。原报告保留；反例先复现，修复仅剥离起始BOM，破损JSON仍拒绝。原source_config_unchanged=false是没有取得前置摘要导致的错误布尔值，不是写入证据；改为先采集摘要。独占授权marker移到真实controller.start之前；存档的前置marker没有代表任何模型次数，实际start marker保留阻止再次启动。

## 验证与限制

全量服务/编译冒烟、原生14+1、旧schema2包989文件、P0文档13项及设计59文件/58摘要验证结果见verification-summary.json。合成联合harness走查明确标SYNTHETIC_REHEARSAL_PASS，其fixture回复不来自真实模型，不能借用真实结果。作者自检，非独立审核。

源码schema4/迁移/旧便携包/用户实际库均未改；HANDOFF SHA256=9E057D55395FAABD77A175B64042F18DF24A7AC53334C10A0A370D3F06DF0586。Windows隔离暂缓、attached_session/真实WPF点击/完整L1–L3/250产品验收/生产灾备及签名升级未交付，管家不构建。
