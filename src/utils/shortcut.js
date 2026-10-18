/**
 * Windows Desktop Shortcut Utility for AGY Context Compressor
 * Creates a double-clickable desktop shortcut to directly launch the interactive TUI.
 */

const path = require('node:path');
const os = require('node:os');
const { execSync } = require('node:child_process');

function createDesktopShortcut() {
  if (process.platform !== 'win32') {
    return { success: false, reason: '桌面快捷方式仅支持 Windows 系统' };
  }

  const projectDir = path.resolve(__dirname, '..', '..');
  const desktopDir = path.join(os.homedir(), 'Desktop');
  const shortcutPath = path.join(desktopDir, 'AGY 上下文优化与 Token 压缩.lnk');

  const psScript = `
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut('${shortcutPath.replace(/'/g, "''")}')
$s.TargetPath = 'powershell.exe'
$s.Arguments = '-NoExit -ExecutionPolicy Bypass -Command "Set-Location ''${projectDir.replace(/'/g, "''")}'' ; node bin/agy-compressor.js tui"'
$s.WorkingDirectory = '${projectDir.replace(/'/g, "''")}'
$s.Description = 'Google Antigravity 上下文优化与 Token 压缩控制台 (TUI)'
$s.IconLocation = 'shell32.dll,220'
$s.Save()
`;

  try {
    execSync(`powershell.exe -NoProfile -NonInteractive -Command "${psScript.replace(/\r?\n/g, ' ')}"`, {
      encoding: 'utf8',
      stdio: 'ignore'
    });
    return { success: true, path: shortcutPath };
  } catch (err) {
    return { success: false, reason: err.message };
  }
}

module.exports = {
  createDesktopShortcut
};
