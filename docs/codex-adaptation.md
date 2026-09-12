# Codex 适配研究

日期：2026-09-13。基线：`d94c4d7`，package.json 版本 0.2.0。

## 实施结果（0.3.0，2026-09-13）

已完成共享核心拆分、Codex 七工具 MCP、调研 Skill、DSH 兼容入口、证据语义修正、Windows 参数传递、HTTP 期限、原文快照、Tavily start/status 持久化与独立插件打包。后文为改造前的研究记录。

- Windows / Node 24：19 项测试通过，无跳过；其中包含真实 STDIO 客户端和脱离 node_modules 的独立插件测试。
- 插件与 Skill 验证器通过；旧 DSH 冒烟入口通过。
- 在线 GitHub 搜索与仓库原文抓取成功。Tavily 无密钥，使用模拟响应验证任务提交/恢复/分页，没有发起付费研究。其他在线渠道不作成功声明。
- 已配置三平台 Node 22 CI；本轮只实际运行 Windows，未将 CI 配置存在视为 macOS/Linux 已通过。
- 本机 Codex 已注册 harvest MCP，Skill 已安装到个人 `.agents/skills/harvest-research`；新任务加载。安装入口指向 `dist/dsh-harvest/bin/harvest-mcp.mjs`，更新代码后需重新构建。
- 独立插件包：`dist/dsh-harvest-codex-0.3.0.zip`。本地交付，不是公共插件目录发布。

边界：当前没有 Tavily 远端取消接口；停止本地查询不代表取消服务端任务。小宇宙转写不进入短调用，明确返回 unsupported。正文提取仍是通用轻量实现，不能保证所有动态站点正文完整。

## 结论

建议采用「宿主无关的调研核心 + 本地 STDIO MCP 服务 + Codex 调研 Skill」，最终打包为 Codex 插件。先保留 DSH 适配器，避免在接口迁移时同时破坏原入口。基础功能由当前 Codex 会话负责推理，不需要为接入额外调用 OpenAI API；Tavily 等第三方服务仍需各自凭据。

本轮完成源码研究与离线行为复现，没有实现适配、安装插件或修改用户全局配置，也未验证各平台在线搜索能力。

## 当前结构与可复用部分

- `lib/index.js` 注册五个工具，同时承担参数验证、配置、验证评分、Tavily 研究任务及 DSH 搜索 Provider 注册。
- `lib/backends.js` 封装九个通道，可复用数据归一化和通道失败隔离思路，但需统一配置和进程执行。
- `lib/extract.js` 实现网页/Jina/RSS/小宇宙路由；`lib/http.js` 提供 fetch 与系统命令回退。
- `instructions/harvest-flow.md` 可作为 Skill 的流程素材，需重写证据质量规则。
- `cordis.patch.yml`、`ctx.tools.register`、`ctx.inject`、`ctx.web.registerSearchProvider` 属于 DSH 接入层，不能直接作为 Codex 插件入口。
- 已有三平台 CI 配置，但测试主要覆盖加载、命令构造与失败跳过，不能证明搜索或事实核验有效。

## 必须处理的问题

| 问题 | 源码证据 | 改造要求 |
|---|---|---|
| 关键词匹配被称为已验证 | index.js 的 verify 使用任一 token 命中，两个来源即 verified；不去重、不识别否定 | 工具只返回候选证据，Codex 比对原文并标明支持、反驳、证据不足；记录引文与出处 |
| 来源评分缺乏内容依据 | audit 按 type/URL 设置分数，时效性没有日期输入；流程要求 discard 不得引用 | 改为来源元数据和待核查提示；缺失信息为 unknown，不用启发式分数直接禁止引用 |
| 长调用不能保证超时 | research 一次调用创建并轮询五分钟，fetch 无 AbortSignal；web 的 Tavily fetch 也无超时 | 拆分研究任务 start/status，保存 request_id；统一请求期限、取消与错误分类 |
| 启动时同步探测依赖 | extract.js 导入时 spawnSync 检查 Python/bash，没有超时 | 惰性探测、短超时、缓存，避免阻塞 MCP 初始化 |
| 配置绑定 DSH | 两份配置读取函数读取 .dsh YAML，并残留固定用户目录兜底 | 单一配置模块，Codex 使用环境变量；DSH 配置读取仅留在原适配器 |
| Windows 命令构造脆弱 | Exa/LinkedIn 把查询拼入 PowerShell 双引号表达式，psq 只处理单引号 | 避免将输入拼成脚本；测试引号、美元符号、换行和中文，不执行恶意表达式 |
| 抓取成功判断过宽 | HTTP 200 HTML 去标签即 ok；固定截断 6000/8000 字符 | 检测空正文和登录/脚本占位页；返回 truncated、抓取时间和正文长度，支持完整原文落盘 |
| 搜索相关性不足 | V2EX 无关键词命中仍返回热帖；一些结果可无 URL | 区分热榜与搜索结果；无出处条目不能作为可引用证据 |
| 参数校验不完整 | integer 只检查 number，无范围；extract 静默只取十条 | 用明确 schema 和运行时验证，限制数量/超时，显式返回未处理项 |

