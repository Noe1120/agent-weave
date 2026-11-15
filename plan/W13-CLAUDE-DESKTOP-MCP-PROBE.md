# W13 Claude Desktop独立MCP接入探针

日期：2026-11-15（Asia/Tokyo）。当前状态：**真实启动及清理已通过，MCP握手未通过**。累计四次真实启动，当前没有探针Claude残留。原客户端完整接入仍未完成。

## 范围与依据

固定本机官方Windows包5.11492.2.0（应用5.11492.2）、签名与EXE/ASAR摘要。官方Desktop作为MCP客户端主动初始化本地stdio server，不能照搬DSH的ACP会话方法；不替换为Claude Code/SDK/API。用户要求找到失败原因并持续重试，已覆盖上轮提出的单个遗留进程核验清理。

本阶段仅独立全新user-data-dir、最小环境、空工具/资源/prompt的本地探针；不改已有配置、不登录、不提供旧凭据、不读历史、不发模型prompt、不操作窗口、不改系统身份/ACL/网络策略。管家不构建。

## 当前验收路径

1. 默认verify运行合成MCP和Windows原生进程/目录回归，不启动真实Claude。
2. 真实入口必须显式opt-in及新建一次性尝试目录；核对安装摘要、路径、现有客户端清单。已有Claude时拒绝启动，不附着或重启。
3. 创建全新profile和USERPROFILE/AppData/Roaming、AppData/Local。通过原生SHGetFolderPath核对两个已知文件夹确实解析到本次目录。禁止受厂商签名保护的CLAUDE_USER_DATA_DIR/E2E/CDP钩子。
4. 验收专用.NET host保留实际启动返回的根进程句柄，显式将根进程加入Job。独立观察根进程退出；不能用stdout/close替代。限时60秒，握手和发现成功后立即停止；有限诊断仅留本地。
5. 成功必须同时具备真实initialize/initialized/tools-list、根句柄退出、Job为空、host正常退出和前后客户端清单一致。回收是强制终止，不写成Desktop正常EOF退出。
6. 真实入口不自动登录；缺失外部前提时保留未通过，不能以合成测试补齐。全量服务、原生、包保护、设计/P0、暂存扫描后交付。

## 历史失败与根因

首次尝试：35秒内未见MCP启动，新目录只有探针配置。既有W07开发Job报告为空时实际Claude仍存活，host只观察close不足以判断进程退出。此时没有依据归因登录，历史报告原样保存在真实记录内。

用户要求修复重试后，已按创建时间、可执行路径及完整独立profile参数重新核验遗留进程，持有句柄终止并观察退出。新host直接持有真实根进程句柄，显式入Job；不再从中间worker的Job成员关系推断Desktop归属。具体Windows打包启动的继承机制尚未确定，不将本轮结果称为OS隔离。

第二次尝试：完整清理通过，stderr和本次生成的错误文件明确记录 Failed to get 'appData' path。SHGetFolderPath回归复现HRESULT 80070003。原先只创建任意appdata/localappdata并覆盖环境变量，缺少Windows按USERPROFILE展开并验证的AppData/Roaming和Local目录。已修复标准布局，并在真实启动前核对原生路径。

第三次尝试：修复后正常启动，页面约27秒加载完；30秒总窗口仍未见MCP，完整清理通过。第四次将观察延长到60秒，页面约17秒完成加载，仍没有MCP请求，清理再次通过。三次重试均保持原六个DSH进程身份不变。

## 全量回归发现的验收辅助缺口

首次全量回归有一项DSH权限拒绝场景未观察到退出。检查发现DSH验收辅助探针仅监听close；增加独立合成后代持管道场景后，稳定复现根进程已退出却被标UNKNOWN。已分别记录exit与streams_closed：根退出可被确认，但管道未收束仍是失败，不把它变成PASS，也不重复kill已退出根。首轮间歇失败没有完整底层时序，不能证明其触发条件与合成场景完全一致；保留首轮日志。生产DSH控制器和既有真实会话证据未改，没有重启真实DSH。

## 当前外部前提与下一入口

第四次本地日志显示sign_in_cookie_present=false、accountId/orgId为空、MCP日志为空。固定版本的chat MCP启动由mainView发出的连接请求触发，本轮没有该请求。登录会话是下一项需要用户参与验证的前提；不能据此保证登录一定足够，也不能无意义重复同一未登录条件。

下一步需要用户明确允许并亲自在本阶段专用profile完成登录，随后仅继续空MCP握手。登录不隐含允许模型prompt、计费调用、读取旧历史或窗口自动化。未经该具体授权，不启动登录流程、不复制现有凭据、不注入内部IPC、不绕过反自动化/登录门槛。

## Orca参考与验收限制

按用户建议只读研究Orca提交af82fa8634e19c0376738ad636237aac847b2179，参考其Windows进程身份复核和未证实退出不释放状态的原则。其Claude Code/SDK结构化会话路径不能证明Claude Desktop支持；没有运行或复制其实现，第三方checkout位于忽略目录。

MCP握手即使成功也只证明传输，不证明任务执行、自动唤醒、群数据授权、L1–L3或Windows隔离。生产服务、数据库、WPF、旧包、管家均未扩展。原生点击仍未验收；250 AT/CA保持NOT_RUN。实测和合成分别见[真实记录](../evidence/claude-desktop/real-attempt-report.json)及[交付记录](../evidence/claude-desktop/COMPLETION.md)。
