/**
 * AGY PreToolUse Hook Implementation
 * Intercepts run_command, view_file, and grep_search.
 * Features:
 * 1. PowerShell escaping fixes & alias normalization.
 * 2. Process execution wrapper (agy-exec-wrapper) preserving exit codes 100%.
 * 3. Parameter window narrow-down for lockfiles & giant files in view_file.
 */

const fs = require('node:fs');
const path = require('node:path');
const { fixPowerShellCommandEscaping } = require('../core/powershell');
const { isLockfilePath } = require('../core/headroom');
const { recordPowerShellFix, recordSavings } = require('../core/telemetry');

const WRAPPER_PATH = path.resolve(__dirname, '../../bin/agy-exec-wrapper.js');
const STREAM_FILTER_PATH = path.resolve(__dirname, 'stream-filter.js');

// Broad developer CLI tools that produce terminal noise, ANSI sequences, progress bars, or verbose logs
const HIGH_NOISE_COMMANDS_REGEX = /(?:^|[;&|\s])(?:git(?:\.exe)?\s+(?:diff|log|status|show|blame|branch)|npm(?:\.cmd)?|npx(?:\.cmd)?|pnpm(?:\.cmd)?|yarn(?:\.cmd)?|bun(?:\.exe)?|deno(?:\.exe)?|pip(?:\.exe)?|poetry(?:\.exe)?|pytest(?:\.exe)?|cargo(?:\.exe)?|go(?:\.exe)?|mvn(?:\.cmd)?|gradle(?:\.bat)?|dotnet(?:\.exe)?|docker(?:\.exe)?|podman(?:\.exe)?|kubectl(?:\.exe)?|terraform(?:\.exe)?|dir|ls|Get-ChildItem|gci|tree|find|findstr|grep|rg|cat|type|Get-Content|gc|tsc(?:\.cmd)?|eslint(?:\.cmd)?|prettier(?:\.cmd)?|ruff(?:\.exe)?|curl(?:\.exe)?|Invoke-WebRequest|iwr|wget)\b/i;

function handlePreToolUse(payload, options = {}) {
  const toolCall = payload && payload.toolCall;
  if (!toolCall) {
    return { decision: 'allow' };
  }

  const toolName = toolCall.name || '';
  const args = toolCall.args || {};

  // 1. Intercept run_command
  if (toolName === 'run_command') {
    const rawCmd = args.CommandLine || '';
    if (!rawCmd) {
      return { decision: 'allow' };
    }

    // Windows PowerShell escaping & alias traps fix
    let optimizedCmd = fixPowerShellCommandEscaping(rawCmd, options);
    const hasEscapingFix = optimizedCmd !== rawCmd;

    if (hasEscapingFix && options.recordTelemetry !== false) {
      recordPowerShellFix();
    }

    // High-Noise Command wrapping via Execution Wrapper
    const shouldWrap = options.wrapHighNoiseCommands !== false;
    const hasExistingWrapper = optimizedCmd.includes('agy-exec-wrapper.js') || optimizedCmd.includes('stream-filter.js');
    const isHighNoise = HIGH_NOISE_COMMANDS_REGEX.test(rawCmd);

    if (shouldWrap && isHighNoise && !hasExistingWrapper) {
      const useWrapper = options.usePipeFilter !== true;
      if (useWrapper) {
        const wrapperPathEscaped = WRAPPER_PATH.replace(/\\/g, '/');
        const needsBase64 = options.useBase64 || /[;&|\n\r]/.test(optimizedCmd);
        if (needsBase64) {
          const b64 = Buffer.from(optimizedCmd, 'utf8').toString('base64');
          optimizedCmd = `node "${wrapperPathEscaped}" --base64 ${b64}`;
        } else {
          optimizedCmd = `node "${wrapperPathEscaped}" -- ${optimizedCmd}`;
        }
      } else {
        const filterPathEscaped = STREAM_FILTER_PATH.replace(/\\/g, '/');
        optimizedCmd = `${optimizedCmd} | node "${filterPathEscaped}"`;
      }
    }

    if (optimizedCmd !== rawCmd) {
      return {
        decision: 'allow',
        overwrite: {
          CommandLine: optimizedCmd
        }
      };
    }
  }

  // 2. Intercept view_file: Narrow giant lockfiles and minified assets
  if (toolName === 'view_file') {
    const targetFile = args.AbsolutePath || args.TargetFile || args.path || '';
    if (targetFile && typeof targetFile === 'string') {
      const base = path.basename(targetFile).toLowerCase();
      const isLockfileOrMin = isLockfilePath(base) || /\.(min\.js|min\.css|map|lockb?)$/i.test(base);

      // If viewing a lockfile or minified file without explicitly requesting line boundaries
      if (isLockfileOrMin && !args.StartLine && !args.EndLine) {
        let fileSize = 0;
        try {
          if (fs.existsSync(targetFile)) {
            fileSize = fs.statSync(targetFile).size;
          }
        } catch (_) {}

        if (fileSize > 0 && options.recordTelemetry !== false) {
          const estimatedAllowed = Math.min(fileSize, 200 * 35);
          const saved = Math.max(0, fileSize - estimatedAllowed);
          if (saved > 0) {
            recordSavings('headroom', saved, fileSize, { filename: base, note: 'auto_narrow_lockfile' });
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
    }
  }

  return { decision: 'allow' };
}

module.exports = {
  handlePreToolUse,
  HIGH_NOISE_COMMANDS_REGEX
};
