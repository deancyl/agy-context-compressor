/**
 * Code Skeleton (Signature Mode) Engine
 * 100% native Node.js zero dependencies.
 * Extracts classes, methods, function signatures, interfaces, and types
 * with precise source line number annotations (e.g. [Line 45]).
 * Enables Agent to preview entire file structure in ~15% tokens,
 * then accurately pinpoint StartLine/EndLine for view_file.
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * Extracts Python class and function signatures with line numbers.
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

    // Function and method signatures
    const defMatch = line.match(/^(\s*)(async\s+def|def)\s+([a-zA-Z0-9_]+)\s*\((.*?)\)(?:\s*->\s*[^:]+)?:/);
    if (defMatch) {
      const indent = defMatch[1];
      out.push(`${indent}# [Line ${lineNum}]`);
      out.push(line);
      // Lookahead for docstring
      const nextLine = (lines[i + 1] || '').trim();
      if (nextLine.startsWith('"""') || nextLine.startsWith("'''")) {
        // Will be caught in next loop
      } else {
        out.push(`${indent}    ...`);
      }
      continue;
    }

    // Type aliases and global assignments
    if (/^[A-Z][A-Za-z0-9_]*\s*=\s*(?:TypeVar|NewType|Union|Optional|Annotated|int|str|float|bool|list|dict|tuple)/.test(trimmed)) {
      out.push(line);
      continue;
    }
  }

  return out.join('\n');
}

/**
 * Extracts JS/TS class, interface, type, and function signatures with line numbers.
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
    if (/^(?:export\s+)?(?:type|interface|enum)\s+/.test(trimmed)) {
      out.push(`// [Line ${lineNum}]`);
      out.push(line);
      if (trimmed.includes('{') && !trimmed.includes('}')) {
        let depth = 1;
        while (i + 1 < lines.length && depth > 0) {
          i++;
          const nextL = lines[i];
          if (nextL.includes('{')) depth++;
          if (nextL.includes('}')) depth--;
          out.push(nextL);
        }
      }
      continue;
    }

    // Class declarations
    if (/^(?:export\s+)?(?:abstract\s+)?class\s+/.test(trimmed)) {
      const indent = line.match(/^\s*/)[0];
      out.push(`${indent}// [Line ${lineNum}]`);
      out.push(line);
      continue;
    }

    // Functions and methods
    const fnMatch = line.match(/^(\s*)(?:export\s+)?(?:async\s+)?(?:function\*?|\bfunction\b)\s+([a-zA-Z0-9_$]+)\s*\(([^)]*)\)(?:\s*:\s*[^{]+)?/);
    if (fnMatch) {
      const indent = fnMatch[1];
      out.push(`${indent}// [Line ${lineNum}]`);
      out.push(`${line.replace(/\{[\s\S]*$/, '').trim()} { /* ... */ }`);
      continue;
    }

    // Arrow functions / methods in class or exports
    const methodMatch = line.match(/^(\s*)(?:(?:public|private|protected|static|readonly|async)\s+)*([a-zA-Z0-9_$]+)\s*\(([^)]*)\)(?:\s*:\s*[^{]+)?\s*\{/);
    if (methodMatch && !trimmed.startsWith('if') && !trimmed.startsWith('for') && !trimmed.startsWith('while') && !trimmed.startsWith('switch')) {
      const indent = methodMatch[1];
      out.push(`${indent}// [Line ${lineNum}]`);
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
      out.push(`// [Line ${lineNum}]`);
      out.push(line);
      if (trimmed.includes('{') && !trimmed.includes('}')) {
        let depth = 1;
        while (i + 1 < lines.length && depth > 0) {
          i++;
          const nextL = lines[i];
          if (nextL.includes('{')) depth++;
          if (nextL.includes('}')) depth--;
          out.push(nextL);
        }
      }
      continue;
    }

    if (/^func\s+/.test(trimmed)) {
      out.push(`// [Line ${lineNum}]`);
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
    const lineMatch = trimmed.match(/^(?:\/{2}|#)\s*\[Line\s+(\d+)\]/i);
    if (lineMatch) {
      const lineNum = lineMatch[1];
      const nextLine = (lines[i + 1] || '').trim();
      if (nextLine) {
        const cleaned = nextLine
          .replace(/\{[\s\S]*$/, '')
          .replace(/:\s*$/, '')
          .replace(/\s+/g, ' ')
          .trim();
        if (cleaned && !cleaned.startsWith('//') && !cleaned.startsWith('#')) {
          const isClass = /\bclass\b/.test(cleaned);
          const indent = isClass ? '  - ' : '    - ';
          symbols.push(`${indent}[Line ${lineNum}] ${cleaned}`);
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
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.go', '.rs', '.java', '.c', '.cpp', '.h', '.cs'
]);

/**
 * Scans a directory and generates an Aider-style hierarchical Repo Map (AST outline).
 * @param {string} rootDir - Root directory to map
 * @param {object} [options]
 * @param {number} [options.maxFiles=50]
 * @param {number} [options.maxChars=15000]
 * @param {string[]} [options.excludeDirs]
 * @returns {{ map: string, fileCount: number, symbolCount: number }}
 */
function generateRepoMap(rootDir, options = {}) {
  if (!fs.existsSync(rootDir)) {
    return { map: '', fileCount: 0, symbolCount: 0 };
  }

  const maxFiles = options.maxFiles || 50;
  const maxChars = options.maxChars || 15000;
  const userExcludes = new Set(options.excludeDirs || []);
  
  const filesToScan = [];

  function walk(currentDir) {
    if (filesToScan.length >= maxFiles) return;
    let entries = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch (_) {
      return;
    }

    for (const entry of entries) {
      if (filesToScan.length >= maxFiles) break;
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

  let output = `# Codebase Repo Map (AST Outline)\n> Generated for: ${path.resolve(rootDir).replace(/\\/g, '/')}\n\n`;
  let symbolCount = 0;
  let fileCount = 0;

  for (const filePath of filesToScan) {
    if (output.length >= maxChars) {
      output += `\n... [Repo Map truncated at ${fileCount} files to protect token budget]\n`;
      break;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const symbols = extractSymbolOutline(content, filePath);
      const relPath = path.relative(rootDir, filePath).replace(/\\/g, '/');

      if (symbols.length > 0) {
        output += `## ${relPath}\n`;
        output += symbols.join('\n') + '\n\n';
        symbolCount += symbols.length;
        fileCount++;
      } else if (content.length > 0 && content.length < 5000) {
        output += `## ${relPath} (no class/function symbols)\n\n`;
        fileCount++;
      }
    } catch (_) {}
  }

  return {
    map: output.trim(),
    fileCount,
    symbolCount
  };
}

module.exports = {
  extractCodeSkeleton,
  extractPythonSkeleton,
  extractJavaScriptSkeleton,
  extractGoSkeleton,
  extractSymbolOutline,
  generateRepoMap
};
