# agentflow-worker-ops — 经验记录（experience.md）

## 2026-08-28 — ci-matrix（CI 三平台矩阵，DAG cross-platform，审计 BLOK-3）

### 做了什么
- `.github/workflows/ci.yml`：单 ubuntu-latest → `strategy.matrix.os: [ubuntu-latest, macos-latest, windows-latest]`（node 22，`fail-fast: false` 让三个平台独立报告），每平台：`node --check` 4 个 lib 文件 + `node test/smoke.mjs`。
- `test/smoke.mjs`（T-03，保持零依赖与 9 通道计数断言）：
  - **平台探测断言**：非 win32 校验所有 `build()` 不再出现 `powershell(.exe)/.ps1` 泄漏；win32 校验不再含硬编码用户名 `15775`；另有统一 argv 形状断言（`{ file: string, args: string[] }`）。
  - **「无 CLI 环境冒烟」**：`Promise.all + 逐通道 try/catch`（与 harvest_scout 同语义）跑 `github/youtube/bilibili/__definitely_missing_channel__`，断言聚合整体不抛、未知通道必进 skipped、skipped 带非空原因。

### 学到的模式
- **pwsh 不做 glob 展开**：CI 语法检查不能写 `node --check lib/*.js`——Windows runner 默认 pwsh（7）对原生命令**不展开通配符**，会当作字面量传给 node 报 ENOENT。跨平台写法 = 显式列出全部文件 + `&&` 链（pwsh 7 支持 `&&`）。审计 C-02 已确认此点。
- **CI 断言以「目标形态」编写 + 记录预期红**：执行层修复（fix-shell-layer）与 CI 矩阵并行时，把断言写成「修复后形态必须满足」的绊线（非 win32 无 powershell、win32 无硬编码用户名），当前 pre-fix 或 half-fix 的 lib 上会红——这正是捕获 BLOK-1 的回归绊线价值。不改 lib 迁就断言，红的原因写入断言信息，随修复提交转绿。验证断言逻辑本身正确（不能是「永远红」的坏断言）：用 /tmp 的模拟「修复后形态」跑同一套探测，确认转绿；再用 pre-fix 形态确认仍红。
- **消费者通道 id ≠ CLI 二进制名**：`bilibili` 通道的 build() 里 `file: 'bili'`。写探测清单要用通道 id（BACKENDS 的 key），不要想当然用二进制名，否则打到的不是「CLI 缺失」路径而是「unknown platform」路径（虽然也进 skipped，但掩盖了真实意图）。
- **共享 worktree 的并行提交纪律**：同 DAG 多 worker 共用同一 worktree，别人的改动会直接出现在自己的 `git status` 里。提交时必须按**路径显式 git add**，绝不 `git add -A`/`git add .`，否则会把并行 worker 未提交的工作卷进自己的 commit。commit 后跑 `git log -n 3` 检查是否有他人新提交；文件不相交则无需 rebase。
- **「无 CLI 环境冒烟」的真实执行层反馈**：本机装有 `gh`（未认证）时 `scoutChannel('github')` 真实执行 gh → 空结果 → 优雅进 skipped（reason: `github: empty result`）；无 yt-dlp/bili → ENOENT skipped；未知通道 → unknown platform skipped。聚合层零拒绝——优雅跳过契约在三个失败模式上全部成立，这正是审计 T-03 想要的验证。

### 本次踩坑（流程层）
- 上一个 ci-matrix worker（9b25d6b0）因 429 GoUsageLimitError 额度耗尽死亡，本任务是换绑重派（launch.ticket lt_1787916982002430000）。长任务注意配额度/分段。
- worktree 型 DAG：`task_get/worktree_get` 曾报 task not found（可能 ticket id 与 task id 不同构），用 `task_list` 按 title/assigned_worker 定位即可。

### 验证证据（提交 00556bb 时点）
- `node --check` smoke.mjs + lib 4/4 ✅
- `node test/smoke.mjs`：对 pre-fix lib 红（web/twitter/reddit/xiaohongshu/linkedin 泄漏 powershell.exe——预期绊线红）；fix-shell-layer 落 `lib/backends.js`（shimRun 平台分支）后 web 转绿，其余 4 通道待其继续提交后全绿。
- T-03-2 优雅跳过契约在 HEAD lib 上独立验证通过（/tmp/t032-probe.mjs：聚合不抛 + unknown channel 进 skipped + 原因非空）。
- 断言正确性自检：/tmp/t031-fixed-sim.mjs 用审计 4.1 固定形态模拟 → 0 泄漏（绿）；pre-fix win32 形态 → 检出 15775（红）。双向都对。