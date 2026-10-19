const os = require('node:os');
const path = require('node:path');
process.env.AGY_COMPRESSION_STATS_FILE = path.join(os.tmpdir(), `agy-test-stats-${Date.now()}.json`);

const test = require('node:test');
const assert = require('node:assert');
const {
  estimateTokens,
  recordSavings,
  recordPowerShellFix,
  sanitizeLegacyStats,
  resetStats,
  getStats,
  formatDashboard
} = require('../src/core/telemetry');
const { analyzeTranscriptCache } = require('../src/core/cache-zone');

test('estimateTokens: calculates tokens accurately for English/code and CJK', () => {
  const code = 'function helloWorld() { return 42; }'; // 36 chars
  assert.strictEqual(estimateTokens(code), 9);

  const cjk = '这是一个测试用例'; // 8 CJK chars -> 8 / 1.25 = 6.4 -> 6
  assert.strictEqual(estimateTokens(cjk), 6);

  assert.strictEqual(estimateTokens(380), 100);
});

test('recordSavings: updates totalSavedChars, savedTokens, and module metrics', () => {
  resetStats();

  recordSavings('rtk', 380, 1000);
  let stats = getStats();
  assert.strictEqual(stats.totalSavedChars, 380);
  assert.strictEqual(stats.savedTokens, 100);
  assert.strictEqual(stats.modules.rtk.savedChars, 380);
  assert.strictEqual(stats.modules.rtk.savedTokens, 100);

  recordSavings('headroom', 760, 1000);
  stats = getStats();
  assert.strictEqual(stats.totalSavedChars, 380 + 760);
  assert.strictEqual(stats.savedTokens, 300);
  assert.strictEqual(stats.modules.headroom.savedTokens, 200);
  assert.ok(stats.savedCostUSD > 0);
});

test('recordPowerShellFix: increments fixed commands counter without adding 0-token clutter to recentEvents', () => {
  resetStats();
  recordPowerShellFix();
  recordPowerShellFix();

  const stats = getStats();
  assert.strictEqual(stats.modules.powershell.fixedCommandsCount, 2);
  assert.strictEqual(stats.recentEvents.length, 0);
});

test('sanitizeLegacyStats: cleans polluted cacheZone.savedTokens, test clutter, and diluted compressionRatio', () => {
  const legacyStats = {
    totalOriginalChars: 8254866,
    totalCompressedChars: 7777196,
    totalSavedChars: 632104,
    savedTokens: 166520,
    compressionRatio: 7.7,
    modules: {
      cacheZone: {
        savedChars: 383646496,
        savedTokens: 106568471,
        hits: 875,
        memoHits: 0,
        upstreamKvCacheTokens: 114400523
      }
    },
    recentEvents: [
      { module: 'rtk', savedChars: 13, savedTokens: 3, command: 'Get-ChildItem' },
      { module: 'headroom', savedChars: 14251, savedTokens: 3750, filename: 'agy-test-large-12345.js' },
      { module: 'rtk', savedChars: 2625, savedTokens: 691, command: 'node test_router.js' }
    ]
  };

  const dirty = sanitizeLegacyStats(legacyStats);
  assert.strictEqual(dirty, true);
  assert.strictEqual(legacyStats.modules.cacheZone.savedTokens, 0);
  assert.strictEqual(legacyStats.modules.cacheZone.savedChars, 0);
  assert.strictEqual(legacyStats.recentEvents.length, 1);
  assert.strictEqual(legacyStats.recentEvents[0].command, 'node test_router.js');
  assert.ok(legacyStats.compressionRatio >= 50);
});

test('analyzeTranscriptCache: does not false-trigger bloat alert when latestTurnTokens is healthy (52,221)', () => {
  const fs = require('node:fs');
  const tmpTranscript = path.join(os.tmpdir(), `agy-bloat-test-${Date.now()}.jsonl`);
  const lines = [];
  for (let i = 0; i < 120; i++) {
    lines.push(JSON.stringify({ type: 'PLANNER_RESPONSE', input_tokens: 2221, cache_read_tokens: 50000, output_tokens: 300 }));
  }
  fs.writeFileSync(tmpTranscript, lines.join('\n'), 'utf8');
  try {
    const res = analyzeTranscriptCache(tmpTranscript);
    assert.strictEqual(res.plannerResponsesCount, 120);
    assert.strictEqual(res.latestTurnTokens, 52221);
    assert.strictEqual(res.isContextBloated, false);
    assert.strictEqual(res.bloatLevel, 'normal');
  } finally {
    try { fs.unlinkSync(tmpTranscript); } catch (_) {}
  }
});

test('formatDashboard: renders clean colorized dashboard without throwing', () => {
  resetStats();
  recordSavings('rtk', 500, 1000);
  recordSavings('headroom', 2000, 3000);
  recordPowerShellFix();

  const dashboard = formatDashboard();
  assert.ok(dashboard.includes('Google Antigravity - Context Compression Dashboard'));
  assert.ok(dashboard.includes('全会话处理上下文总体量'));
  assert.ok(dashboard.includes('终端与结构去噪直接节省'));
  assert.ok(dashboard.includes('Card 1: RTK'));
  assert.ok(dashboard.includes('Card 2: Headroom'));
  assert.ok(dashboard.includes('Card 3: Tools'));
  assert.ok(dashboard.includes('Card 4: llmtrim'));
  assert.ok(dashboard.includes('Card 5: PowerShell'));
});

test('recordBatchSavings: records originalChars and totalInvocations exactly once across multiple modules', () => {
  resetStats();
  const { recordBatchSavings } = require('../src/core/telemetry');

  recordBatchSavings({
    originalChars: 10000,
    moduleDeltas: {
      rtk: 1000,
      powershell: 500,
      headroom: 500
    }
  });

  const stats = getStats();
  assert.strictEqual(stats.totalOriginalChars, 10000);
  assert.strictEqual(stats.totalSavedChars, 2000);
  assert.strictEqual(stats.totalCompressedChars, 8000);
  assert.strictEqual(stats.totalInvocations, 1);
  assert.strictEqual(stats.compressionRatio, 20.0);

  assert.strictEqual(stats.modules.rtk.savedChars, 1000);
  assert.strictEqual(stats.modules.powershell.savedChars, 500);
  assert.strictEqual(stats.modules.headroom.savedChars, 500);
});

test('resetStats: clears stats to initial zero state and empties event logs', () => {
  const { recordBatchSavings, getEventsFilePath } = require('../src/core/telemetry');
  recordBatchSavings({
    originalChars: 5000,
    moduleDeltas: { rtk: 1000 }
  });

  let stats = getStats();
  assert.ok(stats.totalSavedChars > 0);

  resetStats();
  stats = getStats();
  assert.strictEqual(stats.totalSavedChars, 0);
  assert.strictEqual(stats.totalOriginalChars, 0);
  assert.strictEqual(stats.savedTokens, 0);
  assert.strictEqual(stats.totalInvocations, 0);
  assert.strictEqual(stats.modules.rtk.savedChars, 0);
  assert.strictEqual(stats.modules.schema.alignedToolsCount, 0);
  assert.strictEqual(stats.recentEvents.length, 0);

  const fs = require('node:fs');
  const eventsFile = getEventsFilePath();
  if (fs.existsSync(eventsFile)) {
    const content = fs.readFileSync(eventsFile, 'utf8');
    assert.strictEqual(content.trim(), '');
  }
});
