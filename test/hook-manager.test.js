const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  isHookInstalled,
  verifyHookExecution,
  verifyMcpExecution,
  installHook,
  uninstallHook,
  restoreHookBackup
} = require('../src/utils/hook-manager');
const {
  runCompressionBenchmark,
  registerCompressionStage,
  unregisterCompressionStage
} = require('../src/core/compactor');

const TEST_SANDBOX_DIR = path.join(os.tmpdir(), `agy_test_hooks_${Date.now()}`);

test('verifyHookExecution & verifyMcpExecution: self-tests live hook runner and MCP server stdio handshake', () => {
  const result = verifyHookExecution();
  assert.strictEqual(result.success, true, `Hook verification failed: ${result.reason}`);
  assert.strictEqual(result.output.decision, 'allow');
  if (process.platform === 'win32') {
    const cmd = result.output.overwrite.CommandLine;
    const b64Match = cmd.match(/--base64\s+([A-Za-z0-9+/=]+)/);
    const actualCmd = b64Match ? Buffer.from(b64Match[1], 'base64').toString('utf8') : cmd;
    assert.ok(actualCmd.includes('curl.exe'));
    assert.ok(actualCmd.includes('C:\\data\\\\'));
  }

  const mcpResult = verifyMcpExecution();
  assert.strictEqual(mcpResult.success, true, `MCP verification failed: ${mcpResult.reason}`);
});

test('runCompressionBenchmark & custom stage plugin registry: verifies all 5 core engines and extensibility', () => {
  const bench = runCompressionBenchmark();
  assert.strictEqual(bench.allPassed, true);
  assert.strictEqual(bench.scenarios.length, 5);
  assert.ok(bench.overallRatio > 60);

  registerCompressionStage({
    name: 'custom-banner-strip',
    module: 'rtk',
    fn: (text) => text.replace(/=== NOISE BANNER ===\n/g, '')
  });
  const { compactOutput } = require('../src/core/compactor');
  const out = compactOutput('=== NOISE BANNER ===\nHello Clean World', { recordTelemetry: false });
  assert.strictEqual(out, 'Hello Clean World');
  unregisterCompressionStage('custom-banner-strip');
});

test('Round-trip verification: install, preserve other hooks, uninstall, and restore', () => {
  const originalCwd = process.cwd();
  try {
    fs.mkdirSync(path.join(TEST_SANDBOX_DIR, '.agents'), { recursive: true });
    process.chdir(TEST_SANDBOX_DIR);

    const hooksFile = path.join(TEST_SANDBOX_DIR, '.agents', 'hooks.json');

    const initialUserHooks = {
      'user-linter': {
        enabled: true,
        PreToolUse: [{ matcher: 'run_command', hooks: [{ type: 'command', command: 'eslint' }] }]
      }
    };
    fs.writeFileSync(hooksFile, JSON.stringify(initialUserHooks, null, 2), 'utf8');

    assert.strictEqual(isHookInstalled('project'), false);

    // Install
    const installRes = installHook('project');
    assert.strictEqual(installRes.success, true);
    assert.strictEqual(installRes.verified, true);
    assert.strictEqual(isHookInstalled('project'), true);

    const installedContent = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
    assert.ok(installedContent['user-linter'], 'User linter hook must be preserved');
    assert.ok(installedContent['agy-context-compressor'], 'Compressor hook must be added');

    // Uninstall
    const uninstallRes = uninstallHook('project');
    assert.strictEqual(uninstallRes.success, true);
    assert.strictEqual(isHookInstalled('project'), false);

    const uninstalledContent = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
    assert.ok(uninstalledContent['user-linter'], 'User linter hook must remain intact');
    assert.strictEqual(uninstalledContent['agy-context-compressor'], undefined);

    // Restore from backup
    const restoreRes = restoreHookBackup('project');
    assert.strictEqual(restoreRes.success, true);
    const restoredContent = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
    assert.deepStrictEqual(restoredContent, initialUserHooks);

  } finally {
    process.chdir(originalCwd);
    try {
      fs.rmSync(TEST_SANDBOX_DIR, { recursive: true, force: true });
    } catch (_) {}
  }
});

test('Repeated stress test: 5 consecutive install and uninstall cycles without degradation', () => {
  const originalCwd = process.cwd();
  const stressDir = path.join(os.tmpdir(), `agy_stress_${Date.now()}`);
  try {
    fs.mkdirSync(path.join(stressDir, '.agents'), { recursive: true });
    process.chdir(stressDir);

    for (let i = 0; i < 5; i++) {
      const ins = installHook('project');
      assert.strictEqual(ins.success, true);
      assert.strictEqual(ins.verified, true);
      assert.strictEqual(isHookInstalled('project'), true);

      const unins = uninstallHook('project');
      assert.strictEqual(unins.success, true);
      assert.strictEqual(isHookInstalled('project'), false);
    }
  } finally {
    process.chdir(originalCwd);
    try {
      fs.rmSync(stressDir, { recursive: true, force: true });
    } catch (_) {}
  }
});
