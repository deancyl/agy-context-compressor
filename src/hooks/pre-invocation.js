/**
 * Antigravity PreInvocation Hook (2.2)
 * Injects zero-pollution ephemeral optimization guidelines before model execution.
 * - Preserves Simplified Chinese (简体中文) interaction quality while keeping English identifiers intact.
 * - Attaches recent hot-file AST symbol spans ([Line start-end]) when available so the agent can slice directly.
 * - Ephemeral messages are transient and dropped after the current turn,
 *   ensuring zero transcript bloat and zero disturbance to upstream Google Gemini KV Cache.
 */

const fs = require('node:fs');
const { getSessionReadsFilePath } = require('./pre-tool-use');

function getRecentSymbolHint() {
  try {
    const stateFile = getSessionReadsFilePath();
    if (!fs.existsSync(stateFile)) return '';
    const state = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
    if (!state || !state.files) return '';
    const entries = Object.values(state.files)
      .filter(f => f && Array.isArray(f.outline) && f.outline.length > 0 && (Date.now() - (f.lastReadAt || 0) < 15 * 60 * 1000))
      .sort((a, b) => (b.lastReadAt || 0) - (a.lastReadAt || 0))
      .slice(0, 2);
    if (entries.length === 0) return '';
    const hints = entries.map(e => `${e.filename}: ${e.outline.slice(0, 5).map(s => s.trim()).join(' ; ')}`);
    return ` | 近期文件符号索引: ${hints.join(' || ')}`;
  } catch (_) {
    return '';
  }
}

function handlePreInvocation(payload = {}) {
  const symbolHint = getRecentSymbolHint();
  return {
    injectSteps: [
      {
        ephemeralMessage:
          `⚡ [AGY Context Optimization Active | 简体中文无损压缩已激活]: 请保持简体中文回复用户。For files >300 lines (检视超过300行大文件时), 请优先指定 StartLine/EndLine 切片 (<=300 lines) 或调用 read_code_skeleton / read_repo_map / compact_search_sandbox；高频终端噪点已自动折叠，可通过 agy_retrieve_chunk 无损回查原文${symbolHint}。`
      }
    ]
  };
}

module.exports = {
  handlePreInvocation
};
