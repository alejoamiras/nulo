# Phase 4 — DappSessionService no-PXE composition harness

## What landed
DappSession is PXE-free AND bb-free (pure storage + profile scoping) → the cleanest composition target (the "second harness shape" — no shared PXE port). Added the `browserApi?` ctor seam (storage field-init → ctor body, mirroring Token/Fpc/OperationJournalService). `dapp-session/service.composition.test.ts` drives the REAL lifecycle FSM against FakeBrowserApi storage + a Profile stub whose `onProfileDeleted` is a real `EventHandler` (so the cascade can be fired):
- **(AUDIT A12) cross-network scoping** — add for (origin, chainA); `tryGetDappSessionByOriginAndChain(origin, chainB)` → undefined; (origin, chainA) → the session. Pins the trust-bleed guard.
- **upgradeDappSession** — old id deleted + new id present (`getDappSession(old)` → "Invalid id").
- **read-triggered expiry eviction** — upgrade to a past expiry → `getDappSession` throws "Session expired" AND the row is evicted (`tryGetDappSession` → undefined).
- **setCapabilityGrants** round-trips through real storage.
- **onProfileDeleted cascade** — `invoke` the profile-deleted event → all of p1's sessions removed (`waitFor`, since `EventHandler.invoke` fires async handlers without awaiting).

All assertions are on REAL persisted state (the service's own read methods), not the fakes.

## Gate — MET
`vitest run dapp-session/service.composition.test.ts` (5/5) · dapp-session dir 24/24 · typecheck 0 · lint clean. No bundle gate (no PXE fake).

LESSONS_FILE=implementations-plan/composition-test-rollout/lessons/phase-4.md
