/**
 * Telemetry & Token Savings Tracker for AGY Context Compressor
 * 100% native Node.js zero dependencies.
 * Tracks character savings, estimated token savings, and USD cost reduction.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function estimateTokens(input) {
  if (typeof input === 'number') {
    return Math.round(input / 3.8);
  }
  if (typeof input !== 'string' || input.length === 0) {
    return 0;
  }
  const cjkMatches = input.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const nonCjkCount = input.length - cjkCount;
  return Math.round(cjkCount / 1.25 + nonCjkCount / 3.8);
}

function getStatsFilePath() {
  const customPath = process.env.AGY_COMPRESSION_STATS_FILE;
  if (customPath) return customPath;

  const configDir = path.join(os.homedir(), '.gemini', 'config');
  if (!fs.existsSync(configDir)) {
    try {
      fs.mkdirSync(configDir, { recursive: true });
    } catch (_) {}
  }
  return path.join(configDir, 'agy-compression-stats.json');
}

let statsCache = null;
let persistTimer = null;

function getInitialStats() {
  const now = new Date().toISOString();
  return {
    totalOriginalChars: 0,
    totalCompressedChars: 0,
    totalSavedChars: 0,
    savedTokens: 0,
    savedCostUSD: 0,
    compressionRatio: 0,
    totalInvocations: 0,
    modules: {
      rtk: { savedChars: 0, savedTokens: 0, invocations: 0 },
      headroom: { savedChars: 0, savedTokens: 0, invocations: 0 },
      schema: { savedChars: 0, savedTokens: 0, alignedToolsCount: 0 },
      powershell: { savedChars: 0, savedTokens: 0, fixedCommandsCount: 0 }
    },
    recentEvents: [],
    createdAt: now,
    updatedAt: now
  };
}

function loadStats() {
  if (statsCache) return statsCache;
  const file = getStatsFilePath();
  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      statsCache = { ...getInitialStats(), ...data };
      if (!statsCache.modules) statsCache.modules = getInitialStats().modules;
      return statsCache;
    } catch (e) {
      // Fallback to fresh stats if corrupt
    }
  }
  statsCache = getInitialStats();
  return statsCache;
}

function flushStats() {
  if (!statsCache) return;
  const file = getStatsFilePath();
  try {
    const tmp = `${file}.tmp_${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(statsCache, null, 2), 'utf8');
    fs.renameSync(tmp, file);
  } catch (err) {
    try {
      fs.writeFileSync(file, JSON.stringify(statsCache, null, 2), 'utf8');
    } catch (_) {}
  }
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    flushStats();
  }, 500);
}

/**
 * Records savings for a specific module or overall event.
 * @param {string} moduleName - 'rtk' | 'headroom' | 'schema' | 'powershell'
 * @param {number} deltaChars - Number of characters pruned
 * @param {number} originalChars - Original character count
 * @param {object} [metadata] - Additional context (e.g. command or filename)
 */
function recordSavings(moduleName, deltaChars, originalChars = 0, metadata = {}) {
  if (typeof deltaChars !== 'number' || deltaChars <= 0) return;

  const stats = loadStats();
  const tokens = estimateTokens(deltaChars);
  const costPerToken = 1.50 / 1000000; // $1.50 per 1M tokens baseline (Gemini / Claude Pro rate)

  stats.totalSavedChars += deltaChars;
  stats.totalOriginalChars += Math.max(originalChars, deltaChars);
  stats.totalCompressedChars += Math.max(0, originalChars - deltaChars);
  stats.savedTokens += tokens;
  stats.savedCostUSD = parseFloat((stats.savedTokens * costPerToken).toFixed(4));
  stats.totalInvocations += 1;

  if (stats.totalOriginalChars > 0) {
    stats.compressionRatio = parseFloat(((stats.totalSavedChars / stats.totalOriginalChars) * 100).toFixed(1));
  }

  if (stats.modules && stats.modules[moduleName]) {
    stats.modules[moduleName].savedChars += deltaChars;
    stats.modules[moduleName].savedTokens += tokens;
    if (stats.modules[moduleName].invocations !== undefined) {
      stats.modules[moduleName].invocations += 1;
    }
  }

  // Keep a small ring buffer of recent events
  if (!Array.isArray(stats.recentEvents)) stats.recentEvents = [];
  stats.recentEvents.unshift({
    module: moduleName,
    savedChars: deltaChars,
    savedTokens: tokens,
    timestamp: new Date().toISOString(),
    ...metadata
  });
  if (stats.recentEvents.length > 20) {
    stats.recentEvents.length = 20;
  }

  stats.updatedAt = new Date().toISOString();
  schedulePersist();
}

/**
 * Records a PowerShell command syntax fix.
 */
function recordPowerShellFix(deltaChars = 0) {
  const stats = loadStats();
  if (!stats.modules.powershell) stats.modules.powershell = { savedChars: 0, savedTokens: 0, fixedCommandsCount: 0 };
  stats.modules.powershell.fixedCommandsCount += 1;
  if (deltaChars > 0) {
    recordSavings('powershell', deltaChars, deltaChars + 50);
  } else {
    stats.updatedAt = new Date().toISOString();
    schedulePersist();
  }
}

/**
 * Resets cumulative stats.
 */
