# Context Optimization & Token Compression Guidelines

When working in this environment, follow these rules to maintain high model reasoning performance and prevent token budget exhaustion:

1. **Large Lockfiles Inspection**:
   - Avoid reading full `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`, or `Cargo.lock` files directly into conversation context.
   - Use `compact_view_file` or targeted searches (e.g. `npm list <pkg>` or `view_file` with precise line slices) when inspecting dependencies.

2. **Test Running & Logs**:
   - Prefer focused test runs (e.g. `npm test -- -t "specific_case"` or `pytest path/to/test.py::test_name`).
   - When running large test suites, the `agy-context-compressor` hook automatically collapses passing test runs while preserving all failure details and stack traces.

3. **Windows PowerShell Commands**:
   - Always be mindful of Windows quote escaping: avoid trailing backslashes before closing double quotes (`"C:\dir\"`).
   - The PreToolUse hook automatically normalizes trailing slashes, converts `curl` to `curl.exe`, and strips `#< CLIXML` error noise.
