# 平台假设全量审计报告（audit-platform）

- 任务：audit-platform（ticket lt_1787909534630940000，DAG: cross-platform）
- 日期：2026-08-28
- 审计基线：`feat/cross-platform` @ `244077f`（working tree clean，基线 `node --check` 全绿 + `node test/smoke.mjs` 通过）
- 审计范围：`lib/index.js`、`lib/backends.js`、`lib/extract.js`、`lib/http.js`、`test/smoke.mjs`、`.github/workflows/ci.yml`（另附 README.md / DESIGN.md 文档层结论，供 docs-cross-platform 任务参考）
- 方法：作者本机为 Windows 优先实现；以「macOS / Linux 视角」逐文件逐行核对进程调用、路径与环境变量、CLI 二进制名、测试与 CI 假设。
- 分类定义：
  - **阻塞**：不修则 macOS/Linux 上该功能必坏（或该保证必失效）；
  - **建议**：不修则降级 / 体验差 / 诊断困难，但不会整条坏；
  - **不适用**：对该平台无影响（含「已正确」的确认项）。

---

## 0. TL;DR（结论摘要）

1. **9 条数据通道中 5 条在 macOS/Linux 上 100% 失败**，且与 CLI 是否安装无关：`web`(Exa)、`twitter`、`reddit`、`xiaohongshu`、`linkedin` 的 `build()` 写死 `powershell.exe` + `C:\Users\15775\.npm-global\*.ps1` 垫片（`lib/backends.js` L18/L20/L97/L126/L132/L138/L201）。macOS/Linux 无 `powershell.exe` → `execFile` ENOENT → 全部静默进 `skipped[]`。工具不会崩，但**用户感知为「这些通道永远没结果」**，且日志只显示 `[SKIP]`，难诊断。
2. **`lib/http.js` 的「系统代理双路兜底」是 Windows 独占**：兜底走 `Invoke-WebRequest` + PowerShell 哈希表语法（L32/L34）。macOS/Linux 上 `fetch`(undici) 失败后无救援路径（undici 本来也不读系统代理），依赖代理才能访问的主机（README 里描述的 v2ex / r.jina.ai 场景）在 macOS 上同样会不可达。
3. **`lib/extract.js` 三处 unix 假设不牢**：`HOME` 兜底字面 `'~'`（L16，execFile 不经 shell、不展开 `~`）；RSS 通道写死 `python`（L58，macOS 12.3+ 只有 `python3`）；小宇宙通道依赖 `bash` + `~/.agent-reach`（L69-L71，Windows 默认无 bash，恒 unreachable）。
4. **CI 只在 ubuntu-latest（ci.yml L9）跑**，macOS/Windows 从未被 CI 验证；且 smoke.mjs 不触达执行层（不回真跑通道），本报告的 5 通道阻塞项在任何平台的 CI 上都是「绿」。→ 三平台矩阵（ci-matrix 任务）**须与执行层修复并行或紧随落地**，否则修复无验证闭环。
5. `lib/index.js` 与 `test/smoke.mjs` 为纯函数 / 纯模块断言，**平台干净，无需修改**（仅记录维护性提示）。

---

## 1. 逐文件平台假设点清单

### 1.1 `lib/backends.js`

