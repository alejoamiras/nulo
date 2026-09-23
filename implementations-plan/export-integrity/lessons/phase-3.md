# Phase 3 lessons — integration proof

## The 16 MiB cap was below reality (both e2e failures, one root cause)

First battery: `audit:vue` fully green, but 4 e2e failures across TWO specs with DIFFERENT symptoms — roundtrip's creation "timing out" at 120 s, passkey's encrypt never reaching the encrypted banner. In-page sampling (temp instrumentation) surfaced the same toast behind both: **"Backup is too large to create"** — the shared size gate firing on LEGITIMATE backups. Measurement with a raised probe cap: a fresh test wallet's encrypted artifact is **23,443,420 bytes (~22.4 MiB)**, dominated by the account-state slice; the pretty JSON straddles ~16 MiB nondeterministically, which is why the creation gate fired on some attempts and the encrypt gate (base64 ≈ 1.33×) on others. The "timeout" was the gate resetting the flow — the button the spec polled for never re-appeared.

**Fix:** cap recalibrated to 64 MiB (codex resume on the final-pass session: approve). The invariant itself WORKED — it failed loud at export instead of shipping a file the importer would reject, exactly its purpose; the calibration, not the mechanism, was wrong. Durable: never derive a size ceiling from intuition when one e2e run can measure it — codex's unanswered "measured maximum" Ask was the tell.

## The smoke e2e runs a STALE dist — rebuild before every e2e after source edits

`tests/e2e/global-setup-smoke.ts` loads `dist/chrome` and ERRORS if absent — it never rebuilds. `audit:vue` happens to refresh dist (build is its last step), which masks this in the standard battery ordering; but any targeted `bun run test:e2e <spec>` after a source edit runs the OLD bundle. Two instrumented diagnosis cycles here ran against a stale build (the 512 MiB probe "not taking effect" was this). Durable rule for the remaining batches: **`bun run --cwd apps/extension build` before any standalone e2e re-run that follows a source change.**

## Validated

- The atomic double-Enter poke (single `page.evaluate`) passes against the fixed build — the original N-01 vector is dead at the UI level and the full export→import roundtrip stays green.
- Passkey two-click encrypt flow unaffected by the status-first flip (spec's card asserts pass).

## Codex consults this phase

- Cap recalibration (resume of final-pass session `01a03428-6572-7eb2-960c-1e2b7ec88ae2`): 64 MiB → **approve**, with the condition that the 2–4× parse-amplification figure stays documented as an estimate (done, in the constant's docblock).
