#!/usr/bin/env node
/**
 * Stream Filter for Antigravity Tool Commands
 * Chunk-level sliding window streaming with real-time incremental telemetry.
 * Does NOT block until 'end' — emits output immediately and flushes stats periodically.
 */

const { createLineStreamFilter } = require('../core/compactor');
const { flushStats } = require('../core/telemetry');

const filter = createLineStreamFilter({
  onEmit: text => {
    process.stdout.write(text);
  },
  metadata: { filter: 'pipe-stream-filter' }
});

process.stdin.setEncoding('utf8');

process.stdin.on('data', chunk => {
  filter.write(chunk);
});

process.stdin.on('end', () => {
  filter.end();
  flushStats();
});
