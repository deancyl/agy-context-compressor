/**
 * Card 1: RTK & Token-Saver Engine
 * 100% native Node.js zero dependencies.
 * Denoises terminal output, ANSI sequences, progress bars, and test pass logs.
 */

// Comprehensive ANSI Escape Code regex
const ANSI_REGEX = new RegExp(
  [
    '[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\\d\\/#&.:=?%_~_]+)*|[a-zA-Z\\d]+(?:;[-a-zA-Z\\d\\/#&.:=?%_~_]*)*)?\\u0007)',
    '(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))'
  ].join('|'),
  'g'
);

// Safety regex patterns (never fold failures, diffs, conflicts or stack traces)
const RE_FAIL_ICONS = /^[ \t]*(?:FAIL|FAILURE|FAILED|✕|✖|✗|⨯|!|\[\s*FAIL\s*\])/i;
const RE_NOT_OK = /^not ok\b/i;
const RE_ASSERTION = /\b(?:AssertionError|AssertionError \[ERR_ASSERTION\]|Expected|Received|Difference:|\+ expected|- actual)\b/i;
const RE_RUNTIME_EXCEPTIONS = /\b(?:TypeError|ReferenceError|SyntaxError|RangeError|URIError|EvalError|Exception|Panic|Fatal|Error:)\b/;
const RE_TRACEBACK_START = /^Traceback \(most recent call last\):/i;
const RE_AT_STACK = /^[ \t]*at\s+(?:.+|\/.+|[a-zA-Z]:\\.+)\s+\(?.+:\d+:\d+\)?/;
const RE_PY_STACK = /^[ \t]*File\s+["'].+["'],\s+line\s+\d+/;
const RE_C_ERROR = /:\d+:\d+:\s*(?:fatal )?error:/i;
const RE_RUST_ERROR = /^(?:error(?:\[E\d+\])?:|-->\s+.+:\d+:\d+)/;
const RE_EXPECTED = /^[ \t]*(?:expected:|actual:|want:|got:)/i;
const RE_CONFLICT_MARKERS = /^(?:<{7}|={7}|>{7})(?:\s+|$)/m;
const RE_DIFF_HEADER = /^(?:diff --git|---|\+\+\+|@@)/;

// Positive indicators for test frameworks
const RE_CHECKMARK_PASS = /^[ \t]*(?:✓|✔)[ \t]+/;
const RE_TAP_PASS = /^ok\s+\d+\s+-\s+/;
const RE_JEST_PASS = /^[ \t]*PASS\s+/;
const RE_PYTEST_PASS = /::[a-zA-Z0-9_]+(?:\s*\[[^\]]+\])?\s+PASSED\b/;
const RE_TEST_PATH_PASS = /^[ \t]*[a-zA-Z0-9_\-\/\\]+\.(?:py|rs|go|js|ts|cpp|c)\b.*(?:\bPASSED|\bpassed|\bok|\bPASS)\b/;
const RE_CARGO_PASS = /^[ \t]*test\s+[a-zA-Z0-9_:]+\s+\.\.\.\s+(?:ok|bench)\b/;
const RE_GO_PASS = /^--- PASS:\s+/;
const RE_GENERIC_PASS = /^[ \t]*\[\s*(?:PASS|OK)\s*\]\s+/i;
const RE_GTEST_PASS = /^\[\s*OK\s*\]\s+/;
const RE_CMAKE_PASS = /^\s*\d+\/\d+\s+Test\s+#\d+:\s+.+\s+\.\.\.\s+Passed\b/i;
const RE_CHECK_START = /^[ \t]*(?:✓|✔|PASS|ok)\b/;

/**
 * Strip ANSI escape sequences from text.
 * @param {string} text
 * @returns {string}
 */
function stripAnsi(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  try {
    return text.replace(ANSI_REGEX, '');
  } catch (err) {
    return text;
  }
}

/**
 * Clean terminal carriage return (\r) overwriting progress bars.
 * Keeps only final frame while strictly preserving \r\n Windows CRLF endings.
 * @param {string} text
 * @returns {string}
 */
function cleanProgressBars(text) {
  if (typeof text !== 'string' || !text.includes('\r')) return text;
  try {
    const isCrlf = text.includes('\r\n');
    const hasStandaloneCr = text.replace(/\r\n/g, '').includes('\r');
    if (!hasStandaloneCr) return text;

    const normalized = text.replace(/\r\n/g, '\n');
    const lines = normalized.split('\n');
    const cleanedLines = lines.map(line => {
      if (!line.includes('\r')) return line;
      const parts = line.split('\r').filter(p => p.length > 0);
      return parts.length > 0 ? parts[parts.length - 1] : '';
    });
    return cleanedLines.join(isCrlf ? '\r\n' : '\n');
  } catch (err) {
    return text;
  }
}

function isPassLine(line) {
  if (typeof line !== 'string') return false;
  const trimmed = line.trim();
  if (!trimmed) return false;

  // Absolute safety checks (never fold failures or stack traces)
  if (RE_FAIL_ICONS.test(line)) return false;
  if (RE_NOT_OK.test(trimmed)) return false;
  if (RE_ASSERTION.test(line) && !RE_CHECK_START.test(trimmed)) return false;
  if (RE_RUNTIME_EXCEPTIONS.test(line)) return false;
  if (RE_TRACEBACK_START.test(trimmed)) return false;
  if (RE_AT_STACK.test(line) || RE_PY_STACK.test(line) || RE_C_ERROR.test(line) || RE_RUST_ERROR.test(line)) return false;
  if (RE_EXPECTED.test(trimmed)) return false;
  if (RE_CONFLICT_MARKERS.test(line)) return false;
  if (RE_DIFF_HEADER.test(trimmed)) return false;

  // Positive matchers
  if (RE_CHECKMARK_PASS.test(trimmed)) return true;
  if (RE_TAP_PASS.test(trimmed)) return true;
  if (RE_JEST_PASS.test(trimmed)) return true;
  if (RE_PYTEST_PASS.test(trimmed) || RE_TEST_PATH_PASS.test(trimmed)) return true;
  if (RE_CARGO_PASS.test(trimmed)) return true;
  if (RE_GO_PASS.test(trimmed)) return true;
  if (RE_GENERIC_PASS.test(trimmed)) return true;
  if (RE_GTEST_PASS.test(trimmed)) return true;
  if (RE_CMAKE_PASS.test(trimmed)) return true;

  return false;
}

