/**
 * Antigravity PreInvocation Hook (2.1)
 * Injects zero-pollution ephemeral optimization guidelines before model execution.
 * - Preserves Simplified Chinese (简体中文) interaction quality while keeping English identifiers intact.
 * - Ephemeral messages are transient and dropped after the current turn,
 *   ensuring zero transcript bloat and zero disturbance to upstream Google Gemini KV Cache.
 */

function handlePreInvocation(payload = {}) {
  return {
    injectSteps: [
      {
        ephemeralMessage:
          '⚡ [AGY Context Optimization Active | 简体中文无损压缩已激活]: 请保持简体中文回复用户。For files >300 lines (检视超过300行大文件时), 请优先指定 StartLine/EndLine 切片 (<=300 lines) 或调用 read_code_skeleton / read_repo_map / compact_search_sandbox；高频终端噪点已自动折叠，可通过 agy_retrieve_chunk 无损回查原文。'
      }
    ]
  };
}

module.exports = {
  handlePreInvocation
};
