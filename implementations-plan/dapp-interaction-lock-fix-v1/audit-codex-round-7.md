# Codex review — round 7 (effectively cleared — plan-text consistency only)

**Date:** 2026-05-22
**Effort:** xhigh, read-only
**Session:** 019e5147-f83f-7bb2-a0f6-f14dfe87b1ad

**Verdict: needs-work** in form, but effectively cleared in substance. Codex's closing line: *"If you already fixed the Step 7 call site and `IDappInteractionRunner` locally, I'd treat the rest as **looks-good**."*

## Findings

### F1 — Drop `updateMetadata`: CONFIRMED safe, no regression

No path depends on a post-claim title refresh:
- `RecentActivityView.vue:257` reads `op.title` directly at render time, no caching.
- `journal-state.ts:198` (terminal cards) reads the same way.
- `TransactionAwaitingCard` receives title as a prop, doesn't cache.
- The current send path derives the dapp title BEFORE any authwit/proving work at `execution/service.ts:1872`.

Queued-time title is correct.

### F2 — Plan text still has the OLD 2-arg `execute()` call in Step 7

Plan.md:404 shows `execute(payload, hooks)`, but the v7 fix made it `execute(payload, cancellationToken, hooks)` (3 args). Need to update Step 7 to match.

Companion: `services-contract.ts:41` `IDappInteractionRunner.execute` interface needs the optional third arg added; dispatcher test stubs need updating in the same implementation pass. Compile-time-checked, so tsc/test will catch any miss.

### Residual risk (cosmetic only — not blocking)

`extractCallsMetadata(message)` may pick a slightly different primary-method heuristic than the existing sendTx path. If so, the queued-card title might differ from today's label. **Display drift, not correctness.** Acceptable.

## Verdict for v8

Plan v8 applies both:
- Step 7 dispatcher call site → 3-arg `execute(payload, undefined, hooks)`
- Inline note: `IDappInteractionRunner` interface contract + test stubs updated during implementation

After v8 application, codex's "looks-good" condition is met.
