# W09 任务依赖、完整输入快照与授权资料

## 范围

依据PRE-COORDINATOR-FOUNDATIONS.md实施的确定性后端增量，不属于管家Agent。仅可信进程内接口，不新增HTTP/MCP能力或WPF按钮。没有Embedding、LLM、自动派工、自动验收或自动合并。

## 接口与数据

- DependencyService.setPrerequisites(token, request)：请求为project_id/action_id/task_ref/prerequisite_ids，严格字段、CAS、同项目授权、DAG检查、幂等回执；只能修改draft/queued。改变排序依赖不移除已有数据来源ACL闭包。
- capture(token, request)：请求为project_id/action_id/task_ref/snapshot_id/inputs。服务获取完整上游changeset闭包，固定revision、source_commit、tree_digest和内容摘要；缺引用、版本冲突、环、未approved/ready/valid、超限均拒绝。未提供完整依赖元数据不能当成无依赖。
- 快照不可覆盖，task持有版本引用；普通调用方不能给自己增加资源范围，snapshot_id必须由可信装配预先授权。
- read只读计算valid/stale；上游变化沿完整闭包传播，不通过读取改DB或触发客户端。assertTaskInputsCurrent在计划排队、Broker领取/写入/finish/主动对账、评审就绪等待中重新检查。失效不释锁、不重派工、不删除成果。
- 任务前置条件读取当前完成事实；代码成果存在candidate_ref时还要检查同版本approved/ready/valid。更改前置任务状态/输入有效性会使下游重新不可用。
- Broker产出的changeset记录producer_task_id及实际消费的完整upstream_refs，防止跨代遗漏。
- KnowledgeReader.search/read只读knowledge_document资源。所有来源先过grant/policy/run/domain/ACL及引用闭包；过期来源不返回；过滤先于排序/分页。返回版本、来源和受限摘要，查询最长256字符、每页最多50条。它不是语义检索或管家RAG。

## 边界

现在实现的是受信任平台元数据的依赖有效性，不凭任意hash就承诺工作区已物化。物理工作区组合、真实多客户端协作、speculative批准、正式评审/验收/合并仍未开放；只读资料来自平台预置资源，不扫描用户文件或原客户端历史。所有真实门槛仍按09章执行。

## 验证

tests/dependencies.test.ts、tests/knowledge.test.ts覆盖完整闭包、任务环/CAS、撤权、跨域、隐藏派生资料、100次无写入读取，以及Broker和等待路径。编译后用户顺序走查在tests/pre-coordinator-walkthrough.mjs。最终数量与结果记录于evidence/pre-coordinator/2026-11-14/COMPLETION.md，不把这些开发测试改写为250项产品验收。
