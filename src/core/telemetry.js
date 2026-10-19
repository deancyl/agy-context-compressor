/**
 * Telemetry & Token Savings Tracker for AGY Context Compressor (2.1)
 * 100% native Node.js zero dependencies.
 * Multi-process real-time safe: tracks character savings, accurate CJK/English token savings,
 * bounded event log rotation, and separates direct plugin compression metrics from upstream Google KV Cache telemetry.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const MAX_EVENT_LOG_BYTES = 512 * 1024; // 512 KB cap for jsonl event log

/**
 * Bilingual CJK / Code token estimator.
 * - When given a string, counts CJK characters (~1.25 chars/token) and non-CJK (~3.8 chars/token).
 * - When given a numeric character delta and optional text samples (originalText, compressedText),
 *   computes the exact token difference between originalText and compressedText.
 * @param {string|number} input
 * @param {string} [originalText]
 * @param {string} [compressedText]
 * @returns {number}
 */
function estimateTokens(input, originalText = null, compressedText = null) {
  if (typeof originalText === 'string' && typeof compressedText === 'string') {
    return Math.max(0, estimateTokens(originalText) - estimateTokens(compressedText));
  }
  if (typeof input === 'number') {
    return Math.max(0, Math.round(input / 3.8));
  }
  if (typeof input !== 'string' || input.length === 0) {
    return 0;
  }
  const cjkMatches = input.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff\u3000-\u303f\uff00-\uffef]/g);
  const cjkCount = cjkMatches ? cjkMatches.length : 0;
  const nonCjkCount = input.length - cjkCount;
  return Math.max(0, Math.round(cjkCount / 1.25 + nonCjkCount / 3.8));
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

function getEventsFilePath() {
  const statsFile = getStatsFilePath();
  return path.join(path.dirname(statsFile), 'agy-compression-events.jsonl');
}

function appendEventLog(event) {
  try {
    const file = getEventsFilePath();
    if (fs.existsSync(file)) {
      const st = fs.statSync(file);
      if (st.size > MAX_EVENT_LOG_BYTES) {
        // Keep the newest half of lines on rotation
        const lines = fs.readFileSync(file, 'utf8').split('\n').filter(Boolean);
        const kept = lines.slice(Math.floor(lines.length / 2));
        fs.writeFileSync(file, kept.join('\n') + '\n', 'utf8');
      }
    }
    fs.appendFileSync(file, JSON.stringify(event) + '\n', 'utf8');
  } catch (_) {}
}

let statsCache = null;
let lastLoadedMtime = 0;

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
      cacheZone: { savedChars: 0, savedTokens: 0, hits: 0, memoHits: 0, upstreamKvCacheTokens: 0 },
      powershell: { savedChars: 0, savedTokens: 0, fixedCommandsCount: 0 },
      aider: { savedChars: 0, savedTokens: 0, repoMapCount: 0, skeletonsCount: 0, ftsSearchCount: 0, invocations: 0 },
      kompact: { savedChars: 0, savedTokens: 0, prunedToolOutputsCount: 0, invocations: 0 }
    },
    recentEvents: [],
    createdAt: now,
    updatedAt: now
  };
}

/**
 * Loads latest stats from disk, detecting any external updates via file modification time.
 * @param {boolean} [force=false]
 * @returns {object}
 */
