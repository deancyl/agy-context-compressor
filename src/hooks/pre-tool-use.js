/**
 * AGY PreToolUse Hook Implementation
 * Intercepts run_command and applies PowerShell escaping fixes and automated stream compaction.
 */

const path = require('node:path');
const { fixPowerShellCommandEscaping } = require('../core/powershell');
const { recordPowerShellFix } = require('../core/telemetry');

const STREAM_FILTER_PATH = path.resolve(__dirname, 'stream-filter.js');

// High-noise commands that produce hundreds/thousands of lines of ANSI, progress bars, or passing tests
const HIGH_NOISE_COMMANDS_REGEX = /\b(?:npm\s+(?:run\s+)?test|npx\s+(?:jest|vitest|mocha)|pytest|cargo\s+test|go\s+test|mvn\s+test|gradle\s+test|dotnet\s+test|docker\s+(?:pull|build)|terraform\s+(?:refresh|plan)|git\s+diff)\b/i;

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

    // 2. Automated High-Noise Stream Compaction (Active by default unless explicitly disabled)
    const shouldWrap = options.wrapHighNoiseCommands !== false;
    if (shouldWrap && !optimizedCmd.includes('stream-filter.js')) {
      const isHighNoise = HIGH_NOISE_COMMANDS_REGEX.test(rawCmd);
      // Avoid breaking existing file redirections (> or >> or Out-File)
      const hasOutputRedirection = />|Out-File|Set-Content/i.test(optimizedCmd);

      if (isHighNoise && !hasOutputRedirection) {
        const filterPathEscaped = STREAM_FILTER_PATH.replace(/\\/g, '/');
        optimizedCmd = `${optimizedCmd} | node "${filterPathEscaped}"`;
      }
    }

    if (optimizedCmd !== rawCmd) {
      if (options.recordTelemetry !== false) {
        recordPowerShellFix();
      }
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
