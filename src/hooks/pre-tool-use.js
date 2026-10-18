/**
 * AGY PreToolUse Hook Implementation
 * Intercepts run_command and applies PowerShell escaping fixes and automated stream compaction.
 */

const path = require('node:path');
const { fixPowerShellCommandEscaping } = require('../core/powershell');
const { recordPowerShellFix } = require('../core/telemetry');

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

  if (toolName === 'run_command') {
    const rawCmd = args.CommandLine || '';
    if (!rawCmd) {
      return { decision: 'allow' };
    }

    // 1. Fix Windows PowerShell escaping & alias traps
    let optimizedCmd = fixPowerShellCommandEscaping(rawCmd, options);
    const hasEscapingFix = optimizedCmd !== rawCmd;

    if (hasEscapingFix && options.recordTelemetry !== false) {
      recordPowerShellFix();
    }

    // 2. Automated High-Noise Stream Compaction (Active by default unless explicitly disabled)
    const shouldWrap = options.wrapHighNoiseCommands !== false;
    if (shouldWrap && !optimizedCmd.includes('stream-filter.js')) {
      const isHighNoise = HIGH_NOISE_COMMANDS_REGEX.test(rawCmd);
      // Avoid breaking existing file redirections (> or >> or Out-File) or existing pipes to pager/stream-filter
      const hasOutputRedirection = />|Out-File|Set-Content/i.test(optimizedCmd);
      const hasExistingFilter = /\|\s*node\s+.*stream-filter/i.test(optimizedCmd);

      if (isHighNoise && !hasOutputRedirection && !hasExistingFilter) {
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

  return { decision: 'allow' };
}

module.exports = {
  handlePreToolUse,
  HIGH_NOISE_COMMANDS_REGEX
};
