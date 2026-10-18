/**
 * Hook Manager for AGY Context Compressor
 * Provides atomic, self-verifying installation, uninstallation, and backup restoration.
 * Strict Redline: Must verify that installation actually works and restoration completely reverts!
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const HOOK_RUNNER_PATH = path.resolve(__dirname, '..', 'hooks', 'hook-runner.js');

function getGlobalHooksPath() {
  const home = os.homedir();
  return path.join(home, '.gemini', 'config', 'hooks.json');
}

function getProjectHooksPath() {
  return path.join(process.cwd(), '.agents', 'hooks.json');
}

function getHooksPath(target = 'global') {
  return target === 'global' ? getGlobalHooksPath() : getProjectHooksPath();
}

/**
 * Checks whether the hook is currently configured in the target hooks file.
 * @param {'global'|'project'} [target='global']
 * @returns {boolean}
 */
function isHookInstalled(target = 'global') {
  const hooksFile = getHooksPath(target);
  if (!fs.existsSync(hooksFile)) return false;
  try {
    const content = fs.readFileSync(hooksFile, 'utf8');
    const json = JSON.parse(content);
    return Boolean(
      json &&
      json['agy-context-compressor'] &&
      json['agy-context-compressor'].enabled !== false &&
      Array.isArray(json['agy-context-compressor'].PreToolUse)
    );
  } catch (_) {
    return false;
  }
}

/**
 * Tests live execution of the hook runner with an actual test payload via stdin.
 * Verifies that the command can be spawned, handles stdin, and returns valid JSON.
 * @returns {{ success: boolean, reason?: string, output?: object }}
 */
function verifyHookExecution() {
  if (!fs.existsSync(HOOK_RUNNER_PATH)) {
    return { success: false, reason: `Hook runner file missing at: ${HOOK_RUNNER_PATH}` };
  }

  const testPayload = JSON.stringify({
    toolCall: {
      name: 'run_command',
      args: {
        CommandLine: 'curl "C:\\data\\"'
      }
    },
    stepIdx: 1
  });

  try {
    const res = spawnSync(process.execPath, [HOOK_RUNNER_PATH, 'pre-tool-use'], {
      input: testPayload,
      encoding: 'utf8',
      timeout: 3000
    });

    if (res.error) {
      return { success: false, reason: `Process execution error: ${res.error.message}` };
    }
    if (res.status !== 0) {
      return { success: false, reason: `Hook exited with non-zero code: ${res.status}. Stderr: ${res.stderr}` };
    }

    const stdout = (res.stdout || '').trim();
    if (!stdout) {
      return { success: false, reason: 'Hook returned empty stdout' };
    }

    const parsed = JSON.parse(stdout);
    if (!parsed || parsed.decision !== 'allow') {
      return { success: false, reason: `Unexpected decision returned: ${JSON.stringify(parsed)}` };
    }

    // Verify that the PowerShell fix actually kicked in:
    const cmd = parsed.overwrite && parsed.overwrite.CommandLine;
    const isWindows = process.platform === 'win32';
    if (isWindows && (!cmd || !cmd.includes('curl.exe') || !cmd.includes('C:\\data\\\\'))) {
      return { success: false, reason: `PowerShell escaping fix failed to trigger on Windows test. Output: ${cmd}` };
    }

    return { success: true, output: parsed };
  } catch (err) {
    return { success: false, reason: `Verification exception: ${err.message}` };
  }
}

/**
 * Installs the PreToolUse hook into the target hooks.json.
 * Automatically backs up existing file, writes atomically, and self-verifies live execution.
 * @param {'global'|'project'} [target='global']
 * @returns {{ success: boolean, path: string, backupPath: string|null, verified: boolean }}
 */
