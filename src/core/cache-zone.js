/**
 * Card 4: llmtrim Cache-Zone Multi-Turn Session Memoization & KV Cache Lock for AGY (2.3)
 * 100% native Node.js zero dependencies.
 *
 * Implements:
 * 1. Bounded True LRU Session Memoization (sessionCompressionMemo)
 * 2. SHA-256 byte-stream freezing to prevent upstream Prompt Cache invalidation
 * 3. Live AGY Transcript KV Cache Observability (cache_read_tokens tracking)
 * 4. Accurate Single-Turn Context Bloat Detection (based strictly on latestTurnTokens, zero false positives after /compact)
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

const MAX_MEMO_SESSIONS = 500;
const MAX_MEMO_KEYS_PER_SESSION = 200;

const sessionCompressionMemo = new Map();

function hashContent(text) {
  if (typeof text !== 'string') return '';
  return crypto.createHash('sha256').update(text).digest('hex').slice(0, 16);
}

function getMemo(sessionId, cacheKey) {
  if (!sessionId || !cacheKey) return null;
  const sMap = sessionCompressionMemo.get(sessionId);
  if (!sMap) return null;

  const val = sMap.get(cacheKey);
  if (val !== undefined) {
    sMap.delete(cacheKey);
    sMap.set(cacheKey, val);
    sessionCompressionMemo.delete(sessionId);
    sessionCompressionMemo.set(sessionId, sMap);
    return val;
  }
  return null;
}

function setMemo(sessionId, cacheKey, compressed) {
  if (!sessionId || !cacheKey || typeof compressed !== 'string') return;

  let sMap = sessionCompressionMemo.get(sessionId);
  if (!sMap) {
    if (sessionCompressionMemo.size >= MAX_MEMO_SESSIONS) {
      const oldestSession = sessionCompressionMemo.keys().next().value;
      sessionCompressionMemo.delete(oldestSession);
    }
    sMap = new Map();
    sessionCompressionMemo.set(sessionId, sMap);
  } else {
    sessionCompressionMemo.delete(sessionId);
    sessionCompressionMemo.set(sessionId, sMap);
  }

  if (sMap.size >= MAX_MEMO_KEYS_PER_SESSION) {
    const oldestKey = sMap.keys().next().value;
    sMap.delete(oldestKey);
  }
  sMap.set(cacheKey, compressed);
}

function clearSessionMemo(sessionId) {
  if (sessionId) {
    sessionCompressionMemo.delete(sessionId);
  } else {
    sessionCompressionMemo.clear();
  }
}

function getMemoStats() {
  let totalKeys = 0;
  for (const sMap of sessionCompressionMemo.values()) {
    totalKeys += sMap.size;
  }
  return {
    activeSessions: sessionCompressionMemo.size,
    totalKeys,
    maxSessions: MAX_MEMO_SESSIONS,
    maxKeysPerSession: MAX_MEMO_KEYS_PER_SESSION
  };
}

/**
 * Analyzes an Antigravity transcript.jsonl file to extract live upstream KV Cache metrics.
 * Bloat detection is strictly tied to `latestTurnTokens` (the actual token size of the most recent turn).
 * @param {string} transcriptPath
 * @returns {object}
 */
