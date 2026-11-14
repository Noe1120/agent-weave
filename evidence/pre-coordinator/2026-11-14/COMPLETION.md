# 管家之前的W08–W10开发基础交付

日期：2026-11-14。基线：e16578d3c5e0805462fdddab422282dbd753724d。用户已授权连续构建和正常仓库推送；本轮不实现管家方案。评审性质：作者自检，不是独立审查。

## 实际完成

1. **W08适配底座**：严格指定原身份登记、版本/实例/会话指纹、权限求交、CAS、幂等事务审计、只读能力原因投影。真实客户端不因声明或fixture升级VERIFIED；detach不等于interrupt/kill；未实现的消息/回答/审批/打断明确拒绝。
2. **W09依赖与资料**：任务DAG、完整changeset依赖闭包、不可变版本快照、上游传递stale，Broker领取/写入/finish及评审等待重新检查；锁和WIP不丢失。确定性资料检索在排序前检查ACL与来源，撤权立即生效，无模型/Embedding。
3. **W10离线恢复基础**：停稳development仓库与schema4的SQLite写屏障/online backup、全部Git对象/refs/HEAD/index/staged/unstaged/允许的未跟踪二进制快照、精确摘要闭包、新目录恢复。平台可用凭据不保留，旧token失效；恢复不会启动执行。

入口仅可信进程内，不挂UI或公共HTTP/MCP。原生WPF布局不改，旧0.3.0便携包不重发。core/1.0及001–004迁移字节不变。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 基线npm run verify | 177通过，0失败/跳过 |
| 最终npm run verify | **264通过，0失败/跳过**；增加87项 |
| 生成/格式/类型/旧Web语法/构建/编译服务冒烟 | 全部通过 |
| RunnerHost编译 | 0警告、0错误 |
| 原生回归 | 14组C# + 1静态WPF检查通过 |
| 旧便携包 | 989文件摘要通过，无浏览器运行时/数据库 |
| 保护文件 | 29个契约/迁移/原生源文件无变化 |
| 设计/P0离线 | 48文件、47摘要项通过；12/12专项测试 |
| 编译后端操作顺序走查 | 适配、依赖/检索、离线恢复通过 |
| 原生窗口真实点击/视觉 | **NOT_RUN**；未重试先前拒绝权限 |

公开摘要：verification-summary.json、adapter-walkthrough-report.json、backend-walkthrough-report.json、protection-check.json、author-self-review.json。原始红绿日志、完整合成Git/DB/备份和恢复目录保留本机同级目录，未上传。Node SQLite实验性警告保留，没有隐藏。

## 完整后端走查中的真实行为

- 登记→未验证原因→合成观测（仍UNVERIFIED）→100次无写入读取→更换会话配置（CONFIG_CHANGED）→失效后旧请求重试不能重新激活→撤权拒绝。
- 固定上游输入→真实Broker检查点→上游版本变化→拒绝继续patch/finish→保留3把隔离锁、task仍running，不自动重试。
- 资料检索100次零写入；隐藏资料及派生来源不返回；撤权后不能读。
- 真实Git检查点与独立staged/unstaged/二进制→一致备份→校验→新目录恢复→内容/索引核对；旧token拒绝，RESTORED_OFFLINE，无自动启动。

## 修复根因

先复现并补回归后修复：等待就绪遗漏上游有效性、WAL副本校验生成旁路文件、异步备份窗口未重核工作树、manifest可遗漏保留文件、host存在却无job-empty证明的漏拒绝、声明依赖遗漏upstream_refs，以及Broker私有索引导致HEAD元数据被误判为未跟踪。最终还补齐输入快照的来源task授权闭包，以及对上游依赖列表变化的摘要校验。源码早期strip-only语法/局部变量和测试字符串转义错误也留有日志；没有删断言或放松验收。

## 不能宣称完成的部分

- 真实Codex/Claude Desktop/DeepSeek Harness接入、Windows强制隔离与同配置兼容资格仍UNVERIFIED；未擅自启动、附着、接管原客户端。
- 没有新公共派工/维护入口或UI整合，没有真实多客户端协作、物理speculative工作区组合或自动合并。
- 生产在线灾备、GC pins/增量链、离机加密与密钥管理、实际RPO/RTO、签名安装器/升级资格未交付。W10只覆盖明示支持的本机停稳开发数据形态，不能用它替代这些门槛。
- 250项AT/CA仍NOT_RUN，正式冻结NOT_FROZEN；未操作实际用户数据库/Windows身份ACL，模型调用0。
- 管家Agent的模型、LangGraph/ReAct/RAG编排与派工方案由用户后续确定；**本轮停在管家实现之前**。这不是“整个产品已经完成”的声明。

## 继续工作的入口

源码见packages/service/src/adapter-contract.ts、adapter-registry.ts、dependencies.ts、knowledge.ts、recovery.ts，现有Broker/plans/waits增加依赖检查；测试命令在根package.json。设计唯一维护目录plan；阅读PRE-COORDINATOR-FOUNDATIONS、W08、W09、W10与最新交接。保留旧包schema2/源码schema4边界，禁止用旧包打开升级库。