function installHook(target = 'global') {
  const hooksFile = getHooksPath(target);
  const dir = path.dirname(hooksFile);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let existingContent = '{}';
  let hadExisting = false;
  let backupPath = null;

  if (fs.existsSync(hooksFile)) {
    existingContent = fs.readFileSync(hooksFile, 'utf8');
    hadExisting = true;
    const ts = Date.now();
    backupPath = `${hooksFile}.bak_${ts}`;
    fs.writeFileSync(backupPath, existingContent, 'utf8');
    fs.writeFileSync(`${hooksFile}.bak`, existingContent, 'utf8'); // Latest backup pointer
  }

  let hooksConfig = {};
  try {
    hooksConfig = hadExisting ? JSON.parse(existingContent) : {};
  } catch (err) {
    throw new Error(`无法解析现有 ${hooksFile}，可能是非标 JSON: ${err.message}`);
  }

  // Preserve all other hooks, only add or update agy-context-compressor
  const hookCommand = `node "${HOOK_RUNNER_PATH.replace(/\\/g, '/')}" pre-tool-use`;
  hooksConfig['agy-context-compressor'] = {
    enabled: true,
    PreToolUse: [
      {
        matcher: 'run_command|view_file|grep_search',
        hooks: [
          {
            type: 'command',
            command: hookCommand,
            timeout: 10
          }
        ]
      }
    ]
  };

  const serialized = JSON.stringify(hooksConfig, null, 2);
  const tmpFile = `${hooksFile}.tmp_${process.pid}`;
  fs.writeFileSync(tmpFile, serialized, 'utf8');
  fs.renameSync(tmpFile, hooksFile);

  // Self-verification step: test live execution
  const testRes = verifyHookExecution();
  if (!testRes.success) {
    // Rollback immediately if verification fails
    if (hadExisting) {
      fs.writeFileSync(hooksFile, existingContent, 'utf8');
    } else {
      try { fs.unlinkSync(hooksFile); } catch (_) {}
    }
    throw new Error(`Hook 安装自校验失败，已自动回滚！原因: ${testRes.reason}`);
  }

  return {
    success: true,
    path: hooksFile,
    backupPath,
    verified: true
  };
}

/**
 * Completely uninstalls the PreToolUse hook from hooks.json.
 * Preserves all other user-configured hooks.
 * @param {'global'|'project'} [target='global']
 * @returns {{ success: boolean, path: string, hadOtherHooks: boolean }}
 */
function uninstallHook(target = 'global') {
  const hooksFile = getHooksPath(target);
  if (!fs.existsSync(hooksFile)) {
    return { success: true, path: hooksFile, hadOtherHooks: false, message: '文件不存在，无需卸载' };
  }

  const existingContent = fs.readFileSync(hooksFile, 'utf8');
  let hooksConfig = {};
  try {
    hooksConfig = JSON.parse(existingContent);
  } catch (err) {
    throw new Error(`无法解析现有 ${hooksFile}: ${err.message}`);
  }

  // Create pre-uninstall backup
  const ts = Date.now();
  fs.writeFileSync(`${hooksFile}.pre_uninstall_${ts}`, existingContent, 'utf8');

  // Check and delete agy-context-compressor
  const existed = Boolean(hooksConfig['agy-context-compressor']);
  delete hooksConfig['agy-context-compressor'];

  const remainingKeys = Object.keys(hooksConfig);
  const hadOtherHooks = remainingKeys.length > 0;

  if (hadOtherHooks) {
    fs.writeFileSync(hooksFile, JSON.stringify(hooksConfig, null, 2), 'utf8');
  } else {
    // If no other hooks exist, write clean empty object {}
    fs.writeFileSync(hooksFile, '{\n}\n', 'utf8');
  }

  // Verification step: verify it is truly gone
  const afterInstalled = isHookInstalled(target);
  if (afterInstalled) {
    throw new Error(`Hook 卸载校验失败，未能成功清除配置！`);
  }

  return {
    success: true,
    path: hooksFile,
    hadOtherHooks,
    existed
  };
}

/**
 * Restores the latest available backup of hooks.json.
 * @param {'global'|'project'} [target='global']
 * @returns {{ success: boolean, restoredFrom: string }}
 */
function restoreHookBackup(target = 'global') {
  const hooksFile = getHooksPath(target);
  const latestBak = `${hooksFile}.bak`;

  if (fs.existsSync(latestBak)) {
    const bakContent = fs.readFileSync(latestBak, 'utf8');
    // Verify backup content is valid JSON
    JSON.parse(bakContent);
    fs.writeFileSync(hooksFile, bakContent, 'utf8');
    return { success: true, restoredFrom: latestBak };
  }

  // Scan for timestamped backups
  const dir = path.dirname(hooksFile);
  const baseName = path.basename(hooksFile);
  const files = fs.readdirSync(dir).filter(f => f.startsWith(`${baseName}.bak_`)).sort().reverse();

  if (files.length > 0) {
    const candidate = path.join(dir, files[0]);
    const bakContent = fs.readFileSync(candidate, 'utf8');
    JSON.parse(bakContent);
    fs.writeFileSync(hooksFile, bakContent, 'utf8');
    return { success: true, restoredFrom: candidate };
  }

  throw new Error(`未找到可用的备份文件 (${hooksFile}.bak)`);
}

module.exports = {
  getHooksFilePath: getHooksPath,
  isHookInstalled,
  verifyHookExecution,
  installHook,
  uninstallHook,
  restoreHookBackup
};
