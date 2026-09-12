# Harvest — Codex 调研工具

本地 MCP 服务 + `harvest-research` Skill。复用 dsh-harvest 的多平台发现和抓取能力，由 Codex 阅读原文、判断证据并撰写报告。保留 DSH 入口，当前版本 0.3.0。

## 快速开始

需要 Node.js 22 或更新版本。在仓库目录运行：

```text
npm ci --ignore-scripts
npm test
npm run doctor
```

`npm test` 会构建独立插件并运行离线测试，包括真实 MCP 客户端、Windows 参数传递、网络超时、任务恢复和无依赖目录启动。

### 接入 Codex

在 Codex 的 MCP 设置中添加 STDIO 服务：命令为 `node`，参数为本仓库 `bin/harvest-mcp.mjs` 的绝对路径。也可通过 CLI 注册（将路径替换成本机仓库路径）：

```text
codex mcp add harvest -- node /absolute/path/dsh-harvest/bin/harvest-mcp.mjs
```

Windows 路径包含中文或空格时，在终端中给整个路径加引号。若应用找不到 Node，使用 `node.exe` 的绝对路径。

将 `skills/harvest-research` 目录复制到个人的 `~/.agents/skills/` 中。重新打开任务后，以 `$harvest-research` 调用，例如：

> 用 Harvest 调研本地优先的笔记软件，阅读官方文档，核实离线功能并比较证据。

也可在 `~/.codex/config.toml` 或项目 `.codex/config.toml` 中使用：

```toml
[mcp_servers.harvest]
command = "node"
args = ["/absolute/path/dsh-harvest/bin/harvest-mcp.mjs"]
env_vars = ["TAVILY_API_KEY", "TAVILY_ENDPOINT", "TAVILY_RESEARCH_ENDPOINT", "HARVEST_DATA_DIR", "HARVEST_BIN"]
startup_timeout_sec = 15
tool_timeout_sec = 60
```

项目配置需要该项目已被 Codex 信任。不要同时启用同一份插件 MCP 和独立 MCP 配置，以免工具重复。

### 独立插件包

`npm run build` 生成 `dist/dsh-harvest/`，其中包括 `.codex-plugin/plugin.json`、`.mcp.json`、Skill、打包后的 MCP 运行程序及第三方许可证。这个目录只需要 Node.js，不需要再次安装 npm 依赖。`.mcp.json` 的 `cwd: "."` 由 Codex 按插件根目录解析。

源码目录本身也带插件清单，但源码运行需要先安装依赖。个人本地插件的安装入口依 Codex 版本而异；不能使用插件安装界面时，采用上面的独立 MCP + Skill 方式。本仓库未发布到公共插件目录。

## 工具

| 工具 | 行为 |
|---|---|
| `harvest_doctor` | 检查本地命令、凭据是否配置；不验证付费 API 或登录状态 |
| `harvest_scout` | 默认 Web/GitHub，每渠道 5 条，最多 10 条；区分空结果和失败 |
| `harvest_extract` | 每次最多 3 个 URL；正文截断可见，可选保存完整正文 |
| `harvest_verify` | 按原文匹配候选片段、URL 去重；不声称事实已验证 |
| `harvest_audit` | 展示元数据及缺失项；不自动评分或弃用来源 |
| `harvest_research_start` | 提交可选 Tavily 研究，立即返回任务编号 |
| `harvest_research_status` | 单次查询进度，支持重启恢复及报告分页 |

`harvest_verify` 返回 `needs_review` 或 `insufficient_evidence`。Codex 必须结合语义判断支持、反驳、证据不足，并处理否定词、版本、日期和来源转载。两个关键词命中不代表两个独立来源证实结论。

抓取默认每篇返回 8000 字符，`maxChars` 可设为 500–50000。`saveFullText: true` 将实际抓到的完整正文保存为本地 JSON，返回 `artifactPath`；HTTP 响应上限为 2 MiB。HTTP 200 的明显脚本占位页会升级 Jina；通用网页正文提取仍可能带导航或遗漏动态内容，需要人工/模型核对。

## 数据渠道与配置

| 渠道 | 可选依赖 |
|---|---|
| GitHub | `gh` 和有效的 GitHub 登录态 |
| Web | Tavily 密钥，或 `mcporter` 中配置好的 Exa |
| Twitter / Reddit / 小红书 | `opencli`、浏览器桥接及相应登录态 |
| LinkedIn | `mcporter` 中的 linkedin-scraper |
| YouTube | `yt-dlp` |
| B站 | 第三方 `bili` CLI |
| V2EX | 公共热帖 API，仅按主题过滤当前热帖 |
| RSS | Python 和 `feedparser` |

小宇宙转写不在短时抓取工具内运行，返回 `unsupported`；可使用独立转写工具或提供逐字稿。缺依赖不会导致其他渠道失败，也不会自动安装外部工具。

Codex 入口只读取环境配置，不读取 `.dsh` 凭据：

- `TAVILY_API_KEY`：可选，Tavily 搜索/研究凭据。
- `TAVILY_ENDPOINT`：默认 `https://api.tavily.com/search`。
- `TAVILY_RESEARCH_ENDPOINT`：默认 `https://api.tavily.com/research`。
- `HARVEST_DATA_DIR`：默认 `~/.harvest`，存放任务状态、已完成报告和可选的原文快照。
- `HARVEST_BIN`：额外 CLI 搜索目录；兼容旧 `DSH_HARVEST_BIN`。

