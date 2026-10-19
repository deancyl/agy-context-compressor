/**
 * Card 1: RTK, Squeez & ContextZip Terminal Denoising Engine (2.2)
 * 100% native Node.js zero dependencies.
 *
 * Denoises terminal output, ANSI sequences, progress bars, test pass logs,
 * Docker layer pulls, Terraform state refreshes, Kubernetes rollout status,
 * package manager (Cargo / npm / pnpm / pip) download/compile spam,
 * bundler/compiler build progress lines, consecutive/timestamp-similar duplicate log lines,
 * routine INFO/DEBUG log bursts (from Get-Content *.log), and massive directory listings (Get-ChildItem -Recurse).
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
const RE_CONFLICT_MARKERS = /^(?:<{7}|={7}|>{7}|\|{7})(?:\s+|$)/m;
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
 * Checks if a line contains any error, stack trace, diff, or merge conflict marker.
 * Used as an absolute safety barrier across all RTK folding rules.
 * @param {string} line
 * @returns {boolean}
 */
function isProtectedDiagnosticLine(line) {
  if (typeof line !== 'string') return false;
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (RE_FAIL_ICONS.test(line)) return true;
  if (RE_NOT_OK.test(trimmed)) return true;
  if (RE_ASSERTION.test(line) && !RE_CHECK_START.test(trimmed)) return true;
  if (RE_RUNTIME_EXCEPTIONS.test(line)) return true;
  if (RE_TRACEBACK_START.test(trimmed)) return true;
  if (RE_AT_STACK.test(line) || RE_PY_STACK.test(line) || RE_C_ERROR.test(line) || RE_RUST_ERROR.test(line)) return true;
  if (RE_EXPECTED.test(trimmed)) return true;
  if (RE_CONFLICT_MARKERS.test(line)) return true;
  if (RE_DIFF_HEADER.test(trimmed)) return true;
  return false;
}

/**
 * Normalizes a log line by stripping leading timestamps so consecutive timestamped log lines
 * with identical payloads can be recognized and folded.
 * @param {string} line
 * @returns {string}
 */
function normalizeLogSignature(line) {
  if (typeof line !== 'string') return '';
  return line
    .trim()
    .replace(/^\[?\d{4}[-/]\d{2}[-/]\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?\]?\s*/i, '')
    .replace(/^\[?\d{2}:\d{2}:\d{2}(?:\.\d+)?\]?\s*/, '');
}

/**
 * Checks if a line is a routine non-error INFO/DEBUG/TRACE log line.
 * Never matches any line containing error, warn, fail, exception, or stack traces.
 * @param {string} line
 * @returns {boolean}
 */
function isRoutineLogLine(line) {
  if (typeof line !== 'string') return false;
  const trimmed = line.trim();
  if (!trimmed || trimmed.length < 12) return false;
  if (isProtectedDiagnosticLine(line)) return false;
  if (/\b(?:error|err|warn|warning|fail|failed|fatal|panic|exception|traceback|critical|denied|refused|timeout|invalid)\b/i.test(trimmed)) {
    return false;
  }
  // Matches standard timestamped or leveled routine logs: [INFO], [DEBUG], [TRACE], INFO:, level="info", etc.
  if (/(?:^|\s)(?:\[(?:INFO|DEBUG|TRACE|VERBOSE)\]|(?:INFO|DEBUG|TRACE):|level=(?:"?(?:info|debug|trace)"?))\b/i.test(trimmed)) {
    return true;
  }
  // Matches ISO timestamped log lines without error keywords
  if (/^\[?\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?\]?\s+/i.test(trimmed)) {
    return true;
  }
  return false;
}

/**
 * Checks if a line is a standard PowerShell Get-ChildItem / dir / Unix ls -l row.
 * @param {string} line
 * @returns {boolean}
 */
function isDirectoryListingLine(line) {
  if (typeof line !== 'string') return false;
  const trimmed = line.trim();
  if (!trimmed) return false;
  // PowerShell Get-ChildItem Mode row: "d----   2026/10/19  14:20         1234 filename" or "-a---l  10/19/2026 ..."
  if (/^[d-][a-z-]{4,5}\s+\d{2,4}[/-]\d{1,2}[/-]\d{1,4}\s+\d{1,2}:\d{2}/i.test(trimmed)) return true;
  // Unix ls -la row: "drwxr-xr-x 2 user group 4096 Oct 19 14:20 filename"
  if (/^[d\-lcbps][rwxstST-]{9}[+@.]?\s+\d+\s+\S+\s+\S+\s+\d+\s+/.test(trimmed)) return true;
  return false;
}

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

  if (isProtectedDiagnosticLine(line)) return false;

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