| # | 位置 | 假设 | 影响面 | 分类 |
|---|------|------|--------|------|
| B-01 | L16-18 | 注释声称「opencli/mcporter 是 .ps1/.cmd 垫片，统一经 powershell.exe 以绝对路径调用」——把 Windows npm 全局装法的 `.ps1` 垫片（npm 以 powershell 为 script-shell 时生成）当成了全平台事实 | macOS/Linux 上 npm 全局装 opencli/mcporter 是**可执行脚本/二进制**，根本不存在 `.ps1`；该假设直接导致下面的垫片路径 | 阻塞 |
| B-02 | L18 | `SHIM_DIR = DSH_HARVEST_BIN \|\| 'C:\\Users\\15775\\.npm-global'`：硬编码 Windows 绝对路径 + 个人用户名 `15775` | macOS/Linux 无此路径；即便是其它 Windows 用户也不成立（DSH_HARVEST_BIN 未设即坏）。默认值必须平台化（`~/.npm-global` / `os.homedir()`） | 阻塞 |
| B-03 | L20 | `psShim(name)` 返回 `& '...\name.ps1'`：PowerShell 调用运算符 `&` + **反斜杠**路径拼接 + `.ps1` 后缀 | 反斜杠在 unix 是合法文件名字符、`&` 是 shell 元字符——该字符串只有 PowerShell 能解释；macOS/Linux 无 `powershell.exe` 时整串无意义 | 阻塞 |
| B-04 | L97 / L126 / L132 / L138 / L201 | `build()` 返回 `{ file: 'powershell.exe', ... }`（web / twitter / reddit / xiaohongshu / linkedin 共 5 通道） | macOS/Linux 无 `powershell.exe`（装了 PowerShell Core 也叫 `pwsh`）→ `execFile` ENOENT → 5 通道 100% `[SKIP]`，**与 mcporter/opencli 是否已安装无关** | 阻塞 |
| B-05 | L19 + L97 | `psq()` 的 PowerShell 单引号双写转义 `''` + 命令串内嵌参数 | 只在 PS 解析语义下成立；unix 需 POSIX sh 引号或直接 argv 传参（推荐后者，免引号注入） | 建议 |
| B-06 | L91 | `file: 'gh'`：GitHub CLI 二进制名三平台一致（unix: `gh`；win: `gh.exe`），参数 `search repos --json fullName,description,...` 平台无关 | 代码本身跨平台；未安装 → ENOENT → 优雅 `[SKIP]`（设计正确）。仅需文档化获取方式 | 建议 |
| B-07 | L144 | `file: 'yt-dlp'`，参数 `ytsearchN:query` | unix 上经 `pip`/`brew` 装；win 上 `yt-dlp.exe`。代码跨平台；未装 → `[SKIP]` | 建议 |
| B-08 | L162 | `file: 'bili'`（bili-cli，Go 单二进制）：unix `bili` / win `bili.exe`，`--json` 参数一致 | 代码跨平台；未装 → `[SKIP]`（注意 bili-cli 非官方正版渠道，文档需给可信来源） | 建议 |
| B-09 | L183 + L212 | `v2ex` 走 `fetchUrl` + `httpGetText`，不经 shell | 平台无关部分本身正确；兜底能力受 `lib/http.js` 的 Windows 独占兜底影响（见 H-02） | 建议 |
| B-10 | L219 | 通道结果为空时抛错，由 `index.js` 捕获记 `[SKIP]` | 平台无关，设计正确（优雅跳过契约） | 不适用（确认正确） |
| B-11 | L78-82 | `execFileP(file, argv, { windowsHide: true })`：`windowsHide` 仅 Windows 有效，unix 忽略 | unix 无副作用 | 不适用 |
| B-12 | （环境） | mac GUI 进程 PATH 假设：`dsh web` 若由 Finder / LaunchAgent 启动，PATH 常只有 `/usr/bin:/bin:/usr/sbin:/sbin`，brew 装的 `gh`/`yt-dlp`（`/opt/homebrew/bin`）不在 PATH → 即便装了也 ENOENT | macOS 特有坑；终端里启动则无此问题 | 建议 |

### 1.2 `lib/http.js`

