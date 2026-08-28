# dsh-harvest 设计文档

- 日期：2026-08-25（跨平台更新：2026-08-28）
- 作者：用户（omni-scope 原创者）
- 状态：已实现
- 目标平台：**Windows / macOS / Linux**

## 目标

把自研 omni-scope 的「多平台调研方法论」（scout → extract → verify → audit）按 DSH 原生插件形态工程化，
成为一套真正属于自己、可对外声明首创的 DSH 原生能力。

## 形态

cordis 插件 + 原生工具注册（同 dsh-strategic-core 模式）。零 `@deepseek-ai` 依赖、自包含。

## 工具

| 工具 | 职责 | 关键行为 |
|------|------|---------|
| harvest_scout | 多平台并行发现 | 9 通道并行，失败记 `[SKIP]` 不阻塞 |
| harvest_extract | 逐条抓取 | 直抓 → r.jina.ai 升级 → 标记 paywall/unreachable，不静默丢弃 |
| harvest_verify | 交叉验证 | 关键词命中 → verified/weak/unverified |
| harvest_audit | 可信度审计 | 五维启发式评分 → trust/caution/discard |

## 数据通道（平台可用矩阵）

9 条通道，进程调用形态按平台分支（详见下）：

| 通道 | 底层 | Windows | macOS / Linux |
|------|------|---------|---------------|
| GitHub | `gh search repos` | ✅ 原生 | ✅ 原生（未装 `[SKIP]`） |
| Web / Exa | `mcporter call exa.web_search_exa` | ✅ 经 PowerShell 垫片 | ✅ 直接 argv 调用（修复后形态） |
| Twitter / Reddit / 小红书 | `opencli`（浏览器桥接） | ✅ 经 PowerShell 垫片 | ✅ 直接 argv 调用（修复后形态） |
| LinkedIn | `mcporter linkedin-scraper` | ✅ 经 PowerShell 垫片 | ✅ 直接 argv 调用（修复后形态） |
| YouTube | `yt-dlp ytsearchN:` | ✅ 原生 | ✅ 原生（未装 `[SKIP]`） |
| B站 | `bili search`（bili-cli，第三方） | ✅ 原生 | ✅ 原生（未装 `[SKIP]`） |
| V2EX | `curl v2ex.com/api/topics/hot.json` | ✅ HTTP 直连 + 兜底 | ✅ HTTP 直连 + curl 兜底 |

- **进程调用形态**：Windows 上 `mcporter`/`opencli` 是 npm 全局生成的 `.ps1`/`.cmd` 垫片（Node `execFile` 无法直接执行），经 `powershell.exe` 以绝对路径调用，垫片目录可用环境变量 `DSH_HARVEST_BIN` 覆盖；macOS/Linux 上它们是可执行脚本/二进制，直接 `execFile` argv 直调，不经任何 shell 壳（修复后形态）。
- **优雅跳过契约**：未装 CLI / 桥接未连 / 解析失败 → 通道抛错 → 记 `[SKIP]`，绝不阻塞整条 scout；三平台一致。
- **extract 平台依赖**：RSS 解析需 `python3`/`python` + feedparser 包；小宇宙转写需 `bash` + `~/.agent-reach/tools/xiaoyuzhou/transcribe.sh`（Windows 默认无 bash → 恒 unreachable，优雅降级）。
- **HTTP 兜底**：`fetch`(undici) 失败时——Windows 走 PowerShell `Invoke-WebRequest`（WinINET 系统代理），macOS/Linux 走 `curl`（环境变量 `https_proxy` 已设时自动读代理）。

## 安装路径（按平台）

| 平台 | 插件目录 | 配置文件 |
|------|---------|---------|
| Windows | `%USERPROFILE%\.dsh\plugins\dsh-harvest` | `%USERPROFILE%\.dsh\profiles\web\package.json` |
| macOS / Linux | `~/.dsh/plugins/dsh-harvest` | `~/.dsh/profiles/web/package.json` |

1. 克隆到上表插件目录；
2. `profiles/web/package.json` 加 `link:` 依赖（**绝对路径**，JSON 不做变量展开） + bundles 条目；
3. `cordis.patch.yml` 注入 `id: harvest`；
4. profile 内 `pnpm install` 完成链接。

## 命名

工具名全下划线（`harvest_*`），规避 OpenAI 工具名校验 `^[a-zA-Z0-9_-]+$`（此前 strategy.* 点号名踩过坑）。

## 血统

源于自研 omni-scope 方法论，DSH 原生重写。README 明示 lineage。
