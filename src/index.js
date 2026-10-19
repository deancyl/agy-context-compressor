/**
 * agy-context-compressor 2.0 - Main Library Entry
 * Deterministic lossless context optimization & token compression engine tailored for Google Antigravity (AGY).
 */

const rtk = require('./core/rtk');
const headroom = require('./core/headroom');
const schema = require('./core/schema');
const powershell = require('./core/powershell');
const compactor = require('./core/compactor');
const skeleton = require('./core/skeleton');
const fts = require('./core/fts');
const chunkStore = require('./core/chunk-store');
const cacheZone = require('./core/cache-zone');
const telemetry = require('./core/telemetry');
const { handlePreToolUse, HIGH_NOISE_COMMANDS_REGEX } = require('./hooks/pre-tool-use');
const { handlePreInvocation } = require('./hooks/pre-invocation');

module.exports = {
  ...rtk,
  ...headroom,
  ...schema,
  ...powershell,
  ...compactor,
  ...skeleton,
  ...fts,
  ...chunkStore,
  ...cacheZone,
  ...telemetry,
  handlePreToolUse,
  handlePreInvocation,
  HIGH_NOISE_COMMANDS_REGEX
};
