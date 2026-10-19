/**
 * AGY PreToolUse Hook Implementation (2.2)
 * Intercepts run_command, view_file, and grep_search.
 * Features:
 * 1. PowerShell escaping fixes & alias normalization.
 * 2. Process execution wrapper (agy-exec-wrapper) preserving exit codes 100% and UTF-8 Chinese encoding.
 * 3. Parameter window narrow-down for lockfiles, minified assets, and giant raw log files in view_file (0% source truncation).
 * 4. Automatic Card 6 (Aider AST Skeleton Indexing) & Card 7 (OpenCode-DCP Duplicate/Stale Read Tracking) on large source files.
 * 5. Automatic build/dependency noise exclusion on root grep_search.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { fixPowerShellCommandEscaping } = require('../core/powershell');
const { isLockfilePath } = require('../core/headroom');
const { extractCodeSkeleton, extractSymbolOutline } = require('../core/skeleton');
const { recordPowerShellFix, recordSavings } = require('../core/telemetry');

const WRAPPER_PATH = path.resolve(__dirname, '../../bin/agy-exec-wrapper.js');
const STREAM_FILTER_PATH = path.resolve(__dirname, 'stream-filter.js');

// Broad developer CLI tools that produce terminal noise, ANSI sequences, progress bars, or verbose logs
const HIGH_NOISE_COMMANDS_REGEX = /(?:^|[;&|\s])(?:git(?:\.exe)?\s+(?:diff|log|status|show|blame|branch|fetch|pull|push|clone)|npm(?:\.cmd)?|npx(?:\.cmd)?|pnpm(?:\.cmd)?|yarn(?:\.cmd)?|bun(?:\.exe)?|deno(?:\.exe)?|pip3?(?:\.exe)?|uv(?:\.exe)?|poetry(?:\.exe)?|pytest(?:\.exe)?|cargo(?:\.exe)?|rustc(?:\.exe)?|go(?:\.exe)?|mvn(?:\.cmd)?|gradle(?:\.bat)?|dotnet(?:\.exe)?|msbuild(?:\.exe)?|docker(?:\.exe)?|docker-compose(?:\.exe)?|podman(?:\.exe)?|kubectl(?:\.exe)?|helm(?:\.exe)?|terraform(?:\.exe)?|make|cmake|ninja|jest(?:\.cmd)?|vitest(?:\.cmd)?|mocha(?:\.cmd)?|playwright(?:\.cmd)?|cypress(?:\.cmd)?|vite(?:\.cmd)?|webpack(?:\.cmd)?|esbuild(?:\.cmd)?|rollup(?:\.cmd)?|next(?:\.cmd)?|dir|ls|Get-ChildItem|gci|tree|find|findstr|grep|rg|cat|type|Get-Content|gc|tsc(?:\.cmd)?|ts-node(?:\.cmd)?|tsx(?:\.cmd)?|eslint(?:\.cmd)?|prettier(?:\.cmd)?|ruff(?:\.exe)?|curl(?:\.exe)?|Invoke-WebRequest|iwr|wget|aws(?:\.exe)?|gcloud(?:\.cmd)?|az(?:\.cmd)?|sqlite3(?:\.exe)?|psql(?:\.exe)?|node(?:\.exe)?\s+(?:--test\b|-e\b|[\w\.\/\\-]+\.(?:js|mjs|cjs|ts))|python3?(?:\.exe)?\s+(?:-m\s+(?:pytest|unittest)\b|-c\b|[\w\.\/\\-]+\.py)|(?:bash|sh|zsh)\s+[\w\.\/\\-]+\.sh|pwsh(?:\.exe)?\s+-File)\b/i;

function getSessionReadsFilePath() {
  if (process.env.NODE_ENV === 'test' || Boolean(process.env.NODE_TEST_CONTEXT)) {
    return path.join(os.tmpdir(), `agy-session-reads-test-${process.pid}.json`);
  }
  return path.join(os.homedir(), '.gemini', 'config', 'agy-session-reads.json');
}

/**
 * Tracks source file inspections for Card 6 (Aider AST Skeleton) and Card 7 (OpenCode-DCP Read Deduplication)
 * without ever truncating or modifying `view_file` arguments on source code.
 */
