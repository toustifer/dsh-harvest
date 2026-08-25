# 🌾 dsh-harvest

> DSH 原生多平台调研流水线插件 —— 把「发现 → 抓取 → 验证 → 审计」做成四个原生工具。

<p align="center">
  <img src="https://img.shields.io/badge/license-MIT-green" alt="license"/>
  <img src="https://img.shields.io/badge/DeepSeek%20Harness-plugin-4b32c3" alt="DeepSeek Harness"/>
  <img src="https://img.shields.io/badge/version-0.1.0-blue" alt="version"/>
  <img src="https://img.shields.io/badge/zero--deps-self--contained-2ea44f" alt="zero deps"/>
  <img src="https://img.shields.io/badge/runtime-Node%20ESM-339933" alt="Node ESM"/>
</p>

`dsh-harvest` 让 DeepSeek Harness 里的智能体**像开联合收割机一样做调研**:一次撒网多个平台、穿透反爬抓原文、跨源交叉验证、最后给来源打分。任一数据通道挂了也不会卡住整条流水线。

---

## ✨ 四个原生工具

| 工具 | 职责 | 失败策略 |
|------|------|---------|
| `harvest_scout` | 多平台并行发现候选来源 | 单通道失败记 `[SKIP]`,不阻塞 |
| `harvest_extract` | 逐条抓取正文 | 直抓 → Jina 升级 → 标记 paywall/unreachable |
| `harvest_verify` | 跨源交叉验证断言 | 一致 / 弱 / 未证实 三态 |
| `harvest_audit` | 来源可信度五维审计 | 🟢 可信 / 🟡 谨慎 / 🔴 弃用 |

**数据流**:`scout → extract → verify → audit`,每个工具输出结构化 JSON + 折叠文本,供 agent 直接读取。

## 🔌 数据通道

| 通道 | 底层 | 类型 |
|------|------|------|
| GitHub | `gh search repos` | 代码 |
| Web / Exa | `mcporter call exa.web_search_exa` | 网页搜索 |
| Twitter / Reddit / 小红书 | `opencli`(浏览器桥接) | 社交 |
| YouTube | `yt-dlp ytsearchN:` | 视频 |

## 📦 安装(DSH 原生)

```powershell
# 1. 克隆到 DSH 插件目录
git clone https://github.com/<you>/dsh-harvest.git $env:USERPROFILE\.dsh\plugins\dsh-harvest

# 2. 在 web profile 的 package.json 里加 link 依赖 + bundles 条目
#    "dependencies": { "dsh-harvest": "link:C:/Users/15775/.dsh/plugins/dsh-harvest" },
#    "dsh.profile.bundles": [ ..., "dsh-harvest" ]

# 3. 链接
cd $env:USERPROFILE\.dsh\profiles\web
pnpm install

# 4. 重启
dsh web
```

## 🚀 用法

```
harvest_scout(query="最新 AI 项目", limit=8)
harvest_extract(urls=["https://…", "https://…"])
harvest_verify(claims=["DeepSeek 出了视觉模型"], sources=[…])
harvest_audit(sources=[{title, url, type}])
```

## 🏗️ 架构

```
lib/
  index.js      # 插件主体:注册 4 个工具
  backends.js   # 6 通道封装 + 优雅跳过
  extract.js    # 抓取路由(直抓 → r.jina.ai)
```

**零依赖**:只用 Node 内建(`node:child_process` / 全局 `fetch`),不 import 任何第三方包。

## 📄 归属与血统

方法论(Scout → Extract → Verify → Audit)源于作者自研的 [omni-scope](https://github.com/toustifer/omni-scope) 工作流,按 DSH 原生插件形态**从零重写**。
运行时仅以子进程调用 `gh` / `mcporter` / `opencli` / `yt-dlp` 作为数据通道,不包含其源码。详见 [ATTRIBUTION.md](./ATTRIBUTION.md)。

## 📝 License

[MIT](./LICENSE) © 2026 dsh-harvest contributors
