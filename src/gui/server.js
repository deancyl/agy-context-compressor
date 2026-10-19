#!/usr/bin/env node
/**
 * Desktop GUI Server for AGY Context Compressor (2.1)
 * 100% native Node.js zero dependencies.
 * Hosts local Web UI & REST APIs on 127.0.0.1:4012.
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { getStats, resetStats, getStatsFilePath } = require('../core/telemetry');
const { getActivePreset, setActivePreset, runCompressionBenchmark } = require('../core/compactor');
const { getChunkStoreStats, clearChunkStore } = require('../core/chunk-store');
const {
  isHookInstalled,
  isMcpInstalled,
  installHook,
  uninstallHook,
  installMcpServer,
  uninstallMcpServer,
  verifyHookExecution,
  verifyMcpExecution
} = require('../utils/hook-manager');

const PORT = parseInt(process.env.AGY_COMPRESSOR_PORT || '4012', 10);
const HOST = '127.0.0.1';
const DASHBOARD_HTML_PATH = path.join(__dirname, 'dashboard.html');

function readRequestBody(req) {
  return new Promise(resolve => {
    let body = '';
    req.on('data', chunk => {
      body += chunk.toString('utf8');
      if (body.length > 1024 * 100) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (_) {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function getExtendedStats(force = false) {
  const stats = getStats(force);
  return {
    ...stats,
    activePreset: getActivePreset(),
    ccrStats: getChunkStoreStats(),
    hookInstalled: isHookInstalled('global'),
    mcpInstalled: isMcpInstalled()
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || '127.0.0.1'}`);
  const pathname = url.pathname;
  const method = req.method;

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
    res.end(JSON.stringify({ status: 'ok', port: PORT, version: '2.1.0' }));
    return;
  }

  // 3. Stats API
  if (pathname === '/api/stats' && method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(getExtendedStats(true)));
    return;
  }

  // 3b. Stats SSE Stream API
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
        const stats = getExtendedStats(true);
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
    const hookCheck = verifyHookExecution();
    const mcpCheck = verifyMcpExecution();
    const docData = {
      nodeVersion: process.version,
      platform: process.platform,
      osRelease: os.release(),
      configDir: path.join(os.homedir(), '.gemini', 'config'),
      hookInstalled: isHookInstalled('global'),
      hookVerified: hookCheck.success,
      mcpInstalled: isMcpInstalled(),
      mcpVerified: mcpCheck.success,
      activePreset: getActivePreset(),
      ccrStats: getChunkStoreStats(),
      stats: getStats()
    };
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(docData));
    return;
  }

  // 6. Hook + MCP Install API
  if (pathname === '/api/hook/install' && method === 'POST') {
    try {
      installHook('global');
      installMcpServer();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, message: 'PreToolUse Hook 与 MCP 服务已全局安装并激活' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: err.message }));
    }
    return;
  }

  // 7. Hook + MCP Uninstall API
  if (pathname === '/api/hook/uninstall' && method === 'POST') {
    try {
      uninstallHook('global');
      uninstallMcpServer();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: true, message: 'PreToolUse Hook 与 MCP 服务已成功卸载' }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ success: false, message: err.message }));
    }
    return;
  }

  // 8. Preset Switch API
  if (pathname === '/api/preset' && method === 'POST') {
    const body = await readRequestBody(req);
    const updated = setActivePreset(body.preset || 'balanced');
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, preset: updated.preset, message: `已切换全局压缩策略为: ${updated.preset}` }));
    return;
  }

  // 9. Benchmark API
  if (pathname === '/api/benchmark' && (method === 'POST' || method === 'GET')) {
    const bench = runCompressionBenchmark();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(bench));
    return;
  }

  // 10. Clear CCR Cache API
  if (pathname === '/api/ccr/clear' && method === 'POST') {
    const cleared = clearChunkStore();
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ success: true, removedCount: cleared.removedCount, message: `已清理 ${cleared.removedCount} 个 CCR 缓存块` }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'Endpoint not found' }));
});

let listenRetries = 0;
server.on('error', err => {
  if (err.code === 'EADDRINUSE') {
    if (listenRetries < 5) {
      listenRetries++;
      setTimeout(() => {
        try { server.close(); } catch (_) {}
        server.listen(PORT, HOST);
      }, 500);
      return;
    }
    process.exit(0);
  } else {
    console.error('[GUI Server Error]', err);
    process.exit(1);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[GUI Server] Listening silently on http://${HOST}:${PORT}`);
});