离线复现：通过假的 DSH context 收集到五个工具，对断言 `Product Alpha supports offline mode` 输入两个标题 `Alpha does not support offline mode` 和 `Alpha requires internet access`，现有 verify 返回 `verified`、`matches: 2`。这说明包装接口之前必须修正核验语义。此复现没有发出在线搜索或研究请求。

## 建议的职责划分

1. **核心模块**：搜索、正文提取、来源去重、证据存储、第三方任务状态。无 DSH/Codex context 依赖。
2. **MCP 服务**：公开 JSON Schema 工具，返回结构化结果与简短文字；日志只写 stderr；处理异常、取消、输出大小。
3. **Skill**：明确研究问题，按主题选择渠道，调用当前会话可用的搜索/浏览工具补充，阅读原文、识别矛盾、形成可点击引用的报告。
4. **插件包**：组合 Skill、MCP 启动配置、说明和安装验证。实现阶段使用 Codex plugin-creator 的当前规范验证清单。

本地 MCP 进程不能自动调用当前 Codex 会话的内置 web 工具。需要补充搜索时，由 Skill 指导 Codex 发起调用，再将结果传入核心工具。无需将 Codex 自身再包装成一个模型 API 后端。

建议新增的入口：`harvest_doctor` 检测通道是否可用；`harvest_research_start` 与 `harvest_research_status` 管理可恢复的第三方长任务。保留 scout/extract；verify/audit 更名或调整返回语义，避免把自动指标冒充事实结论。

## 实施顺序与验收

### 第一阶段：核心拆分与修复

抽离 config、工具定义和执行逻辑，保留 DSH 薄适配器；修复核验标签、参数边界、Windows 参数传递、HTTP 超时和导入时依赖探测。补充离线测试，覆盖否定句、重复来源、空正文、输入特殊字符和网络超时。

### 第二阶段：Codex 最小可用版

使用维护中的 MCP SDK 实现 STDIO 服务，不为维持零依赖口号手写协议。增加 Skill、配置示例和 doctor。用 MCP 客户端验证初始化、工具发现、有效/无效输入、错误响应；在 Windows 上验证中文及空格路径。没有 Tavily key 时基础流程仍可使用可用通道和当前会话搜索能力。

### 第三阶段：长任务与发布包装

增加 start/status、持久化任务标识、取消边界和恢复行为；完成插件包装与安装检查；三平台 CI 运行离线测试。在线平台测试单独运行并报告实际可用通道，不以全部跳过视为功能验收成功。

最终验收：Codex 能发现工具；主题调研能产生带原文依据的报告；未配置通道显示明确原因；矛盾资料不会被简单标记为 verified；外部服务卡住不拖死调用；重启后仍可查询已经提交的研究任务。

## 官方接入依据

- [MCP 配置](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)：支持本地 STDIO、环境变量及用户/项目配置；默认启动超时 10 秒、工具超时 60 秒，可配置。原有 90 秒通道执行和五分钟轮询必须协调期限。
- [Codex Skills](https://learn.chatgpt.com/docs/build-skills)：Skill 以带 name/description 的 SKILL.md 描述流程，可配脚本和引用资料；支持仓库及用户目录，适合承载调研工作流。

接入结论基于官方文档；源码问题基于当前本地版本；完整在线渠道、第三方 API 参数和插件安装行为仍需在实施阶段分别验证。