function loadStats(force = false, includeLiveTranscript = false) {
  const file = getStatsFilePath();
  let currentMtime = 0;
  try {
    if (fs.existsSync(file)) {
      currentMtime = fs.statSync(file).mtimeMs;
    }
  } catch (_) {}

  if (!force && statsCache && currentMtime > 0 && currentMtime <= lastLoadedMtime) {
    if (includeLiveTranscript && !statsCache.contextMetrics) {
      // Proceed to populate below
    } else {
      return statsCache;
    }
  }

  if (fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      const init = getInitialStats();
      statsCache = { ...init, ...data };
      statsCache.modules = { ...init.modules, ...(data.modules || {}) };
      for (const k of Object.keys(init.modules)) {
        statsCache.modules[k] = { ...init.modules[k], ...(statsCache.modules[k] || {}) };
      }
      lastLoadedMtime = currentMtime;
    } catch (e) {
      // Fallback
    }
  }

  if (!statsCache) {
    statsCache = getInitialStats();
    lastLoadedMtime = currentMtime;
  }

  const isTest = Boolean(process.env.AGY_COMPRESSION_STATS_FILE) || process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT);

  // Augment with real-time live Antigravity context metrics ONLY when explicitly requested (e.g. for GUI dashboard or formatDashboard)
  // NEVER run expensive transcript file reading on the critical execution path of PreToolUse / PreInvocation hooks!
  if (!isTest && includeLiveTranscript) {
    try {
      const { getLiveAntigravityMetrics } = require('./cache-zone');
      const live = getLiveAntigravityMetrics();
      if (live && live.totalContextProcessed > 0) {
        statsCache.contextMetrics = live;
        if (!statsCache.modules.cacheZone) {
          statsCache.modules.cacheZone = { savedChars: 0, savedTokens: 0, hits: 0, memoHits: 0, upstreamKvCacheTokens: 0 };
        }
        statsCache.modules.cacheZone.upstreamKvCacheTokens = live.totalCacheReadTokens;
        statsCache.modules.cacheZone.hits = live.plannerResponsesCount + (statsCache.modules.cacheZone.memoHits || 0);
        statsCache.totalContextProcessed = live.totalContextProcessed;
      }
    } catch (_) {}
  }

  return statsCache;
}

/**
 * Synchronously flushes in-memory stats to disk with atomic write + Windows EPERM retry fallback.
 */
function flushStats() {
  if (!statsCache) return;
  const file = getStatsFilePath();
  const payload = JSON.stringify(statsCache, null, 2);
  try {
    const dir = path.dirname(file);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    const tmp = `${file}.tmp_${process.pid}_${Date.now()}`;
    fs.writeFileSync(tmp, payload, 'utf8');
    try {
      fs.renameSync(tmp, file);
    } catch (renameErr) {
      try { fs.unlinkSync(tmp); } catch (_) {}
      fs.writeFileSync(file, payload, 'utf8');
    }
    try {
      lastLoadedMtime = fs.statSync(file).mtimeMs;
    } catch (_) {}
  } catch (err) {
    try {
      fs.writeFileSync(file, payload, 'utf8');
      lastLoadedMtime = Date.now();
    } catch (_) {}
  }
}

/**
 * Records savings for a specific module or overall event in real time.
 * @param {string} moduleName - 'rtk' | 'headroom' | 'schema' | 'powershell' | 'aider' | 'kompact' | 'cacheZone'
 * @param {number} deltaChars - Number of characters pruned
 * @param {number} originalChars - Original character count
 * @param {object} [metadata] - Additional context (e.g. command, filename, originalText, compressedText)
 */
