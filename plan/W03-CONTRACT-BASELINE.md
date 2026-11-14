# W03 核心契约可运行基线实施计划

> **For agentic workers:** 使用 executing-plans 按步骤执行；本轮遵守不启动原客户端/模型/子代理的边界，以本地测试及自检替代代理分工，不冒称独立评审。

**Goal:** 将既有 core/1.0 的八个操作落地为可构建、可测试的本机确定性参考服务。

**Architecture:** 唯一权威 core.schema.json 派生 TypeScript/OpenAPI；SQLite 事务保存授权、动作账本、等待与恢复意图；HTTP 仅监听回环地址，外部副作用没有执行器。

**Tech Stack:** Node 24.14.0 / TypeScript 5.9.3 / Ajv Draft 2020-12 / node:sqlite / node:test。node:sqlite 在此 Node 版本为实验能力，仅用于基线，未作生产资格认定。

**Spec:** 同目录 02、04、05、09、11、12 章；contracts/core.schema.json；P0-PROBE-PLAN.md。

## 全局约束与范围

- 不启动指定原客户端，不调用模型/外部业务 API，不修改 Windows 隔离设置；仅使用合成记录。
- 成员策略、具体 grant/run/epoch/native binding、资源 ACL 与撤权取交集；每次读和幂等重试重新鉴权。
- apply 不等于 start；stop 只关派送门并进入 stopping，不假装撤销写入者、进程或代码。
- 查询不产生输入/事件/模型调用；完整进度视图须具备全部 scope 的可见权限。
- outbox/inbox 仅为持久化意图，不承诺原客户端副作用 exactly-once。
- 产品 250 项、兼容和 P0 探针模板不写入本轮合成测试结果。
- 正式 W03 冻结仍依赖 W01 真实结果、完整领域写接口/迁移与独立评审；本轮仅 core 基线和六类安全只读投影。
- 当前非 Git 仓库，不初始化 Git 或虚构提交；保留开始时 plan 哈希和历史证据。

## 文件与执行步骤

### 1. 契约与派生物
Files: packages/contracts/src/*、scripts/generate-contracts.mjs、generated/openapi.json、plan/contracts/{transport-bindings,error-mapping,resource.schema}.json、tests/contracts.test.ts。
接口: validateCore(value), validateRequest(value), validateResource(value), CoreRequest/CoreResult/CoreError。
- [x] 先编写并执行失败测试：26 个 wire 样本、未知字段/版本/枚举、响应约束、生成漂移。
- [x] 实现生成、严格运行时验证、状态/重试映射，验证红转绿。

### 2. 持久化与授权
Files: packages/service/migrations/001_core.sql、packages/service/src/{store,auth,domain,errors}.ts、tests/{store,service}.test.ts。
接口: Store(path), transaction(fn), local trusted provisioning helpers；authenticate(token, project, operation), requireResource。
- [x] 写并运行失败测试：迁移重入/校验和/回滚、哈希凭据、跨执行隔离与当前撤权。
- [x] 实现事务迁移、资源/动作/等待/意图账本，重复执行验证。

### 3. 八操作参考语义
Files: packages/service/src/{service,plans,waits}.ts、tests/{service,waits}.test.ts。
接口: CoreService.execute(token, request), readResource(token, project, type, id)；受信任本地任务状态更新与等待对账，不经公共 HTTP 暴露管理功能。
- [x] 写并运行失败测试：计划 CAS/预算/审批、停止不假关闭、等待先后注册、精确消费、继续回答绑定、重启重试、进度只读。
- [x] 实现受限计划应用、等待/动作原子账本；不实现 dispatcher、原客户端适配器或写租约。

### 4. HTTP 边界与构建
Files: packages/service/src/{http,main}.ts、tests/http.test.ts、tests/build-smoke.mjs、README.md。
接口: createServer(service)，八个 POST /v1/core/{operation}；六个 GET /v1/projects/{project_id}/{resource}/{id}。
- [x] 写并运行失败测试：认证、Host/Origin、方法/body 限制、统一缺失/拒绝、资源投影和错误映射。
- [x] 实现回环启动、限量 JSON、响应验证与优雅关闭；测试服务器只绑定随机回环端口，测试后关闭。

### 5. 完整检验与交付
- [x] npm run verify + 编译产物 smoke + 重启/故障/授权回归；保存真实命令与输出。
- [x] 自检安全边界，记录实际支持/拒绝项与未实现域；不冒称独立评审。
- [x] 运行既有 12 项 P0 离线测试，重建设计派生物并只读验证。
- [x] 更新本文件、README、交接目录/文件数、CHANGELOG；证据置于 evidence/w03/2026-11-14-core-baseline。

## 进入下一阶段的条件

本地基线验证不授予 G0/G1 资格。下一批可继续领域契约与本地合成测试；原客户端探针和 Windows 强隔离联合测试须按 P0 清单单独授权及取证；在通过 G1 前不启用真实多 Agent 写入。

## 本轮交付注记

- 0.1.0 仅参考基线；初始部署为空库，无默认令牌/示例账号。通过受信任本地 Store 集成预置记录，不暴露公共管理面。
- apply_plan 对受信任预置 draft 任务排队，不是任务创建/原客户端派工；非 null delegation_ref 拒绝。审批来源签发/真实客户端信号验证不在本轮实现。
- 预算仅为合成整数上界记账，无币种、provider费用对账或付款能力；不能据此授予真实收费调用权限。
- 补齐引用闭包动态授权、受保护验收/输入检查和scope证据；具体红/绿证据及最终计数以工作区 evidence/w03/2026-11-14-core-baseline/COMPLETION.md 为准。
- 本轮执行为本地自检而非独立代码/安全评审；未运行16个P0真实探针或250项产品验收。
