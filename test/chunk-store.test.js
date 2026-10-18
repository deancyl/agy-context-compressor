const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

// Set isolated chunk test dir
process.env.AGY_CHUNK_DIR = path.join(os.tmpdir(), `agy-test-chunks-${Date.now()}`);

const { storeChunk, retrieveChunk, generateChunkId } = require('../src/core/chunk-store');

test('generateChunkId: produces deterministic 8-char sha256 id', () => {
  const id1 = generateChunkId('hello world');
  const id2 = generateChunkId('hello world');
  assert.strictEqual(id1, id2);
  assert.ok(id1.startsWith('chk_'));
  assert.strictEqual(id1.length, 12); // 'chk_' + 8 hex chars
});

test('storeChunk and retrieveChunk: 100% reversible retrieval', () => {
  const original = 'line 1\nline 2\nline 3\nline 4\nline 5';
  const chunkId = storeChunk(original, { test: true });
  assert.ok(chunkId);

  // Retrieve full
  const full = retrieveChunk(chunkId);
  assert.strictEqual(full.isFound, true);
  assert.strictEqual(full.content, original);
  assert.strictEqual(full.totalLines, 5);

  // Retrieve slice lines 2-4
  const slice = retrieveChunk(chunkId, 2, 4);
  assert.strictEqual(slice.isFound, true);
  assert.strictEqual(slice.content, 'line 2\nline 3\nline 4');
  assert.strictEqual(slice.startLine, 2);
  assert.strictEqual(slice.endLine, 4);
});

test('retrieveChunk: handles non-existent or invalid chunk gracefully', () => {
  const missing = retrieveChunk('chk_missing_999');
  assert.strictEqual(missing.isFound, false);
  assert.ok(missing.content.includes('not found'));
});
