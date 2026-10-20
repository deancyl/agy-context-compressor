# ⚡ 七大核心压缩与防护引擎 (7-Core Engines)

本项目深度整合并吸收了业界主流上下文压缩开源项目（**RTK, Headroom, Aider, OpenCode-DCP, llmtrim, Squeez**）的核心设计，按功能划分为七张核心卡片（Card 1 ~ Card 7）。

---

## 1. Card 1: RTK 终端去噪与测试折叠 (`src/core/rtk.js`)
* **对标项目**：`rtk-ai/rtk`、`claudioemmanuel/squeez`、`jee599/contextzip`
* **核心功能**：
  * **ANSI 控制码剥离**：彻底剥离终端色彩转义字符与光标控制码；
  * **覆盖式进度条清洗**：合并 `\r` 频繁刷新的下载/构建帧，仅留最终结果；
  * **通过用例正向安全折叠 (`foldTestPasses`)**：
    * 严格正向匹配通过标记（`✓`, `PASS`, `ok`, `[ OK ]`），将数百行通过用例汇总折叠为 `[Test suite: N passed tests folded]`；
    * **报错免死红线**：只要出现 `FAIL`, `✕`, `Error`, 堆栈 Traceback 或异常代码行，**100% 逐字保留**；
  * **构建与日志流去噪**：
    * `cleanBuildOutput`：折叠 Vite/Webpack/CMake 常规构建进度；
    * `cleanLogBurstOutput`：折叠 $\ge 20$ 行的连续 `[INFO]/[DEBUG]` 日志洪流；
    * `cleanDirectoryListingOutput`：折叠 $\ge 50$ 项的冗长目录树；
    * `foldDuplicateLines`：连续 $\ge 3$ 行相同非报错日志折叠为 `[xN repeated]`。

---

## 2. Card 2: Headroom 锁文件与双层 JSON 折叠 (`src/core/headroom.js`)
* **对标项目**：`headroomlabs-ai/headroom`
* **核心功能**：
  * **依赖锁文件 Diff 折叠**：
    * 自动识别 `package-lock.json`, `pnpm-lock.yaml`, `Cargo.lock`, `go.sum` 等；
    * 将成百上千行的依赖哈希变动行折叠为摘要；
    * **Git 冲突绝对豁免**：只要检测到 `<<<<<<< HEAD` 冲突标记，立即 100% 放弃折叠；
  * **双层结构化 JSON 压缩**：
    * **中型同构数组 (5~50 项)**：启用 **TOON 矩阵无损编码**（将对象数组转换为紧凑的列式表头与值矩阵，保留 100% 原始信息）；
    * **巨型同构数组 (>50 项)**：启用 **SmartCrusher** 首尾采样（保留结构模式、前 5 项与后 3 项），全量数据安全暂存至 CCR。

---

## 3. Card 3: CacheAligner 缓存对齐与 Schema 瘦身 (`src/core/schema.js`)
* **核心功能**：
  * **工具字典序绝对排序 (`alignToolsSchema`)**：
    * 对挂载的 Tools 数组按工具名称及参数属性进行字典序严格排序；
    * 锁定上游 Google Gemini Prompt Cache，消除由于工具注册顺序不同引起的缓存击穿；
  * **超大 Schema 瘦身 (`slimToolsSchema`)**：
    * 当单次工具 Schema 超过门限（默认 15,000 字符）时，自动裁剪说明中的多行 Markdown 样例代码，保留核心字段与必填约束。

---

## 4. Card 4: Cache-Zone 会话记忆与 KV Cache 锁定 (`src/core/cache-zone.js`)
* **对标项目**：`llmtrim`
* **核心功能**：
  * **多会话 LRU 内存记忆池 (`sessionCompressionMemo`)**：
    * 对幂等工具调用的返回内容建立会话级哈希记忆，避免重复处理；
  * **原厂 Prompt Cache 命中率透明度**：
    * 纵深读取会话轨迹中的 `input_tokens` 与 `cache_read_tokens`；
    * 实时计算并向开发者展示 Google Gemini 上游的真实 KV Cache 命中百分比（通常锁定在 95% 以上）。

---

## 5. Card 5: Windows PowerShell 优化与平台自适应 (`src/core/powershell.js`)
* **核心功能**：
  * **反斜杠引号吞噬防御**：自动修复 Windows CRT `CommandLineToArgvW` 陷阱（`"C:\dir\"` $\rightarrow$ `"C:\dir\\"`），防止右引号被吞噬导致命令卡死；
  * **curl 别名安全修正**：自动将裸 `curl` / `wget` 指令改写为 `curl.exe` / `wget.exe`，避免误触 PowerShell 5.1 内置的 WebRequest 异常；
  * **#< CLIXML 报错去噪**：深度解析并提取 CLIXML 报错核心文本，解码 Hex 换行，剔除冗长无用的 CategoryInfo 样板代码；
  * **&& 兼容性转译**：在 PowerShell 5.1 环境下自动将 `cmd1 && cmd2` 安全转译为 `cmd1; if ($?) { cmd2 }`。

---

## 6. Card 6: Aider AST 词法骨架与中心度排序 (`src/core/skeleton.js`)
* **对标项目**：`paul-gauthier/aider` (Repo Map), `yamadashy/repomix`
* **核心功能**：
  * **词法级括号扫描器 (`countBracesLexical`)**：
    * 精准识别并跳过单双引号、模板字符串、单行及多行注释中的花括号，杜绝行号错位；
  * **深度感知参数剥离 (`stripBodyFromSignature`)**：
    * 完美保留默认参数中的对象字面量（如 `cfg = {}`），仅剥离参数列表外层的函数体起始括号；
  * **精确行号跨度标注**：
    * 为每一个折叠的类、方法、函数标注 `[Line start-end]`（支持高达 15,000 行的超大函数跨度扫描）；
  * **顶层符号隔离**：
    * 过滤掉函数内部缩进的局部闭包箭头函数，仅保留具有全局索引价值的导出符号与顶级方法。

---

## 7. Card 7: OpenCode-DCP 三阶段动态历史剪枝 (`src/core/compactor.js`)
* **对标项目**：`Tarquinen/opencode-dynamic-context-pruning`
* **核心功能**：
  * **Stage 1 (重复读去重)**：同一会话内重复读取相同文件或切片时，自动折叠早期快照并保留最新读；
  * **Stage 2 (写操作覆盖旧快照)**：当某个文件被修改写入后，自动将修改前读取的旧版快照归档作废；
  * **Stage 3 (历史报错冷却归档)**：当历史中的某次报错在后续轮次已被修复并验证通过后，在冷却期后自动归档至 CCR，防止早期报错永久污染长轮次上下文。