| # | 位置 | 假设 | 影响面 | 分类 |
|---|------|------|--------|------|
| H-01 | L13 | UA 写死 `Mozilla/5.0 (Windows NT 10.0; Win64; x64)` | 纯指纹伪装；macOS/Linux 上无害，个别站点对 UA 敏感可能返回桌面/移动差异内容 | 建议 |
| H-02 | L29-44 | 兜底 = `powershell.exe -NoProfile -Command 'Invoke-WebRequest -Headers @{...}'`（L32 哈希表语法、L34 调 powershell.exe） | macOS/Linux 无 `powershell.exe` → ENOENT；**双路兜底承诺（README「系统代理 WinINET」）只在 Windows 成立**。unix 上仅当 `fetch` 网络层失败时走到此处并抛合并错误：scout 记 `[SKIP]`、extract 记 `[UNREACHABLE]`，本可经代理救援的 URL 救不回 | 建议（对「双路兜底」承诺属阻塞，对整体功能为降级） |
| H-03 | L32 | `@{'k' = 'v'; ...}` PowerShell 哈希表语法 | Windows-only 语法；平台化改写时必须移除（unix 用 `curl -H`） | 建议（随 H-02） |
| H-04 | L37-40 | 兜底输出解析按 `\n` 切状态码+正文 | 仅 PS 路径使用（`\r\n` 由 `parseInt` 容忍）；unix 路径不经过 | 不适用 |
| H-05 | L21-27 | 主路径 `fetch`（undici）三平台一致 | 正确；但 undici **不读系统代理**（三平台一致）——这恰是 H-02 兜底存在的原因，也是 macOS 上保持兜底价值的依据 | 不适用（确认正确） |

### 1.3 `lib/extract.js`

| # | 位置 | 假设 | 影响面 | 分类 |
|---|------|------|--------|------|
| E-01 | L16 | `home = USERPROFILE \|\| HOME \|\| '~'`：顺序对 unix 正确（走 HOME）；但兜底字面 `'~'` 经 `execFile`（不经 shell）**不会展开** | 若 USERPROFILE 与 HOME 全缺失（极罕见），`~/.agent-reach/...` 作为字面路径传给 `bash` → fopen 失败 → 恒 unreachable。应改 `os.homedir()` | 建议 |
| E-02 | L56-58 | RSS 通道 `execFile('python', ['-c', py, url], ...)` | macOS 12.3+ 无 `python`（Xcode CLT 只给 `python3`）；多数 Linux 发行版同样只有 `python3` → ENOENT → RSS 恒 unreachable（优雅但不工作，README 宣称的「自动识别 RSS feed」在 mac/linux 失效）。附带：`feedparser` 是第三方 Py 包，属环境依赖假设 | 建议 |
| E-03 | L69-71 | 小宇宙通道 `execFile('bash', ['~/.agent-reach/tools/xiaoyuzhou/transcribe.sh', url])` | unix：若脚本存在 + groq key 配置即可工作（依赖 `~/.agent-reach` 目录约定）；Windows 默认无 `bash` → 恒 unreachable（已 catch，优雅） | 建议（mac/linux 侧为「依赖安装约定」；Windows 侧为已知限制，需文档化） |
| E-04 | L40-46 / L48-52 | `httpGetText` 直抓 / jina 升级 | 平台无关的正确调用；兜底韧性受 H-02 约束 | 不适用 |
| E-05 | L78-95 | `extractOne` 路由（feed / xiaoyuzhou / jina / direct+jina） | 纯逻辑，平台无关 | 不适用（确认正确） |

### 1.4 `lib/index.js`

| # | 位置 | 假设 | 影响面 | 分类 |
|---|------|------|--------|------|
| I-01 | 全文件 | 纯工具注册 + 纯函数（validate / tokensOf / audit 启发式），无 process / path / 子进程调用；ESM import（L13-14）Node ≥18 三平台一致 | 无平台假设；**本任务无需改动此文件** | 不适用（确认干净） |

### 1.5 `test/smoke.mjs`

