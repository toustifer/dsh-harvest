# agentflow-worker-infra — 经验记录（experience.md）

## 2026-08-28 — audit-platform（全量平台假设审计，DAG cross-platform）

### 学到的模式
- **「优雅跳过」掩盖平台回归**：dsh-harvest 的通道失败策略是抛错 → index.js 记 `skipped[]`，工具永不崩。这使任何平台回归（如 5 通道在 unix 全坏）只表现为「总是没结果」，日志只有 `[SKIP]`。审计时须把「会不会崩」与「功能是否真的工作」分开验证——smoke.mjs 只验模块加载，**从未触达执行层**，是盲区。
- **修 Windows 引入的 unix 回归（反模式）**：c04ad96 为解决 npm 全局 `.ps1` 垫片（Windows 特有）把 5 条通道的 build() 整体改为 `powershell.exe` —— 对 unix 是净回归。跨平台进程调用的正确姿势：平台分支的 `{ file, args }`，win32 走垫片、非 win32 走 argv 直调（可执行脚本/二进制），**不要为了一个平台的壳而换掉另一个平台的原生形态**。
- **execFile 的三个平台坑**：① Windows 无法直接跑 .cmd/.ps1（要 cmd.exe/powershell 垫片）；② 不经 shell 时 `~` 字面量不会展开（extract.js L16 兜底 `'~'` 是潜伏 bug）；③ 二进制名平台差异（python vs python3 vs py；gh/yt-dlp/bili 三平台同名但后缀/安装渠道不同）。
- **系统代理兜底是平台能力不是代码能力**：undici fetch 不读系统代理（三平台一致），README 里「只有走系统代理才能连」的救援路径只在 PowerShell/WinINET（Windows）存在；macOS 上要么显式 `curl -x`/`https_proxy` 约定，要么接受降级。
- **macOS 特有**：GUI 启动进程（Finder/LaunchAgent）PATH 只有系统目录，brew 的 CLI（gh/yt-dlp）不在 PATH → execFile ENOENT，即便已安装。文档须注明从终端启动或显式环境。

### 本次踩坑（流程层）
- **沙箱作用域=主仓 worktree 之外**：本 worker 会话沙箱为 `workspace-write`（仅 `/Users/stifer/myprogram/dsh-harvest`），而 Leader 指定的执行 worktree 是兄弟目录 `.agentflow-worktrees/dsh-harvest/cross-platform` —— 直接写文件被沙箱拒绝，且本会话禁用审批升级（approval prompts disabled）。审计/验证（读、node --check、smoke）全部可做，**产物只能暂存 /tmp**。经验：worktree 型 DAG 的 worker 沙箱应包含 worktree_root；否则审计型任务（只产文档）无法落地，需 Leader 手动落地或按正确 scope 重派。

### 复用建议（跨域可复用）
- 平台审计输出格式：文件+行号+假设+影响面+分类（阻塞/建议/不适用）+ 具体修复代码级建议，可直接作为后续修复任务的工单。
- 「可并行 vs 必须顺序」按**文件依赖**划分（零 import 依赖的文件组可并行），而非按 worker 数量拍脑袋。