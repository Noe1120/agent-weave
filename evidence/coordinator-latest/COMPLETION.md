# 最新管家设计纳入与DSH会话预检

日期：2026-11-15（Asia/Tokyo）。用户明确修改后的方案为最新版，并允许提交。

## 最新有效方案

- coordinator-core-review-1现为当前管家设计基线，不再标记待定；平台v1.6/管家v1.2编号沿用用户方案。
- 02/04/10/11/12五个源章与coordinator-quality/1.1材料逐字节保留用户修改；README/CHANGELOG/交接合并保留双方内容，解决两处并行新增冲突。
- 20项基础题、6组连续变体/38步骤均保持NOT_RUN，oracle待审；没有运行模型评测或将材料校验冒充产品验收。
- 合订、报告和摘要由现有工具从源章重建，旧生成文件没有强行覆盖W11增量。管家仍不构建。

## 继续DSH的实际进展

只读检查了本机固定的官方0.2.1-rc.3包，确认session/new涉及Agent持久化、MCP组合与模型配置读取，不只是initialize。已登记[W12预检](../../plan/W12-DSH-SESSION-PREFLIGHT.md)：建议新空home/work、空MCP、仅new/close、不prompt、不list/resume、不复用旧账户或历史。

本阶段没有启动DSH或创建真实会话，没有模型请求，也没有改Windows身份/ACL/防火墙。最小新会话探针尚待具体授权；源代码路径推断不当网络隔离或完整客户端资格。W11运行代码未改。

## 验证结果

- 全量服务：317/317，0失败、0跳过；保留SQLite实验性警告。
- 原生：14/14逻辑组、1项WPF静态检查；窗口点击仍NOT_RUN。
- 旧便携包：989文件校验通过，未重发。
- 设计：50文件/49摘要通过；P0离线12/12通过。
- 作者自检不是独立审核；250项AT/CA仍NOT_RUN，客户端与OS资格仍UNVERIFIED。

[验证汇总](verification-summary.json) · [用户源内容保留核验](source-import-check.json) · [DSH只读预检](dsh-session-preflight.json)。原始diff、日志、DSH安装源码及用户数据不上传。

发布目标为main并同步工作分支；整合前保留原未提交修改的可恢复Git快照。实际提交/推送与远端一致性以Git核验和任务回复为准，不以此文档推定操作成功。
