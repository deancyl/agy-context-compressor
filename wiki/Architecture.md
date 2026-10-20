# 🏛️ 系统架构全景 (Architecture)

## 一、 整体技术架构图

```mermaid
flowchart TD
    subgraph ClientHost["Google Antigravity 宿主环境"]
        AgentCore["Antigravity Core Agent / Subagents"]
        RunCmd["run_command (命令执行)"]
        ViewFile["view_file (文件检视)"]
        GrepSearch["grep_search (正则检索)"]
    end

    subgraph HookLayer["生命周期 Hook 拦截层 (~/.gemini/config/hooks.json)"]
        PreToolHook["PreToolUse Hook\n• PowerShell 命令转义自愈\n• 高噪命令包装流式过滤\n• 切片读取真实体积核算"]
        PreInvocHook["PreInvocation Hook\n• 零污染瞬态中文引导\n• 大文件检视切片指引\n• 符号大纲感知注入"]
        HookWatchdog["4.5s 安全看门狗 (Watchdog)\n超时自动放行，绝不阻断主流程"]
    end

    subgraph ExecWrapper["命令执行包装器 (bin/agy-exec-wrapper.js)"]
        Base64Wrap["Base64 安全包装 (免疫宿主 Shell 二次拆解)"]
        UTF8Guard["Windows UTF-8 编码锁定 (消除中文报错乱码)"]
        StreamFilter["实时分块流式过滤器 (LineStreamFilter)"]
        PipeDrain["250ms 优雅排空定时器 (防孙进程挂死管道)"]
    end

    subgraph CoreEngine["七大无损压缩引擎 (src/core/)"]
        Card1["Card 1: RTK 终端去噪与测试折叠"]
        Card2["Card 2: Headroom 锁文件与双层 JSON 折叠"]
        Card3["Card 3: CacheAligner 缓存对齐与 Schema 瘦身"]
        Card4["Card 4: Cache-Zone 会话记忆与 KV Cache 锁定"]
        Card5["Card 5: PowerShell 引号陷阱与 CLIXML 去噪"]
        Card6["Card 6: Aider AST 词法骨架与中心度排序"]
        Card7["Card 7: OpenCode-DCP 三阶段动态历史剪枝"]
    end

    subgraph StorageLayer["本地缓存与可逆存储"]
        CCRStore["CCR 本地可逆块存储池 (LRU 300 块上限)"]
        TelemetryStats["轻量遥测数据中心 (agy-compression-stats.json)"]
        SessionReads["切片检视追踪池 (agy-session-reads.json)"]
    end

    subgraph PresentationLayer["管理与可观测性界面"]
        TUIConsole["交互式终端控制台 (bin/agy-compressor.js)"]
        WebDashboard["独立桌面 Web 控制台 (http://127.0.0.1:4012)"]
        MCPServer["MCP 插件服务 (compact_run_command, etc.)"]
    end

    RunCmd --> PreToolHook
    ViewFile --> PreToolHook
    GrepSearch --> PreToolHook

    PreToolHook --> HookWatchdog
    PreToolHook --> Base64Wrap --> UTF8Guard --> StreamFilter --> PipeDrain
    PreToolHook --> Card6
    PreToolHook --> Card7

    StreamFilter --> Card1
    StreamFilter --> Card2
    StreamFilter --> CCRStore

    PreInvocHook --> AgentCore
    AgentCore --> PresentationLayer
    CoreEngine --> TelemetryStats
```

---

## 二、 核心子系统职责

### 1. 生命周期 Hook 拦截系统
- **`PreToolUse` (工具前置拦截)**：
  - 在底层工具执行前拦截参数。
  - 对高频开发工具（npm, pytest, cargo, docker, git diff 等）自动附加 `agy-exec-wrapper.js` 流式去噪器。
  - 对 `view_file` 切片调用进行真实读取体积核算，杜绝分母稀释与虚增。
- **`PreInvocation` (推理前置引导)**：
  - 注入 `ephemeralMessage` 瞬态指令。
  - 瞬态提示仅在当前单轮交互生效，**绝不写入 `transcript.jsonl`**，从而锁定 Google Gemini 原厂 KV Cache 前缀，且彻底杜绝多智能体语言向英文漂移。

### 2. 命令执行包装器 (`bin/agy-exec-wrapper.js`)
- **Base64 完整封装**：将包含分号、管道符、连接符（`&&`）的多阶段命令完全打包，杜绝 Windows 宿主 Shell 将命令拆分执行两次的严重缺陷。
- **编码与环境变量保护**：自动注入 `[Console]::OutputEncoding = UTF8`、`PYTHONIOENCODING=utf-8`、`GIT_PAGER=cat`、`CI=true`，消除翻页器等待和乱码。
- **非交互式管道免疫**：配置 `stdio: ['ignore', 'pipe', 'pipe']`，彻底免疫交互式提示挂起。

### 3. 可逆存储与内容找回 (CCR: Content-Compressed Retrieval)
- 任何被折叠的大段文本（如 5,000 行通过日志或超大 JSON 数据），均会在本地计算 SHA-256 哈希并落盘至 CCR 块存储。
- 智能体在需要查阅原始全量细节时，可通过 MCP 工具 `agy_retrieve_chunk(chunk_id)` 毫秒级无损调阅。
