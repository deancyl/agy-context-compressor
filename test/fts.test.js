const test = require('node:test');
const assert = require('node:assert');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { searchSandbox } = require('../src/core/fts');

test('searchSandbox: finds matching lines in target file using SQLite FTS5 or fallback', () => {
  const tmpFile = path.join(os.tmpdir(), `agy-test-fts-${Date.now()}.txt`);
  const content = [
    'Initializing server...',
    'Database connected to PostgreSQL',
    'User authentication token generated',
    'Error: Connection timeout at remote host 10.0.0.1',
    'Shutting down gracefully'
  ].join('\n');

  fs.writeFileSync(tmpFile, content, 'utf8');

  const result = searchSandbox({
    targetPath: tmpFile,
    query: 'timeout',
    maxResults: 5
  });

  assert.strictEqual(result.totalLines, 5);
  assert.strictEqual(result.matches.length, 1);
  assert.strictEqual(result.matches[0].lineNumber, 4);
  assert.ok(result.matches[0].line.includes('Connection timeout'));

  try { fs.unlinkSync(tmpFile); } catch (_) {}
});

test('searchSandbox: handles missing file or invalid query safely', () => {
  const missing = searchSandbox({
    targetPath: 'C:/non_existent_file_path.log',
    query: 'test'
  });
  assert.ok(missing.error);
  assert.strictEqual(missing.matches.length, 0);
});
