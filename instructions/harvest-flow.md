# harvest 流程约定（供 agent 决策时使用）

## 何时用

- 用户要「全网 / 全面 / 深度 / 跨平台」调研某主题
- 需要多平台广度发现 + 一手原文抓取 + 交叉验证 + 可信度审计

## 四步管道

1. **scout** — 先 `harvest_scout`，拿 5-15 条候选源；不足 3 个平台成功时，用内置 `web_search` 补齐 web 角度。
2. **extract** — 对候选源 `harvest_extract`；`paywall`/`unreachable` 直接标记，不重试、不假装拿到。
3. **verify** — 把关键结论写成断言，`harvest_verify` 交叉验证；搜索摘要 ≠ 一手来源，须比原文。
4. **audit** — `harvest_audit` 出五维矩阵，🔴 弃用的来源不得引用。

## 红线

- 禁止只用一个内置 web_search 就收工（那是单角度）。
- 每条来源必须带可点击 URL。
- 平台失败记 `[SKIP:platform]` 后立刻继续，不阻塞。
- 最终报告必须含来源可信度矩阵。
