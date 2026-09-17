# 🌾 dsh-harvest

> DSH 原生多平台调研流水线插件 —— 原生工具与 Skill 流水线（支持 5 个原生工具 + harvest skill）。
> 目标平台：Windows / macOS / Linux（安装与数据通道均已按平台分块说明）。

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license"/>
  <img src="https://img.shields.io/badge/DeepSeek%20Harness-plugin-4b32c3" alt="DeepSeek Harness"/>
  <img src="https://img.shields.io/badge/version-0.2.0-blue" alt="version"/>
  <img src="https://img.shields.io/badge/self--contained-2ea44f" alt="self-contained"/>
  <img src="https://img.shields.io/badge/runtime-Node%20ESM-339933" alt="Node ESM"/>
  <img src="https://img.shields.io/badge/target%20platforms-Win%20%7C%20macOS%20%7C%20Linux-lightgrey" alt="target platforms"/>
</p>

`dsh-harvest` 让 DeepSeek Harness 里的智能体**像开联合收割机一样做调研**:一次撒网多个平台、穿透反爬抓原文、跨源交叉验证、最后给来源打分。任一数据通道挂了也不会卡住整条流水线。

---

## ✨ 五个原生工具

| 工具 | 职责 | 失败策略 |
|------|------|---------|
| `harvest_scout` | 多平台并行发现候选来源（Web/GitHub/社媒等） | 单通道失败记 `[SKIP]`,不阻塞 |
| `harvest_deep_research` | 异步端到端深度调研（生成长篇综合研报与信源） | 超时/异常安全回退，不卡死主会话 |
| `harvest_extract` | 逐条抓取正文 | 直抓 → Jina 升级 → 标记 paywall/unreachable |
| `harvest_verify` | 跨源交叉验证断言 | 一致 / 弱 / 未证实 三态 |
| `harvest_audit` | 来源可信度五维审计 | 🟢 可信 / 🟡 谨慎 / 🔴 弃用 |

**数据流**:`scout → extract → verify → audit`,每个工具输出结构化 JSON + 折叠文本,供 agent 直接读取。

## 🔌 数据通道

11 条数据通道，任一通道失败（CLI 未装 / 虚拟环境缺失 / 未登录 / 解析失败）记 `[SKIP]`，不阻塞整条流水线。

| 通道 | 底层 | 类型 | macOS / Linux 可用性 |
|------|------|------|----------------------|
| GitHub | `gh search repos` | 代码 | ✅ 三平台原生可用，未装即 `[SKIP]` |
| Web / Exa | `mcporter call exa.web_search_exa` | 网页搜索 | ✅ mac/linux 可直接调用（修复后形态） |
| Twitter / Reddit / 小红书 | `opencli`(浏览器桥接) | 社交 | ✅ mac/linux 可直接调用（修复后形态） |
| LinkedIn | `mcporter linkedin-scraper`(需登录态) | 招聘 | ✅ mac/linux 可直接调用（修复后形态） |
| YouTube | `yt-dlp ytsearchN:` | 视频 | ✅ 三平台原生可用，未装即 `[SKIP]` |
| B站 | `bili search`(bili-cli，第三方) | 视频 | ✅ 三平台原生可用，未装即 `[SKIP]` |
| V2EX | `curl v2ex.com/api/topics/hot.json` | 社区 | ✅ 三平台可用（HTTP 直连 + curl 兜底） |
| Telegram | `mcp-telegram` (Telethon) | 社群/即时通讯 | ✅ 支持 `TELEGRAM_PYTHON` / `TELEGRAM_MCP_PATH`，未登录即 `[SKIP]` |
| LINUX DO | `linuxdo-mcp` (curl_cffi) | 极客社区 | ✅ 支持 `LINUXDO_PYTHON` / `LINUXDO_MCP_PATH`，无 Cookie 即 `[SKIP]` |

> 📌 **支持的 `platforms` 参数枚举（共 11 通道）**：`github` · `web` · `twitter` · `reddit` · `xiaohongshu` · `youtube` · `bilibili` · `v2ex` · `linkedin` · `telegram` · `linuxdo`。缺省时并行扫描全部通道。

> **修复说明**：`mcporter` / `opencli` 在 Windows 上以 npm 全局安装生成的 `.ps1`/`.cmd` 垫片存在（Node `execFile` 无法直接执行，需经 PowerShell 调用）；在 macOS/Linux 上它们是**可执行脚本/二进制，可直接 argv 调用**。本次跨平台修复（并行进行中，见 DESIGN.md 数据通道矩阵）即按该目标形态实现，文档按修复后的形态描述。macOS/Linux 上未装对应 CLI 时通道记 `[SKIP]`，与 Windows 行为一致。

