# Attribution & Provenance

本项目源于 toustifer/dsh-harvest，保留 MIT 许可证。Scout → Extract → Verify → Audit 方法论来自原作者的 omni-scope 工作流。

0.3.0 在原项目上增加 Codex MCP 与 Skill 接入，拆分共享核心，并调整证据处理、超时和任务持久化行为。该本地适配不代表原作者已经发布或认可此版本。

运行依赖：Model Context Protocol TypeScript SDK、Zod、YAML；开发打包使用 esbuild，分别遵循上游许可证。独立插件包在 THIRD_PARTY_LICENSES.txt 中附带依赖许可文本。

外部 gh、mcporter、opencli、yt-dlp、bili 作为可选进程调用，不包含其源码。Tavily、Jina 与各数据平台为外部服务；RSS 使用用户安装的 Python/feedparser。
