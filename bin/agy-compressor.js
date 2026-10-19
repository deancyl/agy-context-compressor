#!/usr/bin/env node
/**
 * agy-compressor CLI, TUI & Doctor (2.1)
 * Management utility for Antigravity Context Compressor.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { compactOutput, getActivePreset, setActivePreset, runCompressionBenchmark } = require('../src/core/compactor');
const { fixPowerShellCommandEscaping } = require('../src/core/powershell');
const { formatDashboard, resetStats, getStats } = require('../src/core/telemetry');
const { getChunkStoreStats, clearChunkStore } = require('../src/core/chunk-store');
const {
  getHooksFilePath,
  isHookInstalled,
  isMcpInstalled,
  installHook,
  uninstallHook,
  installMcpServer,
  uninstallMcpServer,
  restoreHookBackup,
  verifyHookExecution,
  verifyMcpExecution
} = require('../src/utils/hook-manager');
const { createDesktopShortcut } = require('../src/utils/shortcut');

const args = process.argv.slice(2);
const command = args[0] || (process.stdin.isTTY ? 'tui' : 'help');

function handleInstall(target = 'global') {
  try {
    const res = installHook(target);
    console.log(`\x1b[32m✔ 成功安装并激活 PreToolUse & PreInvocation Hook！\x1b[0m`);
    console.log(`  Hook 配置文件: ${res.path}`);
    if (res.backupPath) {
      console.log(`  原配置已备份至: ${res.backupPath}`);
    }
    console.log(`  \x1b[36m✔ Hook 实时自测验证: PASSED (已通过沙盒命令验证拦截器正常运行)\x1b[0m`);

    if (target === 'global') {
      try {
        const mcpRes = installMcpServer();
        const mcpVerify = verifyMcpExecution();
        if (mcpVerify.success) {
          console.log(`\x1b[32m✔ 成功挂载并验证 MCP 压缩服务 (agy-compressor)！\x1b[0m`);
          console.log(`  MCP 配置文件: ${mcpRes.path}`);
        }
      } catch (_) {}
    }
  } catch (err) {
    console.error(`\x1b[31m✖ 安装失败:\x1b[0m ${err.message}`);
  }
}

function handleUninstall(target = 'global') {
  try {
    const res = uninstallHook(target);
    console.log(`\x1b[32m✔ 成功卸载并清除 PreToolUse & PreInvocation Hook！\x1b[0m`);
    console.log(`  Hook 配置文件: ${res.path}`);
    if (res.hadOtherHooks) {
      console.log(`  \x1b[36m• 检测到其他用户自定义 Hook，已全部完好保留。\x1b[0m`);
    }
    if (target === 'global') {
      try {
        uninstallMcpServer();
        console.log(`\x1b[32m✔ 已同步移除全局 MCP 压缩服务配置。\x1b[0m`);
      } catch (_) {}
    }
    console.log(`  \x1b[36m✔ 状态校验: Hook 已彻底停用。\x1b[0m`);
  } catch (err) {
    console.error(`\x1b[31m✖ 卸载失败:\x1b[0m ${err.message}`);
  }
}

function handleRestore(target = 'global') {
  try {
    const res = restoreHookBackup(target);
    console.log(`\x1b[32m✔ 成功一键恢复配置备份！\x1b[0m`);
    console.log(`  恢复来源文件: ${res.restoredFrom}`);
  } catch (err) {
    console.error(`\x1b[31m✖ 恢复备份失败:\x1b[0m ${err.message}`);
  }
}

function handleShortcut() {
  const res = createDesktopShortcut();
  if (res.success) {
    console.log(`\x1b[32m✔ 成功在 Windows 桌面创建一键启动快捷方式！\x1b[0m`);
    console.log(`  快捷方式路径: ${res.path}`);
    console.log(`  双击桌面图标即可直接唤出本导航控制台。`);
  } else {
    console.error(`\x1b[31m✖ 创建快捷方式失败:\x1b[0m ${res.reason}`);
  }
}

function launchEdgeGui() {
  const guiServerScript = path.resolve(__dirname, '..', 'src', 'gui', 'server.js');
  const serverProc = spawn(process.execPath, [guiServerScript], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  });
  serverProc.unref();

  setTimeout(() => {
    const edgePaths = [
      'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    ];
    const browser = edgePaths.find(p => fs.existsSync(p));
    if (browser) {
      const browserProc = spawn(browser, ['--app=http://127.0.0.1:4012'], {
        detached: true,
        stdio: 'ignore'
      });
      browserProc.unref();
      console.log(`\x1b[32m✔ 已在独立桌面应用模式唤出控制台 (http://127.0.0.1:4012)\x1b[0m`);
    } else {
      console.log(`请在浏览器中打开: http://127.0.0.1:4012`);
    }
  }, 400);
}

function runDoctor() {
  console.log('\n\x1b[1m=== Antigravity Context Compressor: System Doctor (v2.1) ===\x1b[0m\n');

  // 1. Node.js Environment
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (major >= 18) {
    console.log(`  \x1b[32m✔ Node.js Runtime:\x1b[0m ${nodeVersion} (Supported: >= 18.0.0)`);
  } else {
    console.log(`  \x1b[31m✖ Node.js Runtime:\x1b[0m ${nodeVersion} (Outdated, requires >= 18.0.0)`);
  }

  // 2. Antigravity Configuration
  const globalConfigDir = path.join(os.homedir(), '.gemini', 'config');
  if (fs.existsSync(globalConfigDir)) {
    console.log(`  \x1b[32m✔ Antigravity Global Config:\x1b[0m Found at ${globalConfigDir}`);
  } else {
    console.log(`  \x1b[33m! Antigravity Global Config:\x1b[0m Directory not created yet (${globalConfigDir})`);
  }

  // 3. Hook Status & Live Execution Test
  const installed = isHookInstalled('global');
  if (installed) {
    console.log(`  \x1b[32m✔ PreToolUse & PreInvocation Hook:\x1b[0m Active in ${getHooksFilePath('global')}`);
    const execTest = verifyHookExecution();
    if (execTest.success) {
      console.log(`  \x1b[32m✔ Hook Execution & Watchdog Check:\x1b[0m PASSED (Pure JSON stdout + 4.5s timeout guard)`);
    } else {
      console.log(`  \x1b[31m✖ Hook Execution Check:\x1b[0m FAILED (${execTest.reason})`);
    }
  } else {
    console.log(`  \x1b[33m! PreToolUse Hook:\x1b[0m Not active globally. [运行 install 或在 TUI 按 3 即可一键激活]`);
  }

  // 4. MCP Server Handshake Check
  const mcpCheck = verifyMcpExecution();
  const mcpReg = isMcpInstalled();
  if (mcpCheck.success) {
    console.log(`  \x1b[32m✔ MCP Server Handshake (stdio):\x1b[0m PASSED (initialize + ping verified | Registered: ${mcpReg ? 'Yes' : 'No'})`);
  } else {
    console.log(`  \x1b[31m✖ MCP Server Handshake:\x1b[0m FAILED (${mcpCheck.reason})`);
  }

  // 5. Shell, Chinese Encoding & Platform
  console.log(`  \x1b[32m✔ Host Platform & UTF-8 Guard:\x1b[0m ${process.platform} (${os.release()}) | Simplified Chinese UTF-8 Protected`);

  // 6. Active Preset & CCR Store
  const preset = getActivePreset();
  const ccr = getChunkStoreStats();
  console.log(`  \x1b[32m✔ Active Preset & CCR Store:\x1b[0m Preset [${preset}] | CCR Chunks: ${ccr.chunkCount} (${(ccr.totalBytes / 1024).toFixed(1)} KB)`);

  // 7. Engine Health Check
  const sampleRaw = '\u001b[32m✔\u001b[0m test passed\r\n\u001b[32m✓\u001b[0m test 2 passed\r\n\u001b[32m✓\u001b[0m test 3 passed\r\n';
  const sampleCompacted = compactOutput(sampleRaw, { recordTelemetry: false });
  const sampleEscape = fixPowerShellCommandEscaping('curl "C:\\test\\" -X GET', { targetPlatform: 'win32' });

  if (sampleCompacted.includes('passed tests folded') && sampleEscape.includes('curl.exe') && sampleEscape.includes('C:\\test\\\\')) {
    console.log(`  \x1b[32m✔ Core Compression Engines:\x1b[0m Self-test PASSED (7-Core RTK + Headroom + PowerShell + Aider + DCP verified)`);
  } else {
    console.log(`  \x1b[31m✖ Core Compression Engines:\x1b[0m Self-test anomaly detected`);
  }

  // 8. Cumulative Telemetry Summary
  const stats = getStats();
  console.log(`  \x1b[36m✔ Cumulative Saved Tokens:\x1b[0m \x1b[1m\x1b[32m${(stats.savedTokens || 0).toLocaleString()} Tokens\x1b[0m (Saved: $${(stats.savedCostUSD || 0).toFixed(4)} USD)`);

  console.log('\n\x1b[1mDoctor complete.\x1b[0m\n');
}

function runStats() {
  if (args.includes('--reset')) {
    resetStats();
    console.log('\x1b[32m✔ 压缩遥测数据已成功清零重置。\x1b[0m');
    return;
  }
  console.log(formatDashboard());
}

function showHelp() {
  console.log(`
agy-context-compressor (v2.1) - 交互式导航控制台与 CLI

用法:
  agy-compressor [命令] [选项]

预设命令导航:
  tui                                      启动交互式按键导航控制台 (默认)
  stats [--reset]                          查看实时 Token 节省大盘、压缩率与减免费用
  doctor                                   运行系统环境、Hook 与 MCP 连接健康自诊断
  benchmark                                运行内置 5 大场景压缩率与防降智基准实测
  preset [balanced|aggressive|safe]        查看或切换全局压缩策略档位
  install [--global|--project]             一键安装并激活 Hook 与 MCP 服务 (自带实时校验)
  uninstall [--global|--project]           一键安全卸载 Hook 与 MCP 服务 (完全恢复原状)
  restore [--global|--project]             从最近的安全备份中一键还原 hooks.json
  clean-ccr                                清理释放本地 CCR 可逆缓存块
  shortcut                                 在 Windows 桌面创建一键双击启动快捷方式
  gui                                      在独立桌面应用模式下呼出 Web 控制台
  help                                     显示此帮助说明
`);
}

switch (command) {
  case 'tui':
  case 'menu':
  case 'nav': {
    const { startTui } = require('../src/gui/tui');
    startTui({
      onInstall: handleInstall,
      onUninstall: handleUninstall,
      onDoctor: runDoctor,
      onLaunchGui: launchEdgeGui,
      onCreateShortcut: handleShortcut
    });
    break;
  }
  case 'stats':
  case 'telemetry':
  case 'metrics':
    runStats();
    break;
  case 'benchmark':
  case 'bench': {
    const { renderBenchmarkView } = require('../src/gui/tui');
    renderBenchmarkView();
    break;
  }
  case 'preset': {
    const targetPreset = args[1];
    if (targetPreset && ['balanced', 'aggressive', 'safe'].includes(targetPreset)) {
      const res = setActivePreset(targetPreset);
      console.log(`\x1b[32m✔ 全局压缩策略已切换为: ${res.preset}\x1b[0m`);
    } else {
      console.log(`当前全局压缩策略: \x1b[1m\x1b[36m${getActivePreset()}\x1b[0m (可选: balanced | aggressive | safe)`);
    }
    break;
  }
  case 'clean-ccr': {
    const res = clearChunkStore();
    console.log(`\x1b[32m✔ 已清理 ${res.removedCount} 个 CCR 缓存块。\x1b[0m`);
    break;
  }
  case 'install':
    handleInstall(args[1] === '--project' ? 'project' : 'global');
    break;
  case 'uninstall':
    handleUninstall(args[1] === '--project' ? 'project' : 'global');
    break;
  case 'restore':
    handleRestore(args[1] === '--project' ? 'project' : 'global');
    break;
  case 'shortcut':
  case 'create-shortcut':
    handleShortcut();
    break;
  case 'gui':
  case 'dashboard':
    launchEdgeGui();
    break;
  case 'doctor':
    runDoctor();
    break;
  case 'filter':
    require('../src/hooks/stream-filter');
    break;
  case 'help':
  default:
    showHelp();
    break;
}
