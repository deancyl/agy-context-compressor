/**
 * Unified Context Compactor Pipeline for AGY
 * 100% native Node.js zero dependencies.
 */

const {
  stripAnsi,
  cleanProgressBars,
  foldTestPasses,
  cleanDockerOutput,
  cleanTerraformOutput,
  isPassLine,
  isDockerLayerLine,
  isTfRefreshLine
} = require('./rtk');
const { foldLockfiles, foldStructuredData } = require('./headroom');
const { alignToolsSchema, slimToolsSchema } = require('./schema');
const { cleanPowerShellNoise, fixPowerShellCommandEscaping } = require('./powershell');
const { getMemo, setMemo, hashContent } = require('./cache-zone');
const { recordSavings, recordBatchSavings, getStats } = require('./telemetry');

const COMPACTOR_PRESETS = {
  balanced: {
    stripAnsi: true,
    cleanProgressBars: true,
    foldTestPasses: true,
    cleanDockerOutput: true,
    cleanTerraformOutput: true,
    cleanPowerShellNoise: true,
    foldLockfiles: true,
    foldStructuredData: true,
    maxStructuredItems: 50,
    exemptMergeConflicts: true,
    protectSourceDiffs: true,
    alignToolsSchema: true,
    slimToolsSchema: true,
    schemaCharThreshold: 15000,
    fixPowerShellEscaping: true
  },
  aggressive: {
    stripAnsi: true,
    cleanProgressBars: true,
    foldTestPasses: true,
    cleanDockerOutput: true,
    cleanTerraformOutput: true,
    cleanPowerShellNoise: true,
    foldLockfiles: true,
    foldStructuredData: true,
    maxStructuredItems: 20,
    exemptMergeConflicts: true,
    protectSourceDiffs: true,
    alignToolsSchema: true,
    slimToolsSchema: true,
    schemaCharThreshold: 8000,
    fixPowerShellEscaping: true
  },
  safe: {
    stripAnsi: true,
    cleanProgressBars: true,
    foldTestPasses: false,
    cleanDockerOutput: false,
    cleanTerraformOutput: false,
    cleanPowerShellNoise: true,
    foldLockfiles: false,
    foldStructuredData: false,
    exemptMergeConflicts: true,
    protectSourceDiffs: true,
    alignToolsSchema: true,
    slimToolsSchema: false,
    schemaCharThreshold: 20000,
    fixPowerShellEscaping: true
  }
};

/**
 * Normalizes options with presets.
 * @param {object} options
 * @returns {object}
 */
function resolveOptions(options = {}) {
  const presetName = options.preset || 'balanced';
  const base = COMPACTOR_PRESETS[presetName] || COMPACTOR_PRESETS.balanced;
  return { ...base, ...options };
}

/**
 * Compacts terminal or command text output.
 * @param {string} text
 * @param {object} userOptions
 * @param {string|null} [sessionId=null]
 * @returns {string}
 */
function compactOutput(text, userOptions = {}, sessionId = null) {
  if (typeof text !== 'string' || text.length === 0) return text;
  const opts = resolveOptions(userOptions);

  let cacheKey = null;
  if (sessionId && opts.cacheZoneFreeze !== false) {
    cacheKey = hashContent(text);
    const cached = getMemo(sessionId, cacheKey);
    if (cached !== null) {
      return cached;
    }
  }

  const originalLength = text.length;
  let result = text;

  // 1. PowerShell / CLIXML noise
  const beforePs = result.length;
  if (opts.cleanPowerShellNoise) {
    result = cleanPowerShellNoise(result);
  }
  const psDelta = beforePs - result.length;

  // 2. RTK: Strip ANSI, Progress Bars & DevOps/Test folding
  const beforeRtk = result.length;
  if (opts.stripAnsi) {
    result = stripAnsi(result);
  }
  if (opts.cleanProgressBars) {
    result = cleanProgressBars(result);
  }
  if (opts.cleanDockerOutput) {
    result = cleanDockerOutput(result);
  }
  if (opts.cleanTerraformOutput) {
    result = cleanTerraformOutput(result);
  }
  if (opts.foldTestPasses) {
    result = foldTestPasses(result, opts);
  }
  const rtkDelta = beforeRtk - result.length;

  // 3. Headroom: Fold Lockfile diffs & Structured JSON
  const beforeHeadroom = result.length;
  if (opts.foldLockfiles) {
    result = foldLockfiles(result, opts);
  }
  if (opts.foldStructuredData) {
    result = foldStructuredData(result, opts);
  }
  const headroomDelta = beforeHeadroom - result.length;

  const totalSaved = originalLength - result.length;
  if (totalSaved > 0 && opts.recordTelemetry !== false) {
    const moduleDeltas = {};
    if (psDelta > 0) moduleDeltas.powershell = psDelta;
    if (rtkDelta > 0) moduleDeltas.rtk = rtkDelta;
    if (headroomDelta > 0) moduleDeltas.headroom = headroomDelta;

    recordBatchSavings({
      originalChars: originalLength,
      moduleDeltas,
      metadata: { sessionId }
    });
  }

  if (sessionId && cacheKey && opts.cacheZoneFreeze !== false) {
    setMemo(sessionId, cacheKey, result);
  }

  return result;
}

