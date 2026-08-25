# dsh-harvest 设计文档

- 日期：2026-08-25
- 作者：用户（omni-scope 原创者）
- 状态：已实现

## 目标

把自研 omni-scope 的「多平台调研方法论」（scout → extract → verify → audit）按 DSH 原生插件形态工程化，
成为一套真正属于自己、可对外声明首创的 DSH 原生能力。

## 形态

cordis 插件 + 原生工具注册（同 dsh-strategic-core 模式）。零 `@deepseek-ai` 依赖、自包含。

## 工具

| 工具 | 职责 | 关键行为 |
|------|------|---------|
| harvest_scout | 多平台并行发现 | 6 通道（gh / mcporter·Exa / opencli 推特·Reddit·小红书 / yt-dlp），失败记 `[SKIP]` 不阻塞 |
| harvest_extract | 逐条抓取 | 直抓 → r.jina.ai 升级 → 标记 paywall/unreachable，不静默丢弃 |
| harvest_verify | 交叉验证 | 关键词命中 → verified/weak/unverified |
| harvest_audit | 可信度审计 | 五维启发式评分 → trust/caution/discard |

## 命名

工具名全下划线（`harvest_*`），规避 OpenAI 工具名校验 `^[a-zA-Z0-9_-]+$`（此前 strategy.* 点号名踩过坑）。

## 挂载

1. 插件包：`~/.dsh/plugins/dsh-harvest/dsh-harvest/`
2. `profiles/web/package.json` 加 `link:` 依赖 + bundles 条目
3. `cordis.patch.yml` 注入 `id: harvest`
4. profile 内 `pnpm install` 完成链接

## 血统

源于自研 omni-scope 方法论，DSH 原生重写。README 明示 lineage。
