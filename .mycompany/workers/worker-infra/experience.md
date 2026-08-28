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
## 2026-08-28 — fix-shell-layer（执行层跨平台化，DAG cross-platform）

### 学到的模式（落地审计 4.1-4.3 时的新坑）
- **统一垫片入口比逐通道三元更干净**：`shimRun(cli, psExpr, argv)` 一个函数收敛 5 通道的平台分支——win32 返回 `{ file:'powershell.exe', args:['-NoProfile','-Command', ...] }`，非 win32 返回 `{ file: cli, args: argv }`。每个通道只声明「PS 表达式 + Unix argv」两份形态，`IS_WIN` 只在一个点求值，测试与审查都容易。
- **win32 侧参数一律走 argv 而非拼命令字符串**：http.js 的 PS 兜底、backends.js 的 PS 表达式都尽力保持「裸字符串参数→execFile args」形态（powershell.exe args=['-NoProfile','-Command',ps] 本身就是 argv），避免把整个命令串交 shell。真正不可避免的 shell 拼接只有 PowerShell 命令串本身（其语义就是一段脚本）。
- **curl 兜底输出解析与 PS 相反**：`curl -w '\n%{http_code}'` 是「正文在前、状态码追加在末尾」→ 必须 `lastIndexOf('\n')` 分割；而 PowerShell `Write-Output $r.StatusCode; Write-Output $r.Content` 是「状态码在前」→ `indexOf('\n')`。同一对输出分割代码不能两平台共用（审计 H-04 只覆盖 PS 路径，curl 路径的解析顺序是本次踩坑）。
- **header 传递要防重复**：curl 用 `-A` 已带 User-Agent，`-H 'user-agent: …'` 会造成重复 UA 头（部分站点 400）。实现上 `merged` 里排除 user-agent 再逐条 `-H`，UA 只经 `-A merged['user-agent']`（调用方覆盖的头仍生效）。
- **探测顺序按平台现实排列**：`['python3','python','py']`（mac/linux 有 python3、Win 有 py），`.find(probe)` 命中即用；probe 用 `spawnSync(cmd,['--version'],{stdio:'ignore'})`，`status===0` 判可用，ENOENT 由 catch 兜底。bash 同理，探测一次缓存模块级常量。
- **`~` 字面量在 execFile 里不展开**：extract.js 的 `home` 兜底从 `'~'`（无意义）改为 `os.homedir() || process.env.HOME || ''`（审计 E-01）。
- **os.homedir() 在 mac 本机返回真实 home**，与 win32 版 `path.join(os.homedir(),'.npm-global')` 的组合在两端都得到「默认垫片目录」，不再依赖 `C:\Users\15775` 这种个人路径。验证时用 `Object.defineProperty(process,'platform',{value:'win32'})` 模拟 win32 分支的参数构造并断言——`process.platform` 可被 defineProperty 覆盖，但同一模块实例的 ESM 缓存会带着旧的 IS_WIN 快照，二次 import 需 URL 加查询串（`?win=1`）破缓存重求值。
- **「改 lib 时 CI 绊线测试已就位」**：ci-matrix 任务的 smoke T-03 断言（非 win32 build() 不得出现 powershell/.ps1、win32 不得出现 15775）在提交前已是红 → 我提交后转绿。跨 worker 并行在共享 worktree 的收益：对方测试直接覆盖我方交付，省掉自建回归网。

### 复用建议
- 平台分支进程调用：一个 `shimRun`/`buildXxx` 入口收敛分支 + 每个通道声明两形态（PS 串 / Unix argv）→ 可移植到任何「npm 全局装法在 win 生成 .ps1、unix 生成脚本」的 CLI 封装。
- 跨平台双路 HTTP 兜底模板：fetch 优先 → 平台分支 fallback（win=PS 系统代理 / unix=curl 环境代理）→ 输出解析按平台布局分割。curl 兜底默认自动读 https_proxy/http_proxy，无需额外代码。
