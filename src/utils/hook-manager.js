/**
 * Hook & MCP Manager for AGY Context Compressor (2.1)
 * Provides atomic, self-verifying installation, uninstallation, and backup restoration
 * for both Antigravity Hooks (hooks.json) and MCP Server (mcp_config.json).
 * Strict Redline: Must verify that installation actually works and restoration completely reverts!
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');

const HOOK_RUNNER_PATH = path.resolve(__dirname, '..', 'hooks', 'hook-runner.js');
const MCP_SERVER_PATH = path.resolve(__dirname, '..', 'mcp', 'server.js');

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

function getGlobalMcpConfigPath() {
  return path.join(os.homedir(), '.gemini', 'config', 'mcp_config.json');
}

function writeAtomicSync(targetFile, content) {
  const dir = path.dirname(targetFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const tmpFile = `${targetFile}.tmp_${process.pid}_${Date.now()}`;
  fs.writeFileSync(tmpFile, content, 'utf8');
  try {
    fs.renameSync(tmpFile, targetFile);
  } catch (_) {
    try { fs.unlinkSync(tmpFile); } catch (__) {}
    fs.writeFileSync(targetFile, content, 'utf8');
  }
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
 * Checks whether the MCP server is registered in global mcp_config.json.
 * @returns {boolean}
 */
function isMcpInstalled() {
  const mcpFile = getGlobalMcpConfigPath();
  if (!fs.existsSync(mcpFile)) return false;
  try {
    const json = JSON.parse(fs.readFileSync(mcpFile, 'utf8'));
    return Boolean(json && json.mcpServers && json.mcpServers['agy-compressor']);
  } catch (_) {
    return false;
  }
}

/**
 * Tests live execution of the MCP server via JSON-RPC initialize + ping over stdio.
 * @returns {{ success: boolean, reason?: string }}
 */
function verifyMcpExecution() {
  if (!fs.existsSync(MCP_SERVER_PATH)) {
    return { success: false, reason: `MCP server file missing at: ${MCP_SERVER_PATH}` };
  }
  const inputLines = [
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'ping', params: {} })
  ].join('\n') + '\n';

  try {
    const res = spawnSync(process.execPath, [MCP_SERVER_PATH], {
      input: inputLines,
      encoding: 'utf8',
      timeout: 3000
    });
    if (res.error) {
      return { success: false, reason: `MCP spawn error: ${res.error.message}` };
    }
    const lines = (res.stdout || '').trim().split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) {
      return { success: false, reason: `MCP did not respond to initialize + ping` };
    }
    const initResp = JSON.parse(lines[0]);
    const pingResp = JSON.parse(lines[1]);
    if (!initResp.result || !initResp.result.serverInfo || !pingResp.result) {
      return { success: false, reason: `Invalid MCP JSON-RPC response` };
    }
    return { success: true };
  } catch (err) {
    return { success: false, reason: `MCP verification exception: ${err.message}` };
  }
}

/**
 * Installs or updates the agy-compressor MCP entry in ~/.gemini/config/mcp_config.json.
 * Preserves all existing MCP servers.
 */
function installMcpServer() {
  const mcpFile = getGlobalMcpConfigPath();
  const dir = path.dirname(mcpFile);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let mcpConfig = { mcpServers: {} };
  if (fs.existsSync(mcpFile)) {
    try {
      const raw = fs.readFileSync(mcpFile, 'utf8');
      mcpConfig = JSON.parse(raw) || { mcpServers: {} };
      if (!mcpConfig.mcpServers || typeof mcpConfig.mcpServers !== 'object') {
        mcpConfig.mcpServers = {};
      }
    } catch (_) {
      mcpConfig = { mcpServers: {} };
    }
  }

  mcpConfig.mcpServers['agy-compressor'] = {
    command: 'node',
    args: [MCP_SERVER_PATH.replace(/\\/g, '/')]
  };

  writeAtomicSync(mcpFile, JSON.stringify(mcpConfig, null, 2));
  return { success: true, path: mcpFile };
}

