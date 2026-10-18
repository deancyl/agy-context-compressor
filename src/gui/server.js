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
const { getStats, resetStats, getStatsFilePath } = require('../core/telemetry');

const PORT = parseInt(process.env.AGY_COMPRESSOR_PORT || '4012', 10);
const HOST = '127.0.0.1';
const DASHBOARD_HTML_PATH = path.join(__dirname, 'dashboard.html');
const HOOK_RUNNER_PATH = path.resolve(__dirname, '..', 'hooks', 'hook-runner.js');

const { isHookInstalled, installHook, uninstallHook, verifyHookExecution, getHooksPath } = require('../utils/hook-manager');

function checkHookStatus() {
  return isHookInstalled('global');
}

function installGlobalHook() {
  return installHook('global');
}

function uninstallGlobalHook() {
  return uninstallHook('global');
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

  // 3b. Stats SSE Stream API (Real-time Push via fs.watch & 2s tick)
  if (pathname === '/api/stats/stream' && method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*'
    });
    res.write('retry: 2000\n\n');

    const pushStats = () => {
      try {
        const stats = getStats(true);
        res.write(`data: ${JSON.stringify(stats)}\n\n`);
      } catch (_) {}
    };

    pushStats();

    const statsFile = getStatsFilePath();
    let watcher = null;
    try {
      if (fs.existsSync(statsFile)) {
        watcher = fs.watch(statsFile, () => {
          pushStats();
        });
      }
    } catch (_) {}

    const interval = setInterval(pushStats, 3000);

    req.on('close', () => {
      clearInterval(interval);
      if (watcher) {
        try { watcher.close(); } catch (_) {}
      }
    });
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
