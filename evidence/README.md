# 仓库中的验证证据

此仓库只包含经过上传前检查的W07文本证据及合成走查导出。完整历史日志、源码前置快照、浏览器截图、运行数据库、第三方参考checkout、SDK和便携包保留在本机，不随Git上传。

- [W07阶段交付](w07/2026-11-14-runner/COMPLETION.md)
- [测试汇总](w07/2026-11-14-runner/verification-summary.json)
- [编译后端走查](w07/2026-11-14-runner/walkthrough-closeout/report.json)

W07的source-manifest、before-manifest和evidence-manifest是该阶段完成时的历史摘要，不是当前Git提交的全量清单。manifest可能引用本机保留的快照或研究记录；摘要不等于这些文件也已上传。合成仓库整个目录不上传，保留独立JSON中的diff/journal/changeset导出；真实Git检查点及文件/Markdown可按测试命令重现。

证据里的测试项目、成员、执行ID均为合成数据；没有真实原客户端聊天、令牌或用户数据库。UNKNOWN、NOT_RUN、UNVERIFIED和NOT_FROZEN保留原义，上传不会把开发测试升级为产品资格。

历史W03–W06交付概况见plan中的对应阶段记录；本地evidence目录仍保留完整材料。新增证据默认忽略，只有检查范围、敏感内容与引用后才可加入.gitignore白名单。

## 管家之前的W08–W10开发阶段

[交付记录](pre-coordinator/2026-11-14/COMPLETION.md)及同目录6份明确白名单文件提供本轮结果；原始日志、合成数据库、Git仓库、备份包和恢复目录仅在本机保留，不进入仓库。作者自检不是独立审查；真实客户端/隔离/原生点击仍未验收。