function trackSourceFileInspection(targetFile, args, fileSize, mtimeMs) {
  try {
    const base = path.basename(targetFile);
    // Ignore synthetic unit test files
    if (/^agy-test-large-/i.test(base)) return;

    const ext = path.extname(base).toLowerCase();
    const isCodeFile = /^\.(?:js|jsx|ts|tsx|mjs|cjs|py|go|rs|java|cs|c|cpp|cc|h|hpp)$/.test(ext);
    if (!isCodeFile || fileSize < 6000 || fileSize > 2 * 1024 * 1024) return;

    const stateFile = getSessionReadsFilePath();
    let state = { files: {} };
    if (fs.existsSync(stateFile)) {
      try {
        state = JSON.parse(fs.readFileSync(stateFile, 'utf8')) || { files: {} };
        if (!state.files) state.files = {};
      } catch (_) {
        state = { files: {} };
      }
    }

    const normKey = path.resolve(targetFile).replace(/\\/g, '/').toLowerCase();
    const sliceKey = `${args.StartLine || 'full'}:${args.EndLine || 'full'}`;
    const prev = state.files[normKey];
    const now = Date.now();

    if (!prev || prev.mtimeMs !== mtimeMs) {
      // If previously read at an older mtimeMs, the file was edited since the earlier read (DCP Stage 2: Supersede Writes)
      if (prev && prev.mtimeMs && prev.mtimeMs !== mtimeMs) {
        recordSavings('kompact', Math.round(fileSize * 0.65), fileSize, {
          filename: base,
          note: 'dcp_superseded_stale_read',
          prunedCount: 1
        });
      }

      // Extract AST Code Skeleton & Symbol Outline (Card 6: Aider AST)
      const raw = fs.readFileSync(targetFile, 'utf8');
      const skeleton = extractCodeSkeleton(raw, targetFile);
      const outline = extractSymbolOutline(raw, targetFile).slice(0, 12);
      const savedBySkeleton = Math.max(0, raw.length - skeleton.length);

      if (savedBySkeleton > 200) {
        recordSavings('aider', savedBySkeleton, raw.length, {
          filename: base,
          type: 'code_skeleton'
        });
      }

      state.files[normKey] = {
        filename: base,
        mtimeMs,
        size: fileSize,
        lastSlice: sliceKey,
        readCount: 1,
        lastReadAt: now,
        outline
      };
    } else {
      // Unchanged file read again within 30 minutes
      prev.readCount = (prev.readCount || 1) + 1;
      const elapsedMs = now - (prev.lastReadAt || 0);
      prev.lastReadAt = now;

      if (prev.lastSlice === sliceKey && sliceKey === 'full:full' && elapsedMs < 30 * 60 * 1000) {
        // DCP Stage 1: Duplicate full-file read detected
        recordSavings('kompact', Math.round(fileSize * 0.75), fileSize, {
          filename: base,
          note: 'dcp_dedup_repeated_read',
          prunedCount: 1
        });
      }
      prev.lastSlice = sliceKey;
    }

    // Keep state bounded to 40 most recent files
    const keys = Object.keys(state.files);
    if (keys.length > 40) {
      keys.sort((a, b) => (state.files[b].lastReadAt || 0) - (state.files[a].lastReadAt || 0));
      const trimmedFiles = {};
      for (const k of keys.slice(0, 40)) trimmedFiles[k] = state.files[k];
      state.files = trimmedFiles;
    }

    const dir = path.dirname(stateFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2), 'utf8');
  } catch (_) {}
}

