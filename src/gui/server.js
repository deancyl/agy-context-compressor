#!/usr/bin/env node
/**
 * Desktop GUI Server for AGY Context Compressor
 * 100% native Node.js zero dependencies.
 * Hosts local Web UI & REST APIs on 127.0.0.1:4012.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { getStats, resetStats } = require('../core/telemetry');

const PORT = parseInt(process.env.AGY_COMPRESSOR_PORT || '4012', 10);
const HOST = '127.0.0.1';
const DASHBOARD_HTML_PATH = path.join(__dirname, 'dashboard.html');
const HOOK_RUNNER_PATH = path.resolve(__dirname, '..', 'hooks', 'hook-runner.js');

function getGlobalHooksPath() {
  const home = os.homedir();
  return path.join(home, '.gemini', 'config', 'hooks.json');
}

function checkHookStatus() {
  const hooksFile = getGlobalHooksPath();
  if (!fs.existsSync(hooksFile)) return false;
  try {
    const cfg = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
    return Boolean(cfg['agy-context-compressor'] && cfg['agy-context-compressor'].enabled !== false);
  } catch (_) {
    return false;
  }
}

function installGlobalHook() {
  const hooksFile = getGlobalHooksPath();
  const dir = path.dirname(hooksFile);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let hooksConfig = {};
  if (fs.existsSync(hooksFile)) {
    try {
      hooksConfig = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
    } catch (_) {}
  }

  const hookCommand = `node "${HOOK_RUNNER_PATH.replace(/\\/g, '/')}" pre-tool-use`;
  hooksConfig['agy-context-compressor'] = {
    enabled: true,
    PreToolUse: [
      {
        matcher: 'run_command',
        hooks: [
          {
            type: 'command',
            command: hookCommand,
            timeout: 10
          }
        ]
      }
    ]
  };

  fs.writeFileSync(hooksFile, JSON.stringify(hooksConfig, null, 2), 'utf8');
}

function uninstallGlobalHook() {
  const hooksFile = getGlobalHooksPath();
  if (!fs.existsSync(hooksFile)) return;
  try {
    const hooksConfig = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
    if (hooksConfig['agy-context-compressor']) {
      delete hooksConfig['agy-context-compressor'];
      fs.writeFileSync(hooksFile, JSON.stringify(hooksConfig, null, 2), 'utf8');
    }
  } catch (_) {}
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = url.pathname;
  const method = req.method;

  // Enable CORS for local interactions
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // 1. Root: Serve Dashboard HTML
  if (pathname === '/' || pathname === '/index.html') {
    if (fs.existsSync(DASHBOARD_HTML_PATH)) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      fs.createReadStream(DASHBOARD_HTML_PATH).pipe(res);
    } else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Dashboard HTML file not found.');
    }
    return;
  }

  // 2. Health check
  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', port: PORT }));
    return;
  }

  // 3. Stats API
  if (pathname === '/api/stats' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(getStats()));
    return;
  }

  // 4. Stats Reset API
  if (pathname === '/api/stats/reset' && method === 'POST') {
    resetStats();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, message: '遥测数据已重置' }));
    return;
  }

  // 5. Doctor API
  if (pathname === '/api/doctor' && method === 'GET') {
    const isHookInstalled = checkHookStatus();
    const docData = {
      nodeVersion: process.version,
      platform: process.platform,
      osRelease: os.release(),
      configDir: path.join(os.homedir(), '.gemini', 'config'),
      hookInstalled: isHookInstalled,
      stats: getStats()
    };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(docData));
    return;
  }

  // 6. Hook Install API
  if (pathname === '/api/hook/install' && method === 'POST') {
    installGlobalHook();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, message: 'PreToolUse Hook 已全局安装并激活' }));
    return;
  }

  // 7. Hook Uninstall API
  if (pathname === '/api/hook/uninstall' && method === 'POST') {
    uninstallGlobalHook();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, message: 'PreToolUse Hook 已成功卸载' }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    // Port already in use, instance already running cleanly
    process.exit(0);
  } else {
    console.error('[GUI Server Error]', err);
    process.exit(1);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[GUI Server] Listening silently on http://${HOST}:${PORT}`);
});
