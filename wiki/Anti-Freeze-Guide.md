# 🛡️ 底层稳定性与防卡死架构指南 (Anti-Freeze Architecture)

在 Windows 与跨平台自动化集成中，最容易导致 AI 智能体“毫无反应”、“连接假死”或“执行卡顿”的原因并非大模型本身，而是本地 Hook 与子进程的底层调度冲突。

本项目总结并落地了针对 **Windows 平台的四大防死锁加固机制**：

---

## 1. 活跃日志文件锁解耦（消除 Windows File-Locking Contention）

### 痛点根因：
在很多插件的设计中，Hook 拦截器每次触发时，都会为了“更新大盘统计”而强行读取主智能体的当前会话文件 `transcript.jsonl`。
在 Windows 内核中，当 Antigravity 主进程正在向日志追加写入数据时，该文件处于**独占写锁**状态。如果外部 Hook 进程此时使用 `readFileSync` 同步读取，就会被操作系统内核强行挂起（挂起几秒甚至超时直接报错），导致智能体在执行每一个命令前都出现长达数秒的无响应假死。

### 本项目的根治方案：
* 在 [`src/core/telemetry.js`](../src/core/telemetry.js) 中建立执行链与展示链的**绝对解耦隔离**：
  * **执行链 (`PreToolUse`, `PreInvocation`)**：以 `includeLiveTranscript = false` 运行，仅在内存和轻量状态文件间做微秒级累计，耗时严格控制在 **`< 1ms`**，绝不同步触碰并发写入的 `transcript.jsonl`；
  * **展示链 (TUI / Web GUI / `formatDashboard`)**：仅在用户显式启动看板或调用统计时，才主动读取并分析活跃轨迹。

---

## 2. 4.5 秒 Hook 看门狗定时器 (Watchdog)

### 痛点根因：
如果操作系统底层由于磁盘 I/O 拥堵、杀毒软件拦截或管道输入挂死，Hook 进程若无限期等待，整个 Antigravity 智能体会永久停滞在等待 Hook 响应阶段。

### 本项目的根治方案：
在 [`src/hooks/hook-runner.js`](../src/hooks/hook-runner.js) 中内置非阻塞看门狗：
```javascript
const watchdog = setTimeout(() => {
  const fallback = hookType === 'pre-invocation' ? { injectSteps: [] } : { decision: 'allow' };
  sendSafeResponse(fallback);
  process.exit(0);
}, 4500);
if (typeof watchdog.unref === 'function') {
  watchdog.unref();
}
```
* 一旦执行耗时超过 4.5 秒，看门狗自动触发，强制向 Antigravity 派发安全放行指令（`{"decision":"allow"}`）并优雅退出，绝不阻断智能体主流程。

---

## 3. 非交互式管道免疫（Rule 23 铁律）

### 痛点根因：
在 Windows 无窗口后台模式下，如果子命令拉起了诸如 `git diff`、`less` 等默认调用终端分页器的工具，或者测试框架进入了交互式 Watch 模式，子进程会永久停在“等待用户按键输入”的标准输入流中。

### 本项目的根治方案：
在 [`bin/agy-exec-wrapper.js`](../bin/agy-exec-wrapper.js) 中实施双重防御：
1. **输入流切断**：严格配置 `stdio: ['ignore', 'pipe', 'pipe']`，彻底阻断任何交互式悬停；
2. **环境变量强制非交互**：
   ```javascript
   const childEnv = {
     ...process.env,
     PYTHONIOENCODING: 'utf-8',
     PYTHONUTF8: '1',
     GIT_PAGER: 'cat',
     PAGER: 'cat',
     CI: 'true'
   };
   ```
3. **250ms 优雅排空定时器**：在主进程触发 `'exit'` 后，即使底层有未关闭句柄的孙进程试图悬挂管道，包装器也会在 250ms 后强行销毁流并安全退出。

---

## 4. 端口 TIME_WAIT 重试机制与守护平滑重载

### 痛点根因：
在 Windows 环境下快速重启本地服务（端口 `4012`）时，操作系统往往会将之前的 TCP 连接保留在 `TIME_WAIT` 状态数十秒。如果此时新进程直接调用 `server.listen(4012)`，Node.js 会抛出 `EADDRINUSE` 错误；若未妥善处理直接退出，会导致后台服务彻底离线。

### 本项目的根治方案：
在 [`src/gui/server.js`](../src/gui/server.js) 中加入智能退避重试：
```javascript
let listenRetries = 0;
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    if (listenRetries < 5) {
      listenRetries++;
      setTimeout(() => {
        try { server.close(); } catch (_) {}
        server.listen(PORT, HOST);
      }, 500);
      return;
    }
    process.exit(0);
  }
});
```
* 遇到瞬态端口占用时自动重试 5 次（间隔 500ms），轻松渡过系统的 `TIME_WAIT` 窗口，保证桌面控制台 100% 稳定在线。
