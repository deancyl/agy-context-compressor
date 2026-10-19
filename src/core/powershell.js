/**
 * Card 5: Windows PowerShell Escaping & Platform Adaptation Optimizer
 * 100% native Node.js zero dependencies.
 * Automatically cleans CLIXML noise and fixes Windows PowerShell syntax traps.
 */

const { detectPlatform } = require('../utils/platform');

const DEFAULT_POWERSHELL_CONFIG = {
  enabled: true,
  autoDetectPlatform: true,
  cleanCliXmlNoise: true,
  cleanPowerShell7Noise: true,
  fixQuoteEscaping: true,
  fixCurlAlias: true,
  fixTrailingSlash: true,
  fixAndOperator: true,
  fixLineContinuation: true,
  fixSubexpressionEscaping: true
};

/**
 * Cleans CLIXML error wrappers, PowerShell banners, and CategoryInfo blocks.
 * @param {string} text
 * @returns {string}
 */
function cleanPowerShellNoise(text) {
  if (typeof text !== 'string' || text.length === 0) return text;

  try {
    let result = text;

    // 1. Parse and extract payload from #< CLIXML stream
    if (result.includes('#< CLIXML')) {
      const unescapeHex = (str) => {
        return str
          .replace(/_x([0-9a-fA-F]{4})_/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'")
          .replace(/&lt;/g, '<')
          .replace(/&gt;/g, '>')
          .replace(/&amp;/g, '&');
      };

      const errorParts = [];
      const errTagRegex = /<S S="Error">([^<]*)<\/S>/g;
      let match;
      while ((match = errTagRegex.exec(result)) !== null) {
        if (match[1]) {
          errorParts.push(unescapeHex(match[1]));
        }
      }

      if (errorParts.length > 0) {
        let extractedError = errorParts.join('').trim();
        extractedError = extractedError.replace(/(\r?\n){3,}/g, '$1$1');
        result = result.replace(/#<\s*CLIXML[\s\S]*?<\/Objs>/g, extractedError ? `[PowerShell Error]:\n${extractedError}` : '');
      } else {
        result = result.replace(/#<\s*CLIXML[\s\S]*?<\/Objs>/g, '[PowerShell Error Output Cleaned]');
      }
    }

    // 2. Clean verbose CategoryInfo and FullyQualifiedErrorId blocks
    if (result.includes('CategoryInfo') || result.includes('FullyQualifiedErrorId')) {
      const isCrlf = result.includes('\r\n');
      const newline = isCrlf ? '\r\n' : '\n';
      const lines = result.split(/\r?\n/);
      const filtered = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (/^\+\s*CategoryInfo\s*:/i.test(trimmed) || /^\+\s*FullyQualifiedErrorId\s*:/i.test(trimmed)) {
          continue;
        }
        filtered.push(line);
      }
      result = filtered.join(newline);
    }

    // 3. Clean PowerShell startup terminal banner
    if (result.includes('PowerShell ') && result.includes('Windows_NT')) {
      result = result.replace(/^[^\r\n]*?PowerShell\s+\d+(?:\.\d+)*\s+on\s+Windows_NT\r?\n?/gm, '');
    }

    // 4. Clean Git CRLF replacement warning noise
    if (result.includes('LF will be replaced by CRLF') || result.includes('CRLF will be replaced by LF')) {
      const crlfWarnRegex = /^warning:\s*(?:in the working copy of [^\r\n]+,\s*)?(?:LF|CRLF) will be replaced by (?:CRLF|LF)[^\r\n]*\r?\n?/gm;
      result = result.replace(crlfWarnRegex, '');
    }

    // 5. Clean Windows Terminal ANSI title sequences
    if (result.includes('\x1b]0;')) {
      result = result.replace(/\x1b]0;[^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
    }

    // 6. Clean PowerShell 7 repetitive syntax / cmdlet error boilerplate noise
    if (result.includes('Line |') || result.includes('Check the spelling of the name')) {
      const lineNoiseRegex = /(?:^|\r?\n)\s*Line\s*\|\r?\n\s*\d+\s*\|\s*[^\r\n]*\r?\n\s*\|\s*~+\r?\n\s*\|\s*/g;
      result = result.replace(lineNoiseRegex, '\n');
      const adviceRegex = /\r?\n?Check the spelling of the name, or if a path was included, verify that the path is correct and try again\.\r?\n?/g;
      result = result.replace(adviceRegex, '\n');
    }

    return result;
  } catch (err) {
    return text;
  }
}

/**
 * Normalizes and fixes common PowerShell escaping traps in a shell command.
 * Strictly preserves command semantics without breaking valid scripts.
 * @param {string} cmd
 * @param {object} options
 * @returns {string}
 */
function fixPowerShellCommandEscaping(cmd, options = {}) {
  if (typeof cmd !== 'string' || cmd.trim().length === 0) return cmd;

  const cfg = { ...DEFAULT_POWERSHELL_CONFIG, ...(options.powershell || options) };
  if (cfg.enabled === false) return cmd;

  if (cfg.autoDetectPlatform !== false) {
    const platform = detectPlatform(options);
    if (!platform.isWindows) return cmd; // Bypass on Linux/macOS
  }

  let result = cmd;

  try {
    // 1. Fix curl / wget alias trap in Windows PowerShell
    if (cfg.fixCurlAlias !== false) {
      result = result.replace(/(^|[;&|]\s*)curl(?=\s+["'-])/g, '$1curl.exe');
      result = result.replace(/(^|[;&|]\s*)curl(?=\s+[a-zA-Z0-9_./\\])/g, '$1curl.exe');
      result = result.replace(/(^|[;&|]\s*)wget(?=\s+["'-])/g, '$1wget.exe');
      result = result.replace(/(^|[;&|]\s*)wget(?=\s+[a-zA-Z0-9_./\\])/g, '$1wget.exe');
    }

    // 2. Fix Trailing Backslash Quote Eating (CommandLineToArgvW CRT trap)
    // "C:\path\" -> "C:\path\\"
    if (cfg.fixTrailingSlash !== false) {
      result = result.replace(/(")(?:[A-Za-z]:\\[^"\r\n]*?)(\\)(?=")/g, (match) => {
        return match + '\\';
      });
    }

    // 3. Fix multiline trailing backslash line continuation
    if (cfg.fixLineContinuation !== false && result.includes('\n')) {
      result = result.replace(/([^\\])\\\s*(\r?\n)/g, '$1`$2');
    }

    // 4. Fix && and || operators for Windows PowerShell 5.1 compatibility
    if (cfg.fixAndOperator !== false && result.includes(' && ') && !result.includes('; if ($?)')) {
      let inSingleQuote = false;
      let inDoubleQuote = false;
      let buffer = '';
      let i = 0;
      let andCount = 0;

      while (i < result.length) {
        const char = result[i];
        if (char === "'" && !inDoubleQuote) {
          inSingleQuote = !inSingleQuote;
          buffer += char;
          i++;
        } else if (char === '"' && !inSingleQuote) {
          const prevChar = i > 0 ? result[i - 1] : '';
          if (prevChar !== '`') {
            inDoubleQuote = !inDoubleQuote;
          }
          buffer += char;
          i++;
        } else if (!inSingleQuote && !inDoubleQuote && result.slice(i, i + 4) === ' && ') {
          buffer += '; if ($?) { ';
          andCount++;
          i += 4;
        } else if (!inSingleQuote && !inDoubleQuote && result.slice(i, i + 4) === ' || ') {
          buffer += '; if (-not $?) { ';
          andCount++;
          i += 4;
        } else {
          buffer += char;
          i++;
        }
      }

      if (andCount > 0) {
        const closingBraces = ' }'.repeat(andCount);
        const commentIdx = buffer.search(/(?<!["'])(?:\s+#[^\r\n]*)$/);
        if (commentIdx !== -1) {
          buffer = buffer.slice(0, commentIdx) + closingBraces + ' ' + buffer.slice(commentIdx).trim();
        } else {
          buffer += closingBraces;
        }
        result = buffer;
      }
    }

    return result;
  } catch (err) {
    return cmd;
  }
}

module.exports = {
  cleanPowerShellNoise,
  fixPowerShellCommandEscaping
};
