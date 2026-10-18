---
name: agy-compression
description: Comprehensive skill for understanding, configuring, and verifying the agy-context-compressor engine in Google Antigravity.
---

# AGY Context Compression Skill

Use this skill when diagnosing token usage spikes, configuring context compaction presets, or troubleshooting PowerShell command issues in Google Antigravity (`agy`).

## 1. Quick Verification & Doctor

Run the built-in system doctor to verify hook status, Node.js environment, and compression sanity:

```powershell
node bin/agy-compressor.js doctor
```

## 2. Managing the Antigravity Hook

Install the hook globally to protect all conversations:
```powershell
node bin/agy-compressor.js install --global
```

Install the hook project-locally:
```powershell
node bin/agy-compressor.js install --project
```

Remove the hook:
```powershell
node bin/agy-compressor.js uninstall --global
```

## 3. Core Modules Reference

- **Card 1 (RTK)**: Strips ANSI sequences, consolidates `\r` progress bars, and folds repetitive passing tests while preserving 100% of errors and tracebacks.
- **Card 2 (Headroom)**: Folds giant lockfiles with absolute exemption for git merge conflicts (`<<<<<<< HEAD`), plus SmartCrusher JSON sampling.
- **Card 3 (CacheAligner)**: Sorts tools and parameters lexicographically to maximize upstream Prompt Cache hits.
- **Card 5 (PowerShell Guard)**: Fixes Windows quote eating, curl aliases, and strips `#< CLIXML` noise.
