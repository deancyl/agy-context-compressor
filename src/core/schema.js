/**
 * Card 3: CacheAligner & Tools Schema Optimization
 * 100% native Node.js zero dependencies.
 * Locks Prompt Cache (KV Cache) by ensuring lexicographical schema determinism
 * and slims oversized MCP / function schemas.
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
    sorted[k] = sortKeysDeep(obj[k], inStack);
  }
  inStack.delete(obj);
  return sorted;
}

/**
 * Sorts tools array and parameters lexicographically.
 * @param {Array} tools
 * @returns {Array}
 */
function alignToolsSchema(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return tools;
  try {
    const sortedTools = [...tools].sort((a, b) => {
      const nameA = (a.function && a.function.name) || a.name || '';
      const nameB = (b.function && b.function.name) || b.name || '';
      return nameA.localeCompare(nameB);
    });

    return sortedTools.map(t => sortKeysDeep(t));
  } catch (err) {
    return tools;
  }
}

/**
 * Trims verbose markdown code blocks & samples from descriptions while preserving core semantics.
 * @param {string} desc
 * @returns {string}
 */
function slimDescription(desc) {
  if (typeof desc !== 'string' || desc.length < 120) return desc;
  // Remove markdown code blocks inside schema descriptions
  let cleaned = desc.replace(/```[\s\S]*?```/g, '').trim();
  // If still very long, take the first two sentences or 250 chars
  if (cleaned.length > 300) {
    const sentences = cleaned.split(/(?<=[.!?。！？])\s+/);
    if (sentences.length > 1) {
      cleaned = sentences.slice(0, 2).join(' ');
    } else {
      cleaned = cleaned.slice(0, 250) + '...';
    }
  }
  return cleaned;
}

/**
 * Recursively slims descriptions in a JSON schema object.
 * @param {object} schema
 * @returns {object}
 */
function slimSchemaDeep(schema, visited = new WeakSet()) {
  if (!schema || typeof schema !== 'object') return schema;
  if (visited.has(schema)) return schema;
  visited.add(schema);

  const copy = Array.isArray(schema) ? [...schema] : { ...schema };

  if (copy.description && typeof copy.description === 'string') {
    copy.description = slimDescription(copy.description);
  }

  if (copy.properties && typeof copy.properties === 'object') {
    const newProps = {};
    for (const [k, v] of Object.entries(copy.properties)) {
      newProps[k] = slimSchemaDeep(v, visited);
    }
    copy.properties = newProps;
  }

  if (copy.items && typeof copy.items === 'object') {
    copy.items = slimSchemaDeep(copy.items, visited);
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
      const copy = { ...tool };
      if (copy.description) {
        copy.description = slimDescription(copy.description);
      }
      if (copy.function) {
        copy.function = { ...copy.function };
        if (copy.function.description) {
          copy.function.description = slimDescription(copy.function.description);
        }
        if (copy.function.parameters) {
          copy.function.parameters = slimSchemaDeep(copy.function.parameters);
        }
      }
      if (copy.inputSchema) {
        copy.inputSchema = slimSchemaDeep(copy.inputSchema);
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
  slimDescription
};
