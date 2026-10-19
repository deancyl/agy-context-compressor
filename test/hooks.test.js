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
  assert.ok(response.overwrite.CommandLine.includes('curl.exe '));
  assert.ok(response.overwrite.CommandLine.includes('"C:\\data\\\\"'));
});

test('handlePreToolUse: automatically wraps high-noise test commands with agy-exec-wrapper.js', () => {
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
  assert.ok(response.overwrite.CommandLine.includes('agy-exec-wrapper.js'));
  assert.ok(response.overwrite.CommandLine.includes('-- npm test'));
});

test('handlePreToolUse: supports legacy usePipeFilter mode if specified', () => {
  const payload = {
    toolCall: {
      name: 'run_command',
      args: {
        CommandLine: 'npm test'
      }
    }
  };

  const response = handlePreToolUse(payload, { usePipeFilter: true });
  assert.strictEqual(response.decision, 'allow');
  assert.ok(response.overwrite);
  assert.ok(response.overwrite.CommandLine.includes('npm test | node '));
  assert.ok(response.overwrite.CommandLine.includes('stream-filter.js'));
});

test('handlePreToolUse: narrows lockfiles in view_file without slice parameters', () => {
  const lockfilePayload = {
    toolCall: {
      name: 'view_file',
      args: {
        AbsolutePath: 'C:/project/package-lock.json'
      }
    }
  };

  const response = handlePreToolUse(lockfilePayload);
  assert.strictEqual(response.decision, 'allow');
  assert.ok(response.overwrite);
  assert.strictEqual(response.overwrite.StartLine, 1);
  assert.strictEqual(response.overwrite.EndLine, 200);
});

test('handlePreToolUse: leaves clean commands and normal source files untouched', () => {
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

test('handlePreToolUse: uses --base64 wrapping when command contains complex operators like && or quotes', () => {
  const payload = {
    toolCall: {
      name: 'run_command',
      args: {
        CommandLine: 'npm test && git status'
      }
    }
  };

  const response = handlePreToolUse(payload);
  assert.strictEqual(response.decision, 'allow');
  assert.ok(response.overwrite);
  assert.ok(response.overwrite.CommandLine.includes('--base64'));

  // Extract the base64 token and verify decoded string matches
  const match = response.overwrite.CommandLine.match(/--base64\s+([A-Za-z0-9+/=]+)/);
  assert.ok(match, 'base64 payload must be present');
  const decoded = Buffer.from(match[1], 'base64').toString('utf8');
  assert.ok(decoded.includes('npm test') && decoded.includes('git status'));
});

test('agy-exec-wrapper: decodes base64 command and executes cleanly with exit code preserved', () => {
  const { execSync } = require('node:child_process');
  const path = require('node:path');
  const wrapperPath = path.resolve(__dirname, '../bin/agy-exec-wrapper.js');

  const cmdToRun = 'node -e "process.stdout.write(\'hello-from-wrapper\\n\')"';
  const b64 = Buffer.from(cmdToRun, 'utf8').toString('base64');

  const stdout = execSync(`node "${wrapperPath}" --base64 ${b64}`, { encoding: 'utf8' });
  assert.ok(stdout.includes('hello-from-wrapper'));
});
