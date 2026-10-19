/**
 * Antigravity PreInvocation Hook
 * Injects zero-pollution ephemeral optimization guidelines before model execution.
 * Ephemeral messages are transient and dropped after the current turn,
 * ensuring zero transcript bloat and zero disturbance to upstream KV Cache.
 */

function handlePreInvocation(payload = {}) {
  return {
    injectSteps: [
      {
        ephemeralMessage: '⚡ [AGY Context Optimization Active]: For files >300 lines, use precise StartLine/EndLine slices (<=300 lines) or read_code_skeleton. High-noise terminal logs are automatically folded.'
      }
    ]
  };
}

module.exports = {
  handlePreInvocation
};
