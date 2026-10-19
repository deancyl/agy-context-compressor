/**
 * Code Skeleton (Signature Mode) & Aider-Style Repo Map Engine (2.0)
 * 100% native Node.js zero dependencies.
 *
 * Capabilities:
 * - Lexical string/comment-aware brace depth tracker (immune to braces inside strings, comments, or inline types).
 * - Extracts classes, methods, arrow functions, multiline function signatures, interfaces, structs, traits, and types.
 * - Annotates exact source line spans (e.g. // [Line 45] or // [Line 45-88]) so the Agent can pass exact StartLine/EndLine to view_file.
 * - Supports Python, JS/TS/JSX/TSX, Go, Rust, Java, C#, and C/C++.
 * - Aider-style Repo Map with cross-file import/reference centrality ranking (most referenced core modules ranked first).
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Counts net '{' (+1) and '}' (-1) on a single line while ignoring strings and comments.
 * Mutates state.inBlockComment across lines.
 * @param {string} line
 * @param {{ inBlockComment?: boolean }} [state]
 * @returns {{ delta: number, openCount: number, closeCount: number }}
 */
function countBracesLexical(line, state = { inBlockComment: false }) {
  let delta = 0;
  let openCount = 0;
  let closeCount = 0;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1] || '';

    if (state.inBlockComment) {
      if (ch === '*' && next === '/') {
        state.inBlockComment = false;
        i++;
      }
      continue;
    }

    if (!inSingle && !inDouble && !inTemplate) {
      if (ch === '/' && next === '/') break; // Line comment
      if (ch === '/' && next === '*') {
        state.inBlockComment = true;
        i++;
        continue;
      }
    }

    if (ch === '\\') {
      i++; // Skip escaped char
      continue;
    }

    if (!inDouble && !inTemplate && ch === "'") {
      inSingle = !inSingle;
      continue;
    }
    if (!inSingle && !inTemplate && ch === '"') {
      inDouble = !inDouble;
      continue;
    }
    if (!inSingle && !inDouble && ch === '`') {
      inTemplate = !inTemplate;
      continue;
    }

    if (!inSingle && !inDouble && !inTemplate) {
      if (ch === '{') {
        delta++;
        openCount++;
      } else if (ch === '}') {
        delta--;
        closeCount++;
      }
    }
  }

  return { delta, openCount, closeCount };
}

/**
 * Finds the closing line number (1-based) of a brace-delimited block starting at startIdx.
 * @param {string[]} lines
 * @param {number} startIdx
 * @param {number} [maxScan=500]
 * @returns {number} 1-based end line number
 */
function findBraceBlockEndLine(lines, startIdx, maxScan = 500) {
  const state = { inBlockComment: false };
  let depth = 0;
  let seenOpen = false;
  const limit = Math.min(lines.length, startIdx + maxScan);

  for (let i = startIdx; i < limit; i++) {
    const { delta, openCount } = countBracesLexical(lines[i], state);
    if (openCount > 0) seenOpen = true;
    depth += delta;
    if (seenOpen && depth <= 0) {
      return i + 1;
    }
  }
  return startIdx + 1;
}

/**
 * Formats line annotation comment. Includes endLine when a multi-line block span is detected.
 */
function formatLineTag(prefix, startLine, endLine) {
  if (endLine && endLine > startLine) {
    return `${prefix}[Line ${startLine}-${endLine}]`;
  }
  return `${prefix}[Line ${startLine}]`;
}

/**
 * Extracts Python class and function signatures (including multiline parameter lists) with line numbers.
 * @param {string} content
 * @returns {string}
 */
