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

### 转绿确认（fix-shell-layer 落地后，真实证据）
- 并行 worker 提交 `44963f5`（lib 执行层三平台化，BLOK-1/2 + H-02/03 + E-01~03）落分支后，本机（macOS）`node test/smoke.mjs` 全绿：
  `smoke OK: 平台=darwin，8 通道 build() 平台契约成立，优雅跳过契约成立（4/4 探测通道记 skipped）`。
- 绊线完整闭环被验证：pre-fix lib → 红（5 通道 powershell 泄漏）；fix 落地 → 绿。断言不是「永远红」的坏断言。
- CI 实跑（push 触发，run 33168647280，feat/cross-platform）：三平台均跑起 —— ubuntu/macos 走非 win32 断言、windows 走 win32 断言（证明 IS_WIN 分支与 pwsh shell 均正确）；Syntax check 三平台全绿；Smoke 在 pre-fix lib 上按预期红（绊线），随 fix-shell-layer 提交推送到分支后应转绿。

## 2026-09-18 — expand-channels-tg-linuxdo（11 通道冒烟断言固化与全量回归验证）

### 做了什么
- `test/smoke.mjs`：
  - **严格 11 通道契约断言**：`assert(Object.keys(BACKENDS).length === 11)`，并完整遍历断言包含 `EXPECTED_CHANNELS` 11 个通道；同时断言具备 `build()` 的通道数严格为 10（除 v2ex 为 fetchUrl）。
  - **深度情报通道契约与边界断言**：针对 `telegram` 与 `linuxdo`，断言 `probe`、`build`、`parse` 方法存在；断言 `probe()` 安全返回布尔值无异常；断言 `build(q, n)` 正确传入 `-c`、query 与 limit；断言 `parse` 正确完成字段映射（`title`, `url`, `snippet` -> `note`, `platform`）并兼容包装对象（`{ data: [...] }` / `{ results: [...] }`），且对空串、非 JSON 文本、空对象、无有效 title/url 等边界输入安全返回空数组，绝不崩溃。
  - **优雅跳过契约扩展**：将探测集扩展为 `['github', 'youtube', 'bilibili', 'telegram', 'linuxdo', '__definitely_missing_channel__']`，断言聚合层 `Promise.all + 逐通道 try/catch` 整体不抛错，各通道结果携带 `ok` 标识，失败通道携带具体原因，无论本地环境是否已登录/配置，均优雅跳过或成功返回，绝不阻塞整个流程。

### 学到的模式
- **动态插件通道扩展的断言阶梯设计**：通道数量由 9 扩展至 11 时，不能仅做宽松的 `>=` 判断，必须严格以全量枚举建立硬约束，并在冒烟脚本中将所有平台 key 显式遍历，避免通道漏挂载或拼写错误。
- **两阶段失败安全验证（Fail-safe Probe & Execution）**：对于依赖本地复杂环境（如 Python venv、认证 Cookie、Telegram Session）的外部通道，冒烟测试必须同时验证 probe 的纯函数安全性与 scoutChannel 执行期的异常捕获降级，确保在 CI、本地未配置及已配置多类异构环境下均能优雅运行。
- **全量测试与回归验证零妥协**：确保不仅单元逻辑跑通，整个系统的 `node test/smoke.mjs` 终端输出符合期望无任何 warning/failure。

## 2026-09-18 — test-linuxdo-ratelimit（LINUX DO 频控节流、短时缓存与 429 熔断单测固化）

### 做了什么
- `test/smoke.mjs`：
  - 新增 `T-03-6` 断言块，导入 `linuxdoThrottleState`、`resetLinuxDoThrottle`、`getLinuxDoCache`、`setLinuxDoCache`。
  - **缓存命中与深拷贝隔离**：验证 `setLinuxDoCache` 写入后能被 `getLinuxDoCache` 精确命中并还原字段；验证返回对象与输入数据为深拷贝副本，修改返回值或原数据均不污染内部 Map 缓存；验证空数组输入防御性忽略。
  - **TTL 超时淘汰**：模拟时间戳推移超出 `cacheTtlMs`，验证条目在 `getLinuxDoCache` 时返回 `null` 且被动清除出 Map。
  - **LRU 淘汰顺序**：配置 `maxCacheSize: 2`，验证在存满后读取旧条目可刷新至队尾，新条目插入时能精准淘汰最久未访问的项。
  - **429 熔断拦截**：人工设置 `linuxdoThrottleState.circuitBreakerUntil` 为未来时点，调用 `scoutChannel('linuxdo', 'test', 1)` 验证被前置拦截抛错，错误信息包含「触发 429 频控保护」与「剩余 Xs」冷却提示。
  - **测试状态隔离与重置**：测试结束后统一调用 `resetLinuxDoThrottle()`，验证 `isCircuitBreaking` 恢复 `false`、熔断时间与缓存彻底清空，确保不污染后续流程。
- 执行 `node test/smoke.mjs` 冒烟与 `node --check` 语法全绿。

### 学到的模式
- **防污染单测夹具生命周期（Test Fixture Isolation）**：针对模块级单例状态（如全局节流队列、熔断标志与内存缓存），测试前后必须提供确定性的 `reset` 入口，并在测试开始前与用例结束时双重重置，防止单测因执行顺序或前序用例的残存状态产生偶发 Flaky Test。
- **确定性时钟与 TTL/LRU 测试设计**：测试 TTL 与 LRU 不需要真正在测试中 `sleep(3分钟)`。通过设计可配置覆盖项（如 `resetLinuxDoThrottle({ cacheTtlMs, maxCacheSize })`）或直接微调 entry 的 `time` 属性，能够实现毫秒级执行、100% 确定性的边界淘汰验证。
- **深拷贝返回值契约防护**：缓存层返回业务数据时，必须返回深拷贝或防御性副本，避免业务调用方在后续处理中就地修改属性引发隐蔽的数据污染与难以排查的状态漂移。
