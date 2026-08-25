# Attribution & Provenance(来源与归属声明)

`dsh-harvest` 是 DSH 原生多平台调研流水线插件,由本仓库作者原创开发。

## 代码来源

- 全部实现为 **Node.js ESM,新写**,无第三方源代码被复制或内联。
- 方法论(Scout → Extract → Verify → Audit 四阶段、r.jina.ai 升级、可信度审计)源于作者自研的 **omni-scope** 工作流。

## 运行时依赖(仅调用,非代码共享)

本插件在运行时以子进程方式调用以下外部 CLI 作为数据通道,**不包含、不内联其源码**:

- `gh`(GitHub CLI)
- `mcporter` / `opencli`(Agent-Reach 生态)
- `yt-dlp`(YouTube 下载/搜索)
- `r.jina.ai`(Jina Reader,HTTP 服务)

## 边界声明

本项目的"原创"指:插件架构、工具注册、后端封装、抓取路由与验证/审计启发式逻辑均为本仓库新写。
方法论术语与上述 CLI 分别属于作者自有工作流与各自上游项目。