| # | 位置 | 假设 | 影响面 | 分类 |
|---|------|------|--------|------|
| T-01 | 全文件 | 纯模块加载断言（name/inject/apply/backends 数/函数存在性），无平台相关行为 | 三平台可跑 | 不适用（确认干净） |
| T-02 | L13 | `Object.keys(BACKENDS).length === 9` 计数断言 | 维护性耦合（增删通道即红），非平台问题 | 不适用（提示） |
| T-03 | （盲区） | smoke **不回真跑任何通道** → 5 通道在 mac/linux 全坏的实况在 CI 上依旧全绿 | 阻塞项无法被现有测试捕获；建议后续增加「无 CLI 环境冒烟」断言：无 `gh`/`yt-dlp` 的机器上 `scoutChannel` 应整体不抛（验证优雅跳过契约而非 `[SKIP]` 语义） | 建议 |

### 1.6 `.github/workflows/ci.yml`

| # | 位置 | 假设 | 影响面 | 分类 |
|---|------|------|--------|------|
| C-01 | L9 | `runs-on: ubuntu-latest` 单平台 | macOS / Windows 从未被 CI 验证；本报告全部 mac/linux 破坏项在 CI 不可见。对「三平台可用」交付目标属**阻塞（验证缺位）**；修它属于 ci-matrix 任务（worker-ops），本审计只记录不修改 | 阻塞（验证缺位，另任务负责） |
| C-02 | L16 | `node --check lib/*.js`（4 文件全覆盖）+ `&&` 链 | GitHub Actions 的 linux(sh) / windows(pwsh 7) 均支持 `&&`；检查项完整 | 不适用 |
| C-03 | L18 | `node test/smoke.mjs` | 平台无关 | 不适用 |

### 1.7 文档层（README.md / DESIGN.md，供 docs-cross-platform 任务参考，本任务不修改）

| # | 位置 | 假设 | 影响面 | 分类 |
|---|------|------|--------|------|
| D-01 | README L44-58 | 安装段全 PowerShell：`$env:USERPROFILE\.dsh\plugins\...`、`link:C:/Users/15775/.dsh/plugins/dsh-harvest` | Windows-only 安装手册；mac/linux 命令不可复制执行 | 建议（由 docs-cross-platform 修） |
| D-02 | README L35 | 「Twitter / Reddit / 小红书 \| opencli(浏览器桥接)」未说明平台差异 | 与实际 mac/linux 行为（见 B-04）不一致，易误导 | 建议（随 B-04 修复后更新） |
| D-03 | DESIGN.md L20 | 「6 通道（gh / mcporter·Exa / opencli 推特·Reddit·小红书 / yt-dlp）」 | 文档口径；配合 B-04 需更新为平台可用矩阵 | 建议（由 docs-cross-platform 修） |

---

## 2. 阻塞项清单（必须修，否则 mac/linux 必坏）

| ID | 一句话 | 载体 | 先修？ |
|----|--------|------|--------|
| BLOK-1 | mac/linux 无 `powershell.exe` → `web/twitter/reddit/xiaohongshu/linkedin` 5 通道 100% `[SKIP]`，与 CLI 安装无关 | backends.js L97/L126/L132/L138/L201（根因 L18-L20） | 是（地基） |
| BLOK-2 | `SHIM_DIR` 硬编码 `C:\Users\15775\.npm-global` + 反斜杠拼接，默认值在 mac/linux 无效且跨 Windows 用户也不可移植 | backends.js L18-L20 | 是（随 BLOK-1 一并） |
| BLOK-3 | CI 仅 ubuntu-latest，mac/linux 破坏项无任何验证闭环（含 smoke 盲区 T-03） | ci.yml L9 + smoke.mjs | 是（须与执行层修复并行或紧随，否则无证据） |

> 注：H-02 的「双路兜底失效」按定义列为**建议**（fetch 正常时无感；仅网络层失败时降级）。若产品承诺「系统代理兜底」为硬性能力，应升级为阻塞——由 fix-shell-layer 任务按「平台分支 + curl 兜底」实现后即可消除该争议。

---

