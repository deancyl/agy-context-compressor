#!/usr/bin/env node
/**
 * Model Context Protocol (MCP) Server for AGY
 * Ultra-low overhead, 100% native Node.js zero dependencies.
 * 
 * Tools:
 * 1. compact_view_file: Lossless context compression for text/code (lockfile/JSON folding).
 * 2. compact_run_command: Denoised terminal command runner (ANSI strip, progress collapse).
 * 3. agy_retrieve_chunk: Headroom CCR reversible chunk retrieval by chunkId.
 * 4. read_code_skeleton: squeez/llmtrim signature-mode code skeleton extractor (75%-85% token savings).
 * 5. compact_search_sandbox: Context Mode FTS5 SQLite BM25 sandboxed search.
 */

const fs = require('node:fs');
const path = require('node:path');
const { execSync } = require('node:child_process');
const readline = require('node:readline');
const { compactOutput, foldLockfiles, foldStructuredData } = require('../core/compactor');
const { fixPowerShellCommandEscaping } = require('../core/powershell');
const { retrieveChunk } = require('../core/chunk-store');
const { extractCodeSkeleton } = require('../core/skeleton');
const { searchSandbox } = require('../core/fts');
const { alignToolsSchema } = require('../core/schema');
const { recordSavings, recordSchemaAlignment } = require('../core/telemetry');

const RAW_TOOLS = [
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
  },
  {
    name: 'agy_retrieve_chunk',
    description: 'Headroom CCR (Content-Compressed Retrieval): Reversibly retrieves the original uncompressed content of a folded chunk by its chunk ID (e.g. "chk_a1b2c3d4").',
    inputSchema: {
      type: 'object',
      properties: {
        chunk_id: {
          type: 'string',
          description: 'The CCR Chunk ID indicated in the folded placeholder.'
        },
        start_line: {
          type: 'integer',
          description: 'Optional 1-based start line number to inspect.'
        },
        end_line: {
          type: 'integer',
          description: 'Optional 1-based end line number to inspect.'
        }
      },
      required: ['chunk_id']
    }
  },
  {
    name: 'read_code_skeleton',
    description: 'Code Skeleton Mode (Signature Mode): Extracts class structures, method signatures, interfaces, and types from source code while omitting method bodies, reducing token consumption by 75%-85%.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'Absolute or workspace-relative path to the source code file (.py, .js, .ts, .go, etc.).'
        }
      },
      required: ['path']
    }
  },
  {
    name: 'compact_search_sandbox',
    description: 'Context Mode Search Sandbox: Uses an in-memory SQLite FTS5 index to search keywords within a large file or log, returning BM25-ranked matching lines without flooding the main context.',
    inputSchema: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: 'File path to search inside.'
        },
        query: {
          type: 'string',
          description: 'Keywords to search for.'
        },
        max_results: {
          type: 'integer',
          description: 'Maximum number of matching lines to return (default: 25).'
        }
      },
      required: ['path', 'query']
    }
  }
];

// Apply lexicographical parameter sorting for Prompt Cache determinism
const TOOLS = alignToolsSchema(RAW_TOOLS);

function sendJsonRpc(response) {
  const payload = JSON.stringify(response);
  process.stdout.write(payload + '\n');
}

function handleToolCall(name, args) {
  // 1. compact_view_file
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

    let content = foldLockfiles(raw, { filename });
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

  // 2. compact_run_command
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

  // 3. agy_retrieve_chunk (Headroom CCR)
  if (name === 'agy_retrieve_chunk') {
    const chunkId = args.chunk_id;
    const res = retrieveChunk(chunkId, args.start_line, args.end_line);
    if (!res.isFound) {
      return {
        content: [{ type: 'text', text: res.content }],
        isError: true
      };
    }
    return {
      content: [{
        type: 'text',
        text: `[Headroom CCR Chunk: ${res.chunkId} | Lines ${res.startLine}-${res.endLine} of ${res.totalLines}]\n${res.content}`
      }]
    };
  }

  // 4. read_code_skeleton (Signature Mode)
  if (name === 'read_code_skeleton') {
    const filePath = args.path;
    if (!fs.existsSync(filePath)) {
      return {
        content: [{ type: 'text', text: `Error: File not found: ${filePath}` }],
        isError: true
      };
    }

    const raw = fs.readFileSync(filePath, 'utf8');
    const skeleton = extractCodeSkeleton(raw, filePath);
    const delta = raw.length - skeleton.length;
    if (delta > 0) {
      recordSavings('headroom', delta, raw.length, { filename: path.basename(filePath), type: 'code_skeleton' });
    }

    return {
      content: [{
        type: 'text',
        text: `// [Code Skeleton: ${path.basename(filePath)} | ${raw.length} bytes -> ${skeleton.length} bytes]\n${skeleton}`
      }]
    };
  }

  // 5. compact_search_sandbox (Context Mode FTS5)
  if (name === 'compact_search_sandbox') {
    const result = searchSandbox({
      targetPath: args.path,
      query: args.query,
      maxResults: args.max_results || 25
    });

    if (result.error) {
      return {
        content: [{ type: 'text', text: `Error: ${result.error}` }],
        isError: true
      };
    }

    const formatted = result.matches.length > 0
      ? result.matches.map(m => `Line ${m.lineNumber}: ${m.line}`).join('\n')
      : `No matches found for query "${result.query}" in ${result.totalLines} lines.`;

    return {
      content: [{
        type: 'text',
        text: `[Sandbox FTS Search: ${result.matches.length} matches in ${path.basename(result.targetPath)} (${result.engine})]\n${formatted}`
      }]
    };
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
            version: '1.1.0'
          }
        }
      });
      return;
    }

    if (method === 'notifications/initialized') {
      return;
    }

    if (method === 'tools/list') {
      try {
        recordSchemaAlignment(TOOLS.length);
      } catch (_) {}

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