function isDockerLayerLine(line) {
  if (typeof line !== 'string') return false;
  const trimmed = line.trim();
  if (!trimmed || /error|failed/i.test(trimmed)) return false;
  return /^[0-9a-f]{8,12}:\s+(?:Pulling fs layer|Downloading|Extracting|Verifying Checksum|Download complete|Pull complete|Waiting|Already exists|Layer already exists|Pushing|Pushed)/i.test(trimmed);
}

function isTfRefreshLine(line) {
  if (typeof line !== 'string') return false;
  const trimmed = line.trim();
  if (!trimmed || /error|failed/i.test(trimmed)) return false;
  return /:\s+Refreshing state\.\.\.(?:\s*\[id=[^\]]+\])?/i.test(trimmed);
}

/**
 * Positive Test Passes Folding.
 * Inverts matching: strictly matches PASS / ✓ / ok lines and folds runs >= 3,
 * while 100% preserving failures, stack traces, assertion diffs, and errors.
 * @param {string} text
 * @param {object} options
 * @returns {string}
 */
function foldTestPasses(text, options = {}) {
  if (typeof text !== 'string' || text.length === 0) return text;
  try {
    const isCrlf = text.includes('\r\n');
    const newline = isCrlf ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const result = [];
    let passingRun = [];

    let folded = false;
    const flushRun = () => {
      if (passingRun.length >= 3) {
        let chunkNotice = '';
        try {
          const { storeChunk } = require('./chunk-store');
          const chunkId = storeChunk(passingRun.join(newline), { type: 'test_passes', count: passingRun.length });
          if (chunkId) chunkNotice = ` [CCR: agy_retrieve_chunk(chunk_id="${chunkId}")]`;
        } catch (_) {}
        result.push(`[Test suite: ${passingRun.length} passed tests folded (✓ / PASS / ok)]${chunkNotice}`);
        folded = true;
      } else {
        result.push(...passingRun);
      }
      passingRun = [];
    };

    for (const line of lines) {
      if (isPassLine(line)) {
        passingRun.push(line);
      } else {
        flushRun();
        result.push(line);
      }
    }
    flushRun();

    if (!folded) return text;
    return result.join(newline);
  } catch (err) {
    return text;
  }
}

/**
 * Clean Docker multi-layer pull / push noise.
 * @param {string} text
 * @returns {string}
 */
function cleanDockerOutput(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  if (!text.includes('Pulling fs layer') && !text.includes('Download complete') && !text.includes('Pull complete') && !text.includes('Extracting') && !text.includes('Already exists') && !text.includes('Pushing')) {
    return text;
  }
  try {
    const isCrlf = text.includes('\r\n');
    const newline = isCrlf ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const result = [];
    let dockerRun = [];
    let folded = false;

    const isDockerLayerLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed || /error|failed/i.test(trimmed)) return false;
      return /^[0-9a-f]{8,12}:\s+(?:Pulling fs layer|Downloading|Extracting|Verifying Checksum|Download complete|Pull complete|Waiting|Already exists|Layer already exists|Pushing|Pushed)/i.test(trimmed);
    };

    const flushRun = () => {
      if (dockerRun.length >= 4) {
        result.push(`[Docker: ${dockerRun.length} layer download/extract status lines folded]`);
        folded = true;
      } else {
        result.push(...dockerRun);
      }
      dockerRun = [];
    };

    for (const line of lines) {
      if (isDockerLayerLine(line)) {
        dockerRun.push(line);
      } else {
        flushRun();
        result.push(line);
      }
    }
    flushRun();

    if (!folded) return text;
    return result.join(newline);
  } catch (err) {
    return text;
  }
}

/**
 * Clean repetitive Terraform / OpenTofu state refreshing logs.
 * @param {string} text
 * @returns {string}
 */
function cleanTerraformOutput(text) {
  if (typeof text !== 'string' || !text.includes('Refreshing state...')) return text;
  try {
    const isCrlf = text.includes('\r\n');
    const newline = isCrlf ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const result = [];
    let tfRun = [];
    let folded = false;

    const isTfRefreshLine = (line) => {
      const trimmed = line.trim();
      if (!trimmed || /error|failed/i.test(trimmed)) return false;
      return /:\s+Refreshing state\.\.\.(?:\s*\[id=[^\]]+\])?/i.test(trimmed);
    };

    const flushRun = () => {
      if (tfRun.length >= 3) {
        result.push(`[Terraform: ${tfRun.length} resource state refresh lines folded]`);
        folded = true;
      } else {
        result.push(...tfRun);
      }
      tfRun = [];
    };

    for (const line of lines) {
      if (isTfRefreshLine(line)) {
        tfRun.push(line);
      } else {
        flushRun();
        result.push(line);
      }
    }
    flushRun();

    if (!folded) return text;
    return result.join(newline);
  } catch (err) {
    return text;
  }
}

module.exports = {
  stripAnsi,
  cleanProgressBars,
  foldTestPasses,
  cleanDockerOutput,
  cleanTerraformOutput,
  isPassLine,
  isDockerLayerLine,
  isTfRefreshLine
};
