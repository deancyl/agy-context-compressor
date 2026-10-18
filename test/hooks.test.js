const test = require('node:test');
const assert = require('node:assert');
const { handlePreToolUse } = require('../src/hooks/pre-tool-use');

test('handlePreToolUse: rewrites run_command with PowerShell escaping fixes', () => {
  const payload = {
    toolCall: {
      name: 'run_command',
      args: {
        CommandLine: 'curl "C:\\data\\" -o file.json'
      }
    }
  };

  const response = handlePreToolUse(payload, { targetPlatform: 'win32' });
  assert.strictEqual(response.decision, 'allow');
  assert.ok(response.overwrite);
  assert.ok(response.overwrite.CommandLine.startsWith('curl.exe '));
  assert.ok(response.overwrite.CommandLine.includes('"C:\\data\\\\"'));
});

test('handlePreToolUse: automatically wraps high-noise test commands with stream-filter.js', () => {
  const payload = {
    toolCall: {
      name: 'run_command',
      args: {
        CommandLine: 'npm test'
      }
    }
  };

  const response = handlePreToolUse(payload);
  assert.strictEqual(response.decision, 'allow');
  assert.ok(response.overwrite);
  assert.ok(response.overwrite.CommandLine.includes('npm test | node '));
  assert.ok(response.overwrite.CommandLine.includes('stream-filter.js'));
});

test('handlePreToolUse: leaves clean commands or non-run_command tools untouched', () => {
  const cleanPayload = {
    toolCall: {
      name: 'run_command',
      args: {
        CommandLine: 'echo "hello world"'
      }
    }
  };

  const cleanResp = handlePreToolUse(cleanPayload, { targetPlatform: 'win32' });
  assert.strictEqual(cleanResp.decision, 'allow');
  assert.strictEqual(cleanResp.overwrite, undefined);

  const viewFilePayload = {
    toolCall: {
      name: 'view_file',
      args: {
        AbsolutePath: 'C:/test/file.js'
      }
    }
  };

  const fileResp = handlePreToolUse(viewFilePayload);
  assert.strictEqual(fileResp.decision, 'allow');
  assert.strictEqual(fileResp.overwrite, undefined);
});