function recordSavings(moduleName, deltaChars, originalChars = 0, metadata = {}) {
  if (typeof deltaChars !== 'number' || deltaChars <= 0) return;

  const stats = loadStats(true);
  const { originalText, compressedText, ...cleanMeta } = metadata || {};
  const tokens = (typeof originalText === 'string' && typeof compressedText === 'string')
    ? estimateTokens(deltaChars, originalText, compressedText)
    : estimateTokens(deltaChars);
  const costPerToken = 1.00 / 1000000;

  stats.totalSavedChars += deltaChars;
  stats.totalOriginalChars += Math.max(originalChars, deltaChars);
  stats.totalCompressedChars += Math.max(0, originalChars - deltaChars);
  stats.savedTokens += tokens;
  stats.savedCostUSD = parseFloat((stats.savedTokens * costPerToken).toFixed(4));
  stats.totalInvocations += 1;

  if (stats.totalOriginalChars > 0) {
    stats.compressionRatio = parseFloat(((stats.totalSavedChars / stats.totalOriginalChars) * 100).toFixed(1));
  }

  if (!stats.modules) stats.modules = {};
  if (!stats.modules[moduleName]) {
    stats.modules[moduleName] = { savedChars: 0, savedTokens: 0, invocations: 0 };
  }
  stats.modules[moduleName].savedChars += deltaChars;
  stats.modules[moduleName].savedTokens += tokens;
  if (stats.modules[moduleName].invocations !== undefined) {
    stats.modules[moduleName].invocations += 1;
  }
  if (moduleName === 'aider') {
    if (cleanMeta.note === 'generate_repo_map') stats.modules.aider.repoMapCount = (stats.modules.aider.repoMapCount || 0) + 1;
    if (cleanMeta.type === 'code_skeleton') stats.modules.aider.skeletonsCount = (stats.modules.aider.skeletonsCount || 0) + 1;
    if (cleanMeta.type === 'fts_search') stats.modules.aider.ftsSearchCount = (stats.modules.aider.ftsSearchCount || 0) + 1;
  }
  if (moduleName === 'kompact') {
    stats.modules.kompact.prunedToolOutputsCount = (stats.modules.kompact.prunedToolOutputsCount || 0) + (cleanMeta.prunedCount || 1);
  }
  if (moduleName === 'cacheZone') {
    stats.modules.cacheZone.memoHits = (stats.modules.cacheZone.memoHits || 0) + 1;
    stats.modules.cacheZone.hits = (stats.modules.cacheZone.hits || 0) + 1;
  }

  const event = {
    module: moduleName,
    savedChars: deltaChars,
    savedTokens: tokens,
    timestamp: new Date().toISOString(),
    ...cleanMeta
  };
  stats.recentEvents.unshift(event);
  if (stats.recentEvents.length > 20) {
    stats.recentEvents.length = 20;
  }
  appendEventLog(event);

  stats.updatedAt = new Date().toISOString();
  flushStats();
}

/**
 * Records an in-memory session memoization hit in Cache-Zone.
 */
function recordCacheZoneHit(savedChars = 0, originalChars = 0, metadata = {}) {
  const stats = loadStats(true);
  if (!stats.modules.cacheZone) {
    stats.modules.cacheZone = { savedChars: 0, savedTokens: 0, hits: 0, memoHits: 0, upstreamKvCacheTokens: 0 };
  }
  stats.modules.cacheZone.memoHits = (stats.modules.cacheZone.memoHits || 0) + 1;
  stats.modules.cacheZone.hits = (stats.modules.cacheZone.hits || 0) + 1;
  if (savedChars > 0) {
    const tokens = estimateTokens(savedChars);
    stats.modules.cacheZone.savedChars += savedChars;
    stats.modules.cacheZone.savedTokens += tokens;
  }
  stats.updatedAt = new Date().toISOString();
  flushStats();
}

/**
 * Atomically records savings from multiple modules in a single compactor pass.
 * Prevents multiple counting of originalChars and totalInvocations.
 * @param {object} params
 * @param {number} params.originalChars - Single original text character count
 * @param {object} params.moduleDeltas - e.g. { rtk: 500, powershell: 200, headroom: 300 }
 * @param {string} [params.originalText]
 * @param {string} [params.compressedText]
 * @param {object} [params.metadata]
 */
