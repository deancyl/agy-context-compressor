#!/usr/bin/env node
/**
 * Antigravity Hook Runner (2.1)
 * Reads AGY hook JSON payload from stdin, routes to handler, outputs result to stdout.
 *
 * Connection & Stability Guarantees:
 * 1. Redirects any accidental console.log/info/warn to stderr so stdout remains 100% pure JSON.
 * 2. Enforces a 4.5-second watchdog timer so slow I/O or hanging stdin never blocks AGY.
 * 3. Implements 100% fail-safe fallback: any exception defaults to {"decision": "allow"}.
 */

const rawStdoutWrite = process.stdout.write.bind(process.stdout);
// Prevent any internal or third-party console.log from corrupting AGY Hook JSON stdout
console.log = (...args) => process.stderr.write(args.join(' ') + '\n');
console.info = console.log;
console.debug = console.log;

const { handlePreToolUse } = require('./pre-tool-use');
const { handlePreInvocation } = require('./pre-invocation');

const hookType = process.argv[2] || 'pre-tool-use';
let hasResponded = false;

function sendSafeResponse(obj) {
  if (hasResponded) return;
  hasResponded = true;
  try {
    rawStdoutWrite(JSON.stringify(obj));
  } catch (_) {
    const fallback = hookType === 'pre-invocation' ? '{"injectSteps":[]}' : '{"decision":"allow"}';
    rawStdoutWrite(fallback);
  }
}

// Fail-safe watchdog: never let hook execution block AGY connection
const watchdog = setTimeout(() => {
  const fallback = hookType === 'pre-invocation' ? { injectSteps: [] } : { decision: 'allow' };
  sendSafeResponse(fallback);
  process.exit(0);
}, 4500);
if (typeof watchdog.unref === 'function') {
  watchdog.unref();
}

let inputData = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', chunk => {
  inputData += chunk;
});

process.stdin.on('end', () => {
  clearTimeout(watchdog);
  try {
    const trimmed = inputData ? inputData.trim() : '';
    const payload = trimmed ? JSON.parse(trimmed) : {};
    let response = { decision: 'allow' };

    if (hookType === 'pre-tool-use') {
      response = handlePreToolUse(payload);
    } else if (hookType === 'pre-invocation') {
      response = handlePreInvocation(payload);
    }

    sendSafeResponse(response);
  } catch (err) {
    // Fail-safe: Always allow tool execution if hook fails
    const fallback = hookType === 'pre-invocation' ? { injectSteps: [] } : { decision: 'allow' };
    sendSafeResponse(fallback);
  }
});

process.stdin.on('error', () => {
  clearTimeout(watchdog);
  const fallback = hookType === 'pre-invocation' ? { injectSteps: [] } : { decision: 'allow' };
  sendSafeResponse(fallback);
});
