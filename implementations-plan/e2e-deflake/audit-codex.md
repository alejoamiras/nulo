# audit-codex.md — codex (gpt-5.6-sol, xhigh) plan audit, round 1 (2026-08-11)

Session `019ff23f-03f1-7941-a202-8ae4f864539a`, dir `/home/homelab/.cache/tmp/codex-GYeJkzzL`.
Full packet (adversarial/security + assumption-attack + implementation-critique + recon
cross-check).

## Verdict

**reject** (blocking findings: disguised timeout raises, unproved root causes, and a
balance wait that weakens coverage).

## Blocking findings

- **High — Fixes 1–3 / timeout constraint**: the Interpretation note cannot interpret
  away the directive. Fix 1 still awaits the same `general|auth` hash (trajectory
  recording is diagnostic; 90→300s is what changes success). Fix 2 retries the identical
  5s selector wait (effectively doubling). Fix 3's `clickByTestId` already waits
  existence + native `!disabled`; the `pointerEvents` clause is safer but the 10→60/120s
  bump is what resolves the timeout. → Surface as explicit owner exceptions OR introduce
  genuinely causal completion signals.
- **High — Fix 1 / evidence + budget math**: the shared helper's rationale is "restore +
  the product's 30s recovery backstop", NOT the 60s RPC envelope (that belongs to
  `waitForActiveAccount`). The 900s ceiling lacks headroom: 120+60+30+300+240+240 already
  exceeds 900. → Instrument restore/activation/RPC/route timings, find the actual slow
  phase, produce coherent nested budgets before adopting any number.
- **High — Fix 4 / balance convergence masks coverage**: imported backups already contain
  the `1,000` balance AND nonzero `updatedAt`, so expected-value polling can pass with NO
  post-import/post-reopen sync; it also drops the UI-render proof. → Capture the exact
  row + baseline `updatedAt`, one refresh, require `updatedAt > baseline` AND exact raw
  value, retain a token-scoped DOM assertion; only re-trigger on an OBSERVABLE
  failed/finished attempt (not an invented "settled-but-stale" state storage can't
  distinguish).
- **High — Fix 2 / reset root cause**: "recon-confirmed" contradicts Assumptions'
  "not reproduced"; storm-free non-failure is correlation; queue dedup weakens the
  "40 callbacks" mechanism. → Add terminal diagnostics, reproduce/compare, remove the
  retry-on-timeout. De-spam is fine independently but is not yet the proven root cause.
  [RESOLVED post-audit: reproduced solo/idle first-try; the real cause is a navigation
  race, NOT starvation — see lessons/phase-2.md.]
- **High — Fix 3 / execute inference**: the button stays disabled for several reasons, not
  only estimation latency; the frozen-account failure is on its SECOND execute popup, so
  "first cold popup" is weak. → Log button/error text, aria-busy, fee method, ops, and
  content-ready→enabled timing. The 120s caller overrides need changes to both test files
  (absent from the file map).
- **High — foundry deletion / supply chain**: probably correct, but "never consumed" is
  too absolute — the action mutates PATH and is a dormant fallback if bundled
  `internal-bin` is incomplete; the aztec installer is version-addressed `curl|bash`, not
  SHA-pinned. → Delete only after adding a setup preflight for all required
  executables+version, bumping the aztec cache schema to force one cold install, and
  failing loudly on partial caches.
- **High — phases/certification**: Phase 2 depends on Fix 4 (Phase 4) — reorder. Local
  `e2e:agent` defaults to 2 retries → every network gate must set `NULO_E2E_RETRY=0`.
  Smoke hardcodes 2 retries → certification must inspect logs for zero vitest retries AND
  GitHub `run_attempt == 1`. Record 3 complete run-ID/SHA/job matrices; wait for each run
  (concurrency cancels predecessors); reset the count after any tree change.
- **Med — Fix 5 / tombstone semantics**: absence alone is initially true → not
  completion. Prove the row EXISTS before submit; afterward require row absent + exact
  tombstone absent + owned roots cleared.
- **Med — Facts/evidence integrity**: Fact 1 false as written — 15 timeout occurrences
  across 14 jobs (one job had two failures: integrity + opfs); the 15th red job is the
  foundry 502, NOT a wait-timeout. Fact 2 misattributes the 300s rationale. Facts 3–5,8
  and #355 timing check out; log-only Facts 6–7 remain ledger assertions. Commit the
  audit artifacts (dir untracked; index.md modified).
- **Med — architecture/security scope**: the plan both allows product observability
  attributes AND says no product files change. Freeze to fixture-only; any attribute
  needs owner approval + named data contract + leakage review (the probe grep does not
  detect arbitrary `data-*`).
- **Low — feeMethod sweep**: unrelated scope; `"fpc"` has no unambiguous subtitle
  mapping. Split out or change the API explicitly to `public|private|sponsored` with
  exercised tests.

## What looks right (per codex)

- Purge-first sequencing + preserving OPFS/IndexedDB negative controls.
- Reading the live native `disabled` contract rather than duplicating Vue logic.
- Fixture-first where existing storage contracts suffice.
- Removing the mutable foundry action once a cold-install preflight is added.
- Required jobs/skips/retry configuration unchanged; honest OPEN ledger retained.
