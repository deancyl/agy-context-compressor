const test = require('node:test');
const assert = require('node:assert');
const { pruneHistoricalToolOutputs } = require('../src/core/compactor');
const { retrieveChunk } = require('../src/core/chunk-store');

test('pruneHistoricalToolOutputs: prunes older read-only outputs while keeping recent K turns intact', () => {
  const longCode = 'const a = 1;\n'.repeat(100); // ~1300 chars

  const messages = [
    { role: 'user', content: 'Turn 1: please inspect file 1' },
    { role: 'assistant', content: 'Checking...', tool_calls: [{ id: 'call_1', type: 'function' }] },
    { role: 'tool', tool_call_id: 'call_1', content: longCode }, // Turn 1 Tool: should be PRUNED

    { role: 'user', content: 'Turn 2: please inspect file 2' },
    { role: 'assistant', content: 'Checking...', tool_calls: [{ id: 'call_2', type: 'function' }] },
    { role: 'tool', tool_call_id: 'call_2', content: longCode }, // Turn 2 Tool: should be PRUNED

    { role: 'user', content: 'Turn 3: please inspect file 3' },
    { role: 'assistant', content: 'Checking...', tool_calls: [{ id: 'call_3', type: 'function' }] },
    { role: 'tool', tool_call_id: 'call_3', content: longCode }, // Recent tool 1 (kept)

    { role: 'user', content: 'Turn 4: please inspect file 4' },
    { role: 'assistant', content: 'Checking...', tool_calls: [{ id: 'call_4', type: 'function' }] },
    { role: 'tool', tool_call_id: 'call_4', content: longCode }, // Recent tool 2 (kept)

    { role: 'user', content: 'Turn 5: please inspect file 5' },
    { role: 'assistant', content: 'Checking...', tool_calls: [{ id: 'call_5', type: 'function' }] },
    { role: 'tool', tool_call_id: 'call_5', content: longCode }, // Recent tool 3 (kept)

    { role: 'user', content: 'Turn 6: please inspect file 6' },
    { role: 'assistant', content: 'Checking...', tool_calls: [{ id: 'call_6', type: 'function' }] },
    { role: 'tool', tool_call_id: 'call_6', content: longCode }, // Recent tool 4 (kept)
  ];

  const res = pruneHistoricalToolOutputs(messages, { keepRecentToolTurns: 4, recordTelemetry: false });

  assert.strictEqual(res.totalToolMessages, 6);
  assert.strictEqual(res.prunedCount, 2);
  assert.ok(res.savedChars > 2000);

  // Turn 1 and 2 must be pruned with CCR notice
  assert.ok(res.messages[2].content.includes('[Historical tool output pruned:'));
  assert.ok(res.messages[2].content.includes('CCR: agy_retrieve_chunk(chunk_id='));
  assert.strictEqual(res.messages[2].tool_call_id, 'call_1'); // Rule 18 preserved!

  assert.ok(res.messages[5].content.includes('[Historical tool output pruned:'));
  assert.strictEqual(res.messages[5].tool_call_id, 'call_2'); // Rule 18 preserved!

  // Turns 3, 4, 5, 6 must remain intact (active working window)
  assert.strictEqual(res.messages[8].content, longCode);
  assert.strictEqual(res.messages[11].content, longCode);
  assert.strictEqual(res.messages[14].content, longCode);
  assert.strictEqual(res.messages[17].content, longCode);
});

test('pruneHistoricalToolOutputs: Anti-Downgrade - NEVER prunes errors or failure tracebacks', () => {
  const errorTraceback = `
Traceback (most recent call last):
  File "app.py", line 42, in <module>
    raise TypeError("Invalid connection state")
TypeError: Invalid connection state
`.repeat(10); // > 500 chars

  const messages = [
    { role: 'assistant', tool_calls: [{ id: 'call_err', type: 'function' }] },
    { role: 'tool', tool_call_id: 'call_err', content: errorTraceback },
    { role: 'assistant', tool_calls: [{ id: 'call_1' }] },
    { role: 'tool', tool_call_id: 'call_1', content: 'ok 1' },
    { role: 'assistant', tool_calls: [{ id: 'call_2' }] },
    { role: 'tool', tool_call_id: 'call_2', content: 'ok 2' },
  ];

  const res = pruneHistoricalToolOutputs(messages, { keepRecentToolTurns: 1, recordTelemetry: false });
  // call_err is historical, but contains 'TypeError' and 'Traceback', so it MUST be exempted!
  assert.strictEqual(res.messages[1].content, errorTraceback);
  assert.strictEqual(res.prunedCount, 0);
});

test('pruneHistoricalToolOutputs: reversible retrieval via CCR agy_retrieve_chunk', () => {
  const secretText = 'CONFIDENTIAL_SECRET_TOKEN_42\n'.repeat(50);
  const messages = [
    { role: 'assistant', tool_calls: [{ id: 'call_secret' }] },
    { role: 'tool', tool_call_id: 'call_secret', content: secretText },
    { role: 'assistant', tool_calls: [{ id: 'call_recent' }] },
    { role: 'tool', tool_call_id: 'call_recent', content: 'recent' },
  ];

  const res = pruneHistoricalToolOutputs(messages, { keepRecentToolTurns: 1, recordTelemetry: false });
  assert.strictEqual(res.prunedCount, 1);

  // Extract chunk id from replacement
  const match = res.messages[1].content.match(/chunk_id="([^"]+)"/);
  assert.ok(match, 'Must embed chunk_id');
  const chunkId = match[1];

  // Retrieve original text via CCR store
  const chunk = retrieveChunk(chunkId);
  assert.strictEqual(chunk.isFound, true);
  assert.strictEqual(chunk.content, secretText);
});
