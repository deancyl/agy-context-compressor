#!/usr/bin/env node
/**
 * Antigravity Command Execution Wrapper (agy-exec-wrapper 2.1)
 * Real-time sliding window chunk streaming with exit-code preservation & Chinese UTF-8 protection.
 *
 * Connection & Chinese Experience Guarantees:
 * 1. Forces UTF-8 output encoding in Windows PowerShell so Simplified Chinese logs/errors never garble into mojibake.
 * 2. Injects non-interactive environment variables (CI=true, GIT_PAGER=cat, PAGER=cat, PYTHONIOENCODING=utf-8)
 *    so commands never hang waiting for interactive pagers or watch modes.
 * 3. Uses an exit grace timer on child 'exit' so lingering background grandchild processes on Windows
 *    cannot hold stdio pipes open and freeze the AGY connection.
 * 4. 100% preserves child process exit code and streams stdout/stderr in real time.
 */

const { spawn } = require('node:child_process');
const { createLineStreamFilter } = require('../src/core/compactor');
const { fixPowerShellCommandEscaping } = require('../src/core/powershell');
const { flushStats } = require('../src/core/telemetry');

function joinShellArgs(tokens) {
  if (!Array.isArray(tokens) || tokens.length === 0) return '';
  if (tokens.length === 1) return tokens[0];
  return tokens
    .map(t => {
      if (/[\s()'"$;|&<>]/.test(t) && !/^["'].*["']$/.test(t)) {
        return `"${t.replace(/"/g, '\\"')}"`;
      }
      return t;
    })
    .join(' ');
}

// Extract command: support both '--base64 <b64>' and '-- <rawCommand>'
const args = process.argv.slice(2);
let rawCommand = '';
const b64Idx = args.indexOf('--base64');
if (b64Idx !== -1 && args[b64Idx + 1]) {
  try {
    rawCommand = Buffer.from(args[b64Idx + 1], 'base64').toString('utf8');
  } catch (_) {
    rawCommand = '';
  }
} else {
  const dashDashIdx = args.indexOf('--');
  const cmdTokens = dashDashIdx !== -1 ? args.slice(dashDashIdx + 1) : args;
  rawCommand = joinShellArgs(cmdTokens);
}

if (!rawCommand.trim()) {
  process.exit(0);
}

// Windows escaping fix
const safeCommand = fixPowerShellCommandEscaping(rawCommand);

const isWin = process.platform === 'win32';
const shell = isWin ? 'powershell.exe' : '/bin/sh';

// On Windows PowerShell, enforce UTF-8 console encoding so Simplified Chinese characters never garble
const finalCommand = isWin
  ? `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; $OutputEncoding = [System.Text.Encoding]::UTF8; ${safeCommand}`
  : safeCommand;

const stdoutFilter = createLineStreamFilter({
  onEmit: text => {
    process.stdout.write(text);
  },
  metadata: { command: rawCommand.slice(0, 60), stream: 'stdout' }
});

const stderrFilter = createLineStreamFilter({
  onEmit: text => {
    process.stderr.write(text);
  },
  options: {
    // Strictly preserve error stack traces on stderr
    foldTestPasses: false
  },
  metadata: { command: rawCommand.slice(0, 60), stream: 'stderr' }
});

const childEnv = {
  ...process.env,
  PYTHONIOENCODING: 'utf-8',
  PYTHONUTF8: '1',
  GIT_PAGER: 'cat',
  PAGER: 'cat',
  CI: process.env.CI || 'true'
};

const child = spawn(finalCommand, {
  shell,
  env: childEnv,
  stdio: ['ignore', 'pipe', 'pipe']
});

let finalized = false;
let exitGraceTimer = null;

function finalizeAndExit(code) {
  if (finalized) return;
  finalized = true;
  if (exitGraceTimer) clearTimeout(exitGraceTimer);
  const exitCode = typeof code === 'number' ? code : 0;
  try {
    stdoutFilter.end();
    stderrFilter.end();
    flushStats();
  } catch (_) {}
  process.exit(exitCode);
}

child.stdout.on('data', chunk => {
  stdoutFilter.write(chunk);
});

child.stderr.on('data', chunk => {
  stderrFilter.write(chunk);
});

// If the child exits but a detached grandchild keeps stdio open, close cleanly after 250ms grace
child.on('exit', code => {
  exitGraceTimer = setTimeout(() => {
    try { child.stdout.destroy(); } catch (_) {}
    try { child.stderr.destroy(); } catch (_) {}
    finalizeAndExit(code);
  }, 250);
  if (typeof exitGraceTimer.unref === 'function') {
    exitGraceTimer.unref();
  }
});

child.on('close', code => {
  finalizeAndExit(code);
});

child.on('error', err => {
  process.stderr.write(`[agy-exec-wrapper error]: ${err.message}\n`);
  finalizeAndExit(1);
});

process.on('SIGINT', () => {
  try { child.kill('SIGINT'); } catch (_) {}
  finalizeAndExit(130);
});

process.on('SIGTERM', () => {
  try { child.kill('SIGTERM'); } catch (_) {}
  finalizeAndExit(143);
});
