const test = require('node:test');
const assert = require('node:assert');
const { stripAnsi, cleanProgressBars, foldTestPasses, cleanDockerOutput, cleanTerraformOutput } = require('../src/core/rtk');

test('stripAnsi: removes color codes and terminal controls', () => {
  const colored = '\u001b[31mRed Text\u001b[0m and \u001b[1;32mBold Green\u001b[0m';
  assert.strictEqual(stripAnsi(colored), 'Red Text and Bold Green');
});

test('cleanProgressBars: cleans \\r overwrite frames while preserving line endings', () => {
  const progress = 'Downloading: 10%\rDownloading: 50%\rDownloading: 100%\r\nDone\r\n';
  const cleaned = cleanProgressBars(progress);
  assert.strictEqual(cleaned, 'Downloading: 100%\r\nDone\r\n');
});

test('foldTestPasses: folds passing tests while 100% preserving failures and stack traces', () => {
  const suite = [
    '✓ test case 1 passed (5ms)',
    '✓ test case 2 passed (3ms)',
    '✓ test case 3 passed (4ms)',
    '✓ test case 4 passed (2ms)',
    '✕ test case 5 failed',
    '    AssertionError: expected true to be false',
    '        at Context.<anonymous> (test/app.test.js:42:10)'
  ].join('\n');

  const folded = foldTestPasses(suite);
  assert.ok(folded.includes('[Test suite: 4 passed tests folded (✓ / PASS / ok)]'));
  assert.ok(folded.includes('✕ test case 5 failed'));
  assert.ok(folded.includes('AssertionError: expected true to be false'));
  assert.ok(folded.includes('at Context.<anonymous> (test/app.test.js:42:10)'));
});

test('cleanDockerOutput: folds multi-layer download lines', () => {
  const dockerLog = [
    'a1b2c3d4: Pulling fs layer',
    'a1b2c3d4: Downloading [=====> ] 1.2MB',
    'a1b2c3d4: Download complete',
    'a1b2c3d4: Pull complete',
    'Status: Downloaded newer image for node:18-alpine'
  ].join('\n');

  const cleaned = cleanDockerOutput(dockerLog);
  assert.ok(cleaned.includes('[Docker: 4 layer download/extract status lines folded]'));
  assert.ok(cleaned.includes('Status: Downloaded newer image'));
});

test('cleanTerraformOutput: folds resource refreshing lines', () => {
  const tfLog = [
    'aws_instance.web: Refreshing state... [id=i-123]',
    'aws_instance.db: Refreshing state... [id=i-456]',
    'aws_s3_bucket.data: Refreshing state... [id=b-789]',
    'Plan: 1 to add, 0 to change, 0 to destroy.'
  ].join('\n');

  const cleaned = cleanTerraformOutput(tfLog);
  assert.ok(cleaned.includes('[Terraform: 3 resource state refresh lines folded]'));
  assert.ok(cleaned.includes('Plan: 1 to add'));
});
