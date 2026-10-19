const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { generateRepoMap, extractSymbolOutline } = require('../src/core/skeleton');

test('extractSymbolOutline: extracts classes and functions with line numbers', () => {
  const code = `
const path = require('path');

class UserManager {
  constructor(db) {
    this.db = db;
  }

  async findUser(id) {
    return this.db.query(id);
  }
}

function helper(a, b) {
  return a + b;
}
`;

  const symbols = extractSymbolOutline(code, 'user.js');
  assert.ok(symbols.length >= 2, 'Must extract at least class and function');
  assert.ok(symbols.some(s => s.includes('class UserManager')));
  assert.ok(symbols.some(s => s.includes('function helper')));
  assert.ok(symbols.some(s => s.includes('[Line ')));
});

test('generateRepoMap: recursively scans directory and generates clean AST map', () => {
  const tmpDir = path.join(os.tmpdir(), `agy-test-repomap-${Date.now()}`);
  fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(tmpDir, 'node_modules', 'fake-lib'), { recursive: true });

  fs.writeFileSync(path.join(tmpDir, 'src', 'index.js'), `
class App {
  start() {}
}
function bootstrap() {}
`, 'utf8');

  // File inside node_modules should be ignored
  fs.writeFileSync(path.join(tmpDir, 'node_modules', 'fake-lib', 'index.js'), `
class Junk {}
`, 'utf8');

  try {
    const res = generateRepoMap(tmpDir);
    assert.strictEqual(res.fileCount, 1);
    assert.ok(res.symbolCount >= 2);
    assert.ok(res.map.includes('Codebase Repo Map'));
    assert.ok(res.map.includes('src/index.js'));
    assert.ok(res.map.includes('class App'));
    assert.ok(res.map.includes('bootstrap'));
    // Must NOT include node_modules
    assert.strictEqual(res.map.includes('node_modules'), false);
    assert.strictEqual(res.map.includes('Junk'), false);
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});
