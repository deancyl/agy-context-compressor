/**
 * Unified Context Compactor Pipeline for AGY (2.2)
 * 100% native Node.js zero dependencies.
 *
 * Integrates:
 * 1. RTK + Squeez + ContextZip Terminal Denoising (ANSI, progress bars, test passes, Docker, Terraform,
 *    Kubectl, Cargo/npm/pip, build asset tables, timestamp-normalized duplicate logs, routine INFO/DEBUG bursts,
 *    and massive directory listings)
 * 2. Headroom Lockfile & 2-Tier Structured JSON Folding (TOON lossless matrix + SmartCrusher CCR)
 * 3. Real-time Block-Aware Line Stream Filter (with trailing padding strip, blank-line collapse, log burst folding,
 *    dir listing folding, git diff lockfile folding & conflict exemption)
 * 4. OpenCode-DCP (Dynamic Context Pruning) 3-Stage Historical Tool Output Condenser
 * 5. Extensible Custom Stage Registry & Persistent Preset Manager
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const {
  stripAnsi,
  cleanProgressBars,
  foldTestPasses,
  cleanDockerOutput,
  cleanTerraformOutput,
  cleanKubectlOutput,
  cleanPkgInstallOutput,
  cleanBuildOutput,
  foldDuplicateLines,
  cleanLogBurstOutput,
  cleanDirectoryListingOutput,
  normalizeLogSignature,
  isPassLine,
  isDockerLayerLine,
  isTfRefreshLine,
  isKubeStatusLine,
  isPkgInstallNoiseLine,
  isBuildNoiseLine,
  isRoutineLogLine,
  isDirectoryListingLine,
  isProtectedDiagnosticLine
} = require('./rtk');
const { foldLockfiles, foldStructuredData, encodeTOON, decodeTOON, compactSourceCode } = require('./headroom');
const { alignToolsSchema, slimToolsSchema } = require('./schema');
const { cleanPowerShellNoise, fixPowerShellCommandEscaping } = require('./powershell');
const { getMemo, setMemo, hashContent } = require('./cache-zone');
const { recordSavings, recordCacheZoneHit, recordBatchSavings, getStats } = require('./telemetry');

const COMPACTOR_PRESETS = {
  balanced: {
    stripAnsi: true,
    cleanProgressBars: true,
    foldTestPasses: true,
    cleanDockerOutput: true,
    cleanTerraformOutput: true,
    cleanKubectlOutput: true,
    cleanPkgInstallOutput: true,
    cleanBuildOutput: true,
    foldDuplicateLines: true,
    cleanLogBurstOutput: true,
    cleanDirectoryListingOutput: true,
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
    cleanBuildOutput: true,
    foldDuplicateLines: true,
    cleanLogBurstOutput: true,
    cleanDirectoryListingOutput: true,
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
    cleanBuildOutput: false,
    foldDuplicateLines: false,
    cleanLogBurstOutput: false,
    cleanDirectoryListingOutput: false,
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

// Extensible custom compression stage registry
const customStages = new Map();

function registerCompressionStage(stage) {
  if (!stage || typeof stage.name !== 'string' || typeof stage.fn !== 'function') {
    throw new Error('Invalid compression stage: requires { name, fn }');
  }
  customStages.set(stage.name, {
    name: stage.name,
    module: stage.module || 'rtk',
    fn: stage.fn
  });
}

function unregisterCompressionStage(name) {
  return customStages.delete(name);
}

function getCompressionStages() {
  return Array.from(customStages.values());
}

function getConfigFilePath() {
  if (process.env.AGY_COMPRESSOR_CONFIG_FILE) {
    return process.env.AGY_COMPRESSOR_CONFIG_FILE;
  }
  return path.join(os.homedir(), '.gemini', 'config', 'agy-compressor-config.json');
}

let cachedActivePreset = null;
let cachedConfigMtime = 0;

function getActivePreset() {
  try {
    const cfgFile = getConfigFilePath();
    if (fs.existsSync(cfgFile)) {
      const mtime = fs.statSync(cfgFile).mtimeMs;
      if (cachedActivePreset && mtime <= cachedConfigMtime) {
        return cachedActivePreset;
      }
      const parsed = JSON.parse(fs.readFileSync(cfgFile, 'utf8'));
      if (parsed && parsed.preset && COMPACTOR_PRESETS[parsed.preset]) {
        cachedActivePreset = parsed.preset;
        cachedConfigMtime = mtime;
        return cachedActivePreset;
      }
    }
  } catch (_) {}
  return 'balanced';
}

function setActivePreset(preset) {
  const validPreset = COMPACTOR_PRESETS[preset] ? preset : 'balanced';
  const cfgFile = getConfigFilePath();
  try {
    const dir = path.dirname(cfgFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(cfgFile, JSON.stringify({ preset: validPreset, updatedAt: new Date().toISOString() }, null, 2), 'utf8');
    cachedActivePreset = validPreset;
    cachedConfigMtime = Date.now();
  } catch (_) {}
  return { preset: validPreset, path: cfgFile };
}

function resolveOptions(options = {}) {
  const presetName = options.preset || getActivePreset() || 'balanced';
  const base = COMPACTOR_PRESETS[presetName] || COMPACTOR_PRESETS.balanced;
  return { ...base, preset: presetName, ...options };
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
      if (opts.recordTelemetry !== false) {
        recordCacheZoneHit(Math.max(0, text.length - cached.length), text.length, { sessionId });
      }
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

  // 2. RTK & Squeez: Strip ANSI, Progress Bars, DevOps/Test/Pkg/Build/Log/Dir folding, and Duplicate Line folding
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
  if (opts.cleanBuildOutput !== false) {
    result = cleanBuildOutput(result);
  }
  if (opts.foldTestPasses) {
    result = foldTestPasses(result, opts);
  }
  if (opts.foldDuplicateLines !== false) {
    result = foldDuplicateLines(result);
  }
  if (opts.cleanLogBurstOutput !== false) {
    result = cleanLogBurstOutput(result);
  }
  if (opts.cleanDirectoryListingOutput !== false) {
    result = cleanDirectoryListingOutput(result);
  }
  let rtkDelta = Math.max(0, beforeRtk - result.length);

  // 3. Headroom: Fold Lockfile diffs & Structured JSON
  const beforeHeadroom = result.length;
  if (opts.foldLockfiles) {
    result = foldLockfiles(result, opts);
  }
  if (opts.foldStructuredData) {
    result = foldStructuredData(result, opts);
  }
  let headroomDelta = Math.max(0, beforeHeadroom - result.length);

  // 4. Custom registered plugin stages
  if (customStages.size > 0) {
    for (const stage of customStages.values()) {
      try {
        const beforeStage = result.length;
        const next = stage.fn(result, opts);
        if (typeof next === 'string' && next.length <= beforeStage) {
          result = next;
          const stageSaved = beforeStage - next.length;
          if (stage.module === 'headroom') headroomDelta += stageSaved;
          else rtkDelta += stageSaved;
        }
      } catch (_) {}
    }
  }

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
 * package manager installs, build asset lines, routine log bursts, directory listings,
 * and git diff lockfile blocks.
 * Also strips PowerShell Format-Table trailing padding spaces and collapses consecutive blank lines.
 * Emits failures and uncompressed lines immediately without lag.
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

  let currentRunType = null; // 'test' | 'docker' | 'tf' | 'kube' | 'pkg' | 'build' | 'log_burst' | 'dir_list' | 'diff_lockfile' | null
  let activeRun = [];
  let currentLockfileName = 'lockfile';
  let headroomSavedChars = 0;
  let newlineChar = '\n';
  let consecutiveBlankCount = 0;
  let inSourceGitDiff = false;

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
    } else if (currentRunType === 'build') {
      if (activeRun.length >= 5 && opts.cleanBuildOutput !== false) {
        const foldedLine = `[Build Output: ${activeRun.length} routine build/asset lines folded]${newlineChar}`;
        emittedCharsOut += foldedLine.length;
        onEmit(foldedLine);
      } else {
        const fullText = activeRun.map(l => l + newlineChar).join('');
        emittedCharsOut += fullText.length;
        onEmit(fullText);
      }
    } else if (currentRunType === 'log_burst') {
      if (activeRun.length >= 20 && opts.cleanLogBurstOutput !== false) {
        const head = activeRun.slice(0, 5);
        const tail = activeRun.slice(-3);
        const omittedCount = activeRun.length - 8;
        let chunkNotice = '';
        try {
          const { storeChunk } = require('./chunk-store');
          const chunkId = storeChunk(activeRun.join(newlineChar), { type: 'routine_logs', count: activeRun.length });
          if (chunkId) chunkNotice = ` [CCR: agy_retrieve_chunk(chunk_id="${chunkId}")]`;
        } catch (_) {}
        const foldedText = [...head, `[Log Stream: ${omittedCount} routine INFO/DEBUG lines folded]${chunkNotice}`, ...tail]
          .map(l => l + newlineChar)
          .join('');
        emittedCharsOut += foldedText.length;
        onEmit(foldedText);
      } else {
        const fullText = activeRun.map(l => l + newlineChar).join('');
        emittedCharsOut += fullText.length;
        onEmit(fullText);
      }
    } else if (currentRunType === 'dir_list') {
      if (activeRun.length >= 50 && opts.cleanDirectoryListingOutput !== false) {
        const head = activeRun.slice(0, 25);
        const tail = activeRun.slice(-10);
        const omittedCount = activeRun.length - 35;
        let chunkNotice = '';
        try {
          const { storeChunk } = require('./chunk-store');
          const chunkId = storeChunk(activeRun.join(newlineChar), { type: 'dir_listing', count: activeRun.length });
          if (chunkId) chunkNotice = ` [CCR: agy_retrieve_chunk(chunk_id="${chunkId}")]`;
        } catch (_) {}
        const foldedText = [...head, `[Directory Listing: ${omittedCount} file entries folded]${chunkNotice}`, ...tail]
          .map(l => l + newlineChar)
          .join('');
        emittedCharsOut += foldedText.length;
        onEmit(foldedText);
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

    if (!line.trim() && rawLine.trim() && !inSourceGitDiff) {
      return;
    }

    if (isAnyDiffHeader(line)) {
      inSourceGitDiff = !Boolean(isLockfileDiffHeader(line));
    }

    // Strip PowerShell Format-Table / console trailing padding spaces (preserve single-space git diff empty context line)
    if (!inSourceGitDiff || line.length > 1) {
      line = line.replace(/[ \t]+$/, '');
    }

    // Collapse multiple consecutive blank lines into at most 1 blank line outside git diffs
    if (!inSourceGitDiff && line.length === 0) {
      consecutiveBlankCount += 1;
      if (consecutiveBlankCount > 1) {
        return;
      }
    } else {
      consecutiveBlankCount = 0;
    }

    // Git Diff streaming state machine for lockfiles
    if (opts.foldLockfiles !== false) {
      if (currentRunType === 'diff_lockfile') {
        if (opts.exemptMergeConflicts !== false && (line.startsWith('<<<<<<<') || line.startsWith('=======') || line.startsWith('>>>>>>>') || line.startsWith('|||||||'))) {
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

    if (opts.cleanBuildOutput !== false && isBuildNoiseLine(line)) {
      if (currentRunType && currentRunType !== 'build') {
        flushActiveRun();
      }
      currentRunType = 'build';
      activeRun.push(line);
      return;
    }

    if (opts.cleanLogBurstOutput !== false && isRoutineLogLine(line)) {
      if (currentRunType && currentRunType !== 'log_burst') {
        flushActiveRun();
      }
      currentRunType = 'log_burst';
      activeRun.push(line);
      return;
    }

    if (opts.cleanDirectoryListingOutput !== false && isDirectoryListingLine(line)) {
      if (currentRunType && currentRunType !== 'dir_list') {
        flushActiveRun();
      }
      currentRunType = 'dir_list';
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
    // Only record a telemetry invocation when meaningful denoising occurred (>= 80 chars saved or >= 4% ratio),
    // preventing 10-byte CRLF pass-throughs on large clean files from diluting compressionRatio or spamming Recent Events!
    const ratio = rawCharsIn > 0 ? savedChars / rawCharsIn : 0;
    const isMeaningfulCompression = savedChars >= 80 || (savedChars >= 25 && ratio >= 0.04);

    if (isMeaningfulCompression && opts.recordTelemetry !== false) {
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
 * OpenCode-DCP (Dynamic Context Pruning) 3-Stage Historical Tool Output Condenser.
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

  const lastToolMsg = messages[toolIndices[toolIndices.length - 1]];
  const lastToolStr = typeof lastToolMsg?.content === 'string' ? lastToolMsg.content : '';
  const recentTurnHealthy = !ERROR_REGEX.test(lastToolStr);

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

    if (deduplicateReads && callMeta && callMeta.targetFile && /(?:view_file|read_file|compact_view_file)/.test(callMeta.fnName)) {
      const rKey = `${callMeta.targetFile}#${callMeta.sliceKey}`;
      const latestIdx = latestReadIdxByKey.get(rKey);
      if (latestIdx !== undefined && latestIdx > idx) {
        pruneReason = 'Duplicate file read superseded by newer read';
      }
    }

    if (!pruneReason && supersedeWrites && callMeta && callMeta.targetFile && /(?:view_file|read_file|compact_view_file)/.test(callMeta.fnName)) {
      const writeIdx = latestWriteIdxByFile.get(callMeta.targetFile);
      if (writeIdx !== undefined && writeIdx > idx) {
        pruneReason = 'Stale file read superseded by subsequent file edit';
      }
    }

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

/**
 * Runs a comprehensive built-in multi-scenario benchmark verifying compression ratio and zero-downgrade safety.
 */