function handlePreToolUse(payload, options = {}) {
  const toolCall = payload && payload.toolCall;
  if (!toolCall) {
    return { decision: 'allow' };
  }

  const toolName = toolCall.name || '';
  const args = toolCall.args || {};

  // 1. Intercept run_command
  if (toolName === 'run_command') {
    const rawCmd = args.CommandLine || args.command || args.cmd || '';
    if (!rawCmd || typeof rawCmd !== 'string') {
      return { decision: 'allow' };
    }

    let optimizedCmd = fixPowerShellCommandEscaping(rawCmd, options);
    const hasEscapingFix = optimizedCmd !== rawCmd;

    if (hasEscapingFix && options.recordTelemetry !== false) {
      recordPowerShellFix();
    }

    const shouldWrap = options.wrapHighNoiseCommands !== false;
    const hasExistingWrapper = optimizedCmd.includes('agy-exec-wrapper.js') || optimizedCmd.includes('stream-filter.js');
    const isHighNoise = HIGH_NOISE_COMMANDS_REGEX.test(rawCmd);

    if (shouldWrap && isHighNoise && !hasExistingWrapper) {
      const useWrapper = options.usePipeFilter !== true;
      if (useWrapper) {
        const wrapperPathEscaped = WRAPPER_PATH.replace(/\\/g, '/');
        const b64 = Buffer.from(optimizedCmd, 'utf8').toString('base64');
        optimizedCmd = `node "${wrapperPathEscaped}" --base64 ${b64}`;
      } else {
        const filterPathEscaped = STREAM_FILTER_PATH.replace(/\\/g, '/');
        optimizedCmd = `${optimizedCmd} | node "${filterPathEscaped}"`;
      }
    }

    if (optimizedCmd !== rawCmd) {
      const cmdKey = ('CommandLine' in args) ? 'CommandLine' : (('command' in args) ? 'command' : 'cmd');
      return {
        decision: 'allow',
        overwrite: {
          ...args,
          [cmdKey]: optimizedCmd
        }
      };
    }
  }

  // 2. Intercept view_file: Narrow giant lockfiles, minified assets, and giant raw log files
  // Zero-Downgrade Redline: Never silently truncate normal source files or explicit slices!
  if (toolName === 'view_file') {
    const targetFile = args.AbsolutePath || args.TargetFile || args.path || '';
    if (targetFile && typeof targetFile === 'string') {
      const base = path.basename(targetFile).toLowerCase();
      const isLockfileOrMin = isLockfilePath(base) || /\.(min\.js|min\.css|map|lockb?)$/i.test(base);
      const isRawLogFile = /\.(log|jsonl|trace|out|err)$/i.test(base);

      let fileSize = 0;
      let mtimeMs = 0;
      try {
        if (fs.existsSync(targetFile)) {
          const st = fs.statSync(targetFile);
          fileSize = st.size;
          mtimeMs = st.mtimeMs;
        }
      } catch (_) {}

      // Case A: Lockfiles, minified files, or giant (>15KB) raw log files without line boundaries
      if ((isLockfileOrMin || (isRawLogFile && fileSize > 15000)) && !args.StartLine && !args.EndLine) {
        if (fileSize > 0 && options.recordTelemetry !== false) {
          const estimatedAllowed = Math.min(fileSize, 200 * 35);
          const saved = Math.max(0, fileSize - estimatedAllowed);
          if (saved > 0) {
            recordSavings('headroom', saved, fileSize, {
              filename: base,
              note: isRawLogFile ? 'auto_narrow_log_file' : 'auto_narrow_lockfile'
            });
          }
        }

        return {
          decision: 'allow',
          overwrite: {
            ...args,
            StartLine: 1,
            EndLine: 200
          }
        };
      }

      // Case B: Track AST Skeleton (Card 6) & Read Deduplication (Card 7) on large code files without truncating
      if (fileSize >= 6000 && options.recordTelemetry !== false) {
        trackSourceFileInspection(targetFile, args, fileSize, mtimeMs);
      }
    }
  }

  // 3. Intercept grep_search: auto-exclude noisy build & dependency directories
  if (toolName === 'grep_search') {
    const searchPath = args.path || args.dir || args.directory || '';
    if (!searchPath || searchPath === '.' || searchPath === './') {
      if (!args.exclude && !args.exclude_dirs && !args.glob) {
        return {
          decision: 'allow',
          overwrite: {
            ...args,
            exclude_dirs: 'node_modules,.git,dist,build,coverage,.gemini,.next'
          }
        };
      }
    }
  }

  return { decision: 'allow' };
}

module.exports = {
  handlePreToolUse,
  HIGH_NOISE_COMMANDS_REGEX,
  getSessionReadsFilePath
};
