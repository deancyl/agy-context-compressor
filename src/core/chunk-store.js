/**
 * Headroom CCR (Content-Compressed Retrieval) Local Chunk Store
 * 100% native Node.js zero dependencies.
 * Saves folded chunks to disk so any folded text is 100% reversibly retrievable by MCP tools.
 */

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');

function getChunkDir() {
  const chunkDir = process.env.AGY_CHUNK_DIR || path.join(os.homedir(), '.gemini', 'antigravity', 'scratch', 'agy-chunks');
  try {
    if (!fs.existsSync(chunkDir)) {
      fs.mkdirSync(chunkDir, { recursive: true });
    }
  } catch (_) {}
  return chunkDir;
}

/**
 * Generates an 8-character content-based hash id.
 * @param {string} content
 * @returns {string}
 */
function generateChunkId(content) {
  const hash = crypto.createHash('sha256').update(content).digest('hex').slice(0, 8);
  return `chk_${hash}`;
}

/**
 * Stores a folded text chunk to disk and returns its chunk ID.
 * @param {string} text - Original uncompressed content
 * @param {object} [metadata]
 * @returns {string} chunkId
 */
function storeChunk(text, metadata = {}) {
  if (typeof text !== 'string' || text.length === 0) return '';
  const chunkId = generateChunkId(text);
  const dir = getChunkDir();
  const filePath = path.join(dir, `${chunkId}.txt`);
  const metaPath = path.join(dir, `${chunkId}.json`);

  try {
    if (!fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, text, 'utf8');
      const meta = {
        chunkId,
        size: text.length,
        lines: text.split('\n').length,
        timestamp: new Date().toISOString(),
        ...metadata
      };
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
    }
  } catch (_) {}

  return chunkId;
}

/**
 * Retrieves a stored chunk or slice of lines.
 * @param {string} chunkId
 * @param {number} [startLine] - 1-based start line
 * @param {number} [endLine] - 1-based end line
 * @returns {{ chunkId: string, content: string, totalLines: number, isFound: boolean }}
 */
function retrieveChunk(chunkId, startLine = 1, endLine = null) {
  if (!chunkId || typeof chunkId !== 'string') {
    return { chunkId, content: 'Error: Invalid chunkId', totalLines: 0, isFound: false };
  }

  // Sanitize chunkId to prevent directory traversal
  const safeId = path.basename(chunkId).replace(/[^a-zA-Z0-9_-]/g, '');
  const dir = getChunkDir();
  const filePath = path.join(dir, `${safeId}.txt`);

  if (!fs.existsSync(filePath)) {
    return { chunkId: safeId, content: `Error: Chunk "${safeId}" not found in local CCR store.`, totalLines: 0, isFound: false };
  }

  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.split(/\r?\n/);
    const totalLines = lines.length;

    let s = Math.max(1, startLine || 1);
    let e = endLine ? Math.min(totalLines, endLine) : totalLines;
    if (s > e) s = e;

    const slice = lines.slice(s - 1, e).join('\n');
    return {
      chunkId: safeId,
      content: slice,
      totalLines,
      startLine: s,
      endLine: e,
      isFound: true
    };
  } catch (err) {
    return {
      chunkId: safeId,
      content: `Error reading chunk: ${err.message}`,
      totalLines: 0,
      isFound: false
    };
  }
}

module.exports = {
  getChunkDir,
  generateChunkId,
  storeChunk,
  retrieveChunk
};
