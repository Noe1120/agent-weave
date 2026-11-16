# W15 受保护运行管理交付记录

日期：2026-11-16。基线 d62d940（已与远端 main 核对）。实施者：本聊天；审查：作者自检，不是独立审核。

## 实际交付

- 新增 RuntimeGateway 和 HTTP 运行投影；项目/成员/run 取自 grant，资源和任务依赖逐次鉴权。
- start/close 需额外 runtime_control，继续由原控制器校验 adapter_configure、CAS、action 幂等及所属进程；不开放 turn/prompt/interrupt/attach。
- 正常服务默认没有 launcher。真实原客户端不能由请求传入路径/凭据来启动；没有持有控制器的活动记录显示 unknown。
- 白名单投影不带原生 thread 明文、原始消息、秘密或本机路径；100 次查询不写 DB、不发模型请求。
- DSH 仅 initialize-only，Codex 仅既有 app-server 管理能力；Claude 长期连接、WPF 控制和生产邀请/凭据未借此宣称完成。

## 验证

| 项目 | 结果 |
| --- | --- |
| 同步后全量基线 | 497/497，0 fail / 0 skip |
| 新增 HTTP 回归 | 7/7：未知状态、权限/依赖/撤权/过期、生命周期/幂等/CAS、错误 target、动态参数/Host-Origin 边界、默认无 launcher、DSH 限定能力 |
| 最终 npm run verify | 504/504，0 fail / 0 skip；生成检查、格式、类型、Web 语法、构建与编译冒烟通过 |
| npm run test:native | 14/14 C# + 1 WPF 静态，通过；不是窗口点击 |
| npm run test:native:package | 旧 0.3.0 包 989 文件通过，未覆盖包 |
| 编译后 HTTP 用户路径 | start → 相同 action 重试 → ready → 100 次读 → revoke → 拒读 → 维护关闭 → exit_observed；一个仓库 fixture，零读写增量，非强制退出 |
| 设计/P0 | 13/13 P0 离线检查（含新增报告字节回归）；54 设计文件、53 摘要项通过；190 AT + 60 CA 仍 NOT_RUN |

复现：`npm run verify`、`npm run test:native`、`npm run test:native:package`、`node tests/runtime-walkthrough.mjs`（先 build）。原始本地日志在 .runtime/w15/{baseline,red-read,red-control,verify,native,package,walkthrough}.log，不上传。

红灯：旧 HTTP 路由对运行 GET 和 start 都返回 404；实现后验证预期状态和副作用。实现中的 strip-only 语法及 exactOptionalPropertyTypes 错误均按根因修复，没有关检查、删断言或跳过测试。

暂存检查另发现 verify_design.py 在 Windows 用 write_text 隐式生成 CRLF，违反仓库精确字节要求。先复现生成报告含 CR（P0 红灯 1/13），再改为显式 UTF-8 write_bytes；刷新后字节回归与 Git 空白检查通过，不修改 Git 检查规则。

## 边界与下一个决策

本轮新增真实原客户端启动 0、计费模型调用 0、读取私有历史 0、窗口点击 0、系统账户/ACL/网络变更 0；schema4、001–004 迁移与旧包未改，管家未构建。

Windows 只读预检：build 22631、C: NTFS、非提升进程、具备本地账户管理命令。没有实测强制隔离。具体环境选择与有限系统变更提案见 [决策说明](../../plan/WINDOWS-ISOLATION-DECISION.md)。完整管家前任务仍未完成；不能以本阶段或历史客户端单次验收替代真实隔离、在线/离机灾备、可信签名升级与原生点击。
