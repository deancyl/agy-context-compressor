const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  hashContent,
  getMemo,
  setMemo,
  clearSessionMemo,
  getMemoStats,
  analyzeTranscriptCache,
  handlePreInvocation,
  MAX_MEMO_SESSIONS,
  MAX_MEMO_KEYS_PER_SESSION
} = require('../src/core/cache-zone');

test('hashContent: returns deterministic 16-char sha256 prefix', () => {
  const hash1 = hashContent('test content string');
  const hash2 = hashContent('test content string');
  const hash3 = hashContent('different string');

  assert.strictEqual(hash1.length, 16);
  assert.strictEqual(hash1, hash2);
  assert.notStrictEqual(hash1, hash3);
});

test('sessionCompressionMemo: correctly sets, gets, and refreshes LRU within session', () => {
  const sid = 'session-test-01';
  clearSessionMemo(sid);

  assert.strictEqual(getMemo(sid, 'key1'), null);

  setMemo(sid, 'key1', 'compressed-value-1');
  assert.strictEqual(getMemo(sid, 'key1'), 'compressed-value-1');

  // Multi-key in session
  setMemo(sid, 'key2', 'compressed-value-2');
  assert.strictEqual(getMemo(sid, 'key2'), 'compressed-value-2');

  // Stats verification
  const stats = getMemoStats();
  assert.ok(stats.activeSessions >= 1);
  assert.ok(stats.totalKeys >= 2);

  // Clear specific session
  clearSessionMemo(sid);
  assert.strictEqual(getMemo(sid, 'key1'), null);
});

test('analyzeTranscriptCache: parses PLANNER_RESPONSE tokens and calculates KV Cache ratio', () => {
  const tmpDir = os.tmpdir();
  const transcriptFile = path.join(tmpDir, `transcript-test-${Date.now()}.jsonl`);

  const lines = [
    JSON.stringify({ step_index: 0, type: 'USER_INPUT', content: 'hello' }),
    JSON.stringify({ step_index: 1, type: 'PLANNER_RESPONSE', input_tokens: 1000, cache_read_tokens: 4000, output_tokens: 200 }),
    JSON.stringify({ step_index: 2, type: 'PLANNER_RESPONSE', input_tokens: 500, cache_read_tokens: 4500, output_tokens: 150 })
  ];

  fs.writeFileSync(transcriptFile, lines.join('\n'), 'utf8');

  try {
    const metrics = analyzeTranscriptCache(transcriptFile);
    assert.strictEqual(metrics.plannerResponsesCount, 2);
    assert.strictEqual(metrics.totalInputTokens, 1500);
    assert.strictEqual(metrics.totalCacheReadTokens, 8500);
    assert.strictEqual(metrics.totalOutputTokens, 350);
    // (8500 / 10000) * 100 = 85%
    assert.strictEqual(metrics.kvCacheHitRatio, 85);
  } finally {
    try { fs.unlinkSync(transcriptFile); } catch (_) {}
  }
});

test('handlePreInvocation: guarantees safe fail-safe structure to lock Prompt Cache', () => {
  const result = handlePreInvocation({ conversationId: 'c-123' });
  assert.deepStrictEqual(result, { injectSteps: [] });
});
