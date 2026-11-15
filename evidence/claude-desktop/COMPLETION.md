# W13 Claude Desktop当前交付记录

日期：2026-11-15（Asia/Tokyo）。状态：**启动与清理缺陷已修复，真实MCP握手仍未通过，Claude接入尚未完成**。累计四次实际启动，当前没有本次Claude残留。

## 已完成与真实证据

- 官方Desktop 5.11492.2身份、签名及固定EXE/ASAR摘要保持；不替换为Claude Code、SDK或模型API。
- 用户要求找根因并重试后，按创建时间、路径、独立profile参数核验首次遗留，通过保留句柄终止并确认退出。首次失败报告原样嵌入[真实记录](real-attempt-report.json)，没有改写成成功。
- 验收host直接持有实际Desktop根进程句柄并显式入Job；分别核验根退出、Job为空、host退出与原客户端清单。退出不依赖管道close；64KiB本地诊断有明确失败上限。
- 第二次实测取得明确启动错误 Failed to get 'appData' path。原生SHGetFolderPath复现HRESULT 80070003，修复USERPROFILE/AppData/Roaming及Local布局，并在每次实际启动前核验原生路径。
- 第三、四次正常启动；第三次30秒总窗口中页面约27秒才就绪，第四次延长到60秒，页面约17秒就绪，但均没有MCP连接请求。
- 三次重试均完整清理，六个原DSH进程身份不变。回收使用强制终止，不能称Desktop正常EOF退出。真实尝试的host构建摘要分别保留；之后输出故障报告和DSH辅助探针的加固另经合成回归。

## 当前阻塞与下一步

第四次日志确认无登录cookie，accountId/orgId为空，MCP日志为空；固定版本的chat MCP连接由mainView请求触发。下一步需用户明确允许并亲自在本阶段专用profile完成登录，再只验证空MCP握手。登录是否足够仍需实测，不能保证；不会复制旧凭据、调用内部IPC或绕过登录/反自动化。

登录不隐含允许模型prompt、计费调用、旧历史访问或窗口自动化。本轮没有登录、模型请求或窗口点击。MCP握手未通过，因此生产适配器未开放；L1–L3/OS资格和250 AT/CA没有升级，管家没有构建。

## 回归、根因记录与参考

- 最终全量verify：**390/390通过，0失败、0跳过**；包含37项Claude专项合成回归。生成、格式、类型、构建及编译冒烟通过，verify不启动真实客户端。
- 首轮全量389项有1项DSH权限拒绝清理观测失败，日志保留。检查后增加独立后代持管道场景，稳定复现close不能代表根退出；DSH验收辅助现分别记录exit与streams_closed，管道未关闭仍失败。不能据此臆定首轮间歇失败的全部底层时序；生产DSH控制器及既有实际会话证据未改。
- 原生14组C#及1项WPF静态通过；旧包989个文件清单/摘要通过。设计51文件/50摘要和P0 12项通过，见[验证汇总](verification-summary.json)。SQLite实验警告、真实Desktop本身的监听器警告保留，没有修改或抑制第三方报错。
- 按用户建议研究Orca固定提交af82fa8634e19c0376738ad636237aac847b2179，借鉴进程身份复核、未证实退出不释放的原则。其Claude Code/SDK路径不能替代本项目指定Desktop，没有复制或运行其代码。
- [作者自检](author-self-review.json)不是独立审核。未做网络/文件访问审计，不把独立profile或Job回收当Windows强制隔离。原生点击仍未验收。

仅上传五份审核文本。实际profile、配置、日志、进程快照、错误转储、第三方checkout和二进制留本机且被忽略。下一入口详见[W13](../../plan/W13-CLAUDE-DESKTOP-MCP-PROBE.md)。
