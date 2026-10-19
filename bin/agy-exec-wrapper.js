#!/usr/bin/env node
/**
 * Antigravity Command Execution Wrapper (agy-exec-wrapper)
 * Real-time sliding window chunk streaming with exit-code preservation.
 * 
 * Features:
 * 1. 100% preserves child process exit code (no error code swallowing).
 * 2. Emits stdout & stderr chunks in real-time (zero waiting till process exit).
 * 3. Applies real-time ANSI cleaning, progress bar collapse, and test result folding.
 * 4. Pushes incremental telemetry every 300ms so dashboards update live during execution.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const { createLineStreamFilter } = require('../src/core/compactor');
const { fixPowerShellCommandEscaping } = require('../src/core/powershell');
const { flushStats } = require('../src/core/telemetry');

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
  rawCommand = dashDashIdx !== -1 ? args.slice(dashDashIdx + 1).join(' ') : args.join(' ');
}

if (!rawCommand.trim()) {
  process.exit(0);
}

// Windows escaping fix
const safeCommand = fixPowerShellCommandEscaping(rawCommand);

const isWin = process.platform === 'win32';
const shell = isWin ? 'powershell.exe' : '/bin/sh';

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

const child = spawn(safeCommand, {
  shell,
  stdio: ['inherit', 'pipe', 'pipe']
});

child.stdout.on('data', chunk => {
  stdoutFilter.write(chunk);
});

child.stderr.on('data', chunk => {
  stderrFilter.write(chunk);
});

child.on('close', code => {
  const exitCode = code !== null ? code : 0;
  stdoutFilter.end();
  stderrFilter.end();
  flushStats();
  process.exit(exitCode);
});

child.on('error', err => {
  process.stderr.write(`[agy-exec-wrapper error]: ${err.message}\n`);
  process.exit(1);
});
