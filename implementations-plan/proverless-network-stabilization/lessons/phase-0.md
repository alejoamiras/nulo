# Phase 0 — Lock the proverless prod-safety invariants

**Goal:** pin the guards that stop the fake-proof test mode from ever shipping to prod, BEFORE touching proverless-adjacent surfaces.

## Findings

- **Layer 3 (negative bundle-grep) is already wired + complete.** `_build-extension.yml:67-80`
  greps both `dist/chrome` and `dist/firefox` for BOTH markers (`NULO_E2E_PROVERLESS_BUILD_STAMP`
  and `nulo:e2e:proof-gate`) and fails the build if either leaks. On the shipping build path
  (after Build Chrome/Firefox). No change needed — verified by reading.
- **Layer 1 (the double-opt-in fail-closed guard in `config.ts`) had NO unit test.** The existing
  `chrome-storage-proof-gate.test.ts` covers the runtime gate behavior, not the arming logic.
  This is the load-bearing guard (a regression risks shipping a wallet that broadcasts unproven
  txs), so it must be pinned.

## Change

Added `packages/extension/src/e2e/config.test.ts` (4 cases):
1. neither flag → `E2E_PROVERLESS === false`, build stamp null (default-safe).
2. both flags → `E2E_PROVERLESS === true`, stamp present (armed).
3. only the primary flag → throws (fail-closed).
4. only the confirm flag → throws (fail-closed).

**Pattern note:** `config.ts` evaluates `import.meta.env` at module-load (top-level `if (...) throw`).
Tested via `vi.stubEnv(...)` + `vi.resetModules()` + dynamic `await import("./config")` per case;
the throw cases assert `await expect(import("./config")).rejects.toThrow(...)`. Confirmed Vitest's
`vi.stubEnv` patches `import.meta.env` and the re-import re-runs the guard. (Vitest 4.1.5.)

## Validation gate — PASS

- `bun run lint` → exit 0 (56 pre-existing biome *warnings*, no errors).
- `bun run typecheck` → exit 0 (vue-tsc clean).
- `bun run test` (extension unit suite) → exit 0: **196 files passed / 1 skipped; 2398 tests passed / 7 todo** (incl. the 4 new config cases).
