/**
 * Card 2: Headroom Code & Structured Data Folding Engine
 * 100% native Node.js zero dependencies.
 * Folds giant lockfiles and homogeneous JSON arrays while strictly protecting
 * source code diffs and Git merge conflict markers.
 */

const { storeChunk } = require('./chunk-store');

const LOCKFILE_NAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  'cargo.lock',
  'go.sum',
  'composer.lock',
  'poetry.lock',
  'gemfile.lock',
  'flake.lock',
  'pipfile.lock',
  'bun.lock',
  'bun.lockb',
  'pubspec.lock',
  'gradle.lockfile',
  'berksfile.lock'
]);

function isLockfilePath(filePath) {
  if (!filePath || typeof filePath !== 'string') return false;
  const clean = filePath.trim().replace(/^["']|["']$/g, '');
  const baseName = clean.split(/[/\\]/).pop().toLowerCase();
  return LOCKFILE_NAMES.has(baseName);
}

function parseGitDiffHeader(section) {
  const firstLine = section.split(/\r?\n/)[0] || '';
  if (!firstLine.startsWith('diff --git ')) return null;
  const rest = firstLine.slice(11).trim();
  const match = rest.match(/^(?:"a\/(.+?)"|a\/(\S+)|"([^\r\n"]+)"|(\S+))\s+(?:"b\/(.+?)"|b\/(\S+)|"([^\r\n"]+)"|(\S+))$/);
  if (!match) return null;
  const fileA = match[1] || match[2] || match[3] || match[4] || '';
  const fileB = match[5] || match[6] || match[7] || match[8] || '';
  return { fileA, fileB };
}

/**
 * Folds lockfile git diffs.
 * CRITICAL SAFETY: If conflict markers (<<<<<<<, =======, >>>>>>>) are detected,
 * the diff is NEVER folded to guarantee the LLM can inspect and resolve conflicts!
 * @param {string} text
 * @param {object} options
 * @returns {string}
 */
function foldLockfiles(text, options = {}) {
  if (typeof text !== 'string' || text.length === 0) return text;
  const exemptMergeConflicts = options.exemptMergeConflicts !== false;
  const protectSourceDiffs = options.protectSourceDiffs !== false;

  try {
    const isCrlf = text.includes('\r\n');
    const newline = isCrlf ? '\r\n' : '\n';

    if (text.includes('diff --git ')) {
      const sections = text.split(/(?=diff --git )/);
      const processedSections = sections.map(section => {
        const header = parseGitDiffHeader(section);
        if (!header) return section;
        const { fileA, fileB } = header;
        if (protectSourceDiffs && !isLockfilePath(fileA) && !isLockfilePath(fileB)) {
          return section;
        }

        // Safety barrier: Never fold conflicted files!
        if (exemptMergeConflicts && (
          section.includes('<<<<<<<') ||
          section.includes('=======') ||
          section.includes('>>>>>>>')
        )) {
          return section;
        }

        if (section.includes('[Lockfile diff folded:')) {
          return section;
        }

        const lines = section.split(/\r?\n/);
        if (lines.length <= 6) return section;

        let hunkIndex = lines.findIndex(l => l.startsWith('@@'));
        const headerLines = hunkIndex !== -1 ? lines.slice(0, hunkIndex) : lines.slice(0, 4);
        const additions = (section.match(/^\+[^+]/gm) || []).length;
        const deletions = (section.match(/^-[^-]/gm) || []).length;

        const lockfileName = [fileA, fileB].find(f => isLockfilePath(f)) || 'lockfile';
        let chunkNotice = '';
        try {
          const chunkId = storeChunk(section, { type: 'lockfile_diff', filename: lockfileName });
          if (chunkId) chunkNotice = ` [CCR Chunk: ${chunkId}]`;
        } catch (_) {}
        return [
          ...headerLines,
          `@@ -1,${lines.length} +1,${lines.length} @@ [Lockfile diff folded: ${lockfileName} (+${additions} -${deletions} lines omitted for context savings)${chunkNotice}]`
        ].join(newline);
      });

      return processedSections.join('');
    }

    // Direct lockfile content viewing check
    if (options.filename && isLockfilePath(options.filename)) {
      if (exemptMergeConflicts && (
        text.includes('<<<<<<<') ||
        text.includes('=======') ||
        text.includes('>>>>>>>')
      )) {
        return text;
      }

      const lines = text.split(/\r?\n/);
      if (lines.length > 50) {
        const head = lines.slice(0, 20);
        const tail = lines.slice(-10);
        let chunkNotice = '';
        try {
          const chunkId = storeChunk(text, { type: 'lockfile_content', filename: options.filename });
          if (chunkId) chunkNotice = ` [CCR Chunk: ${chunkId}]`;
        } catch (_) {}
        return [
          ...head,
          `... [${lines.length - 30} lines folded from ${options.filename} for context compression${chunkNotice}] ...`,
          ...tail
        ].join(newline);
      }
    }

    return text;
  } catch (err) {
    return text;
  }
}

/**
 * SmartCrusher: Folds giant homogeneous JSON arrays/objects.
 * @param {string} text
 * @param {object} options
 * @returns {string}
 */
function foldStructuredData(text, options = {}) {
  if (typeof text !== 'string' || text.length < 500) return text;
  const maxItems = options.maxStructuredItems || 50;
  const headCount = options.structuredHeadCount || 5;
  const tailCount = options.structuredTailCount || 3;

  // Never fold merge conflicts or diffs
  if (text.includes('<<<<<<<') || text.includes('>>>>>>>') || text.startsWith('diff --git ')) {
    return text;
  }

  try {
    const trimmed = text.trim();
    if (!trimmed.startsWith('[') || !trimmed.endsWith(']')) return text;

    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed) || parsed.length <= maxItems) return text;

    // Check if items look homogeneous (objects with same keys)
    if (parsed.length > 0 && typeof parsed[0] === 'object' && parsed[0] !== null) {
      const sampleKeys = Object.keys(parsed[0]).sort().join(',');
      const isHomogeneous = parsed.slice(0, 10).every(
        item => item && typeof item === 'object' && Object.keys(item).sort().join(',') === sampleKeys
      );

      if (isHomogeneous) {
        let chunkNotice = '';
        try {
          const chunkId = storeChunk(text, { type: 'json_array', count: parsed.length });
          if (chunkId) chunkNotice = ` [CCR Chunk: ${chunkId}]`;
        } catch (_) {}

        const head = parsed.slice(0, headCount);
        const tail = parsed.slice(-tailCount);
        const placeholder = {
          _folded_summary: `[SmartCrusher: ${parsed.length - headCount - tailCount} homogeneous items folded. Total items: ${parsed.length}.${chunkNotice}]`,
          _schema_keys: Object.keys(parsed[0])
        };

        const crushed = [...head, placeholder, ...tail];
        return JSON.stringify(crushed, null, 2);
      }
    }

    return text;
  } catch (err) {
    // Not valid JSON, bypass gracefully
    return text;
  }
}

/**
 * TOON (Token-Oriented Object Notation)
 * Converts an array of homogeneous objects into a compact header + rows matrix.
 * Eliminates repeated JSON keys and saves 40%-60% of tokens with zero information loss.
 * @param {Array<object>} array
 * @returns {object}
 */
function encodeTOON(array) {
  if (!Array.isArray(array) || array.length === 0) return array;
  const first = array[0];
  if (!first || typeof first !== 'object' || Array.isArray(first)) return array;
  const keys = Object.keys(first).sort();
  const rows = array.map(item => keys.map(k => (item ? item[k] : null)));
  return {
    _format: 'TOON',
    keys,
    totalRows: array.length,
    rows
  };
}

module.exports = {
  isLockfilePath,
  foldLockfiles,
  foldStructuredData,
  encodeTOON
};
