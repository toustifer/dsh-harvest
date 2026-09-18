# Design Spec: dsh-zotero-fusion (一站式文献沉浸阅读、翻译与双向批注融合插件)

- **Author/Lead**: Agentflow Leader & User
- **Date**: 2026-09-18
- **Base Project**: [Fisfzy/dsh-zotero](https://github.com/Fisfzy/dsh-zotero) (结合 [Vncntvx/dsh-zotero](https://github.com/Vncntvx/dsh-zotero) 工具链思想)
- **Status**: Design Approved / Ready for Implementation

---

## 1. 目标与用户价值 (Goals & User Value)

融合现有学术生态中两个不同形态的优秀 Zotero 插件：
1. **沉浸阅读 + 翻译**：继承 `Fisfzy/dsh-zotero` 的侧边栏独立 React 面板、`pdf.js` 页面渲染、划词翻译浮钮及 `pdf2zh` 双语对照全文翻译。
2. **证据检索与引用**：继承 `Vncntvx/dsh-zotero` 的 Zotero 本地 Local API 证据段落检索 (`zotero_retrieve`) 与标准引用生成。
3. **全能混合批注与双重存储**：
   - **页面划线标注**：在 PDF 页面上直接划词生成原生高亮与便利贴笔记；
   - **侧栏联动卡片**：一键将划线段落送入右侧文献 Chat 窗口，由 DSH 绑定的模型进行深度精读解析；
   - **双向归档**：批注实时同步回本地 Zotero 数据库（可在 Zotero 客户端即时查看），并在 DSH 当前工作区自动落盘一份带精准引用的 Markdown 文献卡片（供 Agent 后续检索或 Obsidian 联动）。

---

## 2. 总体系统架构 (Architecture Overview)

```
┌────────────────────────────────────────────────────────────────────────┐
│                        DeepSeek Harness Web GUI                        │
│                                                                        │
│  ┌──────────────────────┐  ┌────────────────────────────────────────┐  │
│  │   DSH 主会话对话流   │  │       Zotero 侧边栏工作台 (React 面板)  │  │
│  │                      │  │                                        │  │
│  │ - 自然语言指令       │  │ ┌───────────────┐  ┌─────────────────┐ │  │
│  │ - 综述与证据查询     │  │ │ PDF.js 阅读器 │  │ 文献 Chat & 笔记│ │  │
│  │ - 引用生成           │  │ │ - 划词即译    │  │ - 翻译结果卡片  │ │  │
│  │                      │  │ │ - 划线高亮/便签│ │ - 批注卡片列表  │ │  │
│  │                      │  │ │ - 双语对照翻页│  │ - Markdown 导出 │ │  │
│  └──────────┬───────────┘  │ └───────┬───────┘  └────────┬────────┘ │  │
│             │              └─────────┼───────────────────┼──────────┘  │
└─────────────┼────────────────────────┼───────────────────┼─────────────┘
              │                        │                   │              
              ▼                        ▼                   ▼              
┌────────────────────────────────────────────────────────────────────────┐
│                     Cordis Plugin Host (Node.js 后端)                  │
│                                                                        │
│  [Zotero Connector]     [Annotation Engine]      [Translation & OCR]  │
│  - Local API (23119)    - Zotero 批注回写        - LLM 划词翻译        │
│  - 库搜索/元数据同步     - DSH Markdown 卡片导出  - pdf2zh 双语对照     │
│  - BM25 证据段落检索    - 划线与便签同步处理     - MinerU 公式/表格    │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │
           ┌─────────────────────────┴────────────────────────┐
           ▼                                                  ▼
┌─────────────────────────┐                        ┌─────────────────────┐
│    本机 Zotero 数据库   │                        │ DSH 本地工作区      │
│  - 原生 PDF 附件        │                        │ - notes/papers/     │
│  - 官方高亮/笔记实时同步│                        │ - 带引用的 Markdown │
└─────────────────────────┘                        └─────────────────────┘
```

---

## 3. 核心功能模块设计 (Feature Breakdown)

### 3.1 PDF 阅读与全能混合批注 (PDF Annotation & Reader)
1. **划选交互浮动工具栏**：
   - 鼠标划选 PDF 文本后弹出 Action Bar：`[高亮 / 颜色选择]`、`[写便签]`、`[即时翻译]`、`[发送到 Chat 精读]`。
2. **页面批注渲染**：
   - 采用 `pdf.js` 的 AnnotationLayer 与自定义高亮层，持久化渲染用户的划线与便签小图标。
3. **侧栏卡片联动**：
   - 点击任何一段高亮或在弹窗中选择“发送到 Chat”，右侧对话窗口即时创建一个引用卡片（含论文标题、所在页码、选中的英文原文），模型自动对其进行学术背景解读。

### 3.2 翻译双通道 (Translation Pipeline)
1. **划词快速翻译**：
   - 选中段落调用当前 DSH 激活的模型进行精准学术翻译，带 Sha1 内存/磁盘双级缓存，避免重复划词耗费 Token。
2. **一键全文双语对照**：
   - 后端桥接 `pdf2zh` 命令行工具，一键生成左右排版或原位对齐的双语 PDF。

### 3.3 双重存储与数据流 (Dual Storage Synchronization)
1. **写回 Zotero**：
   - 收集用户的批注对象 `{ type: 'highlight'|'note', text, comment, rects, pageIndex }`；
   - 通过 Zotero Local API (`POST /api/users/0/items/{parentKey}/children`)，以 Zotero 原生 Annotation Schema 回写，保持与官方桌面端完美互通。
2. **DSH 工作区落盘**：
   - 批注触发时，在当前工作区目录下的 `.mycompany/literature_notes/` 或用户指定工作目录生成对应论文的 Markdown 文献卡片（包含 DOI、引用格式、核心摘抄与用户批注）。

### 3.4 面向 Agent 的检索工具矩阵 (Agent Tools)
提供给对话模型调用的原生 MCP 工具：
- `zotero_library_search`: 检索文献库（标题/作者/全文/分类）；
- `zotero_get_item`: 读取文献元数据、PDF 路径与现有批注笔记；
- `zotero_retrieve`: 输入具体问题，通过 BM25 段落级检索提取论文最强证据链；
- `zotero_annotate`: 允许 Agent 在分析完论文后，受用户委托向 Zotero 回写关键小结或高亮批注；
- `zotero_export_bibtex`: 一键生成标准格式引用。

---

## 4. 实施与分期规划 (Roadmap)

- **Phase 1（底座引入与基础跑通）**：
  克隆 `Fisfzy/dsh-zotero` 源码至插件目录，跑通 Node.js/pnpm 构建流程与本地 Zotero 9 Local API 连通性测试。
- **Phase 2（批注层与双向同步实现）**：
  在 React 前端接入 PDF 划线与便签交互，后端开发 Zotero Annotation 回写与 Markdown 卡片本地落盘。
- **Phase 3（工具层融合与 Agent 联动）**：
  吸收 `Vncntvx/dsh-zotero` 的段落检索 (`zotero_retrieve`) 与导出工具，完成端到端自测。
