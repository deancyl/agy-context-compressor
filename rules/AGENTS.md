# Context Optimization & Simplified Chinese Experience Guidelines (v2.1)

When working in this environment, follow these rules to maintain optimal model reasoning performance, preserve Simplified Chinese (简体中文) user experience, and prevent token budget exhaustion:

1. **Simplified Chinese Communication**:
   - Always respond to the user in clear Simplified Chinese (简体中文) unless explicitly requested otherwise, keeping code identifiers and paths intact.

2. **Large Source Files & Lockfiles Inspection**:
   - Avoid reading full `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, or `Cargo.lock` files directly into conversation context.
   - For source files >300 lines, call `read_code_skeleton` or `read_repo_map` first to get exact `[Line start-end]` spans, then inspect targeted slices with `view_file(StartLine, EndLine)`.
   - Use `compact_search_sandbox` for keyword searches across files or directories with automatic context window merging.

3. **Test Running & Logs**:
   - Prefer focused test runs (e.g. `npm test -- -t "specific_case"` or `pytest path/to/test.py::test_name`).
   - When running large test suites, the `agy-context-compressor` hook automatically collapses passing test runs and repetitive build/install noise while preserving 100% of failure details, diffs, conflicts, and stack traces. Use `agy_retrieve_chunk` if you ever need to inspect a folded block.

4. **Windows PowerShell & Connection Stability**:
   - The `PreToolUse` hook automatically normalizes trailing slashes (`"C:\dir\\"`), converts `curl` to `curl.exe`, forces UTF-8 console encoding for Chinese output, disables interactive pagers (`GIT_PAGER=cat`), and strips `#< CLIXML` error noise.
