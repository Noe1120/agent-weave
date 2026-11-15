# W13 Claude Desktop接入尝试记录

日期：2026-11-15（Asia/Tokyo）。状态：**真实连接未通过；本次遗留进程待清理**。用户授权按DSH同样步骤尝试，实际启动一次，没有重试。

## 已交付

- 核对官方Windows包5.11492.2.0/应用5.11492.2，签名Valid、发布者Anthropic, PBC；固定EXE/ASAR摘要，官方MCP资料及安装源码只读核查结论见[预检](preflight-report.json)。
- 新增空能力stdio MCP服务、独立profile准备、结果判定与32项合成测试。Desktop是客户端，探针是服务端；无工具/资源/prompt暴露，无项目数据或旧凭据。
- 本轮没有扩展生产服务、WPF、数据库契约、DSH适配器或管家。

## 真实结果与清理问题

一次新profile启动后，35秒观察期内没有MCP进程/握手记录，新profile只观察到我们写入的配置。不能据此认定是登录问题。开发Job报告已空，但本次Claude进程仍活着并处于另一个未确认归属的Windows Job；只读查询为STILL_ACTIVE。原有6个DSH进程身份不变。完整白名单结论见[真实记录](real-attempt-report.json)。

根因是开发Job继承/回收假设不适用于该安装的打包客户端；具体Windows迁移机制待查。host管道关闭未观察到，也不等于已经证实主进程仍活着。已补回归，禁止以Job已空或合成测试通过提升真实资格。test:claude:live现在直接报CLAUDE_PACKAGED_LIFETIME_UNQUALIFIED，不会再启动实例。

原持有子进程句柄的worker已结束。AGENTS.md禁止按保存PID重开终止，原窗口操作也未获授权，因此未换工具清理。需要用户关闭这次遗留进程，或具体允许重核PID/创建时间/程序路径/全新profile参数后仅终止该进程。进程标识和路径仅保留本地。此清理尚未完成，不能称本阶段全部完成。

## 回归与交付

全量verify：384/384、0失败、0跳过；包含32项新增合成测试，生成/格式/类型/构建/编译冒烟均通过。原生14组C#及1项WPF静态通过；旧包989文件清单与摘要通过。设计/P0结果见[验证汇总](verification-summary.json)。[作者自检](author-self-review.json)不是独立审核。SQLite实验性警告保留。

没有发送模型prompt、登录、提供旧凭据或执行旧会话操作；不是OS网络访问审计，也没有完成原生点击。L1–L3保持UNVERIFIED，250项AT/CA仍NOT_RUN。下一入口见[W13](../../plan/W13-CLAUDE-DESKTOP-MCP-PROBE.md)：先处理遗留并建立真实所属句柄回收，再查MCP启动条件。

只上传这5份审核文本。原始profile、配置、日志、进程信息、安装源码和临时尝试脚本均留本机。
