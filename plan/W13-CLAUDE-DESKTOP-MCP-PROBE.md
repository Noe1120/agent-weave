# W13 Claude Desktop独立MCP接入探针

日期：2026-11-15（Asia/Tokyo）。状态：REAL_ATTEMPT_NOT_CONNECTED / CLEANUP_PENDING。用户授权按DSH相同步骤和要求尝试Claude Desktop接入。

## 范围与依据

固定本机官方Windows包5.11492.2.0（应用5.11492.2），先静态检查安装签名/摘要、启动profile规则及MCP配置。官方Desktop作为MCP客户端主动初始化本地stdio server，不能照搬DSH的ACP会话方法。原客户端身份不替换为Claude Code/SDK/API。

只允许独立全新user-data-dir、最小环境和一个无工具/资源/prompt的本地探针；不改已有配置、不登录、不提供旧凭据、不读历史、不发模型prompt、不点击窗口、不改系统身份/ACL/网络策略。若登录或额外权限是前置条件，记录未通过，不能以合成测试补齐。

## 实施步骤

1. 写入合成客户端驱动的MCP服务测试：initialize、initialized、tools/resources/prompts空列表、ping、非法方法/重复ID/超时/帧上限/EOF。默认verify不启动Claude。
2. 验收入口固定安装摘要、配置作用域与脚本；准备全新目录和一次性尝试目录。正式包中的CLAUDE_USER_DATA_DIR/E2E/CDP入口有签名授权限制，禁止使用或绕过；仅考虑其处理的普通--user-data-dir路径。
3. 从既有W07开发host启动等待begin的固定验收worker，先加入Job再启动新Claude实例，限定时间后只清理该所属Job。Job用于子进程寿命回收，不是OS安全隔离或Desktop撤写资格。无附着、无按保存PID杀进程。
4. 单独登记真实MCP握手/发现是否出现、原进程是否改变、Job是否空；GUI清理若强制，不写成正常EOF关闭。
5. 全量服务、原生/包保护、设计/P0、暂存扫描后提交推送。只上传审核元数据，原始profile、日志、配置和安装源码留本地。

## 静态核查

官方支持文档确认本地MCP/扩展接入；本机包中MCP配置来自所选userData下claude_desktop_config.json。启动逻辑对普通--user-data-dir记录chosen_folder；生产包会移除未经厂商测试授权的CLAUDE_USER_DATA_DIR。静态结论不能替代真实启动或数据隔离证据。官方网页以本地只读HTTP取回记录，版本/摘要以本机安装为准。

## 验收边界

MCP握手即使成功也只证明传输，不证明读取群数据、自动唤醒、任务执行、L1–L3或Windows隔离。生产服务与WPF不在本轮扩展；管家仍不构建。

## 实际结果与根因 · 2026-11-15

合成客户端驱动的空能力MCP协议、安装摘要、新profile及所属开发Job测试已实现；真实尝试只做一次。官方进程启动后35秒内未出现MCP服务或初始化记录，新目录仅观察到探针写入的配置。没有依据将失败归因为登录；客户端早期启动停在哪一层仍未确定。

已有W07 Job发出job_empty=true后，本次Claude进程仍活着；只读句柄核验exit_code=259、wait=258、处于某个Windows Job。六个原DSH进程均不变。清理根因是将开发进程的Job继承假设用于此Windows打包客户端并不成立，具体Windows迁移机制未确定。host流关闭也未观察到，不能把超时或job_empty当退出证据。

已补充结果判定回归：只要原客户端进程清单未恢复，即便握手成功/Job已空，也保持cleanup_unconfirmed。公开test:claude:live入口现明确抛出CLAUDE_PACKAGED_LIFETIME_UNQUALIFIED，在修复所属句柄管理前不再启动。旧尝试脚本仅本地留证，没有保留不可用的自动化为生产功能。

仍有一个本次启动的Claude进程待处理，PID/创建时间/完整新profile参数仅在本地证据中；原持有句柄的worker已结束。沿用用户要求的W11关闭边界（[W11](W11-DSH-ACP-LIFECYCLE.md)仅当前所属句柄，不按持久PID杀进程），并遵守AGENTS.md的原客户端边界；不改用窗口工具绕过原拒绝，因此需要用户关闭该进程，或具体允许核验身份后仅终止此遗留进程。该授权只涉及这一次遗留清理。

没有模型prompt/工具调用、登录或旧凭据提供；不把空目录当Windows隔离。没有改生产接口、数据库、WPF、旧包或管家实现。详情见[真实尝试记录](../evidence/claude-desktop/real-attempt-report.json)与[阶段交付](../evidence/claude-desktop/COMPLETION.md)。下一入口为遗留清理及具有可验证所属进程句柄的正式Windows打包客户端启动方案，然后再考虑MCP握手；当前未接通。
