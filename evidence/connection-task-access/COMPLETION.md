# W17 连接绑定与单任务只读授权

日期：2026-11-16。工作区：D:\Users\1\Desktop\team。基线54874c2。

## 交付范围

ConnectionTaskAccess 是可信进程内合成授权内核，不是完整生产连接器。显式预置 policy/run/resource ACL，登记凭据通过 W16 验证后，绑定服务端 observation 的 connection/project/member/target/config/run/epoch/native会话；只接受 synthetic_only、owned_process、active、新鲜度≤30秒的观测。grant恰为read_resource、单task引用闭包，最长5分钟且不超过登记期限。拒绝额外资源、第二task、写权限、私密/附着模式和缺失观测。

每次中央鉴权重新检查登记、成员版本、签名键、观测、run；policy/资源ACL/依赖继续沿用原交集。断联、旧/未来观测、身份配置漂移、run未知后拒绝；一旦观察到连接门失效，本进程不可复活。重开Store没有验证器，旧token默认拒绝；不会因注册记录仍为registered而恢复执行。内存中同grant同载荷重取token，不把秘密写入workspace_commands。DB只保存token摘要。

没有新增HTTP签发/附着/模型接口，不改任务或run业务状态、不解锁、不停止任何原客户端。默认服务仍未装配真实controller。注册列表仍诚实显示not_connected；本阶段没有实现主人连接状态UI。

## 验证结果

| 检查 | 实际结果 |
| --- | --- |
| 基线 npm run verify | 517/517；0失败/0跳过 |
| 新增连接授权专项 | 41/41；含跨凭据、闭包、失效、重启、重试、观测故障、去约束降级反例 |
| 最终 npm run verify | 558/558；0失败/0跳过；生成/格式/类型/构建/smoke均通过 |
| 编译后HTTP用户顺序 | 配对→项目/成员→邀请/重试→兑换→可信合成授权→100次连接和task读取→主人撤销→两类token拒绝；读取0DB写入 |
| 原生回归 | 14/14 C# + 1 WPF静态；不是窗口点击 |
| 旧0.3.0包 | 989文件完整性PASS；未重打包 |
| P0准备文档 | 13/13 |
| 设计校验 | 56文件/55摘要；AT190/CA60仍NOT_RUN |

复现：`node --test tests/connection-task-access.test.ts`；`npm run build`后`node tests/connection-task-walkthrough.mjs`。原始日志仅本机 `.runtime/w17/`；不上传数据库/凭据/缓存。

## 失败与修复记录

1. 首个红灯：持久化grant携带连接约束但原鉴权忽略它，Missing expected exception。新增默认拒绝的进程内连接门；缺失模块红灯另记录于issue-red，不能把模块缺失当业务语义证明。
2. 类型检查发现多余函数真值条件，以及测试误用不存在的只读scope类型。移除冗余条件，改为实际task投影的越权资源检查；未关闭类型检查。
3. 作者自检发现降级路径：移除已绑定grant的connection_constraint字段会走普通授权。先写测试复现，再将guard查找提前并保留失效墓碑，连续两次读取均拒绝。DB恢复后仍依赖持久化约束；任意篡改整个数据库不在该可信本机服务的安全模型内。
4. 专项检查了observation抛错：原异常可见，后续固定拒绝，不吞错误制造在线成功。

作者自检，不是独立审核。检验确实走真实SQLite/回环HTTP与编译JS，但数据/观测均为合成；0原客户端启动、0模型调用、0窗口点击、0系统ACL/身份/网络修改。SQLite实验警告保留。

## 保留边界与下一入口

- HANDOFF.md 未编辑；SHA256 `9E057D55395FAABD77A175B64042F18DF24A7AC53334C10A0A370D3F06DF0586`；实时入口改为根README。
- schema4和001–004迁移不改；不打开/升级用户数据库，不重发schema2旧包。
- 真实controller绑定、外发授权与数据分类、主人重新授权产品流程仍需后续实现；callback不能由不受信客户端提供。本阶段不称实际身份认证或连接管理整体完成。
- Windows隔离暂缓；实际写入/私密执行仍禁止。DSH真实模型、Claude长期连接、Codex真实厂商同次撤权、附着会话、原生点击、生产灾备/签名升级未完成，250项正式产品验收不升级。管家未构建。
- 下一阶段：主人可读的连接状态/失败原因与显式重新授权；后续真实验收需具体授权。

提交前须暂存秘密扫描及diff检查；发布事实由Git与根README记录，不由本文件推定。
