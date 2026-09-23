# Fable audit — round 1 (plan review)

Auditor: fable Plan agent, fresh context, source-verified. Verdict: **conditional approve** (4 conditions). Dispositions in plan.md's ledger.

## Adversarial / security
- **Verified sound**: stamp precedes dispatch structurally (B-13 gate at `background.ts:271-274` treats missing establishment status as false; the stamp lands inside `handleSessionEstablished` before it returns true — a dispatched message always has a stamp within one SW lifetime); SW restart drops map + upstream `activeSessions` together (private in-memory, `d.ts:141`) — no stale-stamp window; no dApp-inducible map-miss; post-terminate reconnect skips emoji verify via `trustedVerification` (`session-established.ts:77`) — no re-verification DoS; lock→unlock-same-profile terminates nothing.
- **HIGH — intra-dispatch re-read survives the guard.** The guard at the ctx build closes only the pre-dispatch window; a switch landing DURING `dispatcher.dispatch` (`:694`) still hits `tryGetDappSessionByOriginAndChain`'s internal live-profile re-read (`dapp-session/service.ts:116-121`) — capability resolves against B's row while ctx carries A: mixed authorization. Resolution: anchor the per-dispatch row lookup to `ctx.profileId` (explicit param, or assert `row.profileId === ctx.profileId`) — two lines, in-scope; else downgrade the success-criterion claim and log the residual window.
- **MEDIUM — guard ordering**: terminate-before-respond makes `handler.sendResponse` (`:743`) fail on the deleted session — the promised error envelope never arrives (the DISCONNECT rejection covers the dApp anyway). Resolution: respond, THEN terminate — or drop the envelope claim.
- **Establishment racing a switch**: the stamp is NOT "the identity that approved" — validation filters by the LIVE profile (`service.ts:116`): approve-under-A → switch → validate-under-B either fail-closes (no B row) or self-consistently binds B (B's row + B's hash + B's grant — safe; a verify popup may surface under B). No data crosses in any interleaving; the mechanism is right BECAUSE stamping the approver would just self-terminate. Fix the wording.
- Minor hardening: also terminate unstamped sessions in the switch listener (zombie-until-first-message otherwise; costs nothing).

## Assumption attack
- Facts: ALL verified clean (side-map precedents, cleanup block, teardown template, drain-only listener, double live-read, closed upstream type, TTL convention, toJsonSafe + dangling JSDoc).
- Inference 1 holds with a caveat: the row is in scope with `profileId` (`service.ts:121`) but `SessionEstablishedDeps`' narrowed return type (`session-established.ts:23-26`) must WIDEN to carry it.
- Inference 2 holds (`d.ts:164`); inference 3 holds (B-13 gating).
- **Inference 4 FAILS**: no two-profile in-session fixture exists — `profile-reimport-matrix` is sole-profile delete→reimport; `account-import-export.test.ts:15-16` uses a second BROWSER precisely because "the in-session profile picker … has never been driven" in e2e. Phase 3 pioneers an untested UI path; budget fixtures/testids.
- Asks: inference 4 should have been an Ask.

## Implementation critique
- Hybrid justified, not over-engineered (A-only leaves the pre-teardown window; B-only lies to the dApp UI); stamp-vs-tuple correct (`service.ts:121` confirms same-tuple rows per profile); extraction shapes match convention; c6-2's two pins right; ancestor-frame toJSON handling preserves the self-returning-toJSON guard; N-26's real backstop is `!trustedVerification` — a stale-marker skip can never bypass first-time verification; phase ordering right.

## Verdict
**conditional approve** — conditions:
1. (HIGH) Anchor the dispatcher's session lookup to `ctx.profileId` (or explicitly downgrade the in-flight claim + log the residual).
2. Respond-then-terminate ordering in the guard.
3. Rewrite Assumption 4; budget Phase 3 fixture work for the never-driven in-session profile switch.
4. Correct the "identity that approved" wording; widen `SessionEstablishedDeps` to return `profileId`.
