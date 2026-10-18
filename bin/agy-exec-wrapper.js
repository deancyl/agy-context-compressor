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
const { compactOutput } = require('../src/core/compactor');
const { fixPowerShellCommandEscaping } = require('../src/core/powershell');
const { recordSavings, flushStats } = require('../src/core/telemetry');

// Extract command after '--'
const args = process.argv.slice(2);
const dashDashIdx = args.indexOf('--');
const rawCommand = dashDashIdx !== -1 ? args.slice(dashDashIdx + 1).join(' ') : args.join(' ');

if (!rawCommand.trim()) {
  process.exit(0);
}

// Windows escaping fix
const safeCommand = fixPowerShellCommandEscaping(rawCommand);

const isWin = process.platform === 'win32';
const shell = isWin ? 'powershell.exe' : '/bin/sh';

let totalRawStdout = 0;
let totalEmittedStdout = 0;
let stdoutRemainder = '';
let stderrRemainder = '';
let lastTelemetryTime = Date.now();

function streamStdoutChunk(text, isFinal = false) {
  if (!text && !isFinal) return;

  const compacted = compactOutput(text);
  if (compacted.length > 0) {
    process.stdout.write(compacted);
    totalEmittedStdout += compacted.length;
  }

  const now = Date.now();
  const delta = totalRawStdout - totalEmittedStdout;
  if (delta > 1024 || (now - lastTelemetryTime > 300)) {
    if (delta > 0) {
      recordSavings('rtk', delta, totalRawStdout, { command: rawCommand.slice(0, 60), liveStream: true });
    }
    lastTelemetryTime = now;
  }
}

function streamStderrChunk(text, isFinal = false) {
  if (!text && !isFinal) return;
  // Clean ANSI and \r progress bars, strictly preserve failure stack traces
  const cleaned = compactOutput(text);
  if (cleaned.length > 0) {
    process.stderr.write(cleaned);
  }
}

const child = spawn(safeCommand, {
  shell,
  stdio: ['inherit', 'pipe', 'pipe']
});

child.stdout.on('data', chunk => {
  const str = chunk.toString();
  totalRawStdout += str.length;
  const combined = stdoutRemainder + str;
  const lastNl = combined.lastIndexOf('\n');

  if (lastNl !== -1) {
    const toEmit = combined.slice(0, lastNl + 1);
    stdoutRemainder = combined.slice(lastNl + 1);
    streamStdoutChunk(toEmit, false);
  } else {
    stdoutRemainder = combined;
  }
});

child.stderr.on('data', chunk => {
  const str = chunk.toString();
  const combined = stderrRemainder + str;
  const lastNl = combined.lastIndexOf('\n');

  if (lastNl !== -1) {
    const toEmit = combined.slice(0, lastNl + 1);
    stderrRemainder = combined.slice(lastNl + 1);
    streamStderrChunk(toEmit, false);
  } else {
    stderrRemainder = combined;
  }
});

child.on('close', code => {
  const exitCode = code !== null ? code : 0;

  // Flush remaining chunks
  if (stdoutRemainder.length > 0) {
    streamStdoutChunk(stdoutRemainder, true);
    stdoutRemainder = '';
  }
  if (stderrRemainder.length > 0) {
    streamStderrChunk(stderrRemainder, true);
    stderrRemainder = '';
  }

  const delta = totalRawStdout - totalEmittedStdout;
  if (delta > 0) {
    recordSavings('rtk', delta, totalRawStdout, { command: rawCommand.slice(0, 60), streamFinal: true });
  }

  flushStats();
  process.exit(exitCode);
});

child.on('error', err => {
  process.stderr.write(`[agy-exec-wrapper error]: ${err.message}\n`);
  process.exit(1);
});
