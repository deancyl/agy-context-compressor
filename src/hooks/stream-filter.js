#!/usr/bin/env node
/**
 * Stream Filter for Antigravity Tool Commands
 * Reads stdin, applies context compaction, and streams to stdout.
 * Real-time flush ensures telemetry is instantly written before process exits.
 */

const { compactOutput } = require('../core/compactor');
const { flushStats } = require('../core/telemetry');

let input = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', chunk => {
  input += chunk;
});

process.stdin.on('end', () => {
  if (!input) {
    flushStats();
    return;
  }
  const compacted = compactOutput(input);
  process.stdout.write(compacted);
  flushStats();
});
