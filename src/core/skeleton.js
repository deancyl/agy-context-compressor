/**
 * Code Skeleton (Signature Mode) & Aider-Style Repo Map Engine (2.3)
 * 100% native Node.js zero dependencies.
 *
 * Capabilities:
 * - Lexical string/comment-aware brace depth tracker (immune to braces inside strings, comments, or inline types).
 * - Parenthesis-aware signature body stripper (preserves default object parameters like `cfg = {}` intact).
 * - Deep block scanner (up to 15,000 lines) so giant test suites and server entryfunctions get exact [Line start-end] spans.
 * - Filters out nested inner closures from top-level symbol outlines.
 * - Supports Python, JS/TS/JSX/TSX, Go, Rust, Java, C#, and C/C++.
 * - Aider-style Repo Map with cross-file import/reference centrality ranking.
 */

const fs = require('node:fs');
const path = require('node:path');

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
      if (ch === '/' && next === '/') break;
      if (ch === '/' && next === '*') {
        state.inBlockComment = true;
        i++;
        continue;
      }
    }

    if (ch === '\\') {
      i++;
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
 * Strips the opening '{' of a function/method body at the end of a signature line
 * WITHOUT stripping '{}' inside default parameter values like `function foo(cfg = {}) {`.
 * @param {string} line
 * @returns {string}
 */
function stripBodyFromSignature(line) {
  if (typeof line !== 'string') return '';
  let parenDepth = 0;
  let seenOpenParen = false;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let bodyBraceIdx = -1;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const next = line[i + 1] || '';

    if (!inSingle && !inDouble && !inTemplate && ch === '/' && next === '/') {
      break;
    }
    if (ch === '\\') {
      i++;
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
      if (ch === '(') {
        parenDepth++;
        seenOpenParen = true;
      } else if (ch === ')') {
        if (parenDepth > 0) parenDepth--;
      } else if (ch === '{' && parenDepth === 0) {
        if (seenOpenParen || !line.includes('(') || line.slice(0, i).includes('=>')) {
          bodyBraceIdx = i;
          break;
        }
      }
    }
  }

  if (bodyBraceIdx !== -1) {
    return line.slice(0, bodyBraceIdx).trim();
  }
  return line.replace(/\{\s*$/, '').trim();
}

function findBraceBlockEndLine(lines, startIdx, maxScan = 15000) {
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

function formatLineTag(prefix, startLine, endLine) {
  if (endLine && endLine > startLine) {
    return `${prefix}[Line ${startLine}-${endLine}]`;
  }
  return `${prefix}[Line ${startLine}]`;
}

function extractPythonSkeleton(content) {
  const lines = content.split(/\r?\n/);
  const out = [];
  let inDocstring = false;
  let docstringDelimiter = '';

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    const trimmed = line.trim();

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

    if (trimmed.startsWith('import ') || trimmed.startsWith('from ')) {
      out.push(line);
      continue;
    }

    if (trimmed.startsWith('@')) {
      out.push(line);
      continue;
    }

    if (trimmed.startsWith('class ') || /^\s+class\s+/.test(line)) {
      const indent = line.match(/^\s*/)[0];
      out.push(`${indent}# [Line ${lineNum}]`);
      out.push(line);
      continue;
    }

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

    if (/^[A-Z][A-Za-z0-9_]*\s*(?::\s*[^=]+)?=\s*(?:TypeVar|NewType|Union|Optional|Annotated|int|str|float|bool|list|dict|tuple|\[|\{|\(|["'\d])/.test(trimmed)) {
      out.push(line);
      continue;
    }
  }

  return out.join('\n');
}

function extractJavaScriptSkeleton(content) {
  const lines = content.split(/\r?\n/);
  const out = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith('import ') || trimmed.startsWith('const {') || trimmed.startsWith('require(')) {
      out.push(line);
      continue;
    }

    if (/^(?:export\s+)?(?:declare\s+)?(?:type|interface|enum)\s+/.test(trimmed)) {
      const endLine = trimmed.includes('{') ? findBraceBlockEndLine(lines, i, 200) : lineNum;
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

    if (/^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+/.test(trimmed)) {
      const indent = line.match(/^\s*/)[0];
      const endLine = findBraceBlockEndLine(lines, i, 15000);
      out.push(formatLineTag(`${indent}// `, lineNum, endLine));
      out.push(stripBodyFromSignature(line) + ' {');
      continue;
    }

    // Standard Functions
    const fnMatch = line.match(/^(\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function\*?|\bfunction\b)\s+([a-zA-Z0-9_$]+)\s*(?:<[^>]*>)?\s*\(/);
    if (fnMatch && line.includes(')')) {
      const indent = fnMatch[1];
      if (indent.length <= 2) {
        const endLine = findBraceBlockEndLine(lines, i, 15000);
        out.push(formatLineTag(`${indent}// `, lineNum, endLine));
        out.push(`${stripBodyFromSignature(line)} { /* ... */ }`);
        continue;
      }
    }

    // Top-level Arrow functions (indent === 0 to exclude inner closures like `const onError = (err) =>` inside functions)
    const arrowMatch = line.match(/^(\s*)(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)(?:\s*:\s*[^=]+)?\s*=\s*(?:async\s*)?(?:<[^>]*>\s*)?(?:\([^)]*\)|[a-zA-Z0-9_$]+)\s*(?::\s*[^{=>]+)?\s*=>/);
    if (arrowMatch && arrowMatch[1].length === 0) {
      const indent = arrowMatch[1];
      const endLine = findBraceBlockEndLine(lines, i, 15000);
      out.push(formatLineTag(`${indent}// `, lineNum, endLine));
      out.push(`${stripBodyFromSignature(line)} { /* ... */ }`);
      continue;
    }

    // Top-level Function expressions: const fn = function(...)
    const constFnMatch = line.match(/^(\s*)(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s+)?function\*?\s*(?:[a-zA-Z0-9_$]+)?\s*\(/);
    if (constFnMatch && constFnMatch[1].length === 0 && line.includes(')')) {
      const indent = constFnMatch[1];
      const endLine = findBraceBlockEndLine(lines, i, 15000);
      out.push(formatLineTag(`${indent}// `, lineNum, endLine));
      out.push(`${stripBodyFromSignature(line)} { /* ... */ }`);
      continue;
    }

    // Multiline parameter signatures
    const multiParamStart = line.match(/^(\s*)(?:(?:export\s+)?(?:default\s+)?(?:async\s+)?function\*?\s+([a-zA-Z0-9_$]+)(?:\s*<[^>]*>)?|(?:export\s+)?(?:const|let|var)\s+([a-zA-Z0-9_$]+)\s*=\s*(?:async\s*)?(?:<[^>]*>\s*)?)\s*\(/);
    if (multiParamStart && multiParamStart[1].length <= 2 && !line.includes(')')) {
      const indent = multiParamStart[1];
      let fullSig = line.trim();
      let k = i;
      while (k + 1 < lines.length && k - i < 25 && !fullSig.includes(')')) {
        k++;
        fullSig += ' ' + lines[k].trim();
      }
      if (fullSig.includes(')') && (fullSig.includes('=>') || fullSig.includes('{') || /\)\s*:/.test(fullSig))) {
        const endLine = findBraceBlockEndLine(lines, k, 15000);
        i = k;
        out.push(formatLineTag(`${indent}// `, lineNum, endLine));
        out.push(`${indent}${stripBodyFromSignature(fullSig)} { /* ... */ }`);
        continue;
      }
    }

    // Class methods / object methods (indent 2..4 spaces)
    const methodMatch = line.match(/^(\s*)(?:(?:public|private|protected|static|readonly|override|abstract|async|get|set)\s+)*([a-zA-Z0-9_$]+)\s*(?:<[^>]*>)?\s*\(.*\)(?:\s*:\s*[^{]+)?\s*\{/);
    if (
      methodMatch &&
      methodMatch[1].length <= 4 &&
      !trimmed.startsWith('if') &&
      !trimmed.startsWith('for') &&
      !trimmed.startsWith('while') &&
      !trimmed.startsWith('switch') &&
      !trimmed.startsWith('catch') &&
      !trimmed.startsWith('function')
    ) {
      const indent = methodMatch[1];
      const endLine = findBraceBlockEndLine(lines, i, 5000);
      out.push(formatLineTag(`${indent}// `, lineNum, endLine));
      out.push(`${indent}${stripBodyFromSignature(trimmed)} { /* ... */ }`);
      continue;
    }

    if (trimmed.startsWith('module.exports') || trimmed.startsWith('export default') || trimmed.startsWith('export {')) {
      out.push(line);
      continue;
    }
  }

  return out.join('\n');
}

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
      const endLine = trimmed.includes('{') ? findBraceBlockEndLine(lines, i, 200) : lineNum;
      out.push(formatLineTag('// ', lineNum, endLine));
      out.push(line);
      continue;
    }

    if (/^impl(?:<[^>]*>)?\s+/.test(trimmed)) {
      const endLine = findBraceBlockEndLine(lines, i, 5000);
      out.push(formatLineTag('// ', lineNum, endLine));
      out.push(line);
      continue;
    }

    const fnMatch = trimmed.match(/^(?:pub(?:\s*\([^)]*\))?\s+)?(?:const\s+)?(?:async\s+)?(?:unsafe\s+)?fn\s+([a-zA-Z0-9_]+)/);
    if (fnMatch) {
      const indent = line.match(/^\s*/)[0];
      const endLine = findBraceBlockEndLine(lines, i, 5000);
      out.push(formatLineTag(`${indent}// `, lineNum, endLine));
      out.push(`${indent}${stripBodyFromSignature(trimmed)} { /* ... */ }`);
      continue;
    }
  }

  return out.join('\n');
}

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
      const endLine = findBraceBlockEndLine(lines, i, 10000);
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
      const endLine = findBraceBlockEndLine(lines, i, 5000);
      out.push(formatLineTag(`${indent}// `, lineNum, endLine));
      out.push(`${indent}${stripBodyFromSignature(trimmed)} { /* ... */ }`);
      continue;
    }
  }

  return out.join('\n');
}

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
      const endLine = trimmed.includes('{') ? findBraceBlockEndLine(lines, i, 5000) : lineNum;
      out.push(formatLineTag('// ', lineNum, endLine));
      out.push(line);
      continue;
    }

    if (
      /^[A-Za-z_][\w:<>*&\s]+\s+[A-Za-z_][\w:]*\s*\([^;]*\)\s*(?:const)?\s*\{/.test(trimmed) &&
      !trimmed.startsWith('if') &&
      !trimmed.startsWith('for') &&
      !trimmed.startsWith('while') &&
      !trimmed.startsWith('switch')
    ) {
      const endLine = findBraceBlockEndLine(lines, i, 5000);
      out.push(formatLineTag('// ', lineNum, endLine));
      out.push(`${stripBodyFromSignature(trimmed)} { /* ... */ }`);
      continue;
    }
  }

  return out.join('\n');
}

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
      const endLine = trimmed.includes('{') ? findBraceBlockEndLine(lines, i, 200) : lineNum;
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
      const endLine = findBraceBlockEndLine(lines, i, 5000);
      out.push(formatLineTag('// ', lineNum, endLine));
      out.push(`${stripBodyFromSignature(trimmed)} { ... }`);
      continue;
    }
  }

  return out.join('\n');
}

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
        const cleaned = stripBodyFromSignature(nextLine)
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
  stripBodyFromSignature,
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