function recordBatchSavings({ originalChars, moduleDeltas, originalText = null, compressedText = null, metadata = {} }) {
  if (typeof originalChars !== 'number' || originalChars <= 0 || !moduleDeltas) return;

  let totalDelta = 0;
  for (const delta of Object.values(moduleDeltas)) {
    if (typeof delta === 'number' && delta > 0) {
      totalDelta += delta;
    }
  }
  if (totalDelta <= 0) return;

  const stats = loadStats(true);
  const totalTokens = (typeof originalText === 'string' && typeof compressedText === 'string')
    ? estimateTokens(totalDelta, originalText, compressedText)
    : estimateTokens(totalDelta);
  const costPerToken = 1.00 / 1000000;

  stats.totalSavedChars += totalDelta;
  stats.totalOriginalChars += originalChars; // EXACTLY ONCE!
  stats.totalCompressedChars += Math.max(0, originalChars - totalDelta);
  stats.savedTokens += totalTokens;
  stats.savedCostUSD = parseFloat((stats.savedTokens * costPerToken).toFixed(4));
  stats.totalInvocations += 1; // EXACTLY ONCE!

  if (stats.totalOriginalChars > 0) {
    stats.compressionRatio = parseFloat(((stats.totalSavedChars / stats.totalOriginalChars) * 100).toFixed(1));
  }

  for (const [mod, delta] of Object.entries(moduleDeltas)) {
    if (typeof delta === 'number' && delta > 0) {
      if (!stats.modules[mod]) stats.modules[mod] = { savedChars: 0, savedTokens: 0 };
      const modTok = Math.round((delta / totalDelta) * totalTokens) || estimateTokens(delta);
      stats.modules[mod].savedChars += delta;
      stats.modules[mod].savedTokens += modTok;
      if (stats.modules[mod].invocations !== undefined) {
        stats.modules[mod].invocations += 1;
      }
    }
  }

  const primaryMod = Object.keys(moduleDeltas).sort((a, b) => (moduleDeltas[b] || 0) - (moduleDeltas[a] || 0))[0] || 'rtk';
  const event = {
    module: primaryMod,
    savedChars: totalDelta,
    savedTokens: totalTokens,
    timestamp: new Date().toISOString(),
    ...metadata
  };
  stats.recentEvents.unshift(event);
  if (stats.recentEvents.length > 20) {
    stats.recentEvents.length = 20;
  }
  appendEventLog(event);

  stats.updatedAt = new Date().toISOString();
  flushStats();
}

/**
 * Records a PowerShell command syntax fix in real time without fabricating saved character counts.
 */
function recordPowerShellFix(deltaChars = 0, metadata = {}) {
  const stats = loadStats(true);
  if (!stats.modules.powershell) stats.modules.powershell = { savedChars: 0, savedTokens: 0, fixedCommandsCount: 0 };
  stats.modules.powershell.fixedCommandsCount += 1;
  stats.updatedAt = new Date().toISOString();

  if (deltaChars > 0) {
    recordSavings('powershell', deltaChars, deltaChars + 50, metadata);
  } else {
    const event = {
      module: 'powershell',
      savedChars: 0,
      savedTokens: 0,
      timestamp: new Date().toISOString(),
      note: 'auto_healed_syntax_trap',
      ...metadata
    };
    stats.recentEvents.unshift(event);
    if (stats.recentEvents.length > 20) stats.recentEvents.length = 20;
    appendEventLog(event);
    flushStats();
  }
}

/**
 * Records tools schema dictionary alignment and trimming.
 */
function recordSchemaAlignment(toolsCount = 0, savedChars = 0) {
  const stats = loadStats(true);
  if (!stats.modules.schema) stats.modules.schema = { savedChars: 0, savedTokens: 0, alignedToolsCount: 0 };
  stats.modules.schema.alignedToolsCount = Math.max(stats.modules.schema.alignedToolsCount || 0, toolsCount);
  if (savedChars > 0) {
    recordSavings('schema', savedChars, savedChars + 2000);
  } else {
    flushStats();
  }
}

/**
 * Resets cumulative stats and cleans event log.
 */
function resetStats() {
  statsCache = getInitialStats();
  flushStats();
  try {
    const eventsFile = getEventsFilePath();
    if (fs.existsSync(eventsFile)) {
      fs.writeFileSync(eventsFile, '', 'utf8');
    }
  } catch (_) {}
  return statsCache;
}

function getStats(force = true, includeLive = true) {
  return loadStats(force, includeLive);
}

/**
 * Formats a terminal-friendly dashboard.
 * @param {object|null} [customStats=null]
 * @returns {string}
 */
