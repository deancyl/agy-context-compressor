/**
 * Interactive TUI Navigation Console for AGY Context Compressor (2.1)
 * 100% native Node.js zero dependencies.
 * Provides live status badges, preset switching, one-click Hook + MCP installation,
 * live multi-scenario compression benchmarking, and CCR cache management.
 */

const readline = require('node:readline');
const { formatDashboard, resetStats, getStats } = require('../core/telemetry');
const { getActivePreset, setActivePreset, runCompressionBenchmark } = require('../core/compactor');
const { getChunkStoreStats, clearChunkStore } = require('../core/chunk-store');
const { isHookInstalled, isMcpInstalled } = require('../utils/hook-manager');

function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[0f');
}

function promptKey(question = '\n\x1b[90m按回车或任意键返回主菜单...\x1b[0m') {
  return new Promise(resolve => {
    process.stdout.write(question);
    if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      const onData = buf => {
        process.stdin.removeListener('data', onData);
        try { process.stdin.setRawMode(false); } catch (_) {}
        process.stdin.pause();
        if (buf && buf[0] === 3) {
          // Ctrl+C pressed
          process.stdout.write('\n');
          process.exit(0);
        }
        resolve();
      };
      process.stdin.once('data', onData);
    } else {
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      rl.question('', () => {
        rl.close();
        resolve();
      });
    }
  });
}

function askInput(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.on('SIGINT', () => {
      rl.close();
      process.stdout.write('\n');
      process.exit(0);
    });
    rl.question(question, answer => {
      rl.close();
      resolve((answer || '').trim());
    });
  });
}

