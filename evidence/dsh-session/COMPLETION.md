# W12 DSH独立新会话验收

日期：2026-11-15（Asia/Tokyo）。用户明确允许连续完成本阶段。最新管家方案已在前序提交428eac1纳入，本轮仍不构建管家。

## 本阶段交付

新增测试目录中的固定三方法会话探针、独立空目录启动准备和显式opt-in验收脚本。生产W11适配器仍initialize-only，没有新增HTTP/MCP/UI执行入口。默认verify不能启动真实客户端。

一次真实官方DSH 0.2.1-rc.3验收通过：initialize → session/new（新空cwd、mcpServers=[]）→ session/close（仅返回的本次ID）→ stdin EOF；各1条请求和回执，正常exit0、非强制、stderr0。原6个Desktop进程的PID/父PID/创建时间/路径相同。见[审核后的真实报告](real-session-report.json)。

请求中无prompt、旧会话操作或MCP连接；不提供旧凭据。原始profile的8个文件保留本地，新工作目录为空；close不是删除。协议请求计数不能替代OS网络审计。

## 验证

- 全量服务verify：352/352，0失败、0跳过；包含新增35项合成测试，另有既有49项DSH测试；生成检查、格式、类型、构建与编译冒烟通过。
- 原生回归：14组C# + 1项WPF静态检查通过；不是窗口点击验收。
- 原便携包：989文件摘要与内容清单通过，未重发或覆盖。
- 设计与P0结果详见[验证汇总](verification-summary.json)；仅离线设计检查，不计产品AT/CA通过。
- [作者自检](author-self-review.json)明确不是独立审核；[保护检查](protection-check.json)登记生产源码与用户环境保护。SQLite实验性警告保留可见。

## 交付边界

没有验证模型执行任务、L1–L3、Windows强制隔离或原生点击；生产在线/离机灾备和签名安装升级也未在本阶段交付。250项产品AT/CA保持NOT_RUN。下一入口见[W12计划](../../plan/W12-DSH-SESSION-PREFLIGHT.md)：设计W08授权/幂等体系内的新会话生命周期；本轮独立探针不能直接当生产接入。

仅这5份审核文本进入Git；配置、原始stdout/stderr、会话持久化文件和进程快照均不上传。
