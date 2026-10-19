const os = require('node:os');
const path = require('node:path');
process.env.AGY_COMPRESSION_STATS_FILE = path.join(os.tmpdir(), `agy-test-stats-${Date.now()}.json`);

const test = require('node:test');
const assert = require('node:assert');
const { estimateTokens, recordSavings, recordPowerShellFix, resetStats, getStats, formatDashboard } = require('../src/core/telemetry');

test('estimateTokens: calculates tokens accurately for English/code and CJK', () => {
  // English ~3.8 chars/token
  const code = 'function helloWorld() { return 42; }'; // 36 chars
  assert.strictEqual(estimateTokens(code), 9);

  // CJK ~1.25 chars/token
  const cjk = '这是一个测试用例'; // 8 CJK chars -> 8 / 1.25 = 6.4 -> 6
  assert.strictEqual(estimateTokens(cjk), 6);

  // Numeric char count
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

test('recordPowerShellFix: increments fixed commands counter', () => {
  resetStats();
  recordPowerShellFix();
  recordPowerShellFix();

  const stats = getStats();
  assert.strictEqual(stats.modules.powershell.fixedCommandsCount, 2);
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

  // Input of 10,000 characters with savings from 3 modules
  recordBatchSavings({
    originalChars: 10000,
    moduleDeltas: {
      rtk: 1000,
      powershell: 500,
      headroom: 500
    }
  });

  const stats = getStats();
  // Total original characters must be EXACTLY 10000, NOT 30000!
  assert.strictEqual(stats.totalOriginalChars, 10000);
  assert.strictEqual(stats.totalSavedChars, 2000);
  assert.strictEqual(stats.totalCompressedChars, 8000);
  assert.strictEqual(stats.totalInvocations, 1); // EXACTLY ONCE!
  // Ratio must be exactly (2000 / 10000) * 100 = 20.0%
  assert.strictEqual(stats.compressionRatio, 20.0);

  // Modules individually received their exact deltas
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