function extractPythonSkeleton(content) {
  const lines = content.split(/\r?\n/);
  const out = [];
  let inDocstring = false;
  let docstringDelimiter = '';

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    const trimmed = line.trim();

    // Preserve docstrings at top or immediately after def/class
    if (trimmed.startsWith('"""') || trimmed.startsWith("'''")) {
      const delim = trimmed.slice(0, 3);
      if (trimmed.length > 3 && trimmed.endsWith(delim)) {
        out.push(line);
        continue;
      }
      if (!inDocstring) {
        inDocstring = true;
        docstringDelimiter = delim;
        out.push(line);
        continue;
      } else if (trimmed.endsWith(docstringDelimiter)) {
        inDocstring = false;
        out.push(line);
        continue;
      }
    }
    if (inDocstring) {
      out.push(line);
      continue;
    }

    // Top-level imports
    if (trimmed.startsWith('import ') || trimmed.startsWith('from ')) {
      out.push(line);
      continue;
    }

    // Decorators
    if (trimmed.startsWith('@')) {
      out.push(line);
      continue;
    }

    // Classes
    if (trimmed.startsWith('class ') || /^\s+class\s+/.test(line)) {
      const indent = line.match(/^\s*/)[0];
      out.push(`${indent}# [Line ${lineNum}]`);
      out.push(line);
      continue;
    }

    // Single-line function / method signatures
    const defMatch = line.match(/^(\s*)(async\s+def|def)\s+([a-zA-Z0-9_]+)\s*\((.*?)\)(?:\s*->\s*[^:]+)?\s*:/);
    if (defMatch) {
      const indent = defMatch[1];
      out.push(`${indent}# [Line ${lineNum}]`);
      out.push(line);
      const nextLine = (lines[i + 1] || '').trim();
      if (!nextLine.startsWith('"""') && !nextLine.startsWith("'''")) {
        out.push(`${indent}    ...`);
      }
      continue;
    }

    // Multiline Python function / method signature: def foo(\n  a: int,\n) -> bool:
    const multiDefStart = line.match(/^(\s*)(async\s+def|def)\s+([a-zA-Z0-9_]+)\s*\(/);
    if (multiDefStart && !trimmed.endsWith(':')) {
      const indent = multiDefStart[1];
      let combined = line.trim();
      let k = i;
      while (k + 1 < lines.length && k - i < 25) {
        k++;
        const part = lines[k].trim();
        combined += ' ' + part;
        if (part.endsWith(':') && combined.includes(')')) {
          break;
        }
      }
      if (combined.includes(')') && combined.endsWith(':')) {
        out.push(`${indent}# [Line ${lineNum}-${k + 1}]`);
        out.push(`${indent}${combined}`);
        i = k;
        const nextLine = (lines[i + 1] || '').trim();
        if (!nextLine.startsWith('"""') && !nextLine.startsWith("'''")) {
          out.push(`${indent}    ...`);
        }
        continue;
      }
    }

    // Type aliases and global constants
    if (/^[A-Z][A-Za-z0-9_]*\s*(?::\s*[^=]+)?=\s*(?:TypeVar|NewType|Union|Optional|Annotated|int|str|float|bool|list|dict|tuple|\[|\{|\(|["'\d])/.test(trimmed)) {
      out.push(line);
      continue;
    }
  }

  return out.join('\n');
}

/**
 * Extracts JS/TS class, interface, type, arrow function, and function signatures with line numbers.
 * Uses lexical brace counting so nested inline object types never corrupt block boundaries.
 * @param {string} content
 * @returns {string}
 */
function extractJavaScriptSkeleton(content) {
  const lines = content.split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    const trimmed = line.trim();

    // Preserve imports
    if (trimmed.startsWith('import ') || trimmed.startsWith('const {') || trimmed.startsWith('require(')) {
      out.push(line);
      continue;
    }

    // TypeScript types, interfaces, enums
    if (/^(?:export\s+)?(?:declare\s+)?(?:type|interface|enum)\s+/.test(trimmed)) {
      const endLine = trimmed.includes('{') ? findBraceBlockEndLine(lines, i, 120) : lineNum;
      out.push(formatLineTag('// ', lineNum, endLine));
      out.push(line);
      if (endLine > lineNum) {
        while (i + 1 < endLine) {
          i++;
          out.push(lines[i]);
        }
      }
      continue;
    }

    // Class declarations
    if (/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+/.test(trimmed)) {
      const indent = line.match(/^\s*/)[0];
      const endLine = findBraceBlockEndLine(lines, i, 800);
      out.push(formatLineTag(`${indent}// `, lineNum, endLine));
      out.push(line);
      continue;
    }

    // Standard Functions
    const fnMatch = line.match(/^(\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|\bfunction\b)\s+([a-zA-Z0-9_$]+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*[^{]+)?/);
    if (fnMatch) {
      const indent = fnMatch[1];
      const endLine = findBraceBlockEndLine(lines, i, 500);
      out.push(formatLineTag(`${indent}// `, lineNum, endLine));
      out.push(`${line.replace(/\{[\s\S]*$/, '').trim()} { /* ... */ }`);
      continue;
    }

    // Arrow functions: const fn = <T>(a, b) => or export const fn = async (a, b) =>
    const arrowMatch = line.match(/^(\s*)(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)(?:\s*:\s*[^=]+)?\s*=\s*(?:async\s*)?(?:<[^>]*>\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*(?::\s*[^{=>]+)?\s*=>/);
    if (arrowMatch) {
      const indent = arrowMatch[1];
      const endLine = findBraceBlockEndLine(lines, i, 500);
      out.push(formatLineTag(`${indent}// `, lineNum, endLine));
      out.push(`${line.replace(/\{[\s\S]*$/, '').trim()} { /* ... */ }`);
      continue;
    }

    // Function expressions: const fn = function(...)
    const constFnMatch = line.match(/^(\s*)(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s+)?function\*?\s*(?:[a-zA-Z0-9_$]+)?\s*\(([^)]*)\)/);
    if (constFnMatch) {
      const indent = constFnMatch[1];
      const endLine = findBraceBlockEndLine(lines, i, 500);
      out.push(formatLineTag(`${indent}// `, lineNum, endLine));
      out.push(`${line.replace(/\{[\s\S]*$/, '').trim()} { /* ... */ }`);
      continue;
    }

    // Multiline parameter signatures: function foo( ... \n ... ) or const foo = ( ... \n ... ) =>
    const multiParamStart = line.match(/^(\s*)(?:(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([a-zA-Z0-9_$]+)(?:\s*<[^>]*>)?|(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:<[^>]*>\s*)?)\s*\(/);
    if (multiParamStart && !line.includes(')')) {
      const indent = multiParamStart[1];
      let fullSig = line.trim();
      let k = i;
      while (k + 1 < lines.length && k - i < 25 && !fullSig.includes(')')) {
        k++;
        fullSig += ' ' + lines[k].trim();
      }
      if (fullSig.includes(')') && (fullSig.includes('=>') || fullSig.includes('{') || /\)\s*:/.test(fullSig))) {
        const endLine = findBraceBlockEndLine(lines, k, 500);
        i = k;
        out.push(formatLineTag(`${indent}// `, lineNum, endLine));
        out.push(`${indent}${fullSig.replace(/\{[\s\S]*$/, '').trim()} { /* ... */ }`);
        continue;
      }
    }

    // Class methods / object methods
    const methodMatch = line.match(/^(\s*)(?:(?:public|private|protected|static|readonly|override|abstract|async|get|set)\s+)*([a-zA-Z0-9_$]+)\s*(?:<[^>]*>)?\s*\(([^)]*)\)(?:\s*:\s*[^{]+)?\s*\{/);
    if (
      methodMatch &&
      !trimmed.startsWith('if') &&
      !trimmed.startsWith('for') &&
      !trimmed.startsWith('while') &&
      !trimmed.startsWith('switch') &&
      !trimmed.startsWith('catch') &&
      !trimmed.startsWith('function')
    ) {
      const indent = methodMatch[1];
      const endLine = findBraceBlockEndLine(lines, i, 300);
      out.push(formatLineTag(`${indent}// `, lineNum, endLine));
      out.push(`${line.replace(/\{[\s\S]*$/, '').trim()} { /* ... */ }`);
      continue;
    }

    // Module exports
    if (trimmed.startsWith('module.exports') || trimmed.startsWith('export default') || trimmed.startsWith('export {')) {
      out.push(line);
      continue;
    }
  }

  return out.join('\n');
}

/**
 * Extracts Rust struct, enum, trait, impl, and function signatures with line numbers.
 * @param {string} content
 * @returns {string}
 */
function extractRustSkeleton(content) {
  const lines = content.split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('use ') || trimmed.startsWith('mod ')) {
      out.push(line);
      continue;
    }

    if (/^(?:pub(?:\s*\([^)]*\))?\s+)?(?:struct|enum|trait|type)\s+/.test(trimmed)) {
      const endLine = trimmed.includes('{') ? findBraceBlockEndLine(lines, i, 120) : lineNum;
      out.push(formatLineTag('// ', lineNum, endLine));
      out.push(line);
      continue;
    }

    if (/^impl(?:<[^>]*>)?\s+/.test(trimmed)) {
      const endLine = findBraceBlockEndLine(lines, i, 500);
      out.push(formatLineTag('// ', lineNum, endLine));
      out.push(line);
      continue;
    }

    const fnMatch = trimmed.match(/^(?:pub(?:\s*\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([a-zA-Z0-9_]+)/);
    if (fnMatch) {
      const indent = line.match(/^\s*/)[0];
      const endLine = findBraceBlockEndLine(lines, i, 400);
      out.push(formatLineTag(`${indent}// `, lineNum, endLine));
      out.push(`${line.replace(/\{[\s\S]*$/, '').trim()} { /* ... */ }`);
      continue;
    }
  }

  return out.join('\n');
}

/**
 * Extracts Java / C# class, interface, struct, and method signatures with line numbers.
 * @param {string} content
 * @returns {string}
 */
function extractJavaOrCSharpSkeleton(content) {
  const lines = content.split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('package ') || trimmed.startsWith('import ') || trimmed.startsWith('using ') || trimmed.startsWith('namespace ')) {
      out.push(line);
      continue;
    }

    if (/^(?:(?:public|protected|private|internal|abstract|final|sealed|static|partial)\s+)*(?:class|interface|enum|record|struct)\s+/.test(trimmed)) {
      const indent = line.match(/^\s*/)[0];
      const endLine = findBraceBlockEndLine(lines, i, 800);
      out.push(formatLineTag(`${indent}// `, lineNum, endLine));
      out.push(line);
      continue;
    }

    if (
      /^(?:(?:public|protected|private|internal|static|final|synchronized|abstract|virtual|override|async)\s+)+[\w<>\[\],.?]+\s+[a-zA-Z0-9_]+\s*\([^)]*\)(?:\s+throws\s+[\w,\s]+)?\s*\{?/.test(trimmed) &&
      !trimmed.startsWith('if') &&
      !trimmed.startsWith('for') &&
      !trimmed.startsWith('while')
    ) {
      const indent = line.match(/^\s*/)[0];
      const endLine = findBraceBlockEndLine(lines, i, 400);
      out.push(formatLineTag(`${indent}// `, lineNum, endLine));
      out.push(`${line.replace(/\{[\s\S]*$/, '').trim()} { /* ... */ }`);
      continue;
    }
  }

  return out.join('\n');
}

/**
 * Extracts C / C++ includes, classes, structs, and top-level function signatures.
 * @param {string} content
 * @returns {string}
 */
function extractCSkeleton(content) {
  const lines = content.split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('#include ') || trimmed.startsWith('#define ')) {
      out.push(line);
      continue;
    }

    if (/^(?:template\s*<[^>]+>\s*)?(?:class|struct|enum|namespace)\s+[A-Za-z0-9_]+/.test(trimmed)) {
      const endLine = trimmed.includes('{') ? findBraceBlockEndLine(lines, i, 500) : lineNum;
      out.push(formatLineTag('// ', lineNum, endLine));
      out.push(line);
      continue;
    }

    // Top-level C/C++ function definition
    if (
      /^[A-Za-z_][\w:<>*&\s]+\s+[A-Za-z_][\w:]*\s*\([^;]*\)\s*(?:const)?\s*\{/.test(trimmed) &&
      !trimmed.startsWith('if') &&
      !trimmed.startsWith('for') &&
      !trimmed.startsWith('while') &&
      !trimmed.startsWith('switch')
    ) {
      const endLine = findBraceBlockEndLine(lines, i, 400);
      out.push(formatLineTag('// ', lineNum, endLine));
      out.push(`${line.replace(/\{[\s\S]*$/, '').trim()} { /* ... */ }`);
      continue;
    }
  }

  return out.join('\n');
}

/**
 * Extracts Golang struct, interface, and function signatures with line numbers.
 * @param {string} content
 * @returns {string}
 */
function extractGoSkeleton(content) {
  const lines = content.split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('package ') || trimmed.startsWith('import ')) {
      out.push(line);
      continue;
    }

    if (/^type\s+[A-Za-z0-9_]+\s+(struct|interface)/.test(trimmed)) {
      const endLine = trimmed.includes('{') ? findBraceBlockEndLine(lines, i, 120) : lineNum;
      out.push(formatLineTag('// ', lineNum, endLine));
      out.push(line);
      if (endLine > lineNum) {
        while (i + 1 < endLine) {
          i++;
          out.push(lines[i]);
        }
      }
      continue;
    }

    if (/^func\s+/.test(trimmed)) {
      const endLine = findBraceBlockEndLine(lines, i, 400);
      out.push(formatLineTag('// ', lineNum, endLine));
      out.push(`${line.replace(/\{[\s\S]*$/, '').trim()} { ... }`);
      continue;
    }
  }

  return out.join('\n');
}

/**
 * Main dispatcher to extract code skeleton from a source file.
 * @param {string} content
 * @param {string} filePath
 * @returns {string}
 */
function extractCodeSkeleton(content, filePath = '') {
  if (typeof content !== 'string' || content.length === 0) return '';
  const ext = path.extname(filePath).toLowerCase();

  switch (ext) {
    case '.py':
      return extractPythonSkeleton(content);
    case '.js':
    case '.jsx':
    case '.ts':
    case '.tsx':
    case '.mjs':
    case '.cjs':
      return extractJavaScriptSkeleton(content);
    case '.go':
      return extractGoSkeleton(content);
    case '.rs':
      return extractRustSkeleton(content);
    case '.java':
    case '.cs':
      return extractJavaOrCSharpSkeleton(content);
    case '.c':
    case '.cpp':
    case '.cc':
    case '.h':
    case '.hpp':
      return extractCSkeleton(content);
    default:
      const lines = content.split(/\r?\n/);
      if (lines.length > 120) {
        return lines.slice(0, 100).join('\n') + `\n\n// ... [${lines.length - 100} lines omitted by Code Skeleton]`;
      }
      return content;
  }
}

/**
 * Extracts a ultra-concise bulleted symbol outline from code.
 * @param {string} content
 * @param {string} filePath
 * @returns {string[]}
 */
function extractSymbolOutline(content, filePath = '') {
  if (typeof content !== 'string' || content.length === 0) return [];
  const skeleton = extractCodeSkeleton(content, filePath);
  const lines = skeleton.split(/\r?\n/);
  const symbols = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const lineMatch = trimmed.match(/^(?:\/{2}|#)\s*\[Line\s+(\d+(?:-\d+)?)\]/i);
    if (lineMatch) {
      const lineSpan = lineMatch[1];
      const nextLine = (lines[i + 1] || '').trim();
      if (nextLine) {
        const cleaned = nextLine
          .replace(/\{[\s\S]*$/, '')
          .replace(/:\s*$/, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (cleaned && !cleaned.startsWith('//') && !cleaned.startsWith('#')) {
          const isTopContainer = /\b(?:class|interface|struct|trait|enum|impl)\b/.test(cleaned);
          const indent = isTopContainer ? '  - ' : '    - ';
          symbols.push(`${indent}[Line ${lineSpan}] ${cleaned}`);
        }
      }
    }
  }

  return symbols;
}

const DEFAULT_EXCLUDE_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', '.gemini',
  '.next', '.cache', '.opencode', '.turbo', '.vscode', '.idea'
]);

const CODE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.cc', '.h', '.hpp', '.cs'
]);

/**
 * Extracts referenced module basenames from import / require / use / from statements
 * to compute Aider-style cross-file dependency centrality.
 * @param {string} content
 * @returns {string[]}
 */
function extractImportedModuleNames(content) {
  if (typeof content !== 'string') return [];
  const refs = [];
  const regexes = [
    /require\(\s*['"]([^'"]+)['"]\s*\)/g,
    /from\s+['"]([^'"]+)['"]/g,
    /^(?:from|import)\s+([a-zA-Z0-9_.]+)/gm,
    /use\s+(?:crate::)?([a-zA-Z0-9_:]+)/g
  ];
  for (const rx of regexes) {
    let m;
    while ((m = rx.exec(content)) !== null) {
      const raw = m[1];
      const base = raw.split(/[/\\:.]/).filter(Boolean).pop();
      if (base) refs.push(base.toLowerCase());
    }
  }
  return refs;
}

/**
 * Scans a directory and generates an Aider-style hierarchical Repo Map (AST outline)
 * ranked by cross-file dependency centrality (most referenced core modules first).
 *
 * @param {string} rootDir - Root directory to map
 * @param {object} [options]
 * @param {number} [options.maxFiles=50]
 * @param {number} [options.maxChars=15000]
 * @param {string[]} [options.excludeDirs]
 * @returns {{ map: string, fileCount: number, symbolCount: number, totalOriginalChars: number }}
 */
function generateRepoMap(rootDir, options = {}) {
  if (!fs.existsSync(rootDir)) {
    return { map: '', fileCount: 0, symbolCount: 0, totalOriginalChars: 0 };
  }

  const maxFiles = options.maxFiles || 50;
  const maxChars = options.maxChars || 15000;
  const userExcludes = new Set(options.excludeDirs || []);

  const filesToScan = [];

  function walk(currentDir) {
    if (filesToScan.length >= maxFiles * 2) return;
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (_) {
      return;
    }

    for (const entry of entries) {
      if (filesToScan.length >= maxFiles * 2) break;
      const name = entry.name;
      if (DEFAULT_EXCLUDE_DIRS.has(name) || userExcludes.has(name)) continue;
      if (name.startsWith('.')) continue;

      const fullPath = path.join(currentDir, name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile()) {
        const ext = path.extname(name).toLowerCase();
        if (CODE_EXTENSIONS.has(ext)) {
          filesToScan.push(fullPath);
        }
      }
    }
  }

  walk(rootDir);

  // First pass: read files and compute cross-file import reference counts (Aider PageRank-lite)
  const fileRecords = [];
  const inboundRefCounts = new Map();
  let totalOriginalChars = 0;

  for (const filePath of filesToScan) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      totalOriginalChars += content.length;
      const baseNoExt = path.basename(filePath, path.extname(filePath)).toLowerCase();
      const imports = extractImportedModuleNames(content);
      for (const imp of imports) {
        inboundRefCounts.set(imp, (inboundRefCounts.get(imp) || 0) + 1);
      }
      fileRecords.push({
        filePath,
        baseNoExt,
        content,
        relPath: path.relative(rootDir, filePath).replace(/\\/g, '/')
      });
    } catch (_) {}
  }

  // Sort files by inbound reference centrality descending, then shallow path depth
  fileRecords.sort((a, b) => {
    const scoreA = inboundRefCounts.get(a.baseNoExt) || 0;
    const scoreB = inboundRefCounts.get(b.baseNoExt) || 0;
    if (scoreB !== scoreA) return scoreB - scoreA;
    const depthA = a.relPath.split('/').length;
    const depthB = b.relPath.split('/').length;
    if (depthA !== depthB) return depthA - depthB;
    return a.relPath.localeCompare(b.relPath);
  });

  let output = `# Codebase Repo Map (AST Outline)\n> Generated for: ${path.resolve(rootDir).replace(/\\/g, '/')}\n\n`;
  let symbolCount = 0;
  let fileCount = 0;

  for (const record of fileRecords.slice(0, maxFiles)) {
    if (output.length >= maxChars) {
      output += `\n... [Repo Map truncated at ${fileCount} files to protect token budget]\n`;
      break;
    }

    const symbols = extractSymbolOutline(record.content, record.filePath);
    const refScore = inboundRefCounts.get(record.baseNoExt) || 0;
    const refTag = refScore > 0 ? ` (referenced by ${refScore} module${refScore > 1 ? 's' : ''})` : '';

    if (symbols.length > 0) {
      output += `## ${record.relPath}${refTag}\n`;
      output += symbols.join('\n') + '\n\n';
      symbolCount += symbols.length;
      fileCount++;
    } else if (record.content.length > 0 && record.content.length < 5000) {
      output += `## ${record.relPath} (no class/function symbols)\n\n`;
      fileCount++;
    }
  }

  return {
    map: output.trim(),
    fileCount,
    symbolCount,
    totalOriginalChars
  };
}

module.exports = {
  countBracesLexical,
  findBraceBlockEndLine,
  extractCodeSkeleton,
  extractPythonSkeleton,
  extractJavaScriptSkeleton,
  extractGoSkeleton,
  extractRustSkeleton,
  extractJavaSkeleton: extractJavaOrCSharpSkeleton,
  extractCSkeleton,
  extractSymbolOutline,
  generateRepoMap
};