数据渠道会将查询发送给所选服务，Jina 回退会将目标 URL 交给 Jina。密钥不写入任务缓存；缓存可能包含研究正文和来源，保留在本地直至用户删除。自定义 Tavily 地址必须是你信任的服务；认证请求不跟随重定向。

## 外部研究任务

Tavily 是可选外部服务，可能计费，普通调研不需要它。提交后保留 `request_id`，按照 `pollAfterSeconds` 查询。请求超时不自动重复提交，避免重复任务。完成报告按 `nextOffset` 分页读取，重启后可读取缓存。

取消 MCP 调用只停止本地请求，不保证取消 Tavily 端任务。本版本没有远端取消接口；不要把停止轮询说成已取消远端研究。

## 接入 DSH

DSH 侧以原生插件（cordis bundle）接入：注册 8 个工具（7 个核心工具 + 旧名 `harvest_deep_research`），并在宿主提供 `ctx.web` 时注册 `tavily` 搜索 Provider。适配器为 `lib/adapters/dsh/index.js`，保留 `package.json` 的 `dsh.bundle.patch` 与 `cordis.patch.yml`。

### 前置

| 项 | 说明 |
|---|---|
| Node | 22+ |
| pnpm | `dsh plugin` 把参数转发给 profile 目录中的 pnpm；未安装时用 `npm i -g pnpm`，或借用 Node 自带的 corepack：`corepack pnpm …` |
| 本仓库依赖 | 插件以源码参与运行，先在本仓库 `npm ci`。`link:` 安装**不会**替你安装插件自己的依赖（Zod、YAML） |

### 安装（源码 link）

```bash
# 1. 装本仓库依赖
cd <this repo> && npm ci

# 2. 链接进 web profile —— 等价于 dsh plugin --profile web add link:<abs path>
cd ~/.dsh/profiles/web
pnpm add "link:<this repo 的绝对路径>"        # 无 pnpm 时：corepack pnpm add "link:<abs path>"

# 3. 在同一个 package.json 的 dsh.profile.bundles 数组里加入 "dsh-harvest"
#    （bundles 先按名字从 dsh 安装目录解析，再从 profile 自身的 node_modules 解析）

# 4. 重启 dsh web
```

### 验证

```bash
dsh --profile web --dump-config          # 组合树里应出现：- id: harvest / name: dsh-harvest
DSH_HARVEST_TRACE=1 dsh web              # 真实启动时在 stderr 打印注册结果
```

```
dsh-harvest: registered 8 tools, web search provider unconfigured (no Tavily key)
```

`DSH_HARVEST_TRACE` 默认关闭、只写 stderr、不影响协议输出。宿主侧加载失败或静默降级时（本项目历史上最贵的一类故障），这行是唯一能一眼看见的证据。

### 配置

家目录按 DSH 规则解析：显式配置 → `$DSH_HOME` → `~/.dsh`。在 `$DSH_HOME/settings.yaml` 配置端点、在 `$DSH_HOME/.credentials.yaml` 的 `refs:` 下放密钥（环境变量优先）：

```yaml
# settings.yaml
harvest:
  tavilyApiKeyEnv: TAVILY_API_KEY        # 可选，默认就是 TAVILY_API_KEY
  tavilyEndpoint: https://search.example.com/search
  tavilyResearchEndpoint: https://search.example.com/research
```

未配置 Tavily 时行为明确：`harvest_scout` 的 web 通道回退到 `mcporter`；`harvest_research_start/status` 与 `harvest_deep_research` 报 "not configured"，而不是静默返回空。

### 说明

- `link:` 指向源码目录，改完代码重启 `dsh web` 即生效，无需重新打包；同理，本仓库工作区改动会直接影响已装插件。
- 挂载的宿主取消信号会被透传到所有工具与轮询循环（`exec.signal` → `AbortError`），DSH 侧中断不会被忽略。
- 已知限制：模型侧 `parameters` 由 Zod 投影而来，含 `minLength`/`maxItems` 等 DSH 支持子集之外的关键字。当前默认呈现模式 `native` 不受影响；若切到 Code Mode（`code`/`both`），DSH 的代码生成会因不支持的子集把该工具的参数类型整体降级为 `unknown`（不报错、只丢类型提示）。运行时边界仍由 Zod 强制。

0.3.0 有意调整 verify/audit 的输出语义；依赖旧 `verified`、可信度分数或一次抓取超过 3 个 URL 的调用者需要更新。Node 运行依赖为 MCP SDK、Zod 和 YAML，不再宣称零依赖。

## 开发与验证

核心在 `lib/core/`（工具集 `lib/core/tools.js`），宿主入口为 `lib/adapters/dsh/index.js`（DSH 插件）与 `lib/adapters/mcp/server.js`（Codex STDIO MCP）。`lib/core/**` 不得 import 宿主 SDK，边界由 `test/boundary.test.mjs` 校验。测试位于 `test/*.test.mjs`，三平台 CI 运行同一套离线测试。真实渠道测试应单独进行：依赖检查通过或渠道跳过不算在线功能成功。

详见 [适配研究](docs/codex-adaptation.md)。原始方法论来自作者的 omni-scope，保留 [MIT 许可证](LICENSE) 和 [归属声明](ATTRIBUTION.md)。