function fmtBytes(bytes) {
  if (!bytes || bytes <= 0) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function renderHeader() {
  const stats = getStats();
  const hookOk = isHookInstalled('global');
  const mcpOk = isMcpInstalled();
  const preset = getActivePreset();
  const ccr = getChunkStoreStats();
  const ctx = stats.contextMetrics || {};

  const hookBadge = hookOk ? '\x1b[32m● 已激活\x1b[0m' : '\x1b[31m○ 未挂载\x1b[0m';
  const mcpBadge = mcpOk ? '\x1b[32m● 已挂载\x1b[0m' : '\x1b[33m○ 待配置\x1b[0m';
  const presetLabel = preset === 'aggressive' ? '\x1b[35mAggressive 激进\x1b[0m' : (preset === 'safe' ? '\x1b[34mSafe 保守\x1b[0m' : '\x1b[36mBalanced 均衡\x1b[0m');

  console.log('\x1b[1m\x1b[36m╔════════════════════════════════════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[1m\x1b[36m║      Google Antigravity - 上下文优化与 Token 压缩导航控制台 (TUI v2.1)     ║\x1b[0m');
  console.log('\x1b[1m\x1b[36m╚════════════════════════════════════════════════════════════════════════════╝\x1b[0m');
  console.log(`  Hook 拦截: ${hookBadge}  |  MCP 服务: ${mcpBadge}  |  策略档位: ${presetLabel}  |  CCR 缓存池: \x1b[36m${ccr.chunkCount} 块 (${fmtBytes(ccr.totalBytes)})\x1b[0m`);
  console.log(`  累计节省: \x1b[1m\x1b[32m${(stats.savedTokens || 0).toLocaleString()} Tokens\x1b[0m (\x1b[32m$${(stats.savedCostUSD || 0).toFixed(4)} USD\x1b[0m)  |  去噪压缩率: \x1b[1m\x1b[33m${stats.compressionRatio || 0}%\x1b[0m  |  KV Cache 命中率: \x1b[1m\x1b[35m${ctx.kvCacheHitRatio || 0}%\x1b[0m`);
  if (ctx.isContextBloated) {
    console.log(`  \x1b[33m⚠ 预警: ${ctx.bloatMessage}\x1b[0m`);
  }
  console.log('');
}

function renderBenchmarkView() {
  console.log('\n\x1b[1m\x1b[36m=== 🧪 内置多场景无损压缩率与防降智基准实测 (Live Benchmark) ===\x1b[0m\n');
  const res = runCompressionBenchmark();
  for (const s of res.scenarios) {
    const badge = s.safetyPassed ? '\x1b[32m✔ 100% 保真通过\x1b[0m' : '\x1b[31m✖ 校验异常\x1b[0m';
    console.log(`  • \x1b[1m${s.name}\x1b[0m`);
    console.log(`    体积: ${s.originalChars.toLocaleString()} chars -> ${s.compressedChars.toLocaleString()} chars  |  压缩率: \x1b[1m\x1b[33m-${s.ratio}%\x1b[0m  |  防降智红线: ${badge}`);
  }
  console.log('\n  ──────────────────────────────────────────────────────────────────────────');
  console.log(`  \x1b[1m综合汇总\x1b[0m: 原始 ${res.totalOriginalChars.toLocaleString()} chars -> 压缩后 ${res.totalCompressedChars.toLocaleString()} chars (\x1b[1m\x1b[32m综合压缩率 -${res.overallRatio}%\x1b[0m)`);
  console.log(`  \x1b[1m安全结论\x1b[0m: ${res.allPassed ? '\x1b[32m✔ 全部 5 大核心引擎压缩率与防降智安全红线 100% 验证通过！\x1b[0m' : '\x1b[31m✖ 存在未通过项，请检查配置\x1b[0m'}\n`);
}

async function startTui({ onInstall, onUninstall, onDoctor, onLaunchGui, onCreateShortcut }) {
  while (true) {
    clearScreen();
    renderHeader();

    console.log('\x1b[1m请选择要执行的导航操作：\x1b[0m\n');
    console.log('  \x1b[1m\x1b[32m[1]\x1b[0m 📊 \x1b[1m查看实时 Token 节省与缓存大盘\x1b[0m   (7 大引擎贡献细分 & 最近流水)');
    console.log('  \x1b[1m\x1b[34m[2]\x1b[0m 🩺 \x1b[1m运行系统体检与连接稳定性诊断\x1b[0m   (检测 Node / Hook / MCP / 编码)');
    console.log('  \x1b[1m\x1b[36m[3]\x1b[0m ⚡ \x1b[1m一键全局安装并激活 Hook + MCP\x1b[0m  (自动备份原配置 + 实时自检校验)');
    console.log('  \x1b[1m\x1b[31m[4]\x1b[0m ❌ \x1b[1m一键安全卸载全局 Hook 与 MCP\x1b[0m   (无损保留其他用户自定义配置)');
    console.log('  \x1b[1m\x1b[35m[5]\x1b[0m 🎛️  \x1b[1m切换压缩策略档位 (Preset)\x1b[0m      (Balanced 均衡 / Aggressive 激进 / Safe 保守)');
    console.log('  \x1b[1m\x1b[33m[6]\x1b[0m 🧪 \x1b[1m运行内置压缩率与防降智基准实测\x1b[0m (5 大真实场景秒级验证)');
    console.log('  \x1b[1m\x1b[35m[7]\x1b[0m 🖥️  \x1b[1m呼出独立桌面图形控制台 (GUI)\x1b[0m   (Edge / Chrome 独立桌面窗口)');
    console.log('  \x1b[1m\x1b[33m[8]\x1b[0m 🔗 \x1b[1m创建桌面快捷方式 / 清理 CCR 池\x1b[0m (Windows 快捷图标 & 可逆缓存清理)');
    console.log('  \x1b[1m\x1b[90m[9]\x1b[0m 🔄 \x1b[1m清零重置所有累计遥测统计数据\x1b[0m   (清空历史计分与事件日志)');
    console.log('  \x1b[1m\x1b[90m[0]\x1b[0m 🚪 \x1b[1m退出导航控制台 (或输入 q)\x1b[0m');
    console.log('');

    const choice = await askInput('\x1b[1m请输入数字编号 [0-9] 并按回车:\x1b[0m ');

    if (choice === '1') {
      clearScreen();
      console.log(formatDashboard());
      await promptKey();
    } else if (choice === '2') {
      clearScreen();
      if (onDoctor) await onDoctor();
      await promptKey();
    } else if (choice === '3') {
      clearScreen();
      if (onInstall) await onInstall('global');
      await promptKey();
    } else if (choice === '4') {
      clearScreen();
      if (onUninstall) await onUninstall('global');
      await promptKey();
    } else if (choice === '5') {
      clearScreen();
      const current = getActivePreset();
      console.log(`\n当前压缩策略档位: \x1b[1m\x1b[36m${current}\x1b[0m\n`);
      console.log('  \x1b[1m[1] balanced (均衡推荐)\x1b[0m   : 开启终端去噪、测试折叠、锁文件与 >50 项 JSON 折叠，100% 零降智');
      console.log('  \x1b[1m[2] aggressive (高压缩)\x1b[0m   : 额外开启中型 JSON 的 TOON 无损矩阵转换，阈值收紧至 20 项，极限省流');
      console.log('  \x1b[1m[3] safe (保守排障)\x1b[0m       : 仅剥离 ANSI 控制码、进度条与 PowerShell 语法修复，不做任何结构折叠\n');
      const pChoice = await askInput('请选择档位 [1/2/3] (直接回车取消): ');
      const map = { '1': 'balanced', '2': 'aggressive', '3': 'safe', balanced: 'balanced', aggressive: 'aggressive', safe: 'safe' };
      if (map[pChoice]) {
        const res = setActivePreset(map[pChoice]);
        console.log(`\n\x1b[32m✔ 已切换全局压缩策略为: ${res.preset}\x1b[0m`);
      } else {
        console.log('\n未更改策略档位。');
      }
      await promptKey();
    } else if (choice === '6') {
      clearScreen();
      renderBenchmarkView();
      await promptKey();
    } else if (choice === '7') {
      clearScreen();
      console.log('\n正在启动后台服务并唤出独立桌面控制台...\n');
      if (onLaunchGui) await onLaunchGui();
      await promptKey('\n控制台已在桌面唤出！按任意键返回主菜单...');
    } else if (choice === '8') {
      clearScreen();
      const ccr = getChunkStoreStats();
      console.log('\n\x1b[1m=== 桌面快捷方式与 CCR 可逆缓存池管理 ===\x1b[0m\n');
      console.log(`  当前 CCR 可逆缓存块: \x1b[36m${ccr.chunkCount} 个文件 (${fmtBytes(ccr.totalBytes)})\x1b[0m`);
      console.log(`  缓存目录: ${ccr.dir}\n`);
      console.log('  \x1b[1m[1]\x1b[0m 🔗 在 Windows 桌面创建一键启动快捷方式');
      console.log('  \x1b[1m[2]\x1b[0m 🧹 清理释放所有已暂存的 CCR 历史缓存块\n');
      const sub = await askInput('请选择操作 [1/2] (直接回车取消): ');
      if (sub === '1' && onCreateShortcut) {
        await onCreateShortcut();
      } else if (sub === '2') {
        const cleared = clearChunkStore();
        console.log(`\n\x1b[32m✔ 已成功清理 ${cleared.removedCount} 个 CCR 缓存块！\x1b[0m`);
      }
      await promptKey();
    } else if (choice === '9') {
      clearScreen();
      const confirm = await askInput('确定要清零所有累计节省的 Token 遥测数据吗？(y/N): ');
      if (confirm.toLowerCase() === 'y') {
        resetStats();
        console.log('\n\x1b[32m✔ 遥测数据已成功清零！\x1b[0m');
      } else {
        console.log('\n已取消重置。');
      }
      await promptKey();
    } else if (choice === '0' || choice.toLowerCase() === 'q' || choice.toLowerCase() === 'exit') {
      clearScreen();
      console.log('再见！\n');
      process.exit(0);
    }
  }
}

module.exports = {
  startTui,
  renderBenchmarkView
};
