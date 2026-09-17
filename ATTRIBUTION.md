# Attribution & Provenance（来源与归属声明）

`dsh-harvest` 是 DeepSeek Harness（DSH）原生多平台调研流水线插件，由本仓库作者原创开发。

作为一个面向广度信息收集的联合收割机工具，`dsh-harvest` 极其重视并尊重开源项目、开发者及社区生态的贡献与知识产权。

---

## 💡 代码来源与架构

- 全部插件胶水层与调度层实现为 **Node.js ESM，新写**，无第三方源代码被复制或侵权内联。
- 方法论（Scout → Extract → Verify → Audit 四阶段、r.jina.ai 智能升级、跨源交叉验证与可信度审计）源于作者自研的 [omni-scope](https://github.com/toustifer/omni-scope) 工作流。

---

## 🌐 开源项目与社区生态致谢（Attribution）

`dsh-harvest` 通过子进程管道、标准协议（MCP）或轻量脚本按需桥接外部工具与社区服务，实现 11 条数据信道的广度覆盖。我们在此向以下开源项目、开发者及社区致以诚挚的感谢：

### 1. Telegram 接入与参考生态

| 项目 / 库 | 作者 / 社区 | 开源协议 | 用途说明 | 主页 / 仓库 |
|---|---|---|---|---|
| **Telethon** | Lonami (LonamiWebs) | LGPL-3.0 | 纯 Python 实现的高性能异步 Telegram MTProto 客户端库，用于通道内的消息检索与会话交互 | [GitHub](https://github.com/LonamiWebs/Telethon) |
| **mcp-telegram** | MCP 社区开发者 | MIT | 基于 Model Context Protocol (MCP) 与 Telethon 封装的 Telegram 交互服务架构参考，用于桥接本地会话与搜索协议 | [MCP Servers](https://github.com/modelcontextprotocol/servers) |

### 2. LINUX DO 社区与接入参考生态

| 项目 / 社区 | 作者 / 社区 | 协议 / 性质 | 用途说明 | 主页 / 仓库 |
|---|---|---|---|---|
| **LINUX DO 社区** | Neo 与 LINUX DO 社区贡献者 | 开放技术社区 | 聚集了大量极客与大模型探索者的前沿技术社区，提供高质量开源技术洞察与讨论信源 | [linux.do](https://linux.do) |
| **linuxdo-mcp** | 开源社区贡献者 | MIT | 基于 MCP 协议规范封装的 LINUX DO 检索与交互适配层参考 | 社区开源实现 |
| **curl_cffi** | yifeikong 及社区贡献者 | MIT | 基于 curl-impersonate 的 Python 绑定库，提供浏览器级 TLS/JA3 指纹模拟，保障与现代 Web/Discourse 站点的稳定请求 | [GitHub](https://github.com/yifeikong/curl_cffi) |

### 3. 其他数据通道与运行时生态（外部调用）

本插件在运行时以子进程或 HTTP 方式按需调用以下外部工具与服务，**不包含其二进制或源码**：

| 工具 / 服务 | 上游项目 / 维护者 | 开源协议 | 用途说明 |
|---|---|---|---|
| **`gh`** | GitHub 官方 | MIT | 检索 GitHub 仓库与开源项目代码 |
| **`opencli`** | Agent-Reach 生态 / 社区 | MIT | Twitter、Reddit、小红书等社媒平台的浏览器桥接检索 |
| **`mcporter`** | Agent-Reach 生态 / 社区 | MIT | Web/Exa 搜索与 LinkedIn 平台数据通道 |
| **`yt-dlp`** | yt-dlp 团队 | Unlicense | YouTube 视频与元数据搜索 |
| **`bili-cli`** | 第三方开源贡献者 | GPL-3.0 / MIT | B站视频与内容搜索（Go 单二进制第三方工具） |
| **`r.jina.ai`** | Jina AI 官方 | Cloud API | Web 正文阅读器升级与反反爬内容提取 |
| **`feedparser`** | Kurt McKee 及社区贡献者 | BSD-2-Clause | RSS / Atom Feed 正文提取（由 Python 环境按需提供） |

---

## 🛡️ 边界与合规声明

1. **原创范围**：本项目的“原创”指插件架构、工具注册、后端封装（`lib/backends.js`）、抓取路由与启发式验证/审计算法。
2. **外部依赖**：上述引用的开源工具、库及社区商标权均归各自作者或社区所有。`dsh-harvest` 仅作为工具链集成者进行规范化调用。
3. **数据与凭证**：用户在使用 Telegram、LINUX DO 或社媒检索功能时，须遵守目标社区的使用条款与当地法律法规，本地凭据与会话文件由用户自行安全保管。

