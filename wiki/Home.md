# agy-context-compressor Wiki

欢迎来到 **Google Antigravity (`agy`) 上下文优化与 Token 压缩引擎** 官方知识库（Wiki）！

---

## 📚 目录导航 (Table of Contents)

1. [🏛️ 系统架构全景 (Architecture)](Architecture.md)
   * AGY 运行机制与三层拦截设计
   * Hook、MCP 与 CLI/GUI 交互模型
   * 零外部依赖原生设计原则

2. [⚡ 七大核心压缩与防护引擎 (7-Core Engines)](7-Core-Engines.md)
   * **Card 1 (RTK)**: 终端与构建去噪（测试用例正向折叠、构建日志流折叠）
   * **Card 2 (Headroom)**: 依赖锁文件与双层 JSON 折叠（TOON 矩阵 + SmartCrusher）
   * **Card 3 (CacheAligner)**: Tools 模式对齐与超大 Schema 瘦身
   * **Card 4 (Cache-Zone)**: llmtrim 会话内存记忆与 Google Gemini KV Cache 固化
   * **Card 5 (PowerShell Guard)**: Windows 平台引号吞噬与命令陷阱防御
   * **Card 6 (Aider AST)**: 词法级 AST 代码骨架与跨文件引用中心度
   * **Card 7 (OpenCode-DCP)**: 三阶段动态上下文修剪（读去重、写覆盖、报错归档）

3. [🛡️ 底层稳定性与防卡死架构指南 (Anti-Freeze Architecture)](Anti-Freeze-Guide.md)
   * Windows 文件锁争用深度剖析与解耦方案
   * 4.5 秒 Hook 看门狗定时器与优雅排空
   * 非交互式管道免疫（Rule 23 铁律）
   * 磁盘-内存代码脱节防御与端口 TIME_WAIT 自动重试

4. [🧪 内置基准测试与防降智红线 (Live Benchmark & Anti-Degradation)](Live-Benchmark.md)
   * 5 大真实场景基准实测数据（综合无损压缩率 -86.3%）
   * 防降智免死红线：源码、报错堆栈、Git 冲突绝对豁免
   * CCR (Content-Compressed Retrieval) 本地可逆反查验证

5. [🖥️ CLI、TUI 与桌面图形控制台实操指南 (CLI, TUI & GUI Guide)](CLI-and-GUI-Guide.md)
   * TUI 终端交互式导航大盘使用指引
   * 独立桌面 Web 控制台（端口 4012）与快捷方式
   * 策略档位（Balanced / Aggressive / Safe）动态切换与持久化
   * 一键系统体检 (Doctor) 与 CCR 缓存池管理

---

## 🎯 核心使命与设计理念

`agy-context-compressor` 专为高频使用 **Google Antigravity (`agy` CLI, Antigravity IDE 与 Antigravity 2.0)** 的开发者设计。

在大模型长多轮编程任务中，传统的简单截断会导致模型**“降智”（看不到报错具体行号、误截断代码导致逻辑错乱、看不到 Git 冲突）**，而盲目放行则会导致单轮上下文在几十轮后滚雪球至数万乃至十余万 Tokens，触发昂贵账单并大幅拖慢推理响应速度。

本项目通过 **7 大核心引擎** 协同，达成了三个核心目标：
1. **真实节省 50% ~ 85% 上下文 Token 消耗**；
2. **100% 保真报错堆栈、纯代码变更与 Git 冲突，实现零降智保证**；
3. **彻底根除 Windows 控制台黑框、命令挂起与文件锁死，保障极致流畅体验**。
