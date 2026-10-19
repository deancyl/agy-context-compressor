/**
 * Card 3: CacheAligner & Tools Schema Optimization
 * 100% native Node.js zero dependencies.
 * Locks Prompt Cache (KV Cache) by ensuring lexicographical schema determinism
 * and slims oversized MCP / function schemas without truncating abbreviations (e.g., i.e.) or core constraints.
 */

function sortKeysDeep(obj, inStack = new Set()) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (inStack.has(obj)) return obj;

  if (Array.isArray(obj)) {
    return obj.map(item => sortKeysDeep(item, inStack));
  }

  inStack.add(obj);
  const sorted = {};
  const keys = Object.keys(obj).sort();
  for (const k of keys) {
    if (k === 'required' && Array.isArray(obj[k])) {
      sorted[k] = [...obj[k]].sort();
    } else {
      sorted[k] = sortKeysDeep(obj[k], inStack);
    }
  }
  inStack.delete(obj);
  return sorted;
}

/**
 * Sorts tools array and parameters lexicographically, deduplicating by tool name.
 * @param {Array} tools
 * @returns {Array}
 */
function alignToolsSchema(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return tools;
  try {
    const seen = new Set();
    const deduped = [];
    for (const t of tools) {
      if (!t || typeof t !== 'object') {
        deduped.push(t);
        continue;
      }
      const name = (t.function && t.function.name) || t.name || '';
      if (name && seen.has(name)) continue;
      if (name) seen.add(name);
      deduped.push(t);
    }

    const sortedTools = [...deduped].sort((a, b) => {
      const nameA = (a && a.function && a.function.name) || (a && a.name) || '';
      const nameB = (b && b.function && b.function.name) || (b && b.name) || '';
      return String(nameA).localeCompare(String(nameB));
    });

    return sortedTools.map(t => sortKeysDeep(t));
  } catch (err) {
    return tools;
  }
}

/**
 * Splits text into sentences safely without breaking on common abbreviations like "e.g.", "i.e.", "etc.", "vs.", or version numbers.
 * @param {string} text
 * @returns {string[]}
 */
function splitSentencesSafe(text) {
  if (typeof text !== 'string' || !text.trim()) return [];
  // Protect common abbreviations with a placeholder before splitting
  const PLACEHOLDER = '\u0000DOT\u0000';
  const protectedText = text
    .replace(/\b(e\.g|i\.e|etc|vs|cf|viz|al|fig|no|vol|ch|sec|mr|mrs|dr|prof|st|ave|inc|ltd|co)\./gi, `$1${PLACEHOLDER}`)
    .replace(/(\d)\.(\d)/g, `$1${PLACEHOLDER}$2`);

  const parts = protectedText.split(/(?<=[.!?。！？])\s+/);
  return parts.map(p => p.replaceAll(PLACEHOLDER, '.').trim()).filter(Boolean);
}

/**
 * Trims verbose markdown code blocks & samples from descriptions while preserving core semantics and constraints.
 * @param {string} desc
 * @returns {string}
 */
function slimDescription(desc) {
  if (typeof desc !== 'string' || desc.length < 80) return desc;
  // 1. Remove fenced markdown code blocks inside schema descriptions
  let cleaned = desc.replace(/```[\s\S]*?```/g, '').trim();
  // 2. Remove trailing verbose Example / Sample / Usage sections
  cleaned = cleaned.replace(/(?:\r?\n)+\s*(?:Examples?|Usage|Sample|Detailed Examples?):\s*[\s\S]*/i, '').trim();
  // Collapse excessive whitespace
  cleaned = cleaned.replace(/\n{3,}/g, '\n\n');

  if (!cleaned) {
    return desc.trim().split(/\r?\n/)[0].trim() || desc;
  }

  // 3. If still very long (> 300 chars), keep first two complete sentences (abbreviation-safe)
  // while preserving any trailing CRITICAL/MUST/IMPORTANT sentence
  if (cleaned.length > 300) {
    const sentences = splitSentencesSafe(cleaned);
    if (sentences.length > 2) {
      const headSentences = sentences.slice(0, 2);
      const criticalSentences = sentences.slice(2).filter(s => /\b(?:CRITICAL|MUST|NEVER|REQUIRED|IMPORTANT)\b/i.test(s));
      cleaned = [...headSentences, ...criticalSentences.slice(0, 1)].join(' ');
    } else if (cleaned.length > 350) {
      cleaned = cleaned.slice(0, 300).trim() + '...';
    }
  }
  return cleaned;
}

