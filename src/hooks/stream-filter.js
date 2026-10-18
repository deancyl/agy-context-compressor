#!/usr/bin/env node
/**
 * Stream Filter for Antigravity Tool Commands
 * Chunk-level sliding window streaming with real-time incremental telemetry.
 * Does NOT block until 'end' — emits output immediately and flushes stats periodically.
 */

const { compactOutput } = require('../core/compactor');
const { recordSavings, flushStats } = require('../core/telemetry');

let remainder = '';
let totalRaw = 0;
let totalEmitted = 0;
let lastFlushTime = Date.now();

function processLineChunk(chunkText, isFinal = false) {
  if (!chunkText && !isFinal) return;

  const compacted = compactOutput(chunkText);
  if (compacted.length > 0) {
    process.stdout.write(compacted);
    totalEmitted += compacted.length;
  }

  const now = Date.now();
  const delta = totalRaw - totalEmitted;
  // Push incremental telemetry every 300ms or 1KB saved
  if (delta > 1024 || (now - lastFlushTime > 300)) {
    if (delta > 0) {
      recordSavings('rtk', delta, totalRaw, { stream: true });
    }
    lastFlushTime = now;
  }
}

process.stdin.setEncoding('utf8');

process.stdin.on('data', chunk => {
  totalRaw += chunk.length;
  const combined = remainder + chunk;
  const lastNl = combined.lastIndexOf('\n');

  if (lastNl !== -1) {
    const toProcess = combined.slice(0, lastNl + 1);
    remainder = combined.slice(lastNl + 1);
    processLineChunk(toProcess, false);
  } else {
    remainder = combined;
  }
});

process.stdin.on('end', () => {
  if (remainder.length > 0) {
    processLineChunk(remainder, true);
    remainder = '';
  }
  const delta = totalRaw - totalEmitted;
  if (delta > 0) {
    recordSavings('rtk', delta, totalRaw, { streamFinal: true });
  }
  flushStats();
});
