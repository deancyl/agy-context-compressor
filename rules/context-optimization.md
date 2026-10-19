---
description: "Context optimization rules to prevent token budget exhaustion during file reading, testing, and multi-turn workflows."
trigger: always_on
---

# Antigravity Context Compression & Zero Quality Loss Guidelines

When executing tasks in Google Antigravity, apply progressive disclosure and lossless compaction:

1. **Large Source Files & Data Inspection**:
   - For any file > 300 lines (e.g. `server.js`, `codex-adapter.js`, lockfiles), NEVER dump the entire file into conversation context.
   - ALWAYS specify precise `StartLine` and `EndLine` ranges (keeping slice <= 300 lines) or call `read_code_skeleton` to inspect the structure first.
   - Lockfiles (`package-lock.json`, `pnpm-lock.yaml`, `go.sum`) are strictly limited to the first 200 lines. Homogeneous JSON/CSV arrays (>50 items) are folded with statistical sampling.

2. **Automated Testing & DevOps Execution**:
   - The global `PreToolUse` hook automatically intercepts `run_command` and pipes high-noise commands (`npm test`, `pytest`, `docker`, `terraform`) through `stream-filter.js`.
   - Passing test cases (✓ / PASS / ok) are folded into a single summary line; 100% of failures, errors, diffs, and stack traces are preserved.

3. **Prompt Cache (KV Cache) Protection**:
   - Dynamic reminders or transient notifications must use `ephemeralMessage` rather than `systemMessage` to avoid polluting `transcript.jsonl`, locking Google Gemini upstream KV Cache.
   - Idempotent tool results are cached in the LRU `sessionCompressionMemo` pool.

4. **Windows PowerShell Command Safety**:
   - The PreToolUse hook auto-heals Windows trailing backslash traps (`"C:\path\"` -> `"C:\path\\"`), maps `curl` to `curl.exe`, and cleans `#< CLIXML` PowerShell noise.
