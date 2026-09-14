# 架构决策记录（dsh-harvest）

## D-001 目标平台：Windows 独占 → Windows/macOS/Linux 三平台（2026-08-28）

**决策**：dsh-harvest 从「仅 Windows 使用」升级为三平台（Windows/macOS/Linux）目标。

**Why**：
- 用户明确要求「我想要让他兼容 mac 和 linux」；
- 项目 README/设计文档此前为 Windows 路径与 PowerShell 垫片，但 DSH 本体跨平台，
  插件不应只在一类 OS 可用；
- 三平台约束会影响执行层（shell 垫片/路径解析）、CI（runner 矩阵）、文档（安装指引），
  因此作为本轮 DAG（cross-platform）的全局约束。

**影响**：
- 执行层进程调用必须平台无关（Windows .cmd/.ps1 垫片 + unix /bin/sh），保持零依赖；
- CI 从单一 ubuntu-latest 扩为三平台矩阵；
- README 安装指引与通道 CLI 获取方式三平台化；
- 数据通道未安装时按既有 [SKIP] 优雅跳过策略处理，不阻塞流水线。

## D-002 执行层跨平台进程调用模式：平台分支 argv 直调（2026-08-28）

**决策**：`lib/` 进程调用统一收敛到平台分支形态——`shimRun(cli, psExpr, argv)` 单一入口：
win32 保留 powershell.exe 垫片（`.ps1` 垫片路径经 `path.join` + `os.homedir()` 派生，可用
`DSH_HARVEST_BIN` 覆盖）；非 win32 直接 `{ file, args }` argv 直调（不拼 shell 字符串）。
HTTP 兜底双路：win32 保留 `Invoke-WebRequest`（WinINET 系统代理），mac/linux 用 `curl`
（`https_proxy`/`http_proxy` 环境变量自动生效）。extract 的 python/bash 解析器做存在性探测
（`python3/python/py`、`bash`），无 bash 时小宇宙通道返回 `unreachable` 而非 ENOENT 噪声。

**Why**：
- 审计 BLOK-1/2：c04ad96 为修 Windows `.ps1` 垫片把 5 通道写死 powershell.exe，属
  「修一个平台引入另一个平台回归」的反模式；正确姿势是**让每个平台回到自己的原生调用形态**。
- argv 传参（而非拼 shell 串）杜绝引号注入；`SHIM_DIR` 用 `os.homedir()` 消除个人路径硬编码。
- curl 输出布局（正文在前/状态码在后）与 PS（状态码在前）相反，解析必须按平台分支。
- smoke T-03 断言把「非 win32 无 powershell 泄漏 / win32 无硬编码用户名」写进 CI，
  堵住「优雅跳过掩盖静默坏」的验证盲区（BLOK-3）。

**影响**：三平台行为对等（未装 CLI 一律 `[SKIP]`）；真实 Windows 执行由三平台 CI 矩阵
长期保障；README/DESIGN 按「目标平台」口径同步（D-01~D-03）。

## D-003 DSH 原生 Skill 动静双注册与路径契约（2026-09-14）

**决策**：
1. 静态规范：在项目根目录建立标准 `skills/harvest/SKILL.md`，配齐 DSH 扫描器要求的 YAML Frontmatter（`name: harvest`, `description`, `whenToUse`），并在 `package.json` 的 `files` 中加入 `skills`。
2. 动态注册：在 `lib/index.js` 的 `apply(ctx)` 中通过 `ctx.inject(['skills'], (skillCtx) => { ... })` 动态注册 `harvest` 技能，实现插件加载即自带 Skill，无需依赖外部手动拷贝。
3. 测试契约：`test/smoke.mjs` 中的 Windows 垫片断言重构为基于 `os.homedir()` / `DSH_HARVEST_BIN` 动态基准检验，杜绝直接写死系统用户名的字符串匹配，消除用户名碰撞造成的误报。

**Why**：
- DSH 的插件机制与 Skill 机制解耦，仅安装 npm 插件不会自动注册 Skill；
- 静态文件让外部规范（如 `~/.dsh/skills/` 扫描）生效，动态注册让 Cordis 加载时即时注册，双重保障；
- 保护 CI 与本地在不同 Windows 用户名下测试的一致性与稳定性。
