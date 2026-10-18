#!/usr/bin/env node
/**
 * Model Context Protocol (MCP) Server for AGY
 * Ultra-low overhead, 100% native Node.js zero dependencies.
 * Exposes compressed tool alternatives:
 * - compact_view_file: safe lockfile/JSON folding
 * - compact_run_command: denoised terminal command runner
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const readline = require('node:readline');
const { compactOutput, foldLockfiles, foldStructuredData } = require('../core/compactor');
const { fixPowerShellCommandEscaping } = require('../core/powershell');
const { recordSavings } = require('../core/telemetry');

const TOOLS = [
  {
    name: 'compact_view_file',
    description: 'Reads a text or source code file with deterministic lossless context compression (auto-folds large lockfiles and giant JSON arrays while strictly preserving code diffs and git conflict markers).',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute or workspace-relative path to the file to inspect.'
        },
        maxLines: {
          type: 'integer',
          description: 'Optional maximum number of lines to return.'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'compact_run_command',
    description: 'Executes a terminal command and returns denoised, compressed output (strips ANSI escape codes, collapses progress bars, and folds repetitive passing tests while 100% preserving failure messages and stack traces).',
    inputSchema: {
      type: 'object',
      properties: {
        command: {
          type: 'string',
          description: 'The shell command to execute.'
        },
        cwd: {
          type: 'string',
          description: 'Optional working directory for the command.'
        }
      },
      required: ['command']
    }
  }
];

function sendJsonRpc(response) {
  const payload = JSON.stringify(response);
  process.stdout.write(payload + '\n');
}

function handleToolCall(name, args) {
  if (name === 'compact_view_file') {
    const filePath = args.path;
    if (!fs.existsSync(filePath)) {
      return {
        content: [{ type: 'text', text: `Error: File not found: ${filePath}` }],
        isError: true
      };
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const origLen = raw.length;
    const filename = path.basename(filePath);

    // Apply lockfile folding
    let content = foldLockfiles(raw, { filename });
    // Apply structured data folding
    content = foldStructuredData(content);

    const delta = origLen - content.length;
    if (delta > 0) {
      recordSavings('headroom', delta, origLen, { filename });
    }

    if (args.maxLines && typeof args.maxLines === 'number') {
      const lines = content.split(/\r?\n/);
      if (lines.length > args.maxLines) {
        content = lines.slice(0, args.maxLines).join('\n') + `\n... [truncated to ${args.maxLines} lines]`;
      }
    }

    return {
      content: [{ type: 'text', text: content }]
    };
  }

  if (name === 'compact_run_command') {
    const rawCmd = args.command || '';
    const cwd = args.cwd || process.cwd();
    const safeCmd = fixPowerShellCommandEscaping(rawCmd);

    try {
      const isWin = process.platform === 'win32';
      const shell = isWin ? 'powershell.exe' : '/bin/sh';
      const rawOutput = execSync(safeCmd, {
        cwd,
        shell,
        encoding: 'utf8',
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe']
      });

      const compacted = compactOutput(rawOutput);
      return {
        content: [{ type: 'text', text: compacted }]
      };
    } catch (err) {
      const stdout = err.stdout ? err.stdout.toString() : '';
      const stderr = err.stderr ? err.stderr.toString() : '';
      const combined = stdout + (stderr ? '\n' + stderr : '');
      const compactedErr = compactOutput(combined || err.message);

      return {
        content: [{ type: 'text', text: compactedErr }],
        isError: true
      };
    }
  }

  return {
    content: [{ type: 'text', text: `Unknown tool: ${name}` }],
    isError: true
  };
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', line => {
  const trimmed = line.trim();
  if (!trimmed) return;

  try {
    const req = JSON.parse(trimmed);
    const { id, method, params } = req;

    if (method === 'initialize') {
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: {}
          },
          serverInfo: {
            name: 'agy-context-compressor',
            version: '1.0.0'
          }
        }
      });
      return;
    }

    if (method === 'notifications/initialized') {
      return;
    }

    if (method === 'tools/list') {
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result: {
          tools: TOOLS
        }
      });
      return;
    }

    if (method === 'tools/call') {
      const result = handleToolCall(params.name, params.arguments || {});
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        result
      });
      return;
    }

    if (id !== undefined) {
      sendJsonRpc({
        jsonrpc: '2.0',
        id,
        error: {
          code: -32601,
          message: `Method not found: ${method}`
        }
      });
    }
  } catch (err) {
    sendJsonRpc({
      jsonrpc: '2.0',
      id: null,
      error: {
        code: -32700,
        message: 'Parse error'
      }
    });
  }
});