## 3. 可安全并行修复的项 vs 必须先改的项

### 必须先改（逻辑地基，其它修复的语义前提）
1. **backends.js 垫片层**（BLOK-1 + BLOK-2，B-01~B-05）——它是 5 通道的根因；`extract.js`/`http.js` 的修复不依赖它，但整体冒烟证据以它为先。**单 worker 单 commit 交付（fix-shell-layer）**。

### 可安全并行修复（文件互不依赖，worker/任务可同时开工）
| 组 | 文件 | 内容 | 归属 |
|----|------|------|------|
| P | `lib/backends.js` | 垫片平台化（BLOK-1/2，B-01~B-05） | fix-shell-layer（worker-infra） |
| Q | `lib/http.js` | 兜底平台分支：win32 保留 PS、非 win32 用 `curl`（H-02/H-03）；`http.js` 不 import backends，与 P 零共享 | fix-shell-layer（worker-infra） |
| R | `lib/extract.js` | `os.homedir()`（E-01）、`python3` 优先探测（E-02）、`bash` 可用性文档化（E-03） | fix-shell-layer（worker-infra） |
| S | `.github/workflows/ci.yml` | strategy.matrix 三平台 + 无 CLI 冒烟断言（BLOK-3，C-01，T-03） | ci-matrix（worker-ops） |
| T | `README.md` / `DESIGN.md` | 按本报告结论更新三平台安装 / 通道可用矩阵（D-01~D-03） | docs-cross-platform（worker-config） |

- P/Q/R 三组文件互不依赖，`node --check` 与 smoke 均可独立验证 → **可并行**；若 fix-shell-layer 单 commit 交付则自然顺序 P→Q→R（P 影响面最大，先落）。
- S、T 与 P/Q/R 无文件交集（ci.yml、md 与 lib/ 分属不同文件）→ **可与执行层修复全并行**；建议顺序上 S（CI 矩阵）先落地，让 BLOK-1 修复后第一时间有三平台 CI 证据。
- 唯一逻辑约束：**不要让 S/T 先于本报告结论**（它们 blocked_by=audit-platform，天然满足）。

---

## 4. 具体修复建议（对应每条，无空话）

### 4.1 backends.js（BLOK-1 / BLOK-2，B-01~B-05）
1. 顶部引入平台分支常量，保持零依赖：
   ```js
   import os from 'node:os'
   import path from 'node:path'
   const IS_WIN = process.platform === 'win32'
   const SHIM_DIR = process.env.DSH_HARVEST_BIN || path.join(os.homedir(), '.npm-global')
   ```
2. `build()` 改为按平台返回不同 `{ file, args }`，两个平台都尽量走 **argv 传参**（不拼 shell 字符串，杜绝引号注入）：
   - **win32**：保留现 powershell 垫片形态，但路径用 `path.join(SHIM_DIR, name) + '.ps1'`（去掉反斜杠硬拼）；`psq` 转义保留。
   - **非 win32**：直接 `{ file: 'opencli', args: ['twitter','search',query,'--limit',String(n),'-f','json'] }`、`{ file: 'mcporter', args: ['call', `exa.web_search_exa(query: "${…}", numResults: ${n})`, '--output','json'] }`（还原 c04ad96 之前的 argv 形态，unix 上它们是可执行脚本/二进制，`execFile` 可直接跑，无需 `sh -c`）。
3. 保留「未装/失败 → 抛错 → skipped[]」契约不动（B-10 设计正确）。
4. Windows 侧顺带修复：`SHIM_DIR` 默认值不再依赖用户目录硬编码（B-02 对 Windows 用户自身的可移植性收益）。

