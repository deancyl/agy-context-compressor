const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const {
  isHookInstalled,
  verifyHookExecution,
  installHook,
  uninstallHook,
  restoreHookBackup
} = require('../src/utils/hook-manager');

// Sandbox test directory
const TEST_SANDBOX_DIR = path.join(os.tmpdir(), `agy_test_hooks_${Date.now()}`);

test('verifyHookExecution: self-tests live hook runner process', () => {
  const result = verifyHookExecution();
  assert.strictEqual(result.success, true, `Hook verification failed: ${result.reason}`);
  assert.strictEqual(result.output.decision, 'allow');
  if (process.platform === 'win32') {
    assert.ok(result.output.overwrite.CommandLine.includes('curl.exe'));
    assert.ok(result.output.overwrite.CommandLine.includes('C:\\data\\\\'));
  }
});

test('Round-trip verification: install, preserve other hooks, uninstall, and restore', () => {
  // Use project mode in the sandbox directory
  const originalCwd = process.cwd();
  try {
    fs.mkdirSync(path.join(TEST_SANDBOX_DIR, '.agents'), { recursive: true });
    process.chdir(TEST_SANDBOX_DIR);

    const hooksFile = path.join(TEST_SANDBOX_DIR, '.agents', 'hooks.json');

    // 1. Initial state: Pre-populate with another unrelated user hook
    const initialUserHooks = {
      'user-linter': {
        enabled: true,
        PreToolUse: [{ matcher: 'run_command', hooks: [{ type: 'command', command: 'eslint' }] }]
      }
    };
    fs.writeFileSync(hooksFile, JSON.stringify(initialUserHooks, null, 2), 'utf8');

    assert.strictEqual(isHookInstalled('project'), false);

    // 2. Test 一键开启 (installHook)
    const installRes = installHook('project');
    assert.strictEqual(installRes.success, true);
    assert.strictEqual(installRes.verified, true);
    assert.strictEqual(isHookInstalled('project'), true);

    // Verify existing user hook was preserved
    const installedContent = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
    assert.ok(installedContent['user-linter'], 'User linter hook must be preserved');
    assert.ok(installedContent['agy-context-compressor'], 'Compressor hook must be added');

    // 3. Test 一键恢复/卸载 (uninstallHook)
    const uninstallRes = uninstallHook('project');
    assert.strictEqual(uninstallRes.success, true);
    assert.strictEqual(isHookInstalled('project'), false);

    // Verify user hook is STILL preserved after uninstall
    const uninstalledContent = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
    assert.ok(uninstalledContent['user-linter'], 'User linter hook must remain intact');
    assert.strictEqual(uninstalledContent['agy-context-compressor'], undefined);

    // 4. Test 一键从备份还原 (restoreHookBackup)
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
      // Install
      const ins = installHook('project');
      assert.strictEqual(ins.success, true);
      assert.strictEqual(ins.verified, true);
      assert.strictEqual(isHookInstalled('project'), true);

      // Uninstall
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
