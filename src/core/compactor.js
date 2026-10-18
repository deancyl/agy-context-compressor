/**
 * Unified Context Compactor Pipeline for AGY
 * 100% native Node.js zero dependencies.
 */

const { stripAnsi, cleanProgressBars, foldTestPasses, cleanDockerOutput, cleanTerraformOutput } = require('./rtk');
const { foldLockfiles, foldStructuredData } = require('./headroom');
const { alignToolsSchema, slimToolsSchema } = require('./schema');
const { cleanPowerShellNoise, fixPowerShellCommandEscaping } = require('./powershell');
const { recordSavings, getStats } = require('./telemetry');

const COMPACTOR_PRESETS = {
  balanced: {
    stripAnsi: true,
    cleanProgressBars: true,
    foldTestPasses: true,
    cleanDockerOutput: true,
    cleanTerraformOutput: true,
    cleanPowerShellNoise: true,
    foldLockfiles: true,
    foldStructuredData: true,
    maxStructuredItems: 50,
    exemptMergeConflicts: true,
    protectSourceDiffs: true,
    alignToolsSchema: true,
    slimToolsSchema: true,
    schemaCharThreshold: 15000,
    fixPowerShellEscaping: true
  },
  aggressive: {
    stripAnsi: true,
    cleanProgressBars: true,
    foldTestPasses: true,
    cleanDockerOutput: true,
    cleanTerraformOutput: true,
    cleanPowerShellNoise: true,
    foldLockfiles: true,
    foldStructuredData: true,
    maxStructuredItems: 20,
    exemptMergeConflicts: true,
    protectSourceDiffs: true,
    alignToolsSchema: true,
    slimToolsSchema: true,
    schemaCharThreshold: 8000,
    fixPowerShellEscaping: true
  },
  safe: {
    stripAnsi: true,
    cleanProgressBars: true,
    foldTestPasses: false,
    cleanDockerOutput: false,
    cleanTerraformOutput: false,
    cleanPowerShellNoise: true,
    foldLockfiles: false,
    foldStructuredData: false,
    exemptMergeConflicts: true,
    protectSourceDiffs: true,
    alignToolsSchema: true,
    slimToolsSchema: false,
    schemaCharThreshold: 20000,
    fixPowerShellEscaping: true
  }
};

/**
 * Normalizes options with presets.
 * @param {object} options
 * @returns {object}
 */
function resolveOptions(options = {}) {
  const presetName = options.preset || 'balanced';
  const base = COMPACTOR_PRESETS[presetName] || COMPACTOR_PRESETS.balanced;
  return { ...base, ...options };
}

/**
 * Compacts terminal or command text output.
 * @param {string} text
 * @param {object} userOptions
 * @returns {string}
 */
function compactOutput(text, userOptions = {}) {
  if (typeof text !== 'string' || text.length === 0) return text;
  const opts = resolveOptions(userOptions);
  const originalLength = text.length;

  let result = text;

  // 1. RTK: Strip ANSI & Progress Bars
  const beforeRtk1 = result.length;
  if (opts.stripAnsi) {
    result = stripAnsi(result);
  }
  if (opts.cleanProgressBars) {
    result = cleanProgressBars(result);
  }

  // 2. PowerShell / CLIXML noise
  const beforePs = result.length;
  if (opts.cleanPowerShellNoise) {
    result = cleanPowerShellNoise(result);
  }
  const psDelta = beforePs - result.length;
  if (psDelta > 0 && opts.recordTelemetry !== false) {
    recordSavings('powershell', psDelta, beforePs);
  }

  // 3. DevOps outputs & Test folding
  if (opts.cleanDockerOutput) {
    result = cleanDockerOutput(result);
  }
  if (opts.cleanTerraformOutput) {
    result = cleanTerraformOutput(result);
  }
  if (opts.foldTestPasses) {
    result = foldTestPasses(result, opts);
  }
  const rtkDelta = (beforeRtk1 - beforePs) + (beforePs - psDelta - result.length);
  if (rtkDelta > 0 && opts.recordTelemetry !== false) {
    recordSavings('rtk', rtkDelta, beforeRtk1);
  }

  // 4. Headroom: Fold Lockfile diffs & Structured JSON
  const beforeHeadroom = result.length;
  if (opts.foldLockfiles) {
    result = foldLockfiles(result, opts);
  }
  if (opts.foldStructuredData) {
    result = foldStructuredData(result, opts);
  }
  const headroomDelta = beforeHeadroom - result.length;
  if (headroomDelta > 0 && opts.recordTelemetry !== false) {
    recordSavings('headroom', headroomDelta, beforeHeadroom);
  }

  return result;
}

module.exports = {
  COMPACTOR_PRESETS,
  resolveOptions,
  compactOutput,
  stripAnsi,
  cleanProgressBars,
  foldTestPasses,
  cleanDockerOutput,
  cleanTerraformOutput,
  foldLockfiles,
  foldStructuredData,
  alignToolsSchema,
  slimToolsSchema,
  cleanPowerShellNoise,
  fixPowerShellCommandEscaping,
  getStats
};
