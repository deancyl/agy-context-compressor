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

test('searchSandbox: provides surrounding context snippets when contextLines is specified', () => {
  const tmpFile = path.join(os.tmpdir(), `agy-test-fts-ctx-${Date.now()}.txt`);
  const content = [
    'line 1: import config',
    'line 2: const db = connect()',
    'line 3: function handleRequest() {',
    'line 4:   const user = auth();',
    'line 5:   return user;',
    'line 6: }',
    'line 7: export default handleRequest;'
  ].join('\n');

  fs.writeFileSync(tmpFile, content, 'utf8');

  try {
    const result = searchSandbox({
      targetPath: tmpFile,
      query: 'handleRequest',
      maxResults: 5,
      contextLines: 2
    });

    assert.ok(result.matches.length >= 1);
    const m = result.matches[0];
    assert.ok(m.context, 'context snippet must be provided');
    assert.ok(m.context.includes('const db = connect()'));
    assert.ok(m.startLine <= 2);
    assert.ok(m.endLine >= 4);
  } finally {
    try { fs.unlinkSync(tmpFile); } catch (_) {}
  }
});

