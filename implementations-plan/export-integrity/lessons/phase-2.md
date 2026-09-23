# Phase 2 lessons — byte caps

- **Web streams exist in BOTH vitest envs here** (jsdom inherits Node's `CompressionStream`/`DecompressionStream` globals on this runner) — the plan's `skipIf` guard on the jsdom bomb test never skips, and the node-env `files.caps.test.ts` pragma file guarantees the chunk-cap pins hold even if a future jsdom/runner combination stops leaking them. Real-stream fixtures throughout; zero stream mocks, per the audit condition.
- **The bomb fixture is honest**: 2 MiB of zeros gzips under 64 KiB (asserted), so it passes any input-size check and ONLY the chunk-wise inflation cap can stop it — exactly the production threat shape.
- **Producer-settlement matters on cancel**: without `.catch(() => {})` on `writer.write()`/`close()`, an over-cap `reader.cancel()` leaves the writer promises rejecting unhandled (vitest fails the file on those — which is also what makes "no unhandled rejection" an implicit pin in every cap test).
- **`return` inside a `catch` still runs `finally`** — the contacts cap branch returns early with its specific toast while the `finally` cleanup (cacheStore reset) still executes.
- The worktree-isolation Bash guard rejects heredocs/compound commands — prompt files and probes go through the Write tool; probe test files must live INSIDE the vitest include globs to run.
- Codex consults this phase: none beyond plan-stage (cap placement, values, and the rethrow design were all settled in the audited plan).
