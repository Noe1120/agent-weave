# W08 原客户端能力与适配边界 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 在不启动原客户端、不调用模型的范围内，构建可验证的能力登记、权限判定和只读状态入口，为后续获准的原客户端接入提供明确边界。

**Architecture:** 沿用Node/TypeScript/SQLite及现有Resource授权闭包，不新建云服务或统一替代客户端。声明能力、实际可用性、当前授权和同配置资格分开；注册/状态投影与会话操作分开，owned_process和attached_session不共用终止能力。

**Tech Stack:** Node24.14.0、TypeScript5.9.3、现有SQLite资源表和测试设施；不新增依赖、不改WPF布局、不改001–004迁移。

**Spec:** 03-agent-integration.md §3/10/12/15/16；04-reliability-security-operations.md §19；09-review-closure-and-gates.md；12-protocol-closure-and-validation.md；research/2026-11-14-agents-anywhere.md；项目根AGENTS.md。

**Status:** IMPLEMENTED_DEVELOPMENT_FOUNDATION。能力登记/只读投影/授权/CAS/幂等及本地detach已实现并通过合成回归。真实客户端仍UNVERIFIED，发送/回答/审批/打断仍显式不可用；没有启动或附着原客户端。

## Global Constraints

- 延续根AGENTS.md的已确认要求，不重新要求用户重复说明。
- 指定身份只允许codex、claude_desktop、deepseek_harness；Claude Code/SDK、第三方DSH Desktop与指定原身份不能别名合并。
- 仅可信进程内装配，尚不挂载公共HTTP/MCP写接口；原生UI最后。
- 所有真实客户端能力初始UNVERIFIED；静态路径存在、安装版本或fixture成功不能升级资格。
- 同一配置指纹绑定客户端版本/协议版本/实例/会话/认证与隔离参数；变更立即失效，不沿用旧通过结果。
- 只读状态入口只读已持久化投影；不得spawn、resume、prompt、steer、cancel、联网或读取原客户端私有历史。
- 测试只使用合成资源和显式fixture，不能通过跳过校验或删断言改变失败。

## 设计取舍与推进顺序

推荐“能力与权限底座 → 经授权的只读连接 → 单客户端最小交互 → 写入资格”。不采用一次连通三客户端的方案：那会把身份、会话所有权、认证和撤写风险混在一起；也不先增加UI按钮：现有UI不能把计划能力展示为可用。

W08只完成前一部分的代码与合成走查。后续真实只读探针另记录选定客户端/版本/会话、数据范围及授权，尽量连接用户已启动的实例而非另开替代客户端；如果缺少授权，只询问该具体操作，不重复确认整个目标。

## Task 1 — 严格能力契约与失效判定

**Files:** 新增packages/service/src/adapter-contract.ts、tests/adapter-contract.test.ts。

**Interfaces:** export AdapterTarget、BindingMode、CapabilityFacts、CapabilityDecision；validateAdapterRegistration(unknown)只解析严格登记输入；evaluateCapability(facts: CapabilityFacts): CapabilityDecision是纯函数。

约定的最小接口：

```ts
export type AdapterTarget = 'codex' | 'claude_desktop' | 'deepseek_harness';
export type BindingMode = 'owned_process' | 'attached_session';
export interface CapabilityFacts {
  supported: 'supported' | 'unsupported' | 'unverified';
  available: boolean;
  allowed: boolean;
  qualification: 'UNVERIFIED' | 'VERIFIED';
  observedFingerprint: string;
  currentFingerprint: string;
  evidenceIds: string[];
}
export interface CapabilityDecision {
  enabled: boolean;
  reason: 'READY' | 'UNSUPPORTED' | 'UNVERIFIED' | 'UNAVAILABLE'
    | 'DENIED' | 'CONFIG_CHANGED' | 'EVIDENCE_MISSING';
}
```

以上是已实现的内部接口，不是新wire契约。facts仅由可信服务组装；普通登记输入不能指定VERIFIED、allowed或执行grant。真实身份未取得同配置证据时不得装配VERIFIED。

- [x] RED：对未知字段、伪造客户端别名、无版本/实例绑定、非法指纹、任意command/env、用户自报VERIFIED分别写拒绝测试，确认未实现时失败。
- [x] RED：以固定64位十六进制A/B指纹覆盖unsupported、unverified、unavailable、denied、资格缺失、证据缺失、指纹漂移；仅合成可信事实全部成立时enabled=true。
- [x] 实现严格键/枚举/边界校验。判定顺序为DENIED→CONFIG_CHANGED→UNSUPPORTED/UNVERIFIED→UNAVAILABLE→资格/证据检查→READY；前置输入格式错误直接抛契约错误，不默认为支持。
- [x] GREEN：运行node --test tests/adapter-contract.test.ts；补充不得修改输入对象、重复判定相同输出的测试。

必须保留的测试形状（fixture不能冒充原客户端探针）：

```ts
const facts: CapabilityFacts = {
  supported: 'supported', available: true, allowed: true,
  qualification: 'UNVERIFIED', observedFingerprint: 'a'.repeat(64),
  currentFingerprint: 'a'.repeat(64), evidenceIds: []
};
assert.equal(evaluateCapability(facts).enabled, false);
assert.equal(evaluateCapability({ ...facts, allowed: false }).reason, 'DENIED');
assert.equal(evaluateCapability({ ...facts, currentFingerprint: 'b'.repeat(64) }).reason, 'CONFIG_CHANGED');
```