function runCompressionBenchmark() {
  const { extractCodeSkeleton } = require('./skeleton');

  const scenarios = [];

  // 1. Test Suite with Failure & Stack Trace
  const testInput = [
    ...Array.from({ length: 80 }, (_, i) => `\u001b[32m✓\u001b[0m test suite case #${i + 1}: verifies module behavior (${(i % 9) + 1}ms)`),
    '\u001b[31m✕\u001b[0m test suite case #81: handles edge case',
    '  AssertionError [ERR_ASSERTION]: Expected 200 to strictly equal 500',
    '      at Context.<anonymous> (src/api/router.test.js:142:14)'
  ].join('\n');
  const testOut = compactOutput(testInput, { recordTelemetry: false });
  scenarios.push({
    name: 'Card 1: RTK 大型测试套件去噪 (80 通过 + 1 报错堆栈)',
    originalChars: testInput.length,
    compressedChars: testOut.length,
    ratio: Number(((1 - testOut.length / testInput.length) * 100).toFixed(1)),
    safetyPassed: testOut.includes('AssertionError') && testOut.includes('router.test.js:142:14') && testOut.includes('80 passed tests folded')
  });

  // 2. Lockfile Git Diff + Conflict Safety
  const lockDiffInput = [
    'diff --git a/package-lock.json b/package-lock.json',
    'index 1111111..2222222 100644',
    '--- a/package-lock.json',
    '+++ b/package-lock.json',
    '@@ -10,150 +10,150 @@',
    ...Array.from({ length: 150 }, (_, i) => `+    "pkg-dep-${i}": { "version": "1.2.${i}", "resolved": "https://registry.npmjs.org/pkg-dep-${i}/-/pkg-dep-${i}-1.2.${i}.tgz" },`)
  ].join('\n');
  const lockDiffOut = compactOutput(lockDiffInput, { recordTelemetry: false });
  scenarios.push({
    name: 'Card 2: Headroom 依赖锁文件 Diff 折叠 (150 行)',
    originalChars: lockDiffInput.length,
    compressedChars: lockDiffOut.length,
    ratio: Number(((1 - lockDiffOut.length / lockDiffInput.length) * 100).toFixed(1)),
    safetyPassed: lockDiffOut.includes('Lockfile diff folded') && lockDiffOut.includes('CCR Chunk:')
  });

  // 3. Giant Homogeneous JSON Array (SmartCrusher)
  const jsonInput = JSON.stringify(
    Array.from({ length: 100 }, (_, i) => ({
      id: i + 1,
      username: `user_${i + 1}`,
      email: `user_${i + 1}@example.com`,
      status: 'active',
      role: 'member'
    })),
    null,
    2
  );
  const jsonOut = compactOutput(jsonInput, { recordTelemetry: false });
  scenarios.push({
    name: 'Card 2: SmartCrusher 100 项同构 JSON 数组采样',
    originalChars: jsonInput.length,
    compressedChars: jsonOut.length,
    ratio: Number(((1 - jsonOut.length / jsonInput.length) * 100).toFixed(1)),
    safetyPassed: jsonOut.includes('SmartCrusher:') && jsonOut.includes('user_1') && jsonOut.includes('user_100')
  });

  // 4. AST Code Skeleton Extraction
  const codeInput = Array.from({ length: 20 }, (_, i) => [
    `export async function processOrderStep${i + 1}(orderId, payload = { retry: true }) {`,
    `  const start = Date.now();`,
    `  const normalized = JSON.stringify(payload);`,
    `  for (let k = 0; k < 10; k++) {`,
    `    console.debug("step", k, orderId, normalized);`,
    `  }`,
    `  return { ok: true, elapsed: Date.now() - start };`,
    `}`
  ].join('\n')).join('\n\n');
  const codeOut = extractCodeSkeleton(codeInput, 'service.ts');
  scenarios.push({
    name: 'Card 6: Aider 词法级 AST 代码骨架提取 (20 个函数)',
    originalChars: codeInput.length,
    compressedChars: codeOut.length,
    ratio: Number(((1 - codeOut.length / codeInput.length) * 100).toFixed(1)),
    safetyPassed: codeOut.includes('processOrderStep1') && codeOut.includes('processOrderStep20') && codeOut.includes('[Line 1-8]')
  });

  // 5. OpenCode-DCP 3-Stage Historical Pruning
  const histMessages = [
    { role: 'assistant', content: '', tool_calls: [{ id: 'c1', function: { name: 'view_file', arguments: '{"AbsolutePath":"/src/app.js"}' } }] },
    { role: 'tool', tool_call_id: 'c1', content: '// app.js v1\n'.repeat(120) },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c2', function: { name: 'replace_file_content', arguments: '{"TargetFile":"/src/app.js"}' } }] },
    { role: 'tool', tool_call_id: 'c2', content: 'Updated /src/app.js successfully' },
    { role: 'assistant', content: '', tool_calls: [{ id: 'c3', function: { name: 'view_file', arguments: '{"AbsolutePath":"/src/app.js"}' } }] },
    { role: 'tool', tool_call_id: 'c3', content: '// app.js v2\n'.repeat(120) }
  ];
  const origHistLen = JSON.stringify(histMessages).length;
  const prunedRes = pruneHistoricalToolOutputs(histMessages, { keepRecentToolTurns: 6, recordTelemetry: false });
  const compHistLen = JSON.stringify(prunedRes.messages).length;
  scenarios.push({
    name: 'Card 7: OpenCode-DCP 历史重复读/写前旧快照剪枝',
    originalChars: origHistLen,
    compressedChars: compHistLen,
    ratio: Number(((1 - compHistLen / origHistLen) * 100).toFixed(1)),
    safetyPassed: prunedRes.prunedCount === 1 && prunedRes.messages[5].content.includes('// app.js v2')
  });

  const totalOriginalChars = scenarios.reduce((acc, s) => acc + s.originalChars, 0);
  const totalCompressedChars = scenarios.reduce((acc, s) => acc + s.compressedChars, 0);
  const overallRatio = Number(((1 - totalCompressedChars / totalOriginalChars) * 100).toFixed(1));
  const allPassed = scenarios.every(s => s.safetyPassed && s.ratio > 30);

  return {
    scenarios,
    totalOriginalChars,
    totalCompressedChars,
    overallRatio,
    allPassed
  };
}

module.exports = {
  COMPACTOR_PRESETS,
  getActivePreset,
  setActivePreset,
  registerCompressionStage,
  unregisterCompressionStage,
  getCompressionStages,
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
  cleanBuildOutput,
  foldDuplicateLines,
  cleanLogBurstOutput,
  cleanDirectoryListingOutput,
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
  pruneHistoricalToolOutputs,
  runCompressionBenchmark
};
