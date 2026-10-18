/**
 * Code Skeleton (Signature Mode) Engine
 * 100% native Node.js zero dependencies.
 * Extracts classes, methods, function signatures, interfaces, and types
 * with precise source line number annotations (e.g. [Line 45]).
 * Enables Agent to preview entire file structure in ~15% tokens,
 * then accurately pinpoint StartLine/EndLine for view_file.
 */

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

module.exports = {
  extractCodeSkeleton,
  extractPythonSkeleton,
  extractJavaScriptSkeleton,
  extractGoSkeleton
};
