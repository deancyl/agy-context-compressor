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
  assert.ok(dashboard.includes('累计节省 Token 数'));
  assert.ok(dashboard.includes('Card 1: RTK'));
  assert.ok(dashboard.includes('Card 2: Headroom'));
});
