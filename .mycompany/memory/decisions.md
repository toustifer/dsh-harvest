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