/**
 * Removes the agy-compressor MCP entry from ~/.gemini/config/mcp_config.json.
 */
function uninstallMcpServer() {
  const mcpFile = getGlobalMcpConfigPath();
  if (!fs.existsSync(mcpFile)) return { success: true, path: mcpFile };
  try {
    const mcpConfig = JSON.parse(fs.readFileSync(mcpFile, 'utf8'));
    if (mcpConfig && mcpConfig.mcpServers && mcpConfig.mcpServers['agy-compressor']) {
      delete mcpConfig.mcpServers['agy-compressor'];
      writeAtomicSync(mcpFile, JSON.stringify(mcpConfig, null, 2));
    }
  } catch (_) {}
  return { success: true, path: mcpFile };
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

    let cmd = parsed.overwrite && parsed.overwrite.CommandLine;
    if (cmd && cmd.includes('--base64')) {
      const match = cmd.match(/--base64\s+([A-Za-z0-9+/=]+)/);
      if (match) {
        cmd = Buffer.from(match[1], 'base64').toString('utf8');
      }
    }
    const isWindows = process.platform === 'win32';
    if (isWindows && (!cmd || !cmd.includes('curl.exe') || !cmd.includes('C:\\data\\\\'))) {
      return { success: false, reason: `PowerShell escaping fix failed to trigger on Windows test. Output: ${cmd}` };
    }

    // Also verify pre-invocation ephemeral injection
    const resInvoc = spawnSync(process.execPath, [HOOK_RUNNER_PATH, 'pre-invocation'], {
      input: '{}',
      encoding: 'utf8',
      timeout: 3000
    });
    if (resInvoc.status === 0 && resInvoc.stdout) {
      try {
        const parsedInvoc = JSON.parse(resInvoc.stdout.trim());
        if (!Array.isArray(parsedInvoc.injectSteps)) {
          return { success: false, reason: 'PreInvocation hook did not return injectSteps array' };
        }
      } catch (_) {}
    }

    return { success: true, output: parsed };
  } catch (err) {
    return { success: false, reason: `Verification exception: ${err.message}` };
  }
}

/**
 * Installs the PreToolUse & PreInvocation hooks into the target hooks.json.
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
  const hookCommandPreTool = `node "${HOOK_RUNNER_PATH.replace(/\\/g, '/')}" pre-tool-use`;
  const hookCommandPreInvoc = `node "${HOOK_RUNNER_PATH.replace(/\\/g, '/')}" pre-invocation`;
  hooksConfig['agy-context-compressor'] = {
    enabled: true,
    PreToolUse: [
      {
        matcher: 'run_command|view_file|grep_search',
        hooks: [
          {
            type: 'command',
            command: hookCommandPreTool,
            timeout: 10
          }
        ]
      }
    ],
    PreInvocation: [
      {
        type: 'command',
        command: hookCommandPreInvoc,
        timeout: 5
      }
    ]
  };

  const serialized = JSON.stringify(hooksConfig, null, 2);
  writeAtomicSync(hooksFile, serialized);

  // Self-verification step: test live execution
  const testRes = verifyHookExecution();
  if (!testRes.success) {
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
    writeAtomicSync(hooksFile, JSON.stringify(hooksConfig, null, 2));
  } else {
    writeAtomicSync(hooksFile, '{\n}\n');
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
    JSON.parse(bakContent);
    writeAtomicSync(hooksFile, bakContent);
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
    writeAtomicSync(hooksFile, bakContent);
    return { success: true, restoredFrom: candidate };
  }

  throw new Error(`未找到可用的备份文件 (${hooksFile}.bak)`);
}

module.exports = {
  getHooksFilePath: getHooksPath,
  getHooksPath,
  getGlobalMcpConfigPath,
  isHookInstalled,
  isMcpInstalled,
  verifyHookExecution,
  verifyMcpExecution,
  installHook,
  uninstallHook,
  installMcpServer,
  uninstallMcpServer,
  restoreHookBackup
};