> **另**：`harvest_extract` 自动识别 **RSS feed**(feedparser)与**小宇宙播客** URL(Whisper 转写)，把 agent-reach 剩余 3 个平台(小宇宙/RSS/网页阅读)也纳入 —— 合计覆盖全部 13 平台。
> 平台依赖：RSS 解析走 **Python**(`python3`/`python`，需 feedparser 包)；小宇宙转写走 **bash**(`~/.agent-reach/tools/xiaoyuzhou/transcribe.sh`，需 groq key)。Windows 默认无 bash，小宇宙通道在 Windows 上恒 `unreachable`（优雅降级，不报错）。

### 数据通道 CLI 获取方式（按平台）

未安装的通道不会阻塞流水线（自动记 `[SKIP]`），按需安装即可：

| CLI | 用途 | Windows | macOS | Linux |
|-----|------|---------|-------|-------|
| `gh` | GitHub 搜索 | winget / 官方安装包 | `brew install gh` | 官方 apt 仓库 / 二进制 |
| `mcporter` | Web/Exa · LinkedIn | `npm i -g mcporter`（经 PowerShell 垫片） | `npm i -g mcporter`（可执行脚本，直调） | 同 macOS |
| `opencli` | Twitter · Reddit · 小红书 | `npm i -g opencli` | `npm i -g opencli` | 同 macOS |
| `yt-dlp` | YouTube | 官方 `yt-dlp.exe` / winget | `brew install yt-dlp` | `pip install yt-dlp` / 发行版包 |
| `bili-cli` | B站 | GitHub 发布页 `bili.exe` | brew / 源码构建 | 源码构建 |
| `mcp-telegram` | Telegram 搜索 | 本地虚拟环境或 `TELEGRAM_PYTHON` | 本地虚拟环境或 `TELEGRAM_PYTHON` | 本地虚拟环境或 `TELEGRAM_PYTHON` |
| `linuxdo-mcp` | LINUX DO 搜索 | 本地虚拟环境或 `LINUXDO_PYTHON` | 本地虚拟环境或 `LINUXDO_PYTHON` | 本地虚拟环境或 `LINUXDO_PYTHON` |

> **bili-cli 重要提示**：`bili` 是**第三方非官方** bilibili 客户端（Go 单二进制），非哔哩哔哩官方发布；只从可信来源（如项目自己的 GitHub 发布页）获取并自行核验，注意其登录方式与合规边界。
> **Windows npm 全局**：`mcporter`/`opencli` 经 npm 全局安装，垫片生成在 npm 全局 bin 目录（`npm prefix -g` 可查）；若该目录非常规位置，设环境变量 `DSH_HARVEST_BIN` 指向它以覆盖默认查找。
> **macOS 提示**：若 `dsh web` 从 Finder / LaunchAgent 启动，进程 PATH 通常只有系统目录，`/opt/homebrew/bin` 下的 `gh`/`yt-dlp` 取不到（即便已装也会 `[SKIP]`）；从终端启动，或在启动脚本里显式把用户 bin 目录加进 PATH（如 `export PATH="/opt/homebrew/bin:$PATH"`）。

## 📦 安装（DSH 原生）

### Windows（PowerShell）

```powershell
# 1. 克隆到 DSH 插件目录
git clone https://github.com/<you>/dsh-harvest.git $env:USERPROFILE\.dsh\plugins\dsh-harvest

# 2. 在 web profile 的 package.json 里加 link 依赖 + bundles 条目
#    "dependencies": { "dsh-harvest": "link:C:/Users/<you>/.dsh/plugins/dsh-harvest" },
#    "dsh.profile.bundles": [ ..., "dsh-harvest" ]
#    （link 路径用正斜杠，把 <you> 换成你的用户名）

# 3. 链接
cd $env:USERPROFILE\.dsh\profiles\web
pnpm install

# 4. 重启
dsh web
```

### macOS / Linux（bash / zsh）

```bash
# 1. 克隆到 DSH 插件目录
git clone https://github.com/<you>/dsh-harvest.git ~/.dsh/plugins/dsh-harvest

# 2. 在 web profile 的 package.json 里加 link 依赖 + bundles 条目
#    macOS:  "dependencies": { "dsh-harvest": "link:/Users/<you>/.dsh/plugins/dsh-harvest" }
#    Linux:  "dependencies": { "dsh-harvest": "link:/home/<you>/.dsh/plugins/dsh-harvest" }
#    "dsh.profile.bundles": [ ..., "dsh-harvest" ]

# 3. 链接
cd ~/.dsh/profiles/web
pnpm install

# 4. 重启
dsh web
```

> 两平台差异只在根目录：Windows 用 `$env:USERPROFILE`（PowerShell），macOS/Linux 用 `~`。`link:` 依赖需写**绝对路径**（JSON 不做变量展开），`<you>` 换成你的用户名即可复制执行。

## 🚀 用法

