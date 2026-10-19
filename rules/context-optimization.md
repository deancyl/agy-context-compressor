---
description: "Context optimization & Simplified Chinese experience guidelines to prevent token budget exhaustion during file reading, testing, and multi-turn workflows."
trigger: always_on
---

# Antigravity 上下文无损优化与简体中文体验规范 (v2.1)

在 Google Antigravity 中执行开发与分析任务时，请严格遵循以下渐进式披露、无损压缩与中文交互准则：

1. **简体中文最佳交互体验（Language Preservation）**：
   - 除非用户明确要求其他语言，请始终使用自然、清晰的**简体中文**与用户沟通和输出分析结论，保留代码标识符、路径与专有名词原貌。

2. **大文件源码检视与 AST 骨架先行（Zero Blind-Read）**：
   - 检视超过 300 行的代码文件（如 `server.js`、适配器或核心模块）时，切勿直接全量无参数读取。
   - 优先调用 `read_code_skeleton`（获取带 `[Line start-end]` 精确行号跨度的函数/类签名骨架）或 `read_repo_map`（按依赖中心度排序的项目符号拓扑），随后使用 `view_file(StartLine, EndLine)` 精准读取目标行区间（建议单次切片 ≤ 300 行）。
   - 对依赖锁文件（`package-lock.json`、`pnpm-lock.yaml`、`Cargo.lock` 等）自动收窄为前 200 行；遇到被折叠的 `[CCR: agy_retrieve_chunk(chunk_id="...")]` 块时，可按需调用 `agy_retrieve_chunk` 无损回查原文。

3. **沙盒检索与终端命令去噪**：
   - 在大文件或目录中查找关键字时，优先使用 `compact_search_sandbox`（内置 SQLite FTS5 BM25 排序与相邻上下文窗口自动合并）。
   - 全局 `PreToolUse` 钩子已自动为高噪命令（`npm test`、`pytest`、`cargo`、`docker`、`kubectl` 等）挂载流式去噪包装器 `agy-exec-wrapper.js`，折叠通过用例与重复构建日志，100% 保留报错、异常堆栈与 Git 冲突标记（`<<<<<<<`）。

4. **Prompt Cache (KV Cache) 锁定与 Windows PowerShell 防护**：
   - 动态提醒一律采用 `ephemeralMessage` 注入，零污染 `transcript.jsonl`，确保上游 Gemini KV Cache 高命中率。
   - Windows PowerShell 下自动修正尾部反斜杠引号吞噬陷阱（`"C:\path\"` -> `"C:\path\\"`）、`curl.exe` 别名及 UTF-8 控制台编码，杜绝中文乱码与交互挂死。
