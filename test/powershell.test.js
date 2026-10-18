const test = require('node:test');
const assert = require('node:assert');
const { cleanPowerShellNoise, fixPowerShellCommandEscaping } = require('../src/core/powershell');

test('cleanPowerShellNoise: decodes and extracts clean error from #< CLIXML', () => {
  const clixml = [
    '#< CLIXML',
    '<Objs Version="1.1.0.1" xmlns="http://schemas.microsoft.com/powershell/2004/04">',
    '<S S="Error">Get-ChildItem : Cannot find path _x0027_C:\\missing_x0027__x000D__x000A_</S>',
    '<S S="Error">At line:1 char:1_x000D__x000A_</S>',
    '</Objs>'
  ].join('\r\n');

  const cleaned = cleanPowerShellNoise(clixml);
  assert.ok(!cleaned.includes('#< CLIXML'));
  assert.ok(cleaned.includes('[PowerShell Error]:'));
  assert.ok(cleaned.includes("Cannot find path 'C:\\missing'"));
});

test('cleanPowerShellNoise: strips CategoryInfo and FullyQualifiedErrorId blocks', () => {
  const noise = [
    'error: command failed',
    '+ CategoryInfo          : ObjectNotFound: (foo:String) [], CommandNotFoundException',
    '+ FullyQualifiedErrorId : CommandNotFoundException',
    'Done'
  ].join('\n');

  const cleaned = cleanPowerShellNoise(noise);
  assert.ok(!cleaned.includes('CategoryInfo'));
  assert.ok(!cleaned.includes('FullyQualifiedErrorId'));
  assert.ok(cleaned.includes('error: command failed'));
  assert.ok(cleaned.includes('Done'));
});

test('fixPowerShellCommandEscaping: fixes curl alias and trailing backslash quote eating', () => {
  const raw = 'curl "C:\\Program Files\\App\\" -H "Auth: none"';
  const fixed = fixPowerShellCommandEscaping(raw, { targetPlatform: 'win32' });

  assert.ok(fixed.startsWith('curl.exe '));
  assert.ok(fixed.includes('"C:\\Program Files\\App\\\\"'));
});

test('fixPowerShellCommandEscaping: translates && for PowerShell 5.1 compatibility', () => {
  const raw = 'npm run build && npm test';
  const fixed = fixPowerShellCommandEscaping(raw, { targetPlatform: 'win32' });

  assert.strictEqual(fixed, 'npm run build; if ($?) { npm test }');
});
