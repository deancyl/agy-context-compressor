/**
 * agy-context-compressor - Main Library Entry
 * Deterministic lossless context optimization & token compression engine tailored for Google Antigravity (AGY).
 */

const rtk = require('./core/rtk');
const headroom = require('./core/headroom');
const schema = require('./core/schema');
const powershell = require('./core/powershell');
const compactor = require('./core/compactor');
const { handlePreToolUse } = require('./hooks/pre-tool-use');

module.exports = {
  ...rtk,
  ...headroom,
  ...schema,
  ...powershell,
  ...compactor,
  handlePreToolUse
};
