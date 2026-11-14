# Team — 原生 Windows 工作台

双击此目录中的 **Team.exe**。整个文件夹必须放在一起；无需安装 Node、.NET、浏览器或 npm，无需输入地址或配对码。Windows x64，使用 WPF 原生控件；本包未签名，是开发验证版本，不是正式安装器。不要关闭系统防护来运行。

- 左侧新建/选择项目。右侧切换对话与任务草稿；成员和进度在右上角。
- 消息只保存在本机，原 Agent 尚未连接；“保存消息”不会启动 Agent。任务是草稿，不代表执行或审批。
- 私密收件人须明确选择。停用成员后不会自动改成群聊或取消负责人。
- Ctrl+N 新建项目；Ctrl+F 查找消息；Ctrl+Enter 保存消息；F5 刷新。Tab 切换控件。
- 关闭窗口会结束本窗口拥有的服务，不碰其他 Node 或 Agent 进程。有未保存或未确认内容时会询问。

## 数据

默认数据库：`%LOCALAPPDATA%\Team\core.sqlite`。重新打开沿用同一个数据库；包里没有预置数据库或凭据。不要把它放在网络共享盘。

已有数据库可显式打开：`Team.exe --data "D:\absolute\core.sqlite"`。不会自动复制、覆盖或迁移旧工作台数据库；使用现有 001/002 迁移保持兼容。请先关闭访问此库的旧版服务。首次启动新库与打开旧库都不会调用模型。

请在应用完全关闭后备份数据库及其仍存在的 `-wal` / `-shm` 文件。不要在运行时手工复制一个 SQLite 主文件当作完整备份。

## 故障

应用始终显示连接/保存错误。提交结果不明确时“重试保存”使用相同 action_id 和原始内容，避免重复消息；此时不要关闭窗口重新新建。版本冲突不会覆盖输入，可在表单中显式读取最新版本。数据库重复打开或不可写会报错，不会退回另一个空库。

“关于”显示实际数据路径与 Node SQLite 实验性 API 说明。本原生界面不证明 Agent 原客户端兼容、强制隔离、恢复流程或 250 项产品验收通过。

## 开发

源码：`packages/desktop`；宿主/传输/状态：`Core`；原后端：`packages/service`。构建 `powershell -File scripts/build-native.ps1`；本地 SDK 默认 `.tools/dotnet/dotnet.exe`，版本见根目录 global.json。测试：`dotnet run --project tests/desktop/Team.Tests.csproj`，`node tests/native-package.mjs`。依赖许可随包附带；生产服务依赖各自目录保留 LICENSE。
