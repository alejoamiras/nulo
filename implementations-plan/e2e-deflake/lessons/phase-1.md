# Phase 1 lessons — reset-flow fixes (Fixes 2 + 5) — GATE GREEN

## What raced, what signal now gates it (the pinned regression rationale)

**Fix 2 (`resetProfile` checkbox 5s — 4 CI reds + 2/2 local repro)**: `navigateByHash`'s
one-shot hash-equality wait passes before vue-router commits; a competing in-flight
`router.push("/popup/general")` then supersedes the reset navigation and the hash reverts
(instrumented dump: parked fully on general, `readyState: complete`). The gate is now
"the reset route COMMITTED and HELD": checkbox mounted AND hash+checkbox continuously
true for a 1500ms monotonic in-page dwell (`__resetStableSince` — a plain waitForFunction
resolves on first truthy poll and proves nothing, per the round-2 codex catch), with ONE
re-navigation allowed for the characterized race and a poll-based hash-trajectory recorder
dumped into any failure. A second revert fails loudly — a recurring redirect is a product
signal, never normalized.

**Fix 5 (post-reset waits — 1 opfs CI red + latent in 2 more files)**: `reset.vue` AWAITS
the coordinator's full purge before navigating; the old waits raced the route against the
awaited cascade. The gate is now the purge's own completion fact: profile row (PROVEN to
exist pre-submit via `captureSoleProfileId` — absence alone is also true before deletion
starts) + exact tombstone `nulo:core:profile-tombstones@<id>` + owned roots all cleared
(`waitForProfilePurged`), THEN the prompt route assert. Timeout dumps remaining keys +
session presence (wedged purge vs rejected delete vs never-started).

## Gate evidence (2026-08-11)

- Pre-fix: `backup-restore-integrity` failed 2/2 solo local runs (160s each) at the exact
  CI signature; the second run instrumented and diagnosed the parked state.
- Post-fix: integrity + opfs green 3× consecutively (`NULO_E2E_RETRY=0`, proverless, solo:
  119s / 133s / 142s — "Test Files 2 passed, Tests 3 passed" each) + 2 more greens of the
  intermediate variant. `security-reset` green in 7.4s inside the RESTORED 30s file budget
  (the drafted 45s bump was rejected by round-2 codex as a disguised raise — correctly:
  purge+route are not additive; empirical total 7s).
- `bun run lint` + `bun run typecheck` clean.

## Attempts log

1. Draft fix (settle "window" via plain waitForFunction + 3 attempts) — REJECTED by the
   round-2 codex pass: not a dwell at all (first-truthy-poll resolution). Rebuilt as the
   monotonic dwell + 2 attempts + trajectory recorder. Lesson: a stability check must
   TRACK continuity in page state; puppeteer's waitForFunction timeout is a ceiling, not
   a hold.
2. security-reset 30→45s file budget — reverted after codex flagged it; validation proved
   30s ample.