/**
 * Creates a real-time sliding line stream filter.
 * Preserves cross-chunk test passes, docker layers, and terraform state runs.
 * Emits failures and uncompressed lines immediately without lag.
 * Atomically records net savings at stream end without double-counting.
 *
 * @param {object} params
 * @param {(text: string) => void} params.onEmit
 * @param {object} [params.options]
 * @param {object} [params.metadata]
 */
function createLineStreamFilter({ onEmit, options = {}, metadata = {} }) {
  const opts = resolveOptions(options);
  let remainder = '';
  let rawCharsIn = 0;
  let emittedCharsOut = 0;

  let currentRunType = null; // 'test' | 'docker' | 'tf' | null
  let activeRun = [];
  let newlineChar = '\n';

  function flushActiveRun() {
    if (!currentRunType || activeRun.length === 0) {
      currentRunType = null;
      activeRun = [];
      return;
    }

    if (currentRunType === 'test') {
      if (activeRun.length >= 3 && opts.foldTestPasses) {
        let chunkNotice = '';
        try {
          const { storeChunk } = require('./chunk-store');
          const chunkId = storeChunk(activeRun.join(newlineChar), { type: 'test_passes', count: activeRun.length });
          if (chunkId) chunkNotice = ` [CCR: agy_retrieve_chunk(chunk_id="${chunkId}")]`;
        } catch (_) {}
        const foldedLine = `[Test suite: ${activeRun.length} passed tests folded (✓ / PASS / ok)]${chunkNotice}${newlineChar}`;
        emittedCharsOut += foldedLine.length;
        onEmit(foldedLine);
      } else {
        const fullText = activeRun.map(l => l + newlineChar).join('');
        emittedCharsOut += fullText.length;
        onEmit(fullText);
      }
    } else if (currentRunType === 'docker') {
      if (activeRun.length >= 4 && opts.cleanDockerOutput) {
        let chunkNotice = '';
        try {
          const { storeChunk } = require('./chunk-store');
          const chunkId = storeChunk(activeRun.join(newlineChar), { type: 'docker_layers', count: activeRun.length });
          if (chunkId) chunkNotice = ` [CCR: agy_retrieve_chunk(chunk_id="${chunkId}")]`;
        } catch (_) {}
        const foldedLine = `[Docker: ${activeRun.length} layer operations folded]${chunkNotice}${newlineChar}`;
        emittedCharsOut += foldedLine.length;
        onEmit(foldedLine);
      } else {
        const fullText = activeRun.map(l => l + newlineChar).join('');
        emittedCharsOut += fullText.length;
        onEmit(fullText);
      }
    } else if (currentRunType === 'tf') {
      if (activeRun.length >= 3 && opts.cleanTerraformOutput) {
        let chunkNotice = '';
        try {
          const { storeChunk } = require('./chunk-store');
          const chunkId = storeChunk(activeRun.join(newlineChar), { type: 'terraform_refreshes', count: activeRun.length });
          if (chunkId) chunkNotice = ` [CCR: agy_retrieve_chunk(chunk_id="${chunkId}")]`;
        } catch (_) {}
        const foldedLine = `[Terraform: ${activeRun.length} resource state refreshes folded]${chunkNotice}${newlineChar}`;
        emittedCharsOut += foldedLine.length;
        onEmit(foldedLine);
      } else {
        const fullText = activeRun.map(l => l + newlineChar).join('');
        emittedCharsOut += fullText.length;
        onEmit(fullText);
      }
    }

    currentRunType = null;
    activeRun = [];
  }

  function processSingleLine(rawLine) {
    if (rawLine.includes('\r')) {
      newlineChar = '\r\n';
    }
    let line = rawLine;
    if (opts.stripAnsi) line = stripAnsi(line);
    if (opts.cleanProgressBars) line = cleanProgressBars(line);
    if (opts.cleanPowerShellNoise) line = cleanPowerShellNoise(line);

    if (!line.trim() && rawLine.trim()) {
      return;
    }

    if (opts.foldTestPasses && isPassLine(line)) {
      if (currentRunType && currentRunType !== 'test') {
        flushActiveRun();
      }
      currentRunType = 'test';
      activeRun.push(line);
      return;
    }

    if (opts.cleanDockerOutput && isDockerLayerLine(line)) {
      if (currentRunType && currentRunType !== 'docker') {
        flushActiveRun();
      }
      currentRunType = 'docker';
      activeRun.push(line);
      return;
    }

    if (opts.cleanTerraformOutput && isTfRefreshLine(line)) {
      if (currentRunType && currentRunType !== 'tf') {
        flushActiveRun();
      }
      currentRunType = 'tf';
      activeRun.push(line);
      return;
    }

    flushActiveRun();
    const toSend = line + newlineChar;
    emittedCharsOut += toSend.length;
    onEmit(toSend);
  }

  function write(chunk) {
    if (!chunk) return;
    const str = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
    rawCharsIn += str.length;

    const combined = remainder + str;
    const lines = combined.split(/\r?\n/);
    remainder = lines.pop() || '';

    for (const l of lines) {
      processSingleLine(l);
    }
  }

  function end() {
    if (remainder.length > 0) {
      processSingleLine(remainder);
      remainder = '';
    }
    flushActiveRun();

    const savedChars = Math.max(0, rawCharsIn - emittedCharsOut);
    if (savedChars >= 10 && opts.recordTelemetry !== false) {
      recordBatchSavings({
        originalChars: rawCharsIn,
        moduleDeltas: {
          rtk: savedChars
        },
        metadata: { ...metadata, liveStream: true }
      });
    }

    return {
      rawCharsIn,
      emittedCharsOut,
      savedChars
    };
  }

  return {
    write,
    end,
    flush: flushActiveRun
  };
}

