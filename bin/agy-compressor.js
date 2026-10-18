#!/usr/bin/env node
/**
 * agy-compressor CLI & Doctor
 * Management utility for Antigravity Context Compressor.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');
const { compactOutput } = require('../src/core/compactor');
const { fixPowerShellCommandEscaping } = require('../src/core/powershell');

const args = process.argv.slice(2);
const command = args[0] || 'help';

const HOOK_RUNNER_PATH = path.resolve(__dirname, '..', 'src', 'hooks', 'hook-runner.js');

function getGlobalHooksPath() {
  const home = os.homedir();
  return path.join(home, '.gemini', 'config', 'hooks.json');
}

function getProjectHooksPath() {
  return path.join(process.cwd(), '.agents', 'hooks.json');
}

function installHook(target = 'global') {
  const hooksFile = target === 'global' ? getGlobalHooksPath() : getProjectHooksPath();
  const dir = path.dirname(hooksFile);

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  let hooksConfig = {};
  if (fs.existsSync(hooksFile)) {
    try {
      hooksConfig = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
      // Backup original
      fs.writeFileSync(`${hooksFile}.bak_${Date.now()}`, JSON.stringify(hooksConfig, null, 2));
    } catch (e) {
      console.warn(`[Warning] Existing hooks.json could not be parsed. Starting fresh.`);
    }
  }

  const hookCommand = `node "${HOOK_RUNNER_PATH.replace(/\\/g, '/')}" pre-tool-use`;

  // Inject or update hook
  hooksConfig['agy-context-compressor'] = {
    enabled: true,
    PreToolUse: [
      {
        matcher: 'run_command',
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

  fs.writeFileSync(hooksFile, JSON.stringify(hooksConfig, null, 2), 'utf8');
  console.log(`\x1b[32m✔ Successfully installed agy-context-compressor hook to:\x1b[0m ${hooksFile}`);
  console.log(`  Hook command: ${hookCommand}`);
}

function uninstallHook(target = 'global') {
  const hooksFile = target === 'global' ? getGlobalHooksPath() : getProjectHooksPath();
  if (!fs.existsSync(hooksFile)) {
    console.log(`No hooks file found at ${hooksFile}. Nothing to uninstall.`);
    return;
  }

  try {
    const hooksConfig = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
    if (hooksConfig['agy-context-compressor']) {
      delete hooksConfig['agy-context-compressor'];
      fs.writeFileSync(hooksFile, JSON.stringify(hooksConfig, null, 2), 'utf8');
      console.log(`\x1b[32m✔ Successfully removed agy-context-compressor hook from:\x1b[0m ${hooksFile}`);
    } else {
      console.log(`Hook not found in ${hooksFile}.`);
    }
  } catch (e) {
    console.error(`Failed to modify hooks file:`, e.message);
  }
}

function runDoctor() {
  console.log('\n\x1b[1m=== Antigravity Context Compressor: System Doctor ===\x1b[0m\n');

  // 1. Node.js Environment
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split('.')[0], 10);
  if (major >= 18) {
    console.log(`  \x1b[32m✔ Node.js Runtime:\x1b[0m ${nodeVersion} (Supported: >= 18.0.0)`);
  } else {
    console.log(`  \x1b[31m✖ Node.js Runtime:\x1b[0m ${nodeVersion} (Outdated, requires >= 18.0.0)`);
  }

  // 2. Antigravity Configuration
  const globalConfigDir = path.join(os.homedir(), '.gemini', 'config');
  if (fs.existsSync(globalConfigDir)) {
    console.log(`  \x1b[32m✔ Antigravity Global Config:\x1b[0m Found at ${globalConfigDir}`);
  } else {
    console.log(`  \x1b[33m! Antigravity Global Config:\x1b[0m Directory not created yet (${globalConfigDir})`);
  }

  // 3. Hook Status
  const globalHooks = getGlobalHooksPath();
  let installed = false;
  if (fs.existsSync(globalHooks)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(globalHooks, 'utf8'));
      if (cfg['agy-context-compressor'] && cfg['agy-context-compressor'].enabled !== false) {
        installed = true;
      }
    } catch (_) {}
  }
  if (installed) {
    console.log(`  \x1b[32m✔ PreToolUse Hook:\x1b[0m Active in ${globalHooks}`);
  } else {
    console.log(`  \x1b[33m! PreToolUse Hook:\x1b[0m Not installed globally. Run 'agy-compressor install --global' to enable.`);
  }

  // 4. Shell & Platform
  console.log(`  \x1b[32m✔ Host Platform:\x1b[0m ${process.platform} (${os.release()})`);

  // 5. Engine Health Check
  const sampleRaw = '\u001b[32m✔\u001b[0m test passed\r\n\u001b[32m✓\u001b[0m test 2 passed\r\n\u001b[32m✓\u001b[0m test 3 passed\r\n';
  const sampleCompacted = compactOutput(sampleRaw);
  const sampleEscape = fixPowerShellCommandEscaping('curl "C:\\test\\" -X GET');

  if (sampleCompacted.includes('passed tests folded') && sampleEscape.includes('curl.exe') && sampleEscape.includes('C:\\test\\\\')) {
    console.log(`  \x1b[32m✔ Core Compression Engines:\x1b[0m Self-test PASSED (RTK + PowerShell guards verified)`);
  } else {
    console.log(`  \x1b[31m✖ Core Compression Engines:\x1b[0m Self-test anomaly detected`);
  }

  console.log('\n\x1b[1mDoctor complete.\x1b[0m\n');
}

function showHelp() {
  console.log(`
agy-context-compressor - CLI Tool

Usage:
  agy-compressor <command> [options]

Commands:
  install [--global|--project]    Install the PreToolUse hook into Antigravity
  uninstall [--global|--project]  Remove the hook
  doctor                          Run environment and compression health diagnosis
  filter                          Read stdin, compact, and write to stdout
  help                            Show this help message
`);
}

switch (command) {
  case 'install':
    installHook(args[1] === '--project' ? 'project' : 'global');
    break;
  case 'uninstall':
    uninstallHook(args[1] === '--project' ? 'project' : 'global');
    break;
  case 'doctor':
    runDoctor();
    break;
  case 'filter':
    require('../src/hooks/stream-filter');
    break;
  case 'help':
  default:
    showHelp();
    break;
}
