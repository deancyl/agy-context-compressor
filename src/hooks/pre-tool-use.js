/**
 * AGY PreToolUse Hook Implementation
 * Intercepts run_command and applies PowerShell escaping fixes and optional output compaction.
 */

const path = require('node:path');
const { fixPowerShellCommandEscaping } = require('../core/powershell');

const STREAM_FILTER_PATH = path.resolve(__dirname, 'stream-filter.js');

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

    // 2. Optional: Wrap high-noise test / build commands with stream compactor
    if (options.wrapHighNoiseCommands === true) {
      const isHighNoise = /\b(?:npm\s+test|npx\s+(?:jest|vitest)|pytest|cargo\s+test|go\s+test|mvn\s+test)\b/i.test(rawCmd);
      if (isHighNoise && !optimizedCmd.includes('stream-filter.js')) {
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
  handlePreToolUse
};
