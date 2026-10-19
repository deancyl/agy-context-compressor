const test = require('node:test');
const assert = require('node:assert');
const { sortKeysDeep, alignToolsSchema, slimToolsSchema, slimDescription } = require('../src/core/schema');

test('sortKeysDeep: sorts nested object keys alphabetically', () => {
  const obj = { z: 1, a: 2, m: { y: 10, b: 20 } };
  const sorted = sortKeysDeep(obj);
  assert.deepStrictEqual(Object.keys(sorted), ['a', 'm', 'z']);
  assert.deepStrictEqual(Object.keys(sorted.m), ['b', 'y']);
});

test('alignToolsSchema: sorts tools by name and sorts parameters', () => {
  const tools = [
    { name: 'zeta_tool', parameters: { properties: { z: {}, a: {} } } },
    { name: 'alpha_tool', parameters: { properties: { y: {}, b: {} } } }
  ];

  const aligned = alignToolsSchema(tools);
  assert.strictEqual(aligned[0].name, 'alpha_tool');
  assert.strictEqual(aligned[1].name, 'zeta_tool');
  assert.deepStrictEqual(Object.keys(aligned[0].parameters.properties), ['b', 'y']);
});

test('slimToolsSchema: trims verbose markdown examples while preserving e.g. abbreviations and CRITICAL constraints', () => {
  const longDesc = 'Path to the file (e.g. /src/index.ts or /app/main.py). Must be an absolute path. ```sql\nSELECT * FROM giant_table WHERE id = 1;\n```\nExtra verbose padding text here that repeats many times to exceed three hundred characters in total length so sentence splitting activates cleanly. CRITICAL: Never pass relative paths.';
  const tools = [
    {
      name: 'db_query',
      description: longDesc,
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'SQL query to run.' }
        }
      }
    }
  ];

  const slimmed = slimToolsSchema(tools, 50); // Set low threshold to trigger
  assert.ok(!slimmed[0].description.includes('```sql'));
  assert.ok(slimmed[0].description.includes('(e.g. /src/index.ts or /app/main.py)'));
  assert.ok(slimmed[0].description.includes('Must be an absolute path.'));
  assert.ok(slimmed[0].description.includes('CRITICAL: Never pass relative paths.'));
});
