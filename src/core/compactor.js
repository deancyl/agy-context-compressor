/**
 * Unified Context Compactor Pipeline for AGY
 * 100% native Node.js zero dependencies.
 */

const { stripAnsi, cleanProgressBars, foldTestPasses, cleanDockerOutput, cleanTerraformOutput } = require('./rtk');
const { foldLockfiles, foldStructuredData } = require('./headroom');
const { alignToolsSchema, slimToolsSchema } = require('./schema');
const { cleanPowerShellNoise, fixPowerShellCommandEscaping } = require('./powershell');

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

  let result = text;

  // 1. Strip ANSI
  if (opts.stripAnsi) {
    result = stripAnsi(result);
  }

  // 2. Clean Progress Bars
  if (opts.cleanProgressBars) {
    result = cleanProgressBars(result);
  }

  // 3. Clean PowerShell / CLIXML / CategoryInfo noise
  if (opts.cleanPowerShellNoise) {
    result = cleanPowerShellNoise(result);
  }

  // 4. Clean DevOps outputs (Docker / Terraform)
  if (opts.cleanDockerOutput) {
    result = cleanDockerOutput(result);
  }
  if (opts.cleanTerraformOutput) {
    result = cleanTerraformOutput(result);
  }

  // 5. Fold Test Passes (preserving FAIL / traceback)
  if (opts.foldTestPasses) {
    result = foldTestPasses(result, opts);
  }

  // 6. Fold Lockfile diffs if present in output
  if (opts.foldLockfiles) {
    result = foldLockfiles(result, opts);
  }

  // 7. Fold Structured JSON
  if (opts.foldStructuredData) {
    result = foldStructuredData(result, opts);
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
  fixPowerShellCommandEscaping
};