function analyzeTranscriptCache(transcriptPath) {
  const result = {
    totalInputTokens: 0,
    totalCacheReadTokens: 0,
    totalOutputTokens: 0,
    plannerResponsesCount: 0,
    kvCacheHitRatio: 0,
    latestTurnTokens: 0,
    isContextBloated: false,
    bloatLevel: 'normal',
    bloatMessage: '上下文体积健康，处于最佳推理区间。',
    totalContextProcessed: 0
  };

  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return result;
  }

  let latestTurnTokens = 0;

  try {
    const content = fs.readFileSync(transcriptPath, 'utf8');
    const lines = content.split('\n');
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const step = JSON.parse(line);
        if (step.type === 'PLANNER_RESPONSE') {
          result.plannerResponsesCount += 1;
          const inp = step.input_tokens || 0;
          const cache = step.cache_read_tokens || 0;
          const out = step.output_tokens || 0;
          result.totalInputTokens += inp;
          result.totalCacheReadTokens += cache;
          result.totalOutputTokens += out;
          if (inp + cache > 0) {
            latestTurnTokens = inp + cache;
          }
        }
      } catch (_) {}
    }

    const totalInp = result.totalInputTokens + result.totalCacheReadTokens;
    if (totalInp > 0) {
      result.kvCacheHitRatio = Number(((result.totalCacheReadTokens / totalInp) * 100).toFixed(1));
    }
  } catch (err) {
    // Safe return fallback
  }

  result.latestTurnTokens = latestTurnTokens;
  result.isContextBloated = latestTurnTokens > 80000;
  if (latestTurnTokens > 120000) {
    result.bloatLevel = 'severe';
    result.bloatMessage = `单轮活跃上下文已达 ${latestTurnTokens.toLocaleString()} Tokens (当前会话共 ${result.plannerResponsesCount} 轮)。历史滚雪球严重，强烈建议在输入框使用 /compact 命令压缩历史，或开启新任务。`;
  } else if (latestTurnTokens > 80000) {
    result.bloatLevel = 'elevated';
    result.bloatMessage = `单轮活跃上下文已达 ${latestTurnTokens.toLocaleString()} Tokens (当前会话共 ${result.plannerResponsesCount} 轮)，建议关注历史体积，适时使用 /compact。`;
  } else {
    result.bloatLevel = 'normal';
    result.bloatMessage = `当前单轮上下文为 ${latestTurnTokens.toLocaleString()} Tokens，体积健康，处于最佳推理区间。`;
  }

  result.totalContextProcessed = result.totalInputTokens + result.totalCacheReadTokens + result.totalOutputTokens;
  return result;
}

/**
 * Automatically discovers the most recently updated Antigravity conversation transcript
 * that contains active PLANNER_RESPONSE token metrics.
 * @returns {string|null}
 */
function findLatestTranscriptPath() {
  try {
    const brainDir = path.join(os.homedir(), '.gemini', 'antigravity', 'brain');
    if (!fs.existsSync(brainDir)) return null;
    const entries = fs.readdirSync(brainDir);
    const candidates = [];

    for (const entry of entries) {
      const p = path.join(brainDir, entry, '.system_generated', 'logs', 'transcript.jsonl');
      if (fs.existsSync(p)) {
        try {
          const st = fs.statSync(p);
          if (st.size > 0) {
            candidates.push({ path: p, mtimeMs: st.mtimeMs });
          }
        } catch (_) {}
      }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

    // Check top 5 most recently modified transcripts for PLANNER_RESPONSE presence
    for (const cand of candidates.slice(0, 5)) {
      try {
        const content = fs.readFileSync(cand.path, 'utf8');
        if (content.includes('"PLANNER_RESPONSE"')) {
          return cand.path;
        }
      } catch (_) {}
    }

    return candidates[0].path;
  } catch (_) {
    return null;
  }
}

let lastLiveMetrics = null;
let lastLiveMetricsTime = 0;

function getLiveAntigravityMetrics(customTranscriptPath = null) {
  const now = Date.now();
  if (!customTranscriptPath && lastLiveMetrics && (now - lastLiveMetricsTime < 2000)) {
    return lastLiveMetrics;
  }
  const transcriptPath = customTranscriptPath || findLatestTranscriptPath();
  const metrics = analyzeTranscriptCache(transcriptPath);
  metrics.transcriptPath = transcriptPath;
  if (!customTranscriptPath) {
    lastLiveMetrics = metrics;
    lastLiveMetricsTime = now;
  }
  return metrics;
}

function handlePreInvocation(payload) {
  return {
    injectSteps: []
  };
}

module.exports = {
  hashContent,
  getMemo,
  setMemo,
  clearSessionMemo,
  getMemoStats,
  analyzeTranscriptCache,
  findLatestTranscriptPath,
  getLiveAntigravityMetrics,
  handlePreInvocation,
  MAX_MEMO_SESSIONS,
  MAX_MEMO_KEYS_PER_SESSION
};
