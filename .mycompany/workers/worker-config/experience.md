# agentflow-worker-config — 经验记录（experience.md）

## 2026-08-28 — docs-cross-platform（README/DESIGN 三平台化，DAG cross-platform）

### 学到的模式
- **文档平台化 = 先读代码再写文档**：改安装/通道文档前先通读 `lib/backends.js` / `lib/extract.js`，把「通道底层 CLI 名、调用形态、失败策略」与文档一一核对——README 原架构段写「6 通道封装」实际是 9 通道（BACKENDS 9 个键）；原「运行时调用 gh/mcporter/opencli/yt-dlp」漏了 `bili`。文档里的陈旧数字会随代码漂移，跨平台任务正好把这类口径一并修正。
- **「修复后形态」措辞纪律**：执行层修复（fix-shell-layer）与本文档任务并行，文档只能描述**目标形态**，不能写「已验证」/「已支持」。约定写法：通道矩阵用「✅ mac/linux 可直接调用（修复后形态）」，并加「修复说明」注明修复并行进行中、未装 CLI 行为与 Windows 一致（`[SKIP]`）。事实性结论（gh/yt-dlp/bili 三平台代码原生、V2EX 走 HTTP）才直接写「三平台可用」，因为它们来自审计结论（B-06/B-07/B-08：代码本身跨平台）。
- **link: 依赖的平台化坑**：`link:` 依赖在 JSON 里是字面绝对路径，**不做变量展开**——Windows 不能写 `link:$env:USERPROFILE\...`，unix 不能写 `link:${HOME}/...`。正确做法：Windows 用正斜杠 `link:C:/Users/<you>/...`（<you> 占位），macOS `/Users/<you>/...`，Linux `/home/<you>/...`，注释里说明替换即可复制执行。
- **平台差异文档化要具体到「为什么」**：macOS 的 Finder/LaunchAgent 启动 PATH 只有系统目录（审计 B-12 建议项）导致 brew CLI 取不到 —— 这类「装了却 [SKIP]」的隐形坑必须写进文档（终端启动或显式 PATH）；bili-cli 非官方渠道、Windows npm 全局 `.ps1` 垫片 + `DSH_HARVEST_BIN` 覆盖、小宇宙依赖 bash+`~/.agent-reach`（Windows 恒 unreachable 属设计预期）都是读者会踩的坑，逐条给提示。

### 本次踩坑（流程层）
- **文档 diff 也不要放过行尾细节**：write 工具重写文件后丢了尾换行（\ No newline at end of file），提交前 `git diff` 检查时发现，`printf '\n' >>` 补回。文档类提交同样要过「diff 渲染审查」再 commit。
- 本任务（worker-config）沙箱是 `danger-full-access`，worktree 内读写无障碍；与 worker-infra 上次审计任务的「沙箱只盖主仓、worktree 写不进」形成对比——同一 DAG 不同 worker 的 scope 可以不同，**不要拿别人的踩坑结论当自己的前提，开工先实测**。

### 复用建议（跨域可复用）
- 三平台安装手册模板：按平台分 `<code block>`（PowerShell vs bash）+ 平台差异一句话 + link 依赖绝对路径占位符 + 「未装即 [SKIP]」的失败语义说明。
- 通道可用矩阵列设计：Windows | macOS/Linux 双列 + 「修复后形态」标注 + 单独「修复说明」段落承载正在进行中的变更，避免表格塞不下。