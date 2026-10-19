const test = require('node:test');
const assert = require('node:assert');
const { createLineStreamFilter } = require('../src/core/compactor');
const { resetStats, getStats } = require('../src/core/telemetry');

test('createLineStreamFilter: folds passing test lines arriving across separate streaming chunks', () => {
  const emittedChunks = [];
  const filter = createLineStreamFilter({
    onEmit: text => emittedChunks.push(text),
    options: { recordTelemetry: false }
  });

  // Stream 5 pass lines, each arriving in its own chunk
  filter.write('✓ test 1 passed (2ms)\n');
  filter.write('✓ test 2 passed (3ms)\n');
  filter.write('✓ test 3 passed (1ms)\n');
  filter.write('✓ test 4 passed (4ms)\n');
  filter.write('✓ test 5 passed (2ms)\n');

  // Because all 5 are pass lines, none should have been emitted yet (they are accumulating in the run)
  assert.strictEqual(emittedChunks.length, 0);

  // Send a non-pass line (failure)
  filter.write('✕ test 6 failed: timeout\n');

  // Now the 5 passes should have flushed as a single folded line, followed by the failure
  assert.strictEqual(emittedChunks.length, 2);
  assert.ok(emittedChunks[0].includes('[Test suite: 5 passed tests folded (✓ / PASS / ok)]'));
  assert.strictEqual(emittedChunks[1].trim(), '✕ test 6 failed: timeout');

  filter.end();
});

test('createLineStreamFilter: folds passes on stream end when no failures occur', () => {
  const emittedChunks = [];
  const filter = createLineStreamFilter({
    onEmit: text => emittedChunks.push(text),
    options: { recordTelemetry: false }
  });

  filter.write('PASS test/unit/alpha.test.js (45ms)\n');
  filter.write('PASS test/unit/beta.test.js (32ms)\n');
  filter.write('PASS test/unit/gamma.test.js (28ms)\n');
  filter.write('PASS test/unit/delta.test.js (60ms)\n');
  filter.write('PASS test/unit/epsilon.test.js (15ms)\n');
  filter.write('PASS test/unit/zeta.test.js (22ms)\n');

  assert.strictEqual(emittedChunks.length, 0);

  const summary = filter.end();
  assert.strictEqual(emittedChunks.length, 1);
  assert.ok(emittedChunks[0].includes('[Test suite: 6 passed tests folded (✓ / PASS / ok)]'));
  assert.ok(summary.savedChars > 0);
  assert.ok(summary.rawCharsIn > summary.emittedCharsOut);
});

test('createLineStreamFilter: emits uncompressed lines and stack traces immediately without delay', () => {
  const emittedChunks = [];
  const filter = createLineStreamFilter({
    onEmit: text => emittedChunks.push(text),
    options: { recordTelemetry: false }
  });

  filter.write('Starting application...\n');
  assert.strictEqual(emittedChunks.length, 1);
  assert.strictEqual(emittedChunks[0].trim(), 'Starting application...');

  filter.write('Error: connection refused at 127.0.0.1:8080\n');
  assert.strictEqual(emittedChunks.length, 2);
  assert.strictEqual(emittedChunks[1].trim(), 'Error: connection refused at 127.0.0.1:8080');

  filter.end();
});

test('createLineStreamFilter: folds giant package-lock.json diff streams into CCR chunk', () => {
  const emittedChunks = [];
  const filter = createLineStreamFilter({
    onEmit: text => emittedChunks.push(text),
    options: { recordTelemetry: false }
  });

  filter.write('diff --git a/package-lock.json b/package-lock.json\n');
  filter.write('index 1122334..5566778 100644\n');
  filter.write('--- a/package-lock.json\n');
  filter.write('+++ b/package-lock.json\n');
  filter.write('@@ -10,12 +10,12 @@\n');
  for (let i = 0; i < 15; i++) {
    filter.write(`+    "@pkg/dep-${i}": "^1.0.${i}",\n`);
  }

  // Still accumulating diff lines
  assert.strictEqual(emittedChunks.length, 0);

  const summary = filter.end();
  assert.strictEqual(emittedChunks.length, 1);
  assert.ok(emittedChunks[0].includes('[Git Diff: package-lock.json diff folded (20 lines)]'));
  assert.ok(emittedChunks[0].includes('CCR: agy_retrieve_chunk'));
  assert.ok(summary.savedChars > 0);
});

test('createLineStreamFilter: never folds lockfile diff with merge conflicts (<<<<<<<)', () => {
  const emittedChunks = [];
  const filter = createLineStreamFilter({
    onEmit: text => emittedChunks.push(text),
    options: { recordTelemetry: false }
  });

  filter.write('diff --git a/package-lock.json b/package-lock.json\n');
  filter.write('index 1122334..5566778 100644\n');
  filter.write('--- a/package-lock.json\n');
  filter.write('+++ b/package-lock.json\n');
  filter.write('@@ -10,12 +10,12 @@\n');
  filter.write('<<<<<<< HEAD\n');
  filter.write('+    "version": "1.0.1"\n');
  filter.write('=======\n');
  filter.write('+    "version": "2.0.0"\n');
  filter.write('>>>>>>> feature-branch\n');

  filter.end();
  // Must NOT fold - conflict markers must be 100% visible
  const allEmitted = emittedChunks.join('');
  assert.ok(!allEmitted.includes('diff folded'));
  assert.ok(allEmitted.includes('<<<<<<< HEAD'));
  assert.ok(allEmitted.includes('>>>>>>> feature-branch'));
});

