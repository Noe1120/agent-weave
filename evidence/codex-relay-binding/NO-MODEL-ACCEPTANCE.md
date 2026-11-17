# W24 真实原客户端无模型生命周期验收

结论：**PASSED_FIXED_NO_MODEL_LIFECYCLE**，只限本次固定配置。用户单独批准一次新实例/新thread、无turn、无凭据复用，失败不自动重试。实际只运行一次，授权已使用。

## 环境与操作

- 工作区D:\Users\1\Desktop\team；官方Codex 0.167.0-alpha.3.2，安装元数据只读核验，二进制SHA256为4b3286e35d7fe866c6b0eb3f07d7a4cdb5e96489576170dfd6b3a15aa1c67382。
- tests/codex-relay-acceptance.mjs必须显式--allow-one-no-model-relay；.runtime/w24-live/owned-once独占创建，不可重用。先完成--synthetic演练；脚本缺授权和重复attempt均拒绝。
- 空CODEX_HOME、固定本项目relay入口、临时环境能力、回环拒绝provider，无用户provider/全局配置/聊天读取。本次不建业务数据库，用随机合成资源ID，任何HTTP请求都判失败；不是task_get验收。
- 平台拥有真正MCP桥；新Codex拥有relay。通过持有的自有Codex ChildProcess获得根PID，限定父子关系/创建时间/固定入口找到唯一relay，再在停止前打开并保留Windows实际进程句柄。无按旧PID清理或接管既有实例。

## 真实事实

| 检查 | 结果 |
| --- | --- |
| 开始/结束 | 2026-11-17T10:11:58.972Z / 10:12:05.221Z |
| MCP | initialize=1、tools_list=1、tool_calls=0、tool_errors=0 |
| 原生协议 | thread/start=1，generation=0，turn=null；无prompt/turn/interrupt/unsubscribe |
| 真正桥 | stdin_eof=true，exit0，exit_observed=true，forced=false，fault=null |
| relay OS退出 | exit0，观察时间10:12:03.2721856Z |
| 宿主关闭请求 | 10:12:03.328Z，在relay退出证据之后 |
| 宿主 OS退出 | exit0，观察时间10:12:03.3711455Z；控制器同样exit_observed=true/forced=false |
| 请求/原实例 | 回环provider请求0，原客户端清单不变，无剩余自有宿主子进程 |
| 清理 | 工厂删除bridge.json；另删除home/config.toml 1份，限定75文件扫描零业务token/relay能力残留 |

原始报告只包含计数、退出事实和摘要，无密钥、历史、完整进程命令。审核后的原样报告见[no-model-report.json](no-model-report.json)；本地原始证据为.runtime/w24-live/owned-once/report.json、host-exit.json、relay-exit.json及bridge下最终报告。成功清理不删证据、不递归删除目录。

## 回归与可复核性

全量npm run verify 675/675，0失败/0取消/0跳过，格式/类型/生成/编译冒烟通过；新装配2项回归，正常演练使用实际relay/桥与Windows退出句柄，Codex仅为本项目合成协议夹具。原生14+1、旧包989文件、P0 13项、设计63文件/62摘要通过。完整用户路径仅覆盖本次授权的无模型启动/发现/关闭/清理，不是原生窗口点击或真实任务使用。

日志保留.runtime/w24-live/harness-red.log、harness-first.log、verify-preflight.log、live-console.log、native.log、package.log、p0.log、design.log。新脚本缺失时两项测试先失败，补单次装配后通过；此次真实尝试没有失败或重跑。作者自检，非独立审计。

## 不升级的结论

W20旧联合验收仍FAILED，不用本次无模型证据追认。这里只证明该版本/配置下的一次正常生命周期；不是保证不会短暂重启、长期稳定、真实任务撤权或厂商模型调用成功，也不是OS网络隔离（回环0请求不等于全进程网络审计）。生产服务仍默认不启用relay组合。

下一步为同配置真实单任务只读＋撤权＋严格退出联合验收，需另行确认provider必要复用、一次合成turn及token上限；本轮不追加模型/实例。Windows强制隔离暂缓，原生点击、生产在线/离机灾备、签名安装升级未交付，190 AT/60 CA仍NOT_RUN，管家未构建。HANDOFF保持原摘要9E057D55395FAABD77A175B64042F18DF24A7AC53334C10A0A370D3F06DF0586。
