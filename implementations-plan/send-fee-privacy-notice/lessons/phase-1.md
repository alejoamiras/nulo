# Phase 1 — the rule, pure

- **Gate command corrected.** The plan's `bun run typecheck` (root) exits 127 locally: the root script
  calls `vue-tsc`, which the isolated linker installs only in `apps/extension/node_modules/.bin`.
  Pre-existing, unrelated to this work. Every phase gate now uses
  `bun run --cwd apps/extension typecheck` — same `vue-tsc --noEmit` over the same project.
- `withSendSlot` normalizes the record it is handed through the same hostile-input parser as reads, so
  a caller passing a presentation row cannot persist its extra fields. Pinned by a test.
- `RegisteredFpc` is now exported from `fee-helpers.ts` (the only edit to an existing module here).
- Gate result: lint exit 0; typecheck exit 0; 45/45 unit tests; complexity manifest untouched.
