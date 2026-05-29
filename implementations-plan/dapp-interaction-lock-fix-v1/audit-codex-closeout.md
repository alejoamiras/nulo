# Codex closeout review

**Date:** 2026-05-25
**Effort:** xhigh, read-only
**Session:** 019e5ee3-ab60-79c1-a6de-59da1f03cbaa
**Commit reviewed:** cab6e73 (closeout: stricter types + UI extraction + silent-path)

**Verdict: needs-work** — one real regression in the silent-path ordering. Everything else cleared.

## Finding

### F1 — Silent-path pre-transition strands failed requests at `pending`

`silentInteraction()` (closeout commit) flipped the queued record to `pending` BEFORE doing request materialization + `refreshSession()`. If any of those throw before `executeOperations()` is entered:

- `handleWalletMessage`'s safety-net catch only terminalizes records still at `queued` (background.ts:562 — `if (record?.progress?.stage === "queued")`)
- A record at `pending` slips through and sits at "Preparing..." until the reaper's `pending` grace expires (~2 minutes per `STAGE_GRACE_MS`)

Pre-closeout, the same failure path stayed `queued` and the catch-block transitioned to `failed` immediately. The closeout introduced a regression where silent-path failures take 2 minutes to surface as failed instead of milliseconds.

**Fix:** moved the queued→pending fast-forward to IMMEDIATELY before `executeOperations()` (after materialize loop + refreshSession). Now any pre-execute throw leaves the record at queued for the safety net.

## Positive findings (cleared)

- **Claim-helper widening for `pending` is correct.** Traced all paths:
  - Normal popup flow: still claims `queued → pending` properly
  - Silent flow: pre-transitions, claim skips redundant transition, just registers controller
  - Cancel during silent pre-transition: claim's stage re-read / gate catches it via JobCancelledSentinel

- **Pre-popup short-circuit should stay STRICT (`!== "queued"`).** Codex confirmed `pending` before `execute()` is an invariant violation — the only writer is `silentInteraction()` which runs AFTER the guard. Don't bless that state at the guard.

- **Zod refinement message is useful, not generic.** `validateParams()` includes the refine text in the thrown `ValidationError`. The RPC schema's tuple wrapping puts the path at `0: ...` rather than `initialStage`-scoped, but the message itself is human-readable.

- **No other duplicated stage-to-subtitle switches to consolidate.** The `stageSubtitle` extraction is complete; remaining `"Preparing..."` strings in `RecentActivityView.vue` / `TransactionAwaitingCard.vue` are defaults/fallbacks, not parallel stage maps.

## Resolution

F1 fix applied in the next commit. Reordered `silentInteraction` so:
1. Profile check
2. Materialize loop (can throw → record stays queued → safety-net catches)
3. `refreshSession()` (can throw → same)
4. **Fast-forward queued → pending** (right before executeOperations)
5. `executeOperations()` (claim helper sees pending, skips transition, registers controller)

Added inline comment explaining the ordering invariant.