## Task 2 — 授权登记与只读投影

**Files:** 新增packages/service/src/adapter-registry.ts、tests/adapter-registry.test.ts、tests/adapter-helpers.ts；修改packages/service/src/domain.ts的内部Action联合。复用store.ts/auth.ts，不放宽core/1.0。

**Interfaces:** AdapterRegistry(store, now?)；register(token, value: unknown)；read(token, projectId, bindingId)；invalidate(token, projectId, bindingId, expectedRevision, actionId)。新增内部adapter_configure/adapter_read动作，与现有policy/grant/run/resource求交。

- [x] RED：合成项目A/B、同成员公开/私密运行各有独立scope；未授权、跨项目、跨scope、撤权、过期和依赖不可见均不能登记或读派生信息。
- [x] RED：登记存为Resource<AdapterRegistration>，kind=adapter_binding，携带task/成员绑定所需资源依赖；重试稳定action_id与相同载荷不新增记录，不同载荷冲突。expectedRevision不匹配不覆盖既有数据。
- [x] 明确定义登记请求的project_id、binding_id、action_id、scope_id、expected_revision、target、binding_mode、configuration_fingerprint与声明能力。只存必要元数据/不透明凭据引用，不存token、cookie、原始环境或聊天历史；服务端生成ACL/资格/revision，拒绝调用方注入。
- [x] 在现有resources表存adapter_binding及不可变adapter_registration_action审计资源，同一Store.transaction内执行CAS和回执写入；不写core的八操作actions账本。action资源由服务端继承scope可见性、绑定相同grant与payload摘要；查重仍先重查scope及当前授权，不扩大resource_ids。注册/失效都使用action_id；相同重试返回同一回执，不同载荷冲突，失效后重试旧注册不能重新激活。新增资源的创建资格严格绑定获准scope，读取要求binding及其scope进入可信配置的grant资源范围。无需新增迁移，不放宽旧表或wire契约。
- [x] read返回明确supported/available/allowed/qualification/reason与观测时间；不调用provider。以total_changes前后相同、持久事件数相同以及入口不依赖transport/RunnerHost的结构检查证明100次读取没有调用运行路径。
- [x] GREEN：撤权/更换实例/协议版本后旧资格立即失效；验证不存在的绑定与无权绑定不泄露不同细节。登记过程不为原Agent生成新执行token，也不启用派工。

## Task 3 — 只读边界故障走查与下一接入清单

**Files:** 新增tests/adapter-walkthrough.mjs及合成fixture；必要时新增packages/service/src/adapter-projection.ts；修改package.json增加独立测试/走查命令；更新本计划、README、交接与阶段证据。

- [x] RED：构造“登记→查看未验证原因→导入可信合成观测→更换配置→资格失效→撤权不可读”的动作序列；任何一步不能向真实客户端发送数据。
- [x] attached_session的detach只丢弃平台连接引用，不得调用RunnerHost/ProcessJob.Terminate；没有经过验证的interrupt能力时显式拒绝，不降级为杀进程。
- [x] 明确将未来send_message、reply_wait、approve、interrupt分开列为操作；W08没有真实实现的方法一律不可用，不提供返回成功的空实现。未知发送结果禁止自动生成新action重发。
- [x] 编译后走查，保存脱敏JSON/错误原因/动作顺序；跑npm run verify、npm run test:native、旧包检查及设计/P0离线校验，检查W07成功/停止/UNKNOWN语义未退化。
- [x] 作者自审，保存红绿日志及变更/保护清单；阶段报告明确合成证据、实际能力和未验证项。按已授权仓库流程审查暂存后提交推送，不上传本机数据。

## 后续真实接入的通过条件（不计为W08已完成）

1. 固定三个原客户端的真实身份/版本与官方协议依据，登记supported/unsupported/unverified，不沿用参考项目的测试结果。Codex只读跟随和DSH原客户端插件桥是优先研究线索；Claude Desktop单独核验，不替换成SDK。
2. 对选定且获准的实例/会话只做无副作用探针，证明不会唤醒、接管、打断或读取授权外历史；失败保留原因，不假装连接成功。
3. 之后才选择单客户端合成任务，验证消息/输入恢复/审批/停止的独立协议和重试语义；未知结果先对账。
4. 写入与私密执行必须另有同配置隔离、可信工具身份及可靠撤写证明。W07的Job空只适用于owned_process开发夹具，不能代替G0/G1。
5. 用户2026-11-14已明确继续到管家之前：可独立的依赖/授权资料/离线灾备开发底座已继续实施，见PRE-COORDINATOR-FOUNDATIONS.md；真实多客户端写协作仍必须先通过以上门槛。管家方案暂缓，原生UI最后设计。

## 完成判定

W08交付的是能测试、能拒绝、能解释原因的适配底座，而不是“Agent已上线”。Node回归无跳过，历史迁移/契约/UI/旧包保持；无原客户端启动、无模型费用、无系统策略修改。本阶段新增45项Node测试；编译走查确认100次查询零写入、配置失效与撤权。组合阶段最终回归和交付见evidence/pre-coordinator/2026-11-14/COMPLETION.md；作者自检，不冒称独立评审。
