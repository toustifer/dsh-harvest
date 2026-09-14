# DAG Shape: register-skill

## 目标
让 `dsh-harvest` 能够被 DSH 识别并注册为可调用的 Skill：
1. 提供静态标准 Skill 文件 `skills/harvest/SKILL.md`，携带符合规范的 YAML frontmatter（`name: harvest`, `description: ...`）。
2. 在 `lib/index.js` 中通过 Cordis 依赖注入 `skills` 服务，并在运行时动态调用 `ctx.skills.register(...)`，实现插件加载即自包含注册。
3. 同步 `package.json` 中的 `files` 字段，确保 `skills` 目录在打包发布范围之内。
4. 验证 smoke 测试和三平台契约，确保零回归。

## 任务划分与分工
1. `task-standard-skill`: 由 `worker-config` 负责
   - 创建 `skills/harvest/SKILL.md`，基于 `instructions/harvest-flow.md` 补全 YAML frontmatter，并更新 `package.json` 的 `files` 字段使其包含 `skills`。
2. `task-runtime-skill`: 由 `worker-infra` 负责
   - 修改 `lib/index.js`，通过 `ctx.inject(['skills'], (skillCtx) => { ... })` 动态注册 `harvest` skill，读取标准 skill 内容作为 content。
   - 保证在环境未提供 `skills` 服务时安全降级，不崩溃。
3. `task-verify-smoke`: 由 `worker-ops` 负责
   - 校验 `test/smoke.mjs`，确保加载契约以及平台探测正常。
   - 修复 `test/smoke.mjs` 中将硬编码判断写死为包含 `15775` 的历史瑕疵（改为严格断言 `SHIM_DIR` 是否动态由 `os.homedir()` 派生，而非字符串匹配具体系统用户名），保证本地与 CI 双绿。

## 验收标准
- `skills/harvest/SKILL.md` 存在且包含规范 frontmatter。
- `package.json` `files` 包含 `skills`。
- `node --check lib/index.js` 语法正确。
- `node test/smoke.mjs` 测试全绿。
- 无未提交更改，提交记录清晰规范。