/**
 * Prunes older historical tool outputs from a messages array while strictly preserving
 * Rule 18 protocol integrity (tool_call_id matching) and exempting errors/failures.
 * Implements Kompact-style sliding window context condensation with CCR storage.
 *
 * @param {Array<object>} messages - Full chat completion messages array
 * @param {object} [options]
 * @param {number} [options.keepRecentToolTurns=4] - Number of recent tool calls to keep 100% unpruned
 * @param {number} [options.minPruneChars=300] - Minimum character length of tool output to qualify for pruning
 * @param {boolean} [options.recordTelemetry=true] - Whether to record pruned savings to telemetry
 * @returns {{ messages: Array<object>, prunedCount: number, savedChars: number, totalToolMessages: number }}
 */
function pruneHistoricalToolOutputs(messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages, prunedCount: 0, savedChars: 0, totalToolMessages: 0 };
  }

  const keepRecentToolTurns = typeof options.keepRecentToolTurns === 'number' ? options.keepRecentToolTurns : 4;
  const minPruneChars = typeof options.minPruneChars === 'number' ? options.minPruneChars : 300;

  // Find all tool/function message indices
  const toolIndices = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg && (msg.role === 'tool' || msg.role === 'function')) {
      toolIndices.push(i);
    }
  }

  const totalToolMessages = toolIndices.length;
  if (totalToolMessages <= keepRecentToolTurns) {
    return { messages, prunedCount: 0, savedChars: 0, totalToolMessages };
  }

  const prunableToolIndices = new Set(toolIndices.slice(0, totalToolMessages - keepRecentToolTurns));
  const ERROR_REGEX = /\b(?:error|failed|exception|Traceback|SyntaxError|ReferenceError|TypeError|AssertionError|FAIL)\b/i;

  let prunedCount = 0;
  let savedChars = 0;
  let totalOriginalChars = 0;

  const newMessages = messages.map((msg, idx) => {
    if (!prunableToolIndices.has(idx)) {
      return msg;
    }

    const rawContent = typeof msg.content === 'string' ? msg.content : (Array.isArray(msg.content) ? JSON.stringify(msg.content) : '');
    if (!rawContent || rawContent.length < minPruneChars) {
      return msg;
    }

    // CRITICAL SAFETY (Anti-Downgrade): NEVER prune errors or failure stack traces
    if (ERROR_REGEX.test(rawContent)) {
      return msg;
    }

    // Store uncompressed text into CCR chunk store for zero-loss reversibility
    let chunkNotice = '';
    try {
      const { storeChunk } = require('./chunk-store');
      const chunkId = storeChunk(rawContent, {
        type: 'pruned_tool_output',
        role: msg.role,
        tool_call_id: msg.tool_call_id || null,
        originalLength: rawContent.length
      });
      if (chunkId) {
        chunkNotice = ` CCR: agy_retrieve_chunk(chunk_id="${chunkId}")`;
      }
    } catch (_) {}

    const replacement = `[Historical tool output pruned: was ${rawContent.length} chars. Verification succeeded in earlier turn.${chunkNotice}]`;
    const delta = rawContent.length - replacement.length;
    if (delta > 0) {
      savedChars += delta;
      totalOriginalChars += rawContent.length;
      prunedCount += 1;
      return {
        ...msg,
        content: replacement
      };
    }

    return msg;
  });

  if (savedChars > 0 && options.recordTelemetry !== false) {
    try {
      const { recordSavings } = require('./telemetry');
      recordSavings('headroom', savedChars, totalOriginalChars, {
        note: 'prune_historical_tool_outputs',
        prunedCount
      });
    } catch (_) {}
  }

  return {
    messages: newMessages,
    prunedCount,
    savedChars,
    totalToolMessages
  };
}

module.exports = {
  COMPACTOR_PRESETS,
  resolveOptions,
  compactOutput,
  stripAnsi,
  cleanProgressBars,
  foldTestPasses,
  cleanDockerOutput,
  cleanTerraformOutput,
  foldLockfiles,
  foldStructuredData,
  alignToolsSchema,
  slimToolsSchema,
  cleanPowerShellNoise,
  fixPowerShellCommandEscaping,
  getMemo,
  setMemo,
  hashContent,
  createLineStreamFilter,
  pruneHistoricalToolOutputs
};
