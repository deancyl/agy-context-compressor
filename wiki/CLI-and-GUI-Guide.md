# 🖥️ CLI、TUI 与桌面图形控制台实操指南 (CLI, TUI & GUI Guide)

`agy-context-compressor` 提供了三种层级的管理与观测形态：纯命令行、交互式终端（TUI）与独立桌面图形控制台（GUI）。

---

## 一、 CLI 快捷命令汇总

| 命令 | 功能说明 |
| :--- | :--- |
| `node bin/agy-compressor.js stats` | 在终端打印当前实时的上下文节省看板与七大引擎贡献分布 |
| `node bin/agy-compressor.js benchmark` | 运行内置 5 大真实场景无损压缩率与防降智红线实测 |
| `node bin/agy-compressor.js doctor` | 对环境（Node 版本、全局 Hooks、MCP、平台环境）执行一键体检诊断 |
| `node bin/agy-compressor.js install --global` | 一键将 `PreToolUse` 与 `PreInvocation` 挂载至 Antigravity 全局配置 |
| `node bin/agy-compressor.js uninstall --global` | 一键安全卸载并恢复之前的 Hook 配置备份 |
| `node bin/agy-compressor.js restore` | 一键将配置还原为最近一次自动生成的 `.bak` 备份 |
| `node bin/agy-compressor.js shortcut` | 在 Windows 桌面上自动创建一键启动快捷方式 |
| `node bin/agy-compressor.js gui` | 唤出独立桌面 Web 图形控制台（基于 Edge `--app` 模式） |

---

## 二、 交互式终端控制台 (TUI)

直接在终端中运行：
```powershell
node bin/agy-compressor.js
# 或带参数：
node bin/agy-compressor.js tui
```

### 界面特色：
* **双行实时状态栏**：一屏展示 Hook 拦截状态、MCP 服务就绪情况、当前策略档位、CCR 缓存池体积与 KV Cache 锁定率；
* **单键交互快捷键**：
  * 按 `[1]`：刷新实时数据大盘；
  * 按 `[2]`：运行系统体检（Doctor）；
  * 按 `[3]` / `[4]`：一键安装 / 卸载 Hook 与 MCP 插件；
  * 按 `[5]`：交互式切换策略档位（`Balanced` / `Aggressive` / `Safe`）；
  * 按 `[6]`：在线运行 5 大场景基准压缩实测；
  * 按 `[7]`：在 Windows 桌面创建一键启动快捷方式；
  * 按 `[8]`：一键清理 CCR 缓存池；
  * 按 `[0]`：重置遥测统计数据。

---

## 三、 独立桌面图形控制台 (Web GUI)

本项目内置符合桌面纯粹体验的独立 Web 控制台：
* 默认监听地址：`http://127.0.0.1:4012`
* 采用无地址栏、无标签栏的独立应用模式（Edge `--app=http://127.0.0.1:4012`）唤出，犹如原生桌面软件。

### 核心功能区：
1. **顶部状态指示徽章**：服务在线心跳、Hook 全局状态、MCP 探活状态、CCR 缓存块实时统计；
2. **快捷操作工具栏**：一键刷新、系统体检、压缩实测、一键卸载、清空缓存、重置统计；
3. **策略档位切换器**：
   * **均衡 Balanced（推荐默认）**：全套 RTK 终端去噪 + 锁文件折叠 + Schema 对齐 + DCP 三阶段剪枝；
   * **激进 Aggressive**：额外激活 TOON 矩阵无损对象编码（针对 5~50 项同构 JSON）与更高频的结构折叠；
   * **保守 Safe（排障首选）**：关闭大部分折叠逻辑，仅保留 PowerShell 引号修复与基础 ANSI 剥离。
4. **七大引擎卡片面板 (Card 1 ~ Card 7)**：直观展示每一个模块累计节省的 Tokens、字符数、百分比占比与进度条。
5. **动态事件实时流水**：基于 SSE (Server-Sent Events) 毫秒级推送最近发生的有效压缩事件。