function isKubeStatusLine(line) {
  if (typeof line !== 'string') return false;
  const trimmed = line.trim();
  if (!trimmed) return false;
  if (/(?:error|failed|crashloop|imagepull|evicted|oom|pending|notready|terminating|warning)/i.test(trimmed)) return false;
  if (/^NAME\s+READY\s+STATUS\s+RESTARTS/i.test(trimmed)) return false;
  if (/^(?:pod\/)?[\w.-]+\s+\d+\/\d+\s+(?:Running|Completed)\s+\d+\s+[\w.-]+/i.test(trimmed)) return true;
  if (/^Waiting for (?:deployment|daemon set|statefulset)\b.*?rollout to finish:\s+\d+\s+of\s+\d+\s+updated/i.test(trimmed)) return true;
  if (/^(?:pod|deployment|service|ingress|job|statefulset)\/[\w.-]+\s+condition met$/i.test(trimmed)) return true;
  return false;
}

function isPkgInstallNoiseLine(line) {
  if (typeof line !== 'string') return false;
  const trimmed = line.trim();
  if (!trimmed || /(?:error|err!|warn|failed|vulnerability|audit)/i.test(trimmed)) return false;
  if (/^(?:Downloaded|Compiling|Checking|Fetching)\s+[a-zA-Z0-9_-]+\s+v\d+\.\d+\.\d+/i.test(trimmed)) return true;
  if (/^(?:npm http fetch\s+200|Progress:\s+resolved\s+\d+|Packages:\s+\+\d+)/i.test(trimmed)) return true;
  if (/^(?:Downloading|Using cached|Requirement already satisfied:)\s+[a-zA-Z0-9_.-]+/i.test(trimmed)) return true;
  return false;
}

function isBuildNoiseLine(line) {
  if (typeof line !== 'string') return false;
  const trimmed = line.trim();
  if (!trimmed || /(?:error|warn|failed|exception|invalid)/i.test(trimmed)) return false;
  if (/^(?:dist|build|\.next|out)\/[\w./-]+\.(?:js|css|mjs|map|woff2?|svg|png)\s+\d+(?:\.\d+)?\s*(?:kB|MB|B)\b/i.test(trimmed)) return true;
  if (/^\[\s*\d+%\]\s+Building\s+(?:C|CXX|CUDA|OBJC)\s+object\s+/i.test(trimmed)) return true;
  return false;
}

/**
 * Positive Test Passes Folding.
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
        const rawBlock = passingRun.join(newline);
        let chunkNotice = '';
        try {
          const { storeChunk } = require('./chunk-store');
          const chunkId = storeChunk(rawBlock, { type: 'test_passes', count: passingRun.length });
          if (chunkId) chunkNotice = ` [CCR: agy_retrieve_chunk(chunk_id="${chunkId}")]`;
        } catch (_) {}
        const foldedWithCcr = `[Test suite: ${passingRun.length} passed tests folded (✓ / PASS / ok)]${chunkNotice}`;
        const foldedShort = `[Test suite: ${passingRun.length} passed tests folded (✓ / PASS / ok)]`;
        result.push(foldedWithCcr.length < rawBlock.length ? foldedWithCcr : foldedShort);
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

/**
 * Cleans repetitive Kubernetes pod / rollout status lines.
 */
