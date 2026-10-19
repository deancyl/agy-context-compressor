/**
 * Unified Context Compactor Pipeline for AGY (2.0)
 * 100% native Node.js zero dependencies.
 *
 * Integrates:
 * 1. RTK + Squeez Terminal Denoising (ANSI, progress bars, test passes, Docker, Terraform, Kubectl, Cargo/npm/pip)
 * 2. Headroom Lockfile & 2-Tier Structured JSON Folding (TOON lossless matrix + SmartCrusher CCR)
 * 3. Real-time Block-Aware Line Stream Filter (with git diff lockfile folding & conflict exemption)
 * 4. OpenCode-DCP (Dynamic Context Pruning) 3-Stage Historical Tool Output Condenser:
 *    - Stage 1: Exact Duplicate Read/Output Deduplication
 *    - Stage 2: Supersede Writes (invalidates earlier file reads once the file is edited/written)
 *    - Stage 3: Sliding Window + Cooldown-based Resolved Error Archiving with CCR reversibility
 */

const {
  stripAnsi,
  cleanProgressBars,
  foldTestPasses,
  cleanDockerOutput,
  cleanTerraformOutput,
  cleanKubectlOutput,
  cleanPkgInstallOutput,
  isPassLine,
  isDockerLayerLine,
  isTfRefreshLine,
  isKubeStatusLine,
  isPkgInstallNoiseLine
} = require('./rtk');
const { foldLockfiles, foldStructuredData, encodeTOON, decodeTOON, compactSourceCode } = require('./headroom');
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
    cleanKubectlOutput: true,
    cleanPkgInstallOutput: true,
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
    cleanKubectlOutput: true,
    cleanPkgInstallOutput: true,
    cleanPowerShellNoise: true,
    foldLockfiles: true,
    foldStructuredData: true,
    useTOON: true,
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
    cleanKubectlOutput: false,
    cleanPkgInstallOutput: false,
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
    cacheKey = `${hashContent(text)}_${opts.preset || 'balanced'}`;
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
  const psDelta = Math.max(0, beforePs - result.length);

  // 2. RTK & Squeez: Strip ANSI, Progress Bars & DevOps/Test/Pkg folding
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
  if (opts.cleanKubectlOutput !== false) {
    result = cleanKubectlOutput(result);
  }
  if (opts.cleanPkgInstallOutput !== false) {
    result = cleanPkgInstallOutput(result);
  }
  if (opts.foldTestPasses) {
    result = foldTestPasses(result, opts);
  }
  const rtkDelta = Math.max(0, beforeRtk - result.length);

  // 3. Headroom: Fold Lockfile diffs & Structured JSON
  const beforeHeadroom = result.length;
  if (opts.foldLockfiles) {
    result = foldLockfiles(result, opts);
  }
  if (opts.foldStructuredData) {
    result = foldStructuredData(result, opts);
  }
  const headroomDelta = Math.max(0, beforeHeadroom - result.length);

  // Anti-inflation guard: never return compressed output longer than original input
  if (result.length > originalLength) {
    result = text;
  }

  const totalSaved = originalLength - result.length;
  if (totalSaved > 0 && opts.recordTelemetry !== false) {
    const moduleDeltas = {};
    if (psDelta > 0) moduleDeltas.powershell = psDelta;
    if (rtkDelta > 0) moduleDeltas.rtk = rtkDelta;
    if (headroomDelta > 0) moduleDeltas.headroom = headroomDelta;

    recordBatchSavings({
      originalChars: originalLength,
      moduleDeltas,
      originalText: text,
      compressedText: result,
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
 * Preserves cross-chunk test passes, docker layers, terraform state runs, kubectl status,
 * package manager installs, and git diff lockfile blocks.
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

  let currentRunType = null; // 'test' | 'docker' | 'tf' | 'kube' | 'pkg' | 'diff_lockfile' | null
  let activeRun = [];
  let currentLockfileName = 'lockfile';
  let headroomSavedChars = 0;
  let newlineChar = '\n';

  function isLockfileDiffHeader(line) {
    const match = line.match(/^diff --git\s+(?:"?a\/)?(?:.*\/)?(package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|Cargo\.lock|go\.sum|go\.work\.sum|composer\.lock|poetry\.lock|uv\.lock|bun\.lockb?)\b/i);
    return match ? match[1] : null;
  }

  function isAnyDiffHeader(line) {
    return /^diff --git\s+/i.test(line);
  }

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
    } else if (currentRunType === 'kube') {
      if (activeRun.length >= 4 && opts.cleanKubectlOutput !== false) {
        const foldedLine = `[Kubectl: ${activeRun.length} healthy pods / rollout status lines folded]${newlineChar}`;
        emittedCharsOut += foldedLine.length;
        onEmit(foldedLine);
      } else {
        const fullText = activeRun.map(l => l + newlineChar).join('');
        emittedCharsOut += fullText.length;
        onEmit(fullText);
      }
    } else if (currentRunType === 'pkg') {
      if (activeRun.length >= 4 && opts.cleanPkgInstallOutput !== false) {
        const foldedLine = `[Package Manager: ${activeRun.length} dependency download/compile lines folded]${newlineChar}`;
        emittedCharsOut += foldedLine.length;
        onEmit(foldedLine);
      } else {
        const fullText = activeRun.map(l => l + newlineChar).join('');
        emittedCharsOut += fullText.length;
        onEmit(fullText);
      }
    } else if (currentRunType === 'diff_lockfile') {
      if (activeRun.length >= 8 && opts.foldLockfiles !== false) {
        let chunkNotice = '';
        try {
          const { storeChunk } = require('./chunk-store');
          const chunkId = storeChunk(activeRun.join(newlineChar), { type: 'lockfile_diff', filename: currentLockfileName, count: activeRun.length });
          if (chunkId) chunkNotice = ` [CCR: agy_retrieve_chunk(chunk_id="${chunkId}")]`;
        } catch (_) {}
        const foldedLine = `[Git Diff: ${currentLockfileName} diff folded (${activeRun.length} lines)]${chunkNotice}${newlineChar}`;
        const rawRunLen = activeRun.map(l => l + newlineChar).join('').length;
        headroomSavedChars += Math.max(0, rawRunLen - foldedLine.length);
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

    // Git Diff streaming state machine for lockfiles
    if (opts.foldLockfiles !== false) {
      if (currentRunType === 'diff_lockfile') {
        if (opts.exemptMergeConflicts !== false && (line.startsWith('<<<<<<<') || line.startsWith('=======') || line.startsWith('>>>>>>>') || line.startsWith('|||||||'))) {
          // Merge conflict detected inside lockfile! Never fold conflicts - flush as raw!
          const fullText = activeRun.map(l => l + newlineChar).join('');
          emittedCharsOut += fullText.length;
          onEmit(fullText);
          currentRunType = null;
          activeRun = [];
          const toSend = line + newlineChar;
          emittedCharsOut += toSend.length;
          onEmit(toSend);
          return;
        }

        if (isAnyDiffHeader(line)) {
          flushActiveRun();
          const lockName = isLockfileDiffHeader(line);
          if (lockName) {
            currentRunType = 'diff_lockfile';
            currentLockfileName = lockName;
            activeRun.push(line);
            return;
          }
        } else {
          activeRun.push(line);
          return;
        }
      } else {
        const lockName = isLockfileDiffHeader(line);
        if (lockName) {
          flushActiveRun();
          currentRunType = 'diff_lockfile';
          currentLockfileName = lockName;
          activeRun.push(line);
          return;
        }
      }
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

    if (opts.cleanKubectlOutput !== false && isKubeStatusLine(line)) {
      if (currentRunType && currentRunType !== 'kube') {
        flushActiveRun();
      }
      currentRunType = 'kube';
      activeRun.push(line);
      return;
    }

    if (opts.cleanPkgInstallOutput !== false && isPkgInstallNoiseLine(line)) {
      if (currentRunType && currentRunType !== 'pkg') {
        flushActiveRun();
      }
      currentRunType = 'pkg';
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
      const hrSaved = Math.min(savedChars, headroomSavedChars);
      const rtkSaved = savedChars - hrSaved;
      const moduleDeltas = {};
      if (rtkSaved > 0) moduleDeltas.rtk = rtkSaved;
      if (hrSaved > 0) moduleDeltas.headroom = hrSaved;
      recordBatchSavings({
        originalChars: rawCharsIn,
        moduleDeltas,
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
 * Extracts tool call metadata (tool name & target file path) from assistant tool_calls across messages.
 */
function buildToolCallMap(messages) {
  const callMap = new Map();
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || msg.role !== 'assistant' || !Array.isArray(msg.tool_calls)) continue;
    for (const tc of msg.tool_calls) {
      if (!tc || !tc.id) continue;
      const fnName = (tc.function && tc.function.name) || tc.name || '';
      let args = {};
      if (tc.function && typeof tc.function.arguments === 'string') {
        try { args = JSON.parse(tc.function.arguments); } catch (_) {}
      } else if (tc.function && typeof tc.function.arguments === 'object') {
        args = tc.function.arguments || {};
      } else if (tc.args && typeof tc.args === 'object') {
        args = tc.args;
      }
      const targetFile = args.AbsolutePath || args.TargetFile || args.path || args.file_path || args.filePath || '';
      const sliceKey = `${args.StartLine || ''}:${args.EndLine || ''}`;
      callMap.set(tc.id, {
        msgIndex: i,
        fnName: fnName.toLowerCase(),
        targetFile: typeof targetFile === 'string' ? targetFile.replace(/\\/g, '/').toLowerCase() : '',
        sliceKey
      });
    }
  }
  return callMap;
}

/**
 * OpenCode-DCP (Dynamic Context Pruning) 3-Stage Historical Tool Output Condenser:
 * 1. Stage 1 (Deduplication): If an earlier tool call produced identical output or read the exact same
 *    file+slice as a later tool call, prunes the older duplicate even if inside the recent window.
 * 2. Stage 2 (Supersede Writes): If a file is modified by write/edit/replace/patch at message index W,
 *    any earlier read of that file at index < W is marked superseded and pruned.
 * 3. Stage 3 (Sliding Window + Cooldown-based Resolved Error Archiving):
 *    Prunes older non-error tool outputs outside keepRecentToolTurns, and optionally archives ancient
 *    resolved errors older than errorCooldownTurns when subsequent turns succeeded.
 *    100% of pruned payloads are stored in CCR (agy_retrieve_chunk) for zero-loss reversibility.
 *
 * @param {Array<object>} messages - Full chat completion messages array
 * @param {object} [options]
 * @param {number} [options.keepRecentToolTurns=4] - Number of recent tool calls to keep 100% unpruned
 * @param {number} [options.minPruneChars=300] - Minimum character length of tool output to qualify for pruning
 * @param {number} [options.errorCooldownTurns=8] - Number of tool turns to protect errors before resolved archiving
 * @param {boolean} [options.deduplicateReads=true] - Prune duplicate older outputs
 * @param {boolean} [options.supersedeWrites=true] - Prune file reads older than a write to the same file
 * @param {boolean} [options.recordTelemetry=true] - Whether to record pruned savings to telemetry
 * @returns {{ messages: Array<object>, prunedCount: number, savedChars: number, totalToolMessages: number }}
 */
function pruneHistoricalToolOutputs(messages, options = {}) {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { messages, prunedCount: 0, savedChars: 0, totalToolMessages: 0 };
  }

  const keepRecentToolTurns = typeof options.keepRecentToolTurns === 'number' ? options.keepRecentToolTurns : 4;
  const minPruneChars = typeof options.minPruneChars === 'number' ? options.minPruneChars : 300;
  const errorCooldownTurns = typeof options.errorCooldownTurns === 'number' ? options.errorCooldownTurns : 8;
  const deduplicateReads = options.deduplicateReads !== false;
  const supersedeWrites = options.supersedeWrites !== false;

  const callMap = buildToolCallMap(messages);

  // Find all tool/function message indices
  const toolIndices = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg && (msg.role === 'tool' || msg.role === 'function')) {
      toolIndices.push(i);
    }
  }

  const totalToolMessages = toolIndices.length;
  if (totalToolMessages === 0) {
    return { messages, prunedCount: 0, savedChars: 0, totalToolMessages: 0 };
  }

  const prunableWindowIndices = new Set(
    totalToolMessages > keepRecentToolTurns
      ? toolIndices.slice(0, totalToolMessages - keepRecentToolTurns)
      : []
  );

  // Track latest write index per file and latest read index per (file, slice)
  const latestWriteIdxByFile = new Map();
  const latestReadIdxByKey = new Map();

  for (const [callId, meta] of callMap.entries()) {
    if (!meta.targetFile) continue;
    const isWriteTool = /(?:write|replace|edit|patch|create_file)/.test(meta.fnName);
    const isReadTool = /(?:view_file|read_file|compact_view_file)/.test(meta.fnName);
    if (isWriteTool) {
      const prev = latestWriteIdxByFile.get(meta.targetFile) ?? -1;
      if (meta.msgIndex > prev) latestWriteIdxByFile.set(meta.targetFile, meta.msgIndex);
    }
    if (isReadTool) {
      const rKey = `${meta.targetFile}#${meta.sliceKey}`;
      const prev = latestReadIdxByKey.get(rKey) ?? -1;
      if (meta.msgIndex > prev) latestReadIdxByKey.set(rKey, meta.msgIndex);
    }
  }

  const ERROR_REGEX = /\b(?:error|failed|exception|Traceback|SyntaxError|ReferenceError|TypeError|AssertionError|FAIL)\b/i;

  // Check if the most recent tool output succeeded without error
  const lastToolMsg = messages[toolIndices[toolIndices.length - 1]];
  const lastToolStr = typeof lastToolMsg?.content === 'string' ? lastToolMsg.content : '';
  const recentTurnHealthy = !ERROR_REGEX.test(lastToolStr);

  // Map tool message index -> its ordinal rank (0..totalToolMessages-1)
  const toolRankMap = new Map();
  toolIndices.forEach((mIdx, rank) => toolRankMap.set(mIdx, rank));

  let prunedCount = 0;
  let savedChars = 0;
  let totalOriginalChars = 0;

  const newMessages = messages.map((msg, idx) => {
    if (!msg || (msg.role !== 'tool' && msg.role !== 'function')) {
      return msg;
    }

    const rawContent = typeof msg.content === 'string' ? msg.content : (Array.isArray(msg.content) ? JSON.stringify(msg.content) : '');
    if (!rawContent || rawContent.length < minPruneChars) {
      return msg;
    }

    const callMeta = msg.tool_call_id ? callMap.get(msg.tool_call_id) : null;
    let pruneReason = null;

    // DCP Stage 1: Duplicate Read of same (file, slice) superseded by a later read
    if (deduplicateReads && callMeta && callMeta.targetFile && /(?:view_file|read_file|compact_view_file)/.test(callMeta.fnName)) {
      const rKey = `${callMeta.targetFile}#${callMeta.sliceKey}`;
      const latestIdx = latestReadIdxByKey.get(rKey);
      if (latestIdx !== undefined && latestIdx > idx) {
        pruneReason = 'Duplicate file read superseded by newer read';
      }
    }

    // DCP Stage 2: File read superseded by a subsequent write/edit to the same file
    if (!pruneReason && supersedeWrites && callMeta && callMeta.targetFile && /(?:view_file|read_file|compact_view_file)/.test(callMeta.fnName)) {
      const writeIdx = latestWriteIdxByFile.get(callMeta.targetFile);
      if (writeIdx !== undefined && writeIdx > idx) {
        pruneReason = 'Stale file read superseded by subsequent file edit';
      }
    }

    // DCP Stage 3: Sliding window historical pruning
    if (!pruneReason && prunableWindowIndices.has(idx)) {
      const hasError = ERROR_REGEX.test(rawContent);
      if (!hasError) {
        pruneReason = 'Verification succeeded in earlier turn';
      } else {
        const rank = toolRankMap.get(idx) ?? 0;
        const turnsAgo = totalToolMessages - 1 - rank;
        if (turnsAgo >= errorCooldownTurns && recentTurnHealthy) {
          pruneReason = `Resolved error archived after ${turnsAgo} turns`;
        }
      }
    }

    if (!pruneReason) {
      return msg;
    }

    // Store uncompressed text into CCR chunk store for zero-loss reversibility
    let chunkNotice = '';
    try {
      const { storeChunk } = require('./chunk-store');
      const chunkId = storeChunk(rawContent, {
        type: 'pruned_tool_output',
        reason: pruneReason,
        role: msg.role,
        tool_call_id: msg.tool_call_id || null,
        originalLength: rawContent.length
      });
      if (chunkId) {
        chunkNotice = ` CCR: agy_retrieve_chunk(chunk_id="${chunkId}")`;
      }
    } catch (_) {}

    const replacement = `[Historical tool output pruned: was ${rawContent.length} chars. ${pruneReason}.${chunkNotice}]`;
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
      recordSavings('kompact', savedChars, totalOriginalChars, {
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
  compactSourceCode,
  stripAnsi,
  cleanProgressBars,
  foldTestPasses,
  cleanDockerOutput,
  cleanTerraformOutput,
  cleanKubectlOutput,
  cleanPkgInstallOutput,
  foldLockfiles,
  foldStructuredData,
  encodeTOON,
  decodeTOON,
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
