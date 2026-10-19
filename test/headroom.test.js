const test = require('node:test');
const assert = require('node:assert');
const { isLockfilePath, foldLockfiles, foldStructuredData, encodeTOON, decodeTOON, compactSourceCode } = require('../src/core/headroom');

test('isLockfilePath: identifies common package manager lockfiles', () => {
  assert.strictEqual(isLockfilePath('package-lock.json'), true);
  assert.strictEqual(isLockfilePath('src/components/yarn.lock'), true);
  assert.strictEqual(isLockfilePath('Cargo.lock'), true);
  assert.strictEqual(isLockfilePath('go.sum'), true);
  assert.strictEqual(isLockfilePath('uv.lock'), true);
  assert.strictEqual(isLockfilePath('index.js'), false);
  assert.strictEqual(isLockfilePath('package.json'), false);
});

test('foldLockfiles: folds lockfile git diffs', () => {
  const diff = [
    'diff --git a/package-lock.json b/package-lock.json',
    'index 1234567..89abcdef 100644',
    '--- a/package-lock.json',
    '+++ b/package-lock.json',
    '@@ -10,6 +10,12 @@',
    '+    "lodash": "^4.17.21",',
    '+    "react": "^18.2.0",',
    '-    "old-dep": "^1.0.0",',
    '+    "axios": "^1.6.0",',
    '+    "zod": "^3.22.0",'
  ].join('\n');

  const folded = foldLockfiles(diff);
  assert.ok(folded.includes('[Lockfile diff folded: package-lock.json'));
});

test('foldLockfiles: ABSOLUTELY EXEMPTS Git merge conflicts from folding', () => {
  const conflictedDiff = [
    'diff --git a/package-lock.json b/package-lock.json',
    'index 1234567..89abcdef 100644',
    '--- a/package-lock.json',
    '+++ b/package-lock.json',
    '@@ -10,6 +10,12 @@',
    '<<<<<<< HEAD',
    '+    "lodash": "^4.17.21",',
    '=======',
    '+    "lodash": "^4.17.20",',
    '>>>>>>> main'
  ].join('\n');

  const result = foldLockfiles(conflictedDiff, { exemptMergeConflicts: true });
  // Must NOT be folded
  assert.strictEqual(result, conflictedDiff);
  assert.ok(!result.includes('[Lockfile diff folded:'));
});

test('foldStructuredData: folds large homogeneous JSON arrays while preserving schema', () => {
  const items = [];
  for (let i = 0; i < 60; i++) {
    items.push({ id: i, name: `item_${i}`, active: true });
  }
  const rawJson = JSON.stringify(items);
  const folded = foldStructuredData(rawJson, { maxStructuredItems: 50, structuredHeadCount: 3, structuredTailCount: 2 });

  const parsed = JSON.parse(folded);
  assert.strictEqual(parsed.length, 6); // 3 head + 1 summary + 2 tail
  assert.strictEqual(parsed[0].id, 0);
  assert.strictEqual(parsed[5].id, 59);
  assert.ok(parsed[3]._folded_summary.includes('SmartCrusher: 55 homogeneous items folded'));
});

test('encodeTOON and decodeTOON: lossless round-trip matrix compression for medium arrays', () => {
  const items = Array.from({ length: 20 }, (_, i) => ({
    id: i + 1,
    status: 'active',
    username: `user_${i + 1}`
  }));
  const rawJson = JSON.stringify(items, null, 2);
  const foldedToon = foldStructuredData(rawJson, { useTOON: true, maxStructuredItems: 50 });
  const parsedToon = JSON.parse(foldedToon);
  assert.strictEqual(parsedToon._format, 'TOON');
  assert.strictEqual(parsedToon.totalRows, 20);
  assert.ok(foldedToon.length < rawJson.length);

  const restored = decodeTOON(parsedToon);
  assert.deepStrictEqual(restored, items);
});

test('compactSourceCode: collapses excessive blank lines and trailing spaces without altering code', () => {
  const messy = 'const a = 1;   \n\n\n\nconst b = 2;\t\t\n';
  const cleaned = compactSourceCode(messy);
  assert.strictEqual(cleaned, 'const a = 1;\n\nconst b = 2;\n');
});
