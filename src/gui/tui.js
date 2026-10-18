/**
 * Interactive TUI Navigation Menu for AGY Context Compressor
 * 100% native Node.js zero dependencies.
 * Provides preset commands navigation without typing manual flags.
 */

const readline = require('node:readline');
const path = require('node:path');
const { formatDashboard, resetStats, getStats } = require('../core/telemetry');
const { compactOutput } = require('../core/compactor');
const { fixPowerShellCommandEscaping } = require('../core/powershell');
const { detectPlatform } = require('../utils/platform');

function clearScreen() {
  process.stdout.write('\x1b[2J\x1b[0f');
}

function promptKey(question = '\n按任意键返回主菜单...') {
  return new Promise(resolve => {
    process.stdout.write(question);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
      process.stdin.resume();
      process.stdin.once('data', () => {
        process.stdin.setRawMode(false);
        resolve();
      });
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
    rl.question(question, answer => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function renderHeader() {
  console.log('\x1b[1m\x1b[36m╔══════════════════════════════════════════════════════════════════════════╗\x1b[0m');
  console.log('\x1b[1m\x1b[36m║       Google Antigravity - 上下文优化与 Token 压缩导航控制台 (TUI)       ║\x1b[0m');
  console.log('\x1b[1m\x1b[36m╚══════════════════════════════════════════════════════════════════════════╝\x1b[0m');
  const stats = getStats();
  console.log(`  \x1b[90m当前累计节省: \x1b[32m${(stats.savedTokens || 0).toLocaleString()} Tokens\x1b[90m | 减免费用: \x1b[35m$${(stats.savedCostUSD || 0).toFixed(4)} USD\x1b[90m | 压缩率: \x1b[33m${stats.compressionRatio || 0}%\x1b[0m\n`);
}

async function startTui({ onInstall, onUninstall, onDoctor, onLaunchGui, onCreateShortcut }) {
  while (true) {
    clearScreen();
    renderHeader();

    console.log('\x1b[1m请选择要执行的预设操作：\x1b[0m\n');
    console.log('  \x1b[1m\x1b[32m[1]\x1b[0m 📊 \x1b[1m查看实时 Token 节省大盘 (Stats Dashboard)\x1b[0m');
    console.log('  \x1b[1m\x1b[34m[2]\x1b[0m 🩺 \x1b[1m运行系统体检健康诊断 (Doctor Diagnostic)\x1b[0m');
    console.log('  \x1b[1m\x1b[36m[3]\x1b[0m ⚡ \x1b[1m一键全局安装并激活 PreToolUse Hook\x1b[0m');
    console.log('  \x1b[1m\x1b[31m[4]\x1b[0m ❌ \x1b[1m一键卸载全局 Hook\x1b[0m');
    console.log('  \x1b[1m\x1b[35m[5]\x1b[0m 🖥️  \x1b[1m呼出独立桌面图形控制台 (Edge App GUI)\x1b[0m');
    console.log('  \x1b[1m\x1b[33m[6]\x1b[0m 🔗 \x1b[1m在 Windows 桌面创建一键双击快捷方式\x1b[0m');
    console.log('  \x1b[1m\x1b[90m[7]\x1b[0m 🔄 \x1b[1m清零重置所有累计遥测统计数据\x1b[0m');
    console.log('  \x1b[1m\x1b[90m[0]\x1b[0m 🚪 \x1b[1m退出导航控制台\x1b[0m');
    console.log('');

    const choice = await askInput('\x1b[1m请输入数字编号 [0-7] 并按回车:\x1b[0m ');

    if (choice === '1') {
      clearScreen();
      console.log(formatDashboard());
      await promptKey();
    } else if (choice === '2') {
      clearScreen();
      if (onDoctor) onDoctor();
      await promptKey();
    } else if (choice === '3') {
      clearScreen();
      if (onInstall) onInstall('global');
      await promptKey();
    } else if (choice === '4') {
      clearScreen();
      if (onUninstall) onUninstall('global');
      await promptKey();
    } else if (choice === '5') {
      clearScreen();
      console.log('\n正在启动后台服务并唤出独立桌面控制台...\n');
      if (onLaunchGui) onLaunchGui();
      await promptKey('\n控制台已在桌面唤出！按任意键返回主菜单...');
    } else if (choice === '6') {
      clearScreen();
      if (onCreateShortcut) onCreateShortcut();
      await promptKey();
    } else if (choice === '7') {
      clearScreen();
      const confirm = await askInput('确定要清零所有累计节省的 Token 遥测数据吗？(y/N): ');
      if (confirm.toLowerCase() === 'y') {
        resetStats();
        console.log('\n\x1b[32m✔ 遥测数据已成功清零！\x1b[0m');
      } else {
        console.log('\n已取消重置。');
      }
      await promptKey();
    } else if (choice === '0' || choice.toLowerCase() === 'q') {
      clearScreen();
      console.log('再见！\n');
      process.exit(0);
    }
  }
}

module.exports = {
  startTui
};
