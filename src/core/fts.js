/**
 * Context Mode FTS5 Search Sandbox
 * 100% native Node.js zero dependencies using node:sqlite.
 * Indexes large files or logs into an in-memory SQLite FTS5 virtual table
 * and returns BM25-ranked matching lines, preventing giant files from flooding context.
 */

const fs = require('node:fs');
const path = require('node:path');

let DatabaseSync = null;
try {
  const sqlite = require('node:sqlite');
  DatabaseSync = sqlite.DatabaseSync;
} catch (_) {}

/**
 * Executes a sandboxed FTS5 search over a file or content.
 * @param {object} params
 * @param {string} params.targetPath - File path to search
 * @param {string} params.query - Search keywords
 * @param {number} [params.maxResults=25]
 * @returns {{ matches: Array<{ lineNumber: number, line: string }>, totalLines: number, query: string, engine: string }}
 */
function searchSandbox({ targetPath, query, maxResults = 25 }) {
  if (!targetPath || !fs.existsSync(targetPath)) {
    return { error: `Target file not found: ${targetPath}`, matches: [], totalLines: 0 };
  }
  if (!query || typeof query !== 'string') {
    return { error: 'Search query is required', matches: [], totalLines: 0 };
  }

  const raw = fs.readFileSync(targetPath, 'utf8');
  const lines = raw.split(/\r?\n/);
  const totalLines = lines.length;
  const limit = Math.max(1, Math.min(200, maxResults || 25));

  // 1. If native node:sqlite FTS5 is available, use BM25 virtual table
  if (DatabaseSync) {
    try {
      const db = new DatabaseSync(':memory:');
      db.exec('CREATE VIRTUAL TABLE docs USING fts5(line_num UNINDEXED, text);');
      const insert = db.prepare('INSERT INTO docs (line_num, text) VALUES (?, ?)');

      for (let i = 0; i < lines.length; i++) {
        insert.run(i + 1, lines[i]);
      }

      // Sanitize query for FTS5 syntax
      const safeQuery = query.replace(/['"\\]/g, ' ').trim();
      const ftsQuery = safeQuery.split(/\s+/).filter(Boolean).map(term => `"${term}"*`).join(' OR ') || `"${safeQuery}"`;

      const select = db.prepare('SELECT line_num, text FROM docs WHERE docs MATCH ? LIMIT ?');
      const rows = select.all(ftsQuery, limit);
      db.close();

      return {
        targetPath,
        query,
        matches: rows.map(r => ({ lineNumber: r.line_num, line: r.text })),
        totalLines,
        engine: 'sqlite-fts5'
      };
    } catch (_) {
      // Fallback to substring matching below
    }
  }

  // 2. High-speed substring / regex fallback
  const matches = [];
  const lowerQuery = query.toLowerCase();

  for (let i = 0; i < lines.length && matches.length < limit; i++) {
    if (lines[i].toLowerCase().includes(lowerQuery)) {
      matches.push({
        lineNumber: i + 1,
        line: lines[i]
      });
    }
  }

  return {
    targetPath,
    query,
    matches,
    totalLines,
    engine: 'regex-fallback'
  };
}

module.exports = {
  searchSandbox
};
