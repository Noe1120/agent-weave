# 管家之前的后端基础 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans；原地独立功能分支，逐项RED/GREEN、作者自检，不默认启动子模型。

**Goal:** 完成当前授权可实施的确定性后端基础，停在管家Agent之前。
**Architecture:** 复用SQLite事实、Resource授权闭包、Broker与固定开发Runner；不增加模型、云服务或UI。
**Tech Stack:** 现有Node24/TypeScript/SQLite/WPF，无新依赖。
**Spec:** 02/03/04/09/12源章与W08计划、AGENTS.md；用户2026-11-14扩大连续实施范围。

## 范围与取舍

选择先完成可独立验证的底座，而非跳过真实客户端/隔离门槛开放协作。W08之后可在合成环境实现依赖与恢复基础；实际多客户端代码协作仍受G0/G1约束。增量W08–W10编号不是05章WBS完成宣告。

- 不启动/附着原客户端、不调用模型、不修改系统隔离政策；不读取用户原客户端历史。
- 不设计或实现管家模型、LangGraph、ReAct、RAG编排、自动派工或预算策略。
- UI最后；现有原生WPF、001–004迁移、core/1.0和旧便携包不变。
- 新入口仅可信进程内；不将维护/配置权限暴露给普通Agent。
- 真实客户端/隔离/原生点击验收缺证据时明确保留UNVERIFIED/NOT_RUN。

## 顺序与可检验交付

### W08 能力与适配边界
- [x] 按W08-ADAPTER-FOUNDATION.md完成严格登记、权限/CAS/幂等、配置失效、只读投影、detach与不可用操作。
- [x] 编译走查登记→未验证→合成观测→配置变化→失效→撤权；真实资格不提升。

### W09 依赖与授权资料
详见W09-DEPENDENCIES-KNOWLEDGE.md。
**Files:** packages/service/src/dependencies.ts、knowledge.ts；tests/dependencies.test.ts、knowledge.test.ts。
**Interfaces:** DependencyService(store,now).setPrerequisites(token,request)、capture(token,request)、read(token,projectId,snapshotId)、assertCurrent(ctx,taskId)；KnowledgeReader(store,now).search(token,projectId,query,limit)、read(token,projectId,id)。
- [x] RED：完整changeset闭包、固定版本、缺依赖/环/跨域拒绝；上游变更传递stale且阻止Broker写入/finish，锁不得释放。
- [x] 实现不可变输入快照及实时有效性检查，禁止把一份文本或单文件当完整handoff；不自动物化/合并仓库，不自批speculative。
- [x] RED/GREEN：授权过滤先于排名/分页；定向资料及派生引用不可穿透；撤权立即生效；结果带版本与来源，100次读取不写DB。
- [x] 确定性本地检索仅检索平台已授权Resource，不向Embedding或LLM发送资料，不声称实现管家RAG。

### W10 离线灾备基础
详见W10-OFFLINE-RECOVERY.md；仅本机停稳的development数据形态，生产pins/增量/离机与RPO/RTO未实现。
**Files:** packages/service/src/recovery.ts；tests/recovery.test.ts、tests/pre-coordinator-walkthrough.mjs。
**Interfaces:** 可信维护入口createRecovery/verifyRecovery/restoreRecovery，输出不可变manifest；恢复仅到新目录，不覆盖现有库。
- [x] RED：未知/活动写入者、未完成journal、缺文件/摘要不符、路径越界、非空恢复目标拒绝。
- [x] GREEN：SQLite一致快照、受管Git与dirty内容闭包、无可用凭据、迁移与摘要校验；离线合成仓库恢复后对账，绝不自动恢复执行/放锁。
- [x] 明确只限本机维护入口及支持的数据形态；不实现未经设计的外发加密/自动计划/生产迁移。

### 联合验证与交付
- [x] 编译后按真实操作顺序走查后端，检查100次读取、撤权、失效、故障/恢复；区分后端走查与原生点击。
- [x] npm run verify、test:native、test:native:package、设计与P0离线回归；迁移/契约/WPF/旧包保护摘要不变。
- [x] 更新源章、交接、证据、摘要；审查暂存、正常提交推送，核对远端。只允许经审查的阶段摘要证据进入仓库。

## 停止边界

当前可执行底座完成后停在管家之前。真实客户端读写接入、Windows身份/ACL资格、生产灾备与原生用户验收不能由合成测试代替。若这些仍缺具体授权/环境证据，报告为产品门槛，不宣称整个平台已经完成。

## 本轮执行结果

W08–W10上述限定开发范围已实现；最终264项Node测试、14组C#与1项静态检查、989包文件、48设计文件/47摘要项及12项P0检查通过。编译后端走查验证依赖阻断/只读检索/真实Git与SQLite恢复。完整记录在工作区evidence/pre-coordinator/2026-11-14/COMPLETION.md。产品门槛及管家停止边界保持，不以本清单勾选表示完整生产功能已完成。
