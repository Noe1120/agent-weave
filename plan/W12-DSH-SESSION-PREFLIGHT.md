# W12 DSH独立新会话预检

日期：2026-11-15（Asia/Tokyo）。状态：PREPARED / AWAITING_EXPLICIT_SESSION_AUTHORIZATION。仅完成只读预检；没有开始真实会话测试或扩展生产适配器。

## 当前依据

用户确认最新管家方案coordinator-core-review-1可提交，但管家仍暂不构建。W11初始化生命周期已经完成；“继续”不自动扩大到session、prompt、凭据或费用。继续DSH时先只读核对本机已固定的官方0.2.1-rc.3安装内容，不访问旧用户数据、不启动客户端、不安装升级。

固定app.asar的SHA256：04b32e3a872826ba15cfb2081c6a929a8d4ecaa65e09a2543e5a6b30e2eff1f0。包内dsh-acp/lib/index.js、dsh-llm及DeepSeek提供方实现、dsh-base和dsh-acp-app配置为本次静态依据。完整源码不复制到仓库，仅保存审核后的结论与源内容摘要。

## 已确认的前置影响

- session/new不是只读握手：会创建Agent、组合指定MCP连接、读取模型配置，并flush持久化。因此必须另行批准，而不能沿用initialize授权。
- 新建流程可读取提供方模型目录；ACP配置禁用了session-title-llm，未见该新建调用链主动发送prompt。无凭据的目录路径有缺失凭据处理，但这不证明所有插件都零网络，也不是Windows网络隔离实测。
- 新会话必须使用全新的home/agents/work目录、最小环境和空mcpServers；不复用已有Desktop账户、环境密钥或历史，不自动登录、换模型或补凭据。
- session/close只关闭已知的所属会话，持久状态仍可保留；它不是删除会话，也不能证明整个OS执行域已撤写。

## 建议的最小下一步（尚未执行）

在用户明确允许后，运行一次独立零prompt探针：initialize → session/new（新空cwd、mcpServers=[]）→ session/close（仅本次返回的sessionId）→ stdin EOF。只登记会话创建/关闭回执及退出证据，不对外开放执行能力。

- 出站方法只允许上述三种；不提供通用RPC入口，不list/resume旧会话、不authenticate、不set_config_option、不prompt/cancel。
- 不接收文件写入、终端或工具授权；遇到权限请求、未知协议帧、需要凭据、初始化配置变化或会话结果未知时停下，保留真实错误，不扩大操作或自动重试new。
- 超时仅处理当前所属子进程句柄；未证实退出保持unknown，不释放任务锁，也不把普通进程终止当Windows强制隔离。
- 先测试合成协议夹具与异常分支，再单独执行获准的真实探针；默认verify仍不能调用真实客户端。
- 原始会话目录、日志、config options和任何凭据不上网；审核报告只保留白名单元数据。失败也如实登记，不伪造新会话成功。

## 验收与后续边界

最小验收是本次新sessionId、对应close回执、正常EOF退出和原有Desktop进程未改变；模型调用数/原历史读取必须为零。若出现认证或联网前置条件，本轮不自动解决。创建成功也不代表模型可用、真实任务通过、L1–L3或OS隔离通过。

完成该探针后才能决定会话适配器的最小实现；真实prompt、费用、登录/凭据接入、已有会话附着、Windows身份/ACL/网络策略、原生点击仍分别需要授权。管家不构建，UI最后。
