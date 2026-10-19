#!/usr/bin/env node
/**
 * Antigravity Hook Runner
 * Reads AGY hook JSON payload from stdin, routes to handler, outputs result to stdout.
 * Implements 100% fail-safe fallback: any exception defaults to {"decision": "allow"}.
 */

const { handlePreToolUse } = require('./pre-tool-use');
const { handlePreInvocation } = require('./pre-invocation');

const hookType = process.argv[2] || 'pre-tool-use';

let inputData = '';
process.stdin.setEncoding('utf8');

process.stdin.on('data', chunk => {
  inputData += chunk;
});

process.stdin.on('end', () => {
  try {
    const payload = inputData ? JSON.parse(inputData) : {};
    let response = { decision: 'allow' };

    if (hookType === 'pre-tool-use') {
      response = handlePreToolUse(payload);
    } else if (hookType === 'pre-invocation') {
      response = handlePreInvocation(payload);
    }

    process.stdout.write(JSON.stringify(response));
  } catch (err) {
    // Fail-safe: Always allow tool execution if hook fails
    const fallback = hookType === 'pre-invocation' ? { injectSteps: [] } : { decision: 'allow' };
    process.stdout.write(JSON.stringify(fallback));
  }
});
