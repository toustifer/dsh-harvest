# dsh-harvest 跨平台化 —— 本轮范围（DAG: cross-platform）

- 日期：2026-08-28
- 决策人：用户（Leader 记录）
- 产品形态书（README.md / DESIGN.md）整体保留；本文件只写本轮改造范围。

## 目标（用户原话）

「我想要让他兼容 mac 和 linux」—— 项目从「Windows 独占」升级为
**Windows / macOS / Linux 三平台可用**。

## 现状已知的平台假设（候选，最终以 worker 全量审计为准）

- 执行层：`opencli`/`mcporter` 经 **PowerShell 垫片**调用（解决 `.cmd/.ps1`），
  以及 execFile / HTTP 兜底里的 PowerShell 哈希表语法 —— 疑似仅 Windows 路径。
- 路径/环境：安装目录 `~/.dsh/plugins`、`$env:USERPROFILE`、`C:/Users/...` 等。
- CI：`.github/workflows/ci.yml` 仅在 `ubuntu-latest` 跑语法检查 + 冒烟。
- 通道 CLI：`gh` / `yt-dlp` / `mcporter` / `opencli` / `bili-cli` 的三平台可用性/安装方式。

## 成功标准

1. `harvest_scout / harvest_extract / harvest_verify / harvest_audit` 四个工具
   在 Windows、macOS、Linux 上均可正常注册与调用（不含通道 CLI 是否已安装，
   未安装时按既有优雅跳过策略记 `[SKIP]`）。
2. CI 三平台矩阵（ubuntu / macos / windows）全部通过：语法检查 + 冒烟测试。
3. README 安装指引覆盖三平台（PowerShell / bash / zsh），并注明各通道 CLI
   在各平台的获取方式；DESIGN.md 同步更新目标平台说明。
4. 全量审计报告产出修复清单，逐个关闭；无「打地鼠」。

## 范围边界

- 只做平台兼容与验证，**不做新功能**（不改 scout/extract/verify/audit 语义）。
- 数据通道 CLI（opencli 等）的三平台安装命令写进文档，不负责在 CI 里装齐全部
  通道（冒烟测试只验证工具加载与基础调用路径）。
- 不引入第三方依赖保持零依赖约束；跨平台 shell 调用继续用 Node 内建实现。

## 验收方式

- 每个实现 task：worktree 内提交 + 测试证据（三平台可执行路径的证据，
  如 CI 矩阵运行结果、或本地三平台运行记录）。
- CI task 以 GitHub Actions 三平台矩阵实际运行结果为证据。
- 最终 Leader 验收核对四个工具的加载冒烟在三平台契约内通过。

## 分支

- execution_branch：`feat/cross-platform`
- base_branch：`master`