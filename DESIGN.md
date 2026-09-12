# Harvest 0.3 架构

当前实现：共享工具核心 + Codex STDIO MCP + DSH 薄适配器。原始跨平台审计文档描述 0.2 及更早版本；以当前代码和 README 为准。

- `lib/core/tools.js`：Zod 参数契约、工具编排与每次调用的期限。
- `lib/core/config.js`：环境配置；DSH YAML 解析仅在 `lib/adapters/dsh/index.js`。
- `lib/core/backends.js` / `lib/core/process.js`：九个数据渠道、参数安全传递与进程超时。
- `lib/core/http.js` / `lib/core/extract.js`：有界 HTTP、正文路由、截断与可选快照。
- `lib/core/evidence.js`：来源去重、词汇候选片段和待核查元数据。
- `lib/core/research.js`：Tavily start/status、原子持久化与报告分页。取消本地请求不等于远端取消。
- `lib/adapters/dsh/index.js`：DSH 薄适配器（cordis 工具注册、web 搜索 Provider、`exec.signal` 透传）。
- `lib/adapters/mcp/server.js`：标准 MCP SDK，JSON 结果和错误；stdout 只传输协议。
- 分层约束：`lib/core/**` 是宿主中立层，禁止 import 宿主 SDK（yaml / cordis / MCP SDK）；适配器只许 import 核心与各自宿主 SDK。该边界由 `test/boundary.test.mjs` 机械校验，不靠口头约定。
- `test/dsh.test.mjs`：DSH 适配契约（`exec.signal` 取消、默认值字段不得必填、8 工具集合、Provider 形状与 `$DSH_HOME`）。
- `skills/harvest-research`：宿主负责选渠道、原文语义判断、来源引用及缺口说明。
- `scripts/build-plugin.mjs`：输出不依赖 node_modules 的本地插件目录。

默认每次 scout 限 25 秒，extract 限 45 秒，单次外部研究请求默认 20 秒；MCP 调用期限配置为 60 秒。HTTP 响应最多 2 MiB，原文输出有明确截断标记，证据候选每断言最多五条并报告总数。

核验与审计不会生成自动 truth/trust 判定。工具读到的网页和外部输出均为不可信资料，不能作为操作指令。

Node 22+；固定版本 MCP SDK、Zod、YAML，开发打包使用 esbuild。保留 MIT 血统，独立包附带依赖许可证。
