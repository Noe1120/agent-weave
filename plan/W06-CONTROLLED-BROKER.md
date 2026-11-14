# W06 后端受控写入与恢复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在现有权限/任务/SQLite 基础上实现可实测的本地领取、逻辑锁、真实文件修改、journal、Markdown、Git checkpoint 与崩溃重入闭环，前端设计延后。

**Architecture:** 增加仅可信进程内可用的 DevelopmentBroker；没有 HTTP/MCP 入口，不被桌面启动路径实例化。SQLite 持久化 claim/lock/edit；文件和 Git 使用分阶段日志对账而非假设跨系统事务。仓库由 Broker 在空目录创建，不能接管已有项目仓库；真实客户端接入须另经 G0/G1。

**Tech Stack:** 现有 Node 24.14.0、TypeScript、node:sqlite，已安装 Git；无新增依赖。

**Spec:** 02 §不变量/执行、04、05 P0/P1、08 文件独占、09 §2/4，用户已授权按设计持续构建；最新指示为其他部分先做、原生 UI 最后。

## Global Constraints

- 不启动原 Agent、不调用模型、不改变 Windows 身份/ACL/网络隔离；本阶段只操作自建合成仓库。
- 同项目逻辑路径跨工作目录单写者；大小写/路径别名不能绕过。租约过期、未知状态、撤权后保留锁，不自动交接。
- grant × policy × run × resource/依赖 ACL 逐次求交；日志、diff、Markdown 同样受限。
- 已有数据库迁移不可修改；仅新增003。core/1.0 wire 及旧 UI 不变。
- 不跳过或削弱测试。无 Git 主仓库，采用 evidence/w06/2026-11-14-broker/before 源码快照，不伪造提交。
- author self-review 不冒称独立审计；开发仓库/同用户路径校验不等于强制隔离。

## Task 1 — 领取与持久化单写者锁

Files: 新建 packages/service/migrations/003_broker.sql、broker.ts、broker-paths.ts、tests/broker.test.ts；修改 store.ts 迁移清单及 domain.ts 内部动作类型。

Interfaces: `DevelopmentBroker(store, gitExe, now?, fault?)`; `createWorkspace(projectId, workspaceId, emptyRoot)` 为可信配置；`claim(token, request)` 绑定 project/workspace/scope/task revision/lease 和 claim_id；scope 是预置资源，包含 task_id、candidate_id、paths。

- [x] 先写断言：`assert.throws(() => broker.claim(token, overlappingRequest), /PATH_BUSY/)`；验证另一目录、大小写、父子路径冲突与整批回滚。
- [x] 运行 `node --test tests/broker.test.ts` 保存缺失模块/能力的 RED。
- [x] 实现003事务表、资源交集、任务CAS、锁、严格相对路径；过期/撤权/UNKNOWN进入quarantined并保留锁。
- [x] 验证拒绝越权/旧epoch/过期；迁移v2→v3不丢历史，校验和仍强制。

## Task 2 — 文件、Markdown、Git 与日志闭环

Files: 新建 broker-git.ts；扩展 broker.ts / broker-paths.ts / tests/broker.test.ts。

Interfaces: `write(token,{project_id,claim_id,action_id,edits:[{path,before_digest,text}]})`；text=null 删除。`read(token,project,claimId)` 返回授权内状态/证据；`finish(token,project,claimId)` 仅完整已记录检查点转in_review，绝不标验收完成。

- [x] 写失败断言：真实文件、非空diff、Markdown、Git commit、candidate和journal相互关联；同action重试同receipt，换payload拒绝。
- [x] 实现 prepared → files_applied → checkpointed 三阶段；预存精确commit，Git plumbing/CAS，不调用hooks、filters、网络或shell，不改已有用户仓库。
- [x] 测试增加/更新/删除、基线不符、硬链接/junction/路径逃逸/越界路径，敏感证据读取的撤权。

## Task 3 — 崩溃恢复和全量回归

Files: 新建 tests/fixtures/broker-crash.ts、tests/broker-recovery.test.ts；更新 README、交接、源章状态和本计划。

- [x] 子进程在 prepared / 首个文件落盘 / files_applied / Git ref移动 后直接退出；重开SQLite后重放原请求，断言 `checkpoint_count === 1`，未改文件不被覆盖。
- [x] 人工改文件/改Git HEAD/撤权/租约过期均保留隔离锁并报错，不重置、不吞错、不自动释放。
- [x] 运行全部 Node 验证、原生核心兼容、设计/P0离线检查；确认前端源码不变。
- [x] 生成 evidence/w06/.../COMPLETION.md 和源文件差异清单；AT/CA 保持 NOT_RUN，真实客户端与OS隔离仍 UNVERIFIED。

## 后续顺序与范围

本阶段后仍需：受控运行器/原客户端适配与同配置安全探针；依赖/集成/完整恢复；附件/授权检索与SSE/MCP；管家API/LangGraph/受限ReAct；实测费用和生产备份；最后原生UI设计/真实使用验收。禁止将开发闭环通过写成G0/G1通过。

## 实现后的自审与限制

- 三阶段均重读持久化phase，跨连接重复投递不把已提交变成冲突；已交接动作也可取回同一结果。
- 文件系统与Git完整快照逐路径对账，不能只看本次patch；外部改动保留并报错，不自动回滚/隐藏。
- 领取和写入授权采用现有core认证求交；read投影无写副作用；diff与journal仅原grant及有权资源可读。
- Git plumbing不使用用户index、checkout、add、filters、hooks或网络；新仓库固定开发作者身份，检查点时间取服务时钟。
- 仅允许新建开发仓库、UTF-8文件、每次1MiB/128文件、单workspace单活动claim，元数据路径一并锁定。保守拒绝tilde/DOS短名等有歧义路径。不是通用文件API。
- 同用户路径检查存在TOCTOU/Windows语义限制；进程kill测试不等同断电/磁盘损坏/恶意旧句柄撤销。遇到未知状态保留锁，不提供强制释放捷径。
- 仅作者自审，无独立模型/安全审计。没有重新发布桌面包；其旧schema 2不能打开新源码的schema 3数据库。