function resetStats() {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = null;
  }
  statsCache = getInitialStats();
  flushStats();
  return statsCache;
}

function getStats() {
  return loadStats();
}

/**
 * Formats a terminal-friendly dashboard.
 * @returns {string}
 */
function formatDashboard() {
  const stats = loadStats();
  const fmtNum = (n) => (n || 0).toLocaleString();
  const fmtBytes = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
  };

  const bar = (pct, width = 20) => {
    const filled = Math.round((pct / 100) * width);
    return '█'.repeat(Math.max(0, Math.min(width, filled))) + '░'.repeat(Math.max(0, width - filled));
  };

  const totalTokens = stats.savedTokens;
  const totalChars = stats.totalSavedChars;
  const ratio = stats.compressionRatio || 0;
  const cost = stats.savedCostUSD || 0;

  const rtkTokens = stats.modules.rtk.savedTokens || 0;
  const headroomTokens = stats.modules.headroom.savedTokens || 0;
  const schemaTokens = stats.modules.schema.savedTokens || 0;
  const psTokens = stats.modules.powershell.savedTokens || 0;

  const rtkPct = totalTokens > 0 ? ((rtkTokens / totalTokens) * 100).toFixed(1) : 0;
  const headroomPct = totalTokens > 0 ? ((headroomTokens / totalTokens) * 100).toFixed(1) : 0;
  const schemaPct = totalTokens > 0 ? ((schemaTokens / totalTokens) * 100).toFixed(1) : 0;
  const psPct = totalTokens > 0 ? ((psTokens / totalTokens) * 100).toFixed(1) : 0;

  const lines = [
    '',
    '\x1b[1m\x1b[36m╔══════════════════════════════════════════════════════════════════════════╗\x1b[0m',
    '\x1b[1m\x1b[36m║           Google Antigravity - Context Compression Dashboard             ║\x1b[0m',
    '\x1b[1m\x1b[36m╚══════════════════════════════════════════════════════════════════════════╝\x1b[0m',
    '',
    `  \x1b[1m\x1b[32m✔ 累计节省 Token 数\x1b[0m     : \x1b[1m\x1b[32m${fmtNum(totalTokens)}\x1b[0m Tokens`,
    `  \x1b[1m\x1b[32m✔ 累计节省字符体积\x1b[0m     : \x1b[1m${fmtBytes(totalChars)}\x1b[0m (${fmtNum(totalChars)} chars)`,
    `  \x1b[1m\x1b[33m✔ 综合平均压缩率\x1b[0m       : \x1b[1m\x1b[33m${ratio}%\x1b[0m [${bar(ratio, 16)}]`,
    `  \x1b[1m\x1b[35m✔ 折合预计减免费用\x1b[0m     : \x1b[1m\x1b[35m$${cost.toFixed(4)} USD\x1b[0m (基于行业大模型基准测算)`,
    `  \x1b[90m• 累计触发压缩次数     : ${fmtNum(stats.totalInvocations)} 次 | 上次更新: ${new Date(stats.updatedAt).toLocaleTimeString()}\x1b[0m`,
    '',
    '\x1b[1m── 模块级贡献细分 (Module Contribution) ──────────────────────────────────\x1b[0m',
    `  • \x1b[1mCard 1: RTK 终端与测试去噪\x1b[0m    : ${fmtNum(rtkTokens).padStart(9)} Tokens (${rtkPct.padStart(5)}%) [${bar(rtkPct, 12)}]`,
    `  • \x1b[1mCard 2: Headroom 结构折叠\x1b[0m     : ${fmtNum(headroomTokens).padStart(9)} Tokens (${headroomPct.padStart(5)}%) [${bar(headroomPct, 12)}]`,
    `  • \x1b[1mCard 3: Tools 缓存对齐瘦身\x1b[0m   : ${fmtNum(schemaTokens).padStart(9)} Tokens (${schemaPct.padStart(5)}%) [${bar(schemaPct, 12)}]`,
    `  • \x1b[1mCard 5: PowerShell 报错去噪\x1b[0m   : ${fmtNum(psTokens).padStart(9)} Tokens (${psPct.padStart(5)}%) [${bar(psPct, 12)}]`,
    `    \x1b[90m(已自动拦截修复 Windows 命令语法与反斜杠陷阱: ${stats.modules.powershell.fixedCommandsCount || 0} 次)\x1b[0m`,
    ''
  ];

  if (stats.recentEvents && stats.recentEvents.length > 0) {
    lines.push('\x1b[1m── 最近压缩事件 (Recent Events) ──────────────────────────────────────────\x1b[0m');
    stats.recentEvents.slice(0, 5).forEach((ev, idx) => {
      const timeStr = new Date(ev.timestamp).toLocaleTimeString();
      lines.push(`  ${idx + 1}. [${timeStr}] [${ev.module.toUpperCase()}] 节省 ${fmtNum(ev.savedTokens)} Tokens (${fmtBytes(ev.savedChars)})`);
    });
    lines.push('');
  }

  lines.push('\x1b[90m数据持久化路径: ' + getStatsFilePath() + '\x1b[0m\n');
  return lines.join('\n');
}

module.exports = {
  estimateTokens,
  getStatsFilePath,
  loadStats,
  flushStats,
  recordSavings,
  recordPowerShellFix,
  resetStats,
  getStats,
  formatDashboard
};