```
# 全平台广播发现（默认并行扫描全部 11 个通道）
harvest_scout(query="最新 AI 项目", limit=8)

# 定向通道发现（如仅聚焦极客社区与深度社群）
harvest_scout(query="DeepSeek 优化实践", platforms=["github", "linuxdo", "telegram", "web"], limit=5)

# 端到端长篇深度调研
harvest_deep_research(input="深入剖析大模型推理与架构演进")

# 正文穿透抓取（自动升级 Jina Reader / RSS / 播客转写）
harvest_extract(urls=["https://…", "https://…"])

# 跨源交叉验证关键断言
harvest_verify(claims=["DeepSeek 出了视觉模型"], sources=[…])

# 来源可信度五维审计矩阵
harvest_audit(sources=[{title, url, type}])
```

## ⚙️ 配置与环境变量

插件支持**零侵入、优雅降级**的多级配置机制。未配置的通道或未安装的依赖会自动记入 `[SKIP]`，绝不阻塞整条流水线。

### 1. 深度情报通道（Telegram 与 LINUX DO）配置

深度情报通道通过本地虚拟环境或指定 Python 解释器运行轻量检索探针，支持通过环境变量灵活定制：

| 环境变量 | 默认值 / 查找顺序 | 说明 |
|---|---|---|
| `TELEGRAM_PYTHON` | `<TELEGRAM_MCP_PATH>/.venv/...` → `python3` / `python.exe` | 用于驱动 Telegram (Telethon) 的 Python 解释器绝对路径 |
| `TELEGRAM_MCP_PATH` | `D:\myprogram\tools\mcp-telegram` | 本地 `mcp-telegram` 项目目录，用于加载会话与依赖 |
| `TELEGRAM_SESSION` | `<TELEGRAM_MCP_PATH>/.state/mcp-telegram/session.session` | 指定 Telegram 授权会话文件路径（如未授权则通道自动跳过） |
| `LINUXDO_PYTHON` | `<LINUXDO_MCP_PATH>/.venv/...` → `python3` / `python.exe` | 用于驱动 LINUX DO (curl_cffi) 的 Python 解释器绝对路径 |
| `LINUXDO_MCP_PATH` | `D:\myprogram\tools\linuxdo-mcp` | 本地 `linuxdo-mcp` 项目目录，内含 `.env` 或依赖 |
| `LINUXDO_COOKIE` | 读取 `linuxdo-mcp/.env` 或本地缓存文件 | LINUX DO (linux.do) 的会话 Cookie，免登录态时自动 `[SKIP]` |

> 💡 **跳过与防御性契约**：若本地未准备好 Telegram 会话文件或未提供 LINUX DO Cookie，`harvest_scout` 在探测阶段（`probe()`）会直接安全跳过对应通道，不产生无意义的进程调用或错误弹窗。

### 2. Tavily 深度调研与网页搜索配置（标准凭据管理）

插件支持 DSH 原生标准凭据管理或系统环境变量：

#### 方式 A：DSH 原生标准配置（推荐）
在 `~/.dsh/settings.yaml` 中配置：
```yaml
harvest:
  tavilyApiKeyEnv: TAVILY_API_KEY
  tavilyEndpoint: https://search.cliproxyapi.xyz/search             # 可选，默认官方标准端点
  tavilyResearchEndpoint: https://search.cliproxyapi.xyz/research # 可选，默认官方标准端点
```
然后在 `~/.dsh/.credentials.yaml` 中保存密钥：
```yaml
refs:
  TAVILY_API_KEY: 你的Tavily或中转Key
```

#### 方式 B：系统环境变量
- `TAVILY_API_KEY`: 配置密钥。
- `TAVILY_ENDPOINT`: 默认为 `https://api.tavily.com/search`。
- `TAVILY_RESEARCH_ENDPOINT`: 默认为 `https://api.tavily.com/research`。

## 🏗️ 架构

```
lib/
  index.js      # 插件主体:注册 5 个工具与 harvest skill
  backends.js   # 11 通道封装 + 探针静态探测 + 优雅跳过
  extract.js    # 抓取路由(直抓 → r.jina.ai；RSS / 小宇宙)
  http.js       # HTTP 层(fetch + 平台化兜底)
```

## 📄 归属与血统

方法论(Scout → Extract → Verify → Audit)源于作者自研的 [omni-scope](https://github.com/toustifer/omni-scope) 工作流,按 DSH 原生插件形态**从零重写**。
运行时仅以子进程调用 `gh` / `mcporter` / `opencli` / `yt-dlp` / `bili` / `mcp-telegram` (Telethon) / `linuxdo-mcp` (curl_cffi) 作为数据通道,不包含其源码。
详见 [ATTRIBUTION.md](./ATTRIBUTION.md)。

## 📝 License

[MIT](./LICENSE) © 2026 dsh-harvest contributors