function cleanKubectlOutput(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  if (!text.includes('Running') && !text.includes('Completed') && !text.includes('rollout to finish') && !text.includes('condition met')) {
    return text;
  }
  try {
    const isCrlf = text.includes('\r\n');
    const newline = isCrlf ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const result = [];
    let kubeRun = [];
    let folded = false;

    const flushRun = () => {
      if (kubeRun.length >= 4) {
        result.push(`[Kubectl: ${kubeRun.length} healthy pods / rollout status lines folded]`);
        folded = true;
      } else {
        result.push(...kubeRun);
      }
      kubeRun = [];
    };

    for (const line of lines) {
      if (isKubeStatusLine(line)) {
        kubeRun.push(line);
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
 * Cleans repetitive package manager (Cargo / npm / pnpm / pip) download & compilation progress spam.
 */
function cleanPkgInstallOutput(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  try {
    const isCrlf = text.includes('\r\n');
    const newline = isCrlf ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const result = [];
    let pkgRun = [];
    let folded = false;

    const flushRun = () => {
      if (pkgRun.length >= 4) {
        result.push(`[Package Manager: ${pkgRun.length} dependency download/compile lines folded]`);
        folded = true;
      } else {
        result.push(...pkgRun);
      }
      pkgRun = [];
    };

    for (const line of lines) {
      if (isPkgInstallNoiseLine(line)) {
        pkgRun.push(line);
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
 * Cleans repetitive bundler / compiler build progress and asset table lines.
 */
function cleanBuildOutput(text) {
  if (typeof text !== 'string' || text.length === 0) return text;
  try {
    const isCrlf = text.includes('\r\n');
    const newline = isCrlf ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    const result = [];
    let buildRun = [];
    let folded = false;

    const flushRun = () => {
      if (buildRun.length >= 5) {
        result.push(`[Build Output: ${buildRun.length} routine build/asset lines folded]`);
        folded = true;
      } else {
        result.push(...buildRun);
      }
      buildRun = [];
    };

    for (const line of lines) {
      if (isBuildNoiseLine(line)) {
        buildRun.push(line);
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
 * Folds consecutive identical or timestamp-identical non-diagnostic lines (when repeated >= 3 times)
 * into `<line> [xN repeated]`. Strictly exempts stack traces, diffs, merge conflicts, and errors.
 * @param {string} text
 * @returns {string}
 */
function foldDuplicateLines(text) {
  if (typeof text !== 'string' || text.length < 80) return text;
  try {
    const isCrlf = text.includes('\r\n');
    const newline = isCrlf ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    if (lines.length < 3) return text;

    const out = [];
    let prevLine = null;
    let prevSig = null;
    let count = 0;
    let folded = false;

    const flush = () => {
      if (count === 0) return;
      if (count >= 3 && prevLine && prevSig && prevSig.length > 4 && !isProtectedDiagnosticLine(prevLine)) {
        const summary = `${prevLine} [x${count} repeated]`;
        const rawLen = (prevLine.length + newline.length) * count;
        if (summary.length < rawLen) {
          out.push(summary);
          folded = true;
        } else {
          for (let k = 0; k < count; k++) out.push(prevLine);
        }
      } else {
        for (let k = 0; k < count; k++) out.push(prevLine);
      }
      count = 0;
    };

    for (const line of lines) {
      const sig = normalizeLogSignature(line);
      if (prevSig !== null && sig.length > 0 && sig === prevSig) {
        count += 1;
      } else {
        flush();
        prevLine = line;
        prevSig = sig;
        count = 1;
      }
    }
    flush();

    if (!folded) return text;
    return out.join(newline);
  } catch (err) {
    return text;
  }
}

/**
 * Folds long bursts (>= 20 lines) of routine [INFO]/[DEBUG]/[TRACE] log lines while 100% preserving
 * any ERROR, WARN, FAIL, Exception, or stack trace lines and storing folded logs in CCR.
 * @param {string} text
 * @returns {string}
 */
function cleanLogBurstOutput(text) {
  if (typeof text !== 'string' || text.length < 600) return text;
  try {
    const isCrlf = text.includes('\r\n');
    const newline = isCrlf ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    if (lines.length < 20) return text;

    const result = [];
    let logRun = [];
    let folded = false;

    const flushRun = () => {
      if (logRun.length >= 20) {
        const head = logRun.slice(0, 5);
        const tail = logRun.slice(-3);
        const middle = logRun.slice(5, -3);
        let chunkNotice = '';
        try {
          const { storeChunk } = require('./chunk-store');
          const chunkId = storeChunk(logRun.join(newline), { type: 'routine_logs', count: logRun.length });
          if (chunkId) chunkNotice = ` [CCR: agy_retrieve_chunk(chunk_id="${chunkId}")]`;
        } catch (_) {}
        result.push(...head);
        result.push(`[Log Stream: ${middle.length} routine INFO/DEBUG lines folded]${chunkNotice}`);
        result.push(...tail);
        folded = true;
      } else {
        result.push(...logRun);
      }
      logRun = [];
    };

    for (const line of lines) {
      if (isRoutineLogLine(line)) {
        logRun.push(line);
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
 * Folds giant directory listings (Get-ChildItem / dir / ls -la) exceeding 50 items into head + tail + CCR.
 * @param {string} text
 * @returns {string}
 */
function cleanDirectoryListingOutput(text) {
  if (typeof text !== 'string' || text.length < 1500) return text;
  try {
    const isCrlf = text.includes('\r\n');
    const newline = isCrlf ? '\r\n' : '\n';
    const lines = text.split(/\r?\n/);
    if (lines.length < 50) return text;

    const result = [];
    let dirRun = [];
    let folded = false;

    const flushRun = () => {
      if (dirRun.length >= 50) {
        const head = dirRun.slice(0, 25);
        const tail = dirRun.slice(-10);
        const omitted = dirRun.length - 35;
        let chunkNotice = '';
        try {
          const { storeChunk } = require('./chunk-store');
          const chunkId = storeChunk(dirRun.join(newline), { type: 'dir_listing', count: dirRun.length });
          if (chunkId) chunkNotice = ` [CCR: agy_retrieve_chunk(chunk_id="${chunkId}")]`;
        } catch (_) {}
        result.push(...head);
        result.push(`[Directory Listing: ${omitted} file entries folded]${chunkNotice}`);
        result.push(...tail);
        folded = true;
      } else {
        result.push(...dirRun);
      }
      dirRun = [];
    };

    for (const line of lines) {
      if (isDirectoryListingLine(line)) {
        dirRun.push(line);
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
  cleanKubectlOutput,
  cleanPkgInstallOutput,
  cleanBuildOutput,
  foldDuplicateLines,
  cleanLogBurstOutput,
  cleanDirectoryListingOutput,
  normalizeLogSignature,
  isProtectedDiagnosticLine,
  isRoutineLogLine,
  isDirectoryListingLine,
  isPassLine,
  isDockerLayerLine,
  isTfRefreshLine,
  isKubeStatusLine,
  isPkgInstallNoiseLine,
  isBuildNoiseLine
};
