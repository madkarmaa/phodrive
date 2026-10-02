# Development standards

- Use Bun for development tooling, but keep the project engine agnostic so it also runs with plain Node.js and npm.

- Keep the application, tests, and scripts platform and JavaScript runtime agnostic: support Windows, macOS, and Linux, and both Bun and Node.js/npm. Use portable filesystem APIs and commands, and avoid runtime-specific APIs, shell-specific syntax, or hardcoded `node_modules` executable paths.

- When a suitable library already exists for a task, install and use it instead of reimplementing that functionality. Prefer a focused dependency and use its documented API.

- Refactor recoverable failures to return [results-ts](https://github.com/madkarmaa/results-ts) `Result` values directly throughout browser, API, BMP, and Google Photos code. Use `Ok`/`Err` and explicit propagation, rather than wrapping exception-driven application code with `catchUnwind` or `catchUnwindAsync`. Use `try/catch` only at platform or third-party I/O boundaries that can throw or reject, converting those failures to `Err`.

- Use results-ts `AsyncResult<T, E>` for fallible asynchronous APIs instead of `Promise<Result<T, E>>`; compose with `andThenAsync` and `mapAsync`, then `await` when a concrete `Result` is needed. Use `AsyncOption<T>` instead of `Promise<Option<T>>` when asynchronous absence is expected and there is no failure reason to preserve. Keep failures as `AsyncResult` rather than discarding them into `AsyncOption`.

- Use `unwrap` and `unwrapErr` only in tests. Production code must propagate and handle both variants through `map`, `andThen`, `andThenAsync`, or `match`; do not hide an unwrap inside a helper or replace it with a cast or throw.

- Favor readable, maintainable steps over dense expressions. Assign an awaited value to a clearly named variable before calling its methods; avoid `(await operation()).method()` and nested `await` inside conversions or assertions. Put blank lines between logical blocks such as validation, I/O, parsing, state changes, and returns. Keep tightly related statements together rather than adding a blank line after every statement.

- Prefer early guards with `return` or `continue` for invalid input, failed operations, missing data, and alternate completed actions. Keep the main path at the shallowest practical indentation and avoid `else` after a branch that returns. Flatten long Result pipelines into sequential named steps or small focused functions when needed; preserve explicit error propagation, type safety, cleanup, and operation ordering. Do not add unwrap helpers, casts, or generic control-flow abstractions to reduce indentation.

- Treat type strictness and safety as top priorities. Avoid `any` entirely. Use `as unknown as T` only if a proven runtime check still cannot express the type to TypeScript. Prefer inferred types and explicit `Result<T, E>` signatures at fallible boundaries.

- Name important core constants in `UPPER_CASE_SNAKE_CASE`, including protocol URLs, request masks, format limits, and browser storage keys.

- Name Zod schema values in `PascalCase` (for example `AccountSchema`), even though other important constants use `UPPER_CASE_SNAKE_CASE`. Use Zod to validate external JSON and derive model types from schemas.

- Style the site with [m3-svelte](https://github.com/KTibow/m3-svelte) components and Material 3 colors. Tailwind may handle layout. Use [unplugin-icons](https://github.com/unplugin/unplugin-icons) with the Material Symbols Iconify pack for UI icons. Follow Google Drive's shell, search bar, sidebar, file grid, and profile popup as visual references.

- Test the site through Chrome MCP, including a live upload when credentials are available. Connect only to the user's already open Chrome. Never launch Chrome yourself, headless or visible. If Chrome is unavailable, stop browser work and ask the user to open it. Do not expose token values in tool output or browser snapshots.

- Delegate verification to a separate subagent that only tests and reports results, leaving implementation fixes to the main agent. Coordinate source changes with live browser uploads so hot reload does not interrupt active transfers.

- Keep route components focused on composing the interface. Extract reusable Svelte components into `src/lib/components`, browser storage/network/file operations into `src/lib/browser`, and protocol parsing into focused server modules.

- Before introducing or refactoring main package APIs, consult their current official web documentation and migration guides, and check installed declarations for deprecations. Use supported modern APIs; do not suppress deprecated usage warnings. Dependency versions must satisfy the installed toolchain's peer requirements.

# Git standards

- Use Conventional Commits.

- Keep commit messages concise and spot on; do not overexplain.

- Commit whenever a part of the requested work is complete. Keep each commit focused so the Git log reads like a pull request in progress.
