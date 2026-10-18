#!/usr/bin/env node
/**
 * Stream Filter for Antigravity Tool Commands
 * Reads stdin, applies context compaction, and streams to stdout.
 */

const { compactOutput } = require('../core/compactor');

let input = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', chunk => {
  input += chunk;
});

process.stdin.on('end', () => {
  if (!input) return;
  const compacted = compactOutput(input);
  process.stdout.write(compacted);
});
