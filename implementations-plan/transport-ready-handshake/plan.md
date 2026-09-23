# transport-ready-handshake — PARKED (owner decision, 2026-08-18)

**Status: PARKED before drafting.** The owner halted this arc at the recon
stage — an explicit risk call on touching the transport layer (every
ServiceClient surface rides this wire), made after reviewing the recon
findings. No plan legs ran, no code was written, nothing changed on dev.

## What this arc was

ARC A of the 2026-08-18 two-arc goal: implement the LEDGERED Ready-handshake
transport rework — `implementations-plan/deflake-round-4/fix-plan.md`
decision-ledger **row 1** (fable's full mechanics: MessageType.Ready,
F-09-gated ack, Connecting-until-Ready, never-sent queue, sent-fail-fast +
never-replayed, capped backoff, `chrome.runtime.lastError` read, doomed-port
harness primitive) + **row 6** (ProfileService boot race) — plus A2 (convert
`frozen-account-canary` stage 5 to the real kill) and A3 (clearProfileState
supersede of a `deleted(different-gen)` tombstone, codex-gated on zero D4
resurrection risk).

## Where everything stands

- **The normative spec is UNCHANGED and stays where it was**: fix-plan.md
  ledger rows 1/6 + `recon-fixes.md` §B.
- **The two flake-ledger entries stay OPEN as written**
  (`implementations-plan/e2e-deflake/flake-ledger.md`): the
  frozen-account-canary stage-5 fake-kill entry and the
  crash-before-provision delete-refusal entry. Neither is re-dispositioned by
  the parking — they remain accurate statements of open debt.
- **Recon completed and is preserved** in [recon.md](recon.md): four scouts
  over the transport, callers/noise-filters, profile/PXE lifecycle, and e2e
  harness surfaces, consolidated with exact file:line maps (at dev
  `3e3bd129`), the breaking-test enumeration, the A3 Variant A/B fork
  analysis, and the design-shrinking find (the existing B-15
  readiness-deadline machinery already provides the never-sent queue). An
  un-parking session starts there.

## Why parked (the honest record)

Blast radius: all 22 background ServiceClient consumers across popup,
onboarding, and offscreen; `onConnected` retiming touches 13+ reconnect
consumers; MV3 respawn timing is where unit tests can't reach. Round 4's own
decision ledger had already rejected doing this rework as a bug fix ("large
blast radius vs ONE proven victim") and ledgered it as a deliberate
follow-up; the owner judged the deliberate follow-up not worth the risk now
either. The known debt this leaves open (accepted consciously):

- The messaging client still reports `Connected` on doomed ports during MV3
  respawn gaps; the shipped protection is caller-level
  (`useFullBackupImport`'s liveness gate) — the other 21 clients keep the gap.
- `waitForConnection()`'s uncapped forever-poll (B-16 follow-up) stays open.
- F-09-rejected ports keep dangling silently.
- Per-respawn unchecked-`lastError` console churn continues.
- The canary's stage 5 still exercises a fake kill; the twice-crashed-profile
  delete refusal still fails to the torn backstop until offscreen restart.

## Un-parking checklist

1. Re-read [recon.md](recon.md); re-verify its line numbers against current
   dev (they were exact at `3e3bd129`).
2. Resume the `/blueprint deep` protocol from the three-independent-plans
   step; the three open asks (dead-SW latency contract, queue scope, Ready
   version skew) still need codex-argued decisions — recon.md §E records the
   constraints discovered so far.
3. A3 remains codex-gated: zero D4 resurrection risk or re-ledger.