/**
 * Recursively slims descriptions in a JSON schema object.
 * @param {object} schema
 * @returns {object}
 */
function slimSchemaDeep(schema, visited = new WeakSet(), depth = 0) {
  if (!schema || typeof schema !== 'object' || depth > 50) return schema;
  if (visited.has(schema)) return schema;
  visited.add(schema);

  if (Array.isArray(schema)) {
    return schema.map(item => slimSchemaDeep(item, visited, depth + 1));
  }

  const copy = { ...schema };

  if (copy.description && typeof copy.description === 'string') {
    copy.description = slimDescription(copy.description);
  }
  if (copy.example !== undefined) delete copy.example;
  if (copy.examples !== undefined) delete copy.examples;

  for (const dictKey of ['properties', 'patternProperties', '$defs', 'definitions']) {
    if (copy[dictKey] && typeof copy[dictKey] === 'object') {
      const newDict = {};
      for (const [k, v] of Object.entries(copy[dictKey])) {
        newDict[k] = slimSchemaDeep(v, visited, depth + 1);
      }
      copy[dictKey] = newDict;
    }
  }

  if (copy.additionalProperties && typeof copy.additionalProperties === 'object') {
    copy.additionalProperties = slimSchemaDeep(copy.additionalProperties, visited, depth + 1);
  }

  if (copy.items && typeof copy.items === 'object') {
    copy.items = slimSchemaDeep(copy.items, visited, depth + 1);
  }

  for (const combKey of ['anyOf', 'oneOf', 'allOf']) {
    if (Array.isArray(copy[combKey])) {
      copy[combKey] = copy[combKey].map(sub => slimSchemaDeep(sub, visited, depth + 1));
    }
  }

  return copy;
}

/**
 * Slims oversized tool definitions when total length exceeds threshold.
 * @param {Array} tools
 * @param {number} threshold
 * @returns {Array}
 */
function slimToolsSchema(tools, threshold = 15000) {
  if (!Array.isArray(tools) || tools.length === 0) return tools;
  try {
    const jsonStr = JSON.stringify(tools);
    if (jsonStr.length <= threshold) return tools;

    return tools.map(tool => {
      if (!tool || typeof tool !== 'object') return tool;
      const copy = { ...tool };
      if (copy.description) {
        copy.description = slimDescription(copy.description);
      }
      if (copy.function && typeof copy.function === 'object') {
        copy.function = { ...copy.function };
        if (copy.function.description) {
          copy.function.description = slimDescription(copy.function.description);
        }
        if (copy.function.parameters) {
          copy.function.parameters = slimSchemaDeep(copy.function.parameters);
        }
        if (copy.function.input_schema) {
          copy.function.input_schema = slimSchemaDeep(copy.function.input_schema);
        }
      }
      if (copy.inputSchema) {
        copy.inputSchema = slimSchemaDeep(copy.inputSchema);
      }
      if (copy.input_schema) {
        copy.input_schema = slimSchemaDeep(copy.input_schema);
      }
      if (copy.parameters) {
        copy.parameters = slimSchemaDeep(copy.parameters);
      }
      return copy;
    });
  } catch (err) {
    return tools;
  }
}

module.exports = {
  sortKeysDeep,
  alignToolsSchema,
  slimToolsSchema,
  slimDescription,
  splitSentencesSafe
};