function formatDashboard(customStats = null) {
  const stats = customStats || loadStats(true, true);
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

  const rtkTokens = stats.modules.rtk?.savedTokens || 0;
  const headroomTokens = stats.modules.headroom?.savedTokens || 0;
  const schemaTokens = stats.modules.schema?.savedTokens || 0;
  const cacheZoneTokens = (stats.modules.cacheZone?.savedTokens || 0) + (stats.modules.cacheZone?.upstreamKvCacheTokens || 0);
  const psTokens = stats.modules.powershell?.savedTokens || 0;
  const aiderTokens = stats.modules.aider?.savedTokens || 0;
  const kompactTokens = stats.modules.kompact?.savedTokens || 0;

  const toolBase = (rtkTokens + headroomTokens + schemaTokens + psTokens + aiderTokens + kompactTokens) || 1;
  const rtkPct = ((rtkTokens / toolBase) * 100).toFixed(1);
  const headroomPct = ((headroomTokens / toolBase) * 100).toFixed(1);
  const schemaPct = ((schemaTokens / toolBase) * 100).toFixed(1);
  const psPct = ((psTokens / toolBase) * 100).toFixed(1);
  const aiderPct = ((aiderTokens / toolBase) * 100).toFixed(1);
  const kompactPct = ((kompactTokens / toolBase) * 100).toFixed(1);

  const ctx = stats.contextMetrics || {};
  const totalContext = ctx.totalContextProcessed || stats.totalOriginalChars || 0;
  const kvCacheTokens = ctx.totalCacheReadTokens || 0;
  const kvRatio = ctx.kvCacheHitRatio || 0;

  const lines = [
    '',
    '\x1b[1m\x1b[36m╔══════════════════════════════════════════════════════════════════════════╗\x1b[0m',
    '\x1b[1m\x1b[36m║           Google Antigravity - Context Compression Dashboard             ║\x1b[0m',
    '\x1b[1m\x1b[36m╚══════════════════════════════════════════════════════════════════════════╝\x1b[0m',
    '',
    `  \x1b[1m\x1b[34m✔ 全会话处理上下文总体量\x1b[0m : \x1b[1m\x1b[34m${fmtNum(totalContext)}\x1b[0m Tokens (含历史轮次与思考链)`,
    `  \x1b[1m\x1b[35m✔ Google 原厂 KV Cache 命中\x1b[0m: \x1b[1m\x1b[35m${fmtNum(kvCacheTokens)}\x1b[0m Tokens [锁定命中率: \x1b[1m${kvRatio}%\x1b[0m]`,
    `  \x1b[1m\x1b[32m✔ 终端与结构去噪直接节省\x1b[0m : \x1b[1m\x1b[32m${fmtNum(totalTokens)}\x1b[0m Tokens (${fmtBytes(totalChars)})`,
    `  \x1b[1m\x1b[33m✔ 插件直接去噪文本压缩率\x1b[0m : \x1b[1m\x1b[33m${ratio}%\x1b[0m [${bar(ratio, 16)}]`,
    `  \x1b[1m\x1b[32m✔ 折合预计减免费用\x1b[0m       : \x1b[1m\x1b[32m$${cost.toFixed(4)} USD\x1b[0m (基准单价 $1.00/1M Tokens)`,
    ...(ctx.isContextBloated ? [
      `  \x1b[1m${ctx.bloatLevel === 'severe' ? '\x1b[31m' : '\x1b[33m'}⚠ [历史上下文膨胀预警]\x1b[0m : ${ctx.bloatMessage}`
    ] : []),
    `  \x1b[90m• 累计触发压缩拦截: ${fmtNum(stats.totalInvocations)} 次 | 当前会话轮次: ${fmtNum(ctx.plannerResponsesCount || 0)} | 实时更新于: ${new Date(stats.updatedAt).toLocaleTimeString()}\x1b[0m`,
    '',
    '\x1b[1m── 七大核心引擎贡献细分 (7-Core Engine Contribution) ─────────────────────\x1b[0m',
    `  • \x1b[1mCard 1: RTK 终端与测试去噪\x1b[0m    : ${fmtNum(rtkTokens).padStart(9)} Tokens (${rtkPct.padStart(5)}%) [${bar(rtkPct, 12)}]`,
    `  • \x1b[1mCard 2: Headroom 结构折叠\x1b[0m     : ${fmtNum(headroomTokens).padStart(9)} Tokens (${headroomPct.padStart(5)}%) [${bar(headroomPct, 12)}]`,
    `  • \x1b[1mCard 3: Tools 缓存对齐瘦身\x1b[0m   : ${fmtNum(schemaTokens).padStart(9)} Tokens (${schemaPct.padStart(5)}%) [${bar(schemaPct, 12)}]`,
    `    \x1b[90m(参数字典严格排序对齐: ${stats.modules.schema?.alignedToolsCount || 0} 个工具 | 锁定 Prompt Cache 前缀)\x1b[0m`,
    `  • \x1b[1mCard 4: llmtrim 会话缓存固化\x1b[0m : ${fmtNum(cacheZoneTokens).padStart(9)} Tokens [锁定命中: ${kvRatio}%]`,
    `    \x1b[90m(会话前缀字节流锁定: 活跃 | 原厂 KV Cache 固化保护: ${stats.modules.cacheZone?.hits || 0} 次)\x1b[0m`,
    `  • \x1b[1mCard 5: PowerShell 报错去噪\x1b[0m   : ${fmtNum(psTokens).padStart(9)} Tokens (${psPct.padStart(5)}%) [${bar(psPct, 12)}]`,
    `    \x1b[90m(已自动拦截修复 Windows 命令语法陷阱: ${stats.modules.powershell?.fixedCommandsCount || 0} 次)\x1b[0m`,
    `  • \x1b[1mCard 6: Aider AST 与沙盒检索\x1b[0m  : ${fmtNum(aiderTokens).padStart(9)} Tokens (${aiderPct.padStart(5)}%) [${bar(aiderPct, 12)}]`,
    `    \x1b[90m(Repo Map: ${stats.modules.aider?.repoMapCount || 0} 次 | 代码骨架: ${stats.modules.aider?.skeletonsCount || 0} 次 | FTS5 沙盒: ${stats.modules.aider?.ftsSearchCount || 0} 次)\x1b[0m`,
    `  • \x1b[1mCard 7: OpenCode-DCP 历史剪枝\x1b[0m: ${fmtNum(kompactTokens).padStart(9)} Tokens (${kompactPct.padStart(5)}%) [${bar(kompactPct, 12)}]`,
    `    \x1b[90m(多轮历史重复读/旧快照/过期输出剪枝: ${stats.modules.kompact?.prunedToolOutputsCount || 0} 条 | CCR 可逆暂存)\x1b[0m`,
    ''
  ];

  if (stats.recentEvents && stats.recentEvents.length > 0) {
    lines.push('\x1b[1m── 最近压缩事件 (Recent Events) ──────────────────────────────────────────\x1b[0m');
    stats.recentEvents.slice(0, 8).forEach((ev, idx) => {
      const timeStr = new Date(ev.timestamp).toLocaleTimeString();
      const modLabel = (ev.module || 'rtk').toUpperCase();
      const detail = ev.note ? ` (${ev.note})` : (ev.command ? ` [${ev.command.slice(0, 28)}]` : '');
      lines.push(`  ${idx + 1}. [${timeStr}] [${modLabel}] 节省 ${fmtNum(ev.savedTokens)} Tokens (${fmtBytes(ev.savedChars)})${detail}`);
    });
    lines.push('');
  }

  lines.push('\x1b[90m数据持久化路径: ' + getStatsFilePath() + '\x1b[0m\n');
  return lines.join('\n');
}

module.exports = {
  estimateTokens,
  getStatsFilePath,
  getEventsFilePath,
  loadStats,
  flushStats,
  recordSavings,
  recordCacheZoneHit,
  recordBatchSavings,
  recordPowerShellFix,
  recordSchemaAlignment,
  resetStats,
  getStats,
  formatDashboard
};
