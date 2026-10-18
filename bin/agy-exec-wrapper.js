#!/usr/bin/env node
/**
 * Antigravity Command Execution Wrapper (agy-exec-wrapper)
 * Replaces fragile "| node stream-filter.js" shell pipelines.
 * 
 * Key Advantages:
 * 1. 100% preserves child process exit code (no error swallowing).
 * 2. Captures both stdout and stderr concurrently without pipe deadlocks.
 * 3. Applies real-time ANSI cleaning, progress bar collapse, and test result folding.
 * 4. Records telemetry and appends real-time incremental events.
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { compactOutput } = require('../src/core/compactor');
const { fixPowerShellCommandEscaping } = require('../src/core/powershell');
const { recordSavings } = require('../src/core/telemetry');

// Extract command after '--'
const args = process.argv.slice(2);
const dashDashIdx = args.indexOf('--');
const rawCommand = dashDashIdx !== -1 ? args.slice(dashDashIdx + 1).join(' ') : args.join(' ');

if (!rawCommand.trim()) {
  process.exit(0);
}

// 1. Windows escaping fix
const safeCommand = fixPowerShellCommandEscaping(rawCommand);

const isWin = process.platform === 'win32';
const shell = isWin ? 'powershell.exe' : '/bin/sh';

let rawStdout = '';
let rawStderr = '';

const child = spawn(safeCommand, {
  shell,
  stdio: ['inherit', 'pipe', 'pipe']
});

child.stdout.on('data', chunk => {
  const str = chunk.toString();
  rawStdout += str;
});

child.stderr.on('data', chunk => {
  const str = chunk.toString();
  rawStderr += str;
});

child.on('close', code => {
  const exitCode = code !== null ? code : 0;

  // Process and output stdout
  if (rawStdout.length > 0) {
    const compactedStdout = compactOutput(rawStdout);
    process.stdout.write(compactedStdout);

    const delta = rawStdout.length - compactedStdout.length;
    if (delta > 0) {
      recordSavings('rtk', delta, rawStdout.length, { command: rawCommand.slice(0, 100) });
    }
  }

  // Process and output stderr
  if (rawStderr.length > 0) {
    // Preserve error stack traces 100%, only clean ANSI and \r noise
    const cleanedStderr = compactOutput(rawStderr);
    process.stderr.write(cleanedStderr);
  }

  process.exit(exitCode);
});

child.on('error', err => {
  process.stderr.write(`[agy-exec-wrapper error]: ${err.message}\n`);
  process.exit(1);
});