### 4.2 http.js（H-02 / H-03）
- 兜底改平台分支：
  - **win32**：保留现有 `Invoke-WebRequest` 路径（`@{}` 哈希表、`powershell.exe`）。
  - **非 win32**：`execFile('curl', ['-sS','-o','-','-w','\n%{http_code}', '-A', UA, '-H', 'user-agent: …', …URL…])`（mac/linux 预装 curl），保持「网络层失败才进兜底」的调用语义不变；`curl` 同样不读系统代理，若需系统代理需显式 `-x`（环境变量 `https_proxy` 已设时 curl 自动读）。
- 兜底在两个平台都不再依赖 PS 专属语法 → 哈希表/`psQuote` 只存在于 win32 分支。

### 4.3 extract.js（E-01 / E-02 / E-03）
- L16：`import os from 'node:os'`；`const home = os.homedir() || process.env.HOME || ''`（不再有字面 `~` 兜底）。
- L58：python 解析器探测，零依赖实现：
  ```js
  const PY = ['python3', 'python', 'py'].find((p) => { try { spawnSync(p, ['--version'], { stdio: 'ignore' }).status === 0 } catch { return false } })
  ```
  命中后用 `execFileP(PY, ['-c', py, url], …)`。
- L71：`bash` 存在性可用同款 spawnSync 探测；不存在时直接返回 `{ status: 'unreachable', method:'xiaoyuzhou', error: 'bash not available' }`，避免无谓 ENOENT 噪声（Windows 侧固定 unreachable 属预期，文档化）。

### 4.4 ci.yml（BLOK-3，由 ci-matrix 任务落地，此处给方向）
- `strategy.matrix.os: [ubuntu-latest, macos-latest, windows-latest]`（node-version 22）。
- smoke.mjs 增加（T-03）：
  - 平台探测断言：`process.platform` 为 win32 时校验 `SHIM_DIR` 下有 `mcporter.ps1`/`opencli.ps1`（或跳过），非 win32 时校验通道 `build()` 不再出现 `powershell.exe`；
  - 「无 CLI 环境冒烟」：`scoutChannel('github', …)` 期望抛错（CLI 缺失），`Promise.all` 层面整体不抛 —— 验证优雅跳过契约。

### 4.5 README / DESIGN.md（D-01~D-03，docs-cross-platform 任务）
- 安装段按平台分块：PowerShell（win）/ bash·zsh（mac/linux），`~/.dsh/plugins` 与 `%USERPROFILE%\.dsh\plugins` 差异，`link:` 依赖示例平台化。
- 通道表增加「macOS/Linux 可用性」列（github/yt-dlp/bili/curl 可用；mcporter/opencli 按 4.1 修复后可用）；数据通道 CLI 获取方式（brew/pip 等）与「未装即 [SKIP]」策略说明。

---

## 5. 值得注意的 3 个平台坑（致 Leader）

1. **静默坏**：5 通道的破坏是「优雅跳过」掩盖的——mac/linux 上工具永不报错、只进 `skipped[]`，用户只能看到「总是没结果」；无 CI 兜底的话该问题可长期无人察觉（T-03 是根因）。
2. **垫片是「修 Windows 引入的 unix 回归」**：c04ad96 为 Windows 的 `.ps1` 垫片加了 powershell 壳，同时把原本 argv 直调（unix 友好）的 5 通道全钉死在 Windows 上——跨平台修复不是「加平台」，是**把进程调用形态改回平台各自原生**。
3. **系统代理承诺是 Windows 独占**：README 声称「某些主机只有走系统代理才连得上」，该救援只在 PowerShell（WinINET）路径存在；macOS 上 undici/curl 同样不读系统代理，内网/代理依赖场景的抓取韧性需显式方案（如 `https_proxy` 环境变量约定）。

---

## 6. 验证与留痕

- 基线语法检查（提交前）：`node --check` 全部 4 个 lib 文件 ✅（node v24.14.0）
- `node test/smoke.mjs` ✅（9 通道后端可加载）
- 本任务零代码改动，提交仅含本报告；执行层修复由 fix-shell-layer 按本报告 BLOK-1/2 + 4.1-4.3 落地。