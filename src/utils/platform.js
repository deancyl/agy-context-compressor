/**
 * Platform & Environment Detection Utility
 * 100% native Node.js zero dependencies.
 */

const os = require('node:os');

function detectPlatform(options = {}) {
  const explicitPlat = (options && (options.targetPlatform || options.platform)) ||
    (options && options.modules && options.modules.powershell && (options.modules.powershell.targetPlatform || options.modules.powershell.platform)) ||
    (options && options.powershell && (options.powershell.targetPlatform || options.powershell.platform));

  if (explicitPlat) {
    const p = String(explicitPlat).toLowerCase();
    const isWin = p === 'win32' || p === 'windows' || p === 'win';
    return {
      isWindows: isWin,
      isLinux: p === 'linux',
      isDarwin: p === 'darwin' || p === 'mac' || p === 'macos',
      platform: isWin ? 'win32' : p,
      mode: isWin ? 'windows' : (p === 'linux' ? 'linux' : p),
      reason: 'options_override'
    };
  }

  const hostPlat = os.platform();
  const isWin = hostPlat === 'win32';
  return {
    isWindows: isWin,
    isLinux: hostPlat === 'linux',
    isDarwin: hostPlat === 'darwin',
    platform: hostPlat,
    mode: isWin ? 'windows' : (hostPlat === 'linux' ? 'linux' : hostPlat),
    reason: 'host_process_platform'
  };
}

module.exports = {
  detectPlatform
};
