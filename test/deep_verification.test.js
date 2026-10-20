const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const { stripBodyFromSignature, extractJavaScriptSkeleton } = require('../src/core/skeleton');
const { sanitizeLegacyStats, loadStats, flushStats, getStatsFilePath } = require('../src/core/telemetry');
const { handlePreToolUse } = require('../src/hooks/pre-tool-use');

// --- Verification 1: Function Default Parameter cfg = {} & Complex Signatures ---
test('v2.3 Verification 1: stripBodyFromSignature handles nested {} in default parameters', () => {
  const cases = [
    {
      input: 'function configureAdapter(cfg = {}) {',
      expected: 'function configureAdapter(cfg = {})'
    },
    {
      input: 'async function initClient(url, options = { timeout: 5000, retry: true }, cb = (err) => {}) {',
      expected: 'async function initClient(url, options = { timeout: 5000, retry: true }, cb = (err) => {})'
    },
    {
      input: 'const formatData = (items = [], meta = {}) => {',
      expected: 'const formatData = (items = [], meta = {}) =>'
    },
    {
      input: 'class Service { async process(data = { a: 1, b: { c: 2 } }, strict = false) {',
      expected: 'class Service { async process(data = { a: 1, b: { c: 2 } }, strict = false)'
    }
  ];

  for (const c of cases) {
    const res = stripBodyFromSignature(c.input);
    assert.strictEqual(res, c.expected, `Failed for input: ${c.input}`);
    assert.ok(!res.endsWith('{'), `Signature should not end with body brace: ${res}`);
    assert.ok(res.includes('{}') || res.includes('timeout: 5000') || res.includes('c: 2'), `Default params must be preserved: ${res}`);
  }
});

// --- Verification 2: Super-long Function Line Spans & Local Closure Filtering ---
test('v2.3 Verification 2: extractJavaScriptSkeleton handles >1000 line functions and filters inner closures', () => {
  // Generate a mock file with 1,200 lines
  const lines = [
    '// Top-level comments',
    'async function runTests() {'
  ];
  for (let i = 0; i < 1100; i++) {
    if (i === 50) {
      lines.push('  const onError = (err) => {');
      lines.push('    console.error(err);');
      lines.push('  };');
    } else {
      lines.push(`  const x_${i} = ${i};`);
    }
  }
  lines.push('}'); // line 1104
  lines.push('const topLevelExport = (val) => { return val * 2; };'); // line 1105

  const skeleton = extractJavaScriptSkeleton(lines.join('\n'));

  // 1. runTests should have a multi-line span tag extending beyond 1000 lines
  assert.ok(skeleton.includes('[Line 2-1105]'), `Should have full span [Line 2-1105], got:\n${skeleton}`);

  // 2. Inner closure onError should NOT be in the top-level outline
  assert.ok(!skeleton.includes('onError'), `Inner closure onError should be filtered out from skeleton`);

  // 3. topLevelExport should be present
  assert.ok(skeleton.includes('topLevelExport'), `Top-level arrow function must be preserved`);
});

// --- Verification 3: Slice Inspection Actual Read Size vs Whole File ---
test('v2.3 Verification 3: slice inspection only tracks actual read bytes, not 500KB file size', () => {
  const tmpFile = path.join(os.tmpdir(), `agy_test_slice_${Date.now()}.js`);
  // Create a 200KB mock file with 5,000 lines
  const fileLines = [];
  for (let i = 1; i <= 5000; i++) {
    fileLines.push(`function dummyFunc_${i}() { return ${i}; }`);
  }
  fs.writeFileSync(tmpFile, fileLines.join('\n'), 'utf8');
  const fullSize = fs.statSync(tmpFile).size;
  assert.ok(fullSize > 150000, `File should be >150KB, is ${fullSize}`);

  // Simulate reading a 15-line slice
  const res = handlePreToolUse({
    toolCall: {
      name: 'view_file',
      args: {
        Path: tmpFile,
        StartLine: 100,
        EndLine: 114
      }
    }
  });

  assert.strictEqual(res.decision, 'allow');
  // Check the session reads state file
  const homeDir = os.homedir();
  const readsFile = path.join(homeDir, '.gemini', 'config', 'agy-session-reads.json');
  if (fs.existsSync(readsFile)) {
    const reads = JSON.parse(fs.readFileSync(readsFile, 'utf8'));
    const normKey = tmpFile.replace(/\\/g, '/').toLowerCase();
    const entry = reads.files?.[normKey];
    if (entry) {
      assert.ok(entry.lastReadChars < 2000, `lastReadChars should be ~600 chars, got: ${entry.lastReadChars}`);
      assert.strictEqual(entry.lastSlice, '100:114');
    }
  }

  try { fs.unlinkSync(tmpFile); } catch (_) {}
});

// --- Verification 4: Telemetry Legacy Stats Sanitizer ---
test('v2.3 Verification 4: sanitizeLegacyStats clears legacy 106M pollution and >40KB slice inflation', () => {
  const dirtyStats = {
    schemaVersion: 2.2,
    totalOriginalChars: 8500000,
    totalSavedChars: 1500000,
    savedTokens: 1340000,
    savedCostUSD: 1.34,
    compressionRatio: 17.6,
    modules: {
      rtk: { savedChars: 72000, savedTokens: 19000, invocations: 50 },
      headroom: { savedChars: 59000, savedTokens: 15000, invocations: 10 },
      schema: { savedChars: 740, savedTokens: 200, alignedToolsCount: 14 },
      cacheZone: { savedChars: 106568471, savedTokens: 106568471, memoHits: 0, upstreamKvCacheTokens: 8000000 },
      powershell: { savedChars: 41000, savedTokens: 11000, fixedCommandsCount: 300 },
      aider: { savedChars: 504597, savedTokens: 132000, repoMapCount: 1, skeletonsCount: 0, ftsSearchCount: 0 },
      kompact: { savedChars: 329673, savedTokens: 86000, prunedToolOutputsCount: 1 }
    },
    recentEvents: [
      { module: 'aider', savedChars: 504597, savedTokens: 132000, filename: 'test_router.js', note: 'extract_outline' },
      { module: 'kompact', savedChars: 329673, savedTokens: 86000, filename: 'context-compactor.js', note: 'dcp_superseded_stale_read' },
      { module: 'rtk', savedChars: 1729, savedTokens: 455, command: 'node --test' }
    ]
  };

  const modified = sanitizeLegacyStats(dirtyStats);
  assert.strictEqual(modified, true, 'Should mark dirtyStats as modified');

  // 1. cacheZone.savedTokens should be reset to 0
  assert.strictEqual(dirtyStats.modules.cacheZone.savedTokens, 0, 'cacheZone.savedTokens must be 0');
  assert.strictEqual(dirtyStats.modules.cacheZone.savedChars, 0, 'cacheZone.savedChars must be 0');

  // 2. >40KB slice inflated events must be filtered from recentEvents
  assert.strictEqual(dirtyStats.recentEvents.length, 1, 'Only genuine rtk event should remain');
  assert.strictEqual(dirtyStats.recentEvents[0].module, 'rtk');

  // 3. aider and kompact inflated values must be pruned
  assert.ok(dirtyStats.modules.aider.savedChars < 10000, 'aider savedChars must be recalibrated');
  assert.ok(dirtyStats.modules.kompact.savedChars < 10000, 'kompact savedChars must be recalibrated');

  // 4. Schema version updated
  assert.strictEqual(dirtyStats.schemaVersion, 2.3, 'schemaVersion must be 2.3');
});
