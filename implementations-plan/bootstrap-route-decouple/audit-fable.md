# Fable audit — round 1 (2026-08-12, Plan agent on model fable, fresh context)

Scope: plan.md + recon.md, standard packet (adversarial/security + assumption-attack +
implementation-critique + gates), owner UX decisions settled.

## Verdict

**conditional approve** (with conditions: (1) fix the skip-record synthesis to
per-sender/per-contract `restoreError` + unit-pin that skips flip `isRestoreHasErrors`, and
correct Fact 5 [High-1]; (2) write the restore-pending marker in BOTH profile-restore branches,
passkey included [High-2]; (3) surface the finalize-throw torn false-positive under Ask 3
before the owner confirms withholding, add `backup-restore-sw-restart.test.ts` to the change
map with its outcome matrix consciously updated, and pull the two backup-restore network tests
into the Phase 4 gate [Medium-1]; (4) correct the Phase 1 expected-shapes note re shape (a)
and the preflight `Inactive`-classification wording, and fix the `test:components` gate path
[Medium-2, Low-1, Low-4].)

## Findings (ranked; full transcript retained in the session)

**High**
1. Skip-record synthesis shape wrong: `collectRestoreErrors`'s account-state branch consumes
   per-sender/per-contract `restoreError`, never per-item (`utils/full-backup-helpers.ts:77-85`);
   item-level skip records vanish → auto-route with silently-skipped registrations. Corroborating
   latent bug: the malformed-item entry at `account-state/service.ts:227-235` (item-level error,
   empty child arrays) ALSO vanishes despite its comment claiming it surfaces — fix or ledger.
2. Marker cited only for the password restore branch (`profile/service.ts:1332-1353`); the
   passkey branch lands its row separately (`:1409-1439`, `repo.set` at `:1428`) and must write
   the marker too.

**Medium**
3. Torn-marker false positive: finalize-throw paths (passkey pending-secret loss
   `service.ts:1523-1526`; composable finalize-catch `useFullBackupImport.ts:655-662`) leave a
   fully-restored profile branded torn — replacing a documented working-unlock recovery with
   "delete and re-import". Surface under Ask 3; update `backup-restore-sw-restart.test.ts`
   outcome matrix (`:186-235`); add to change map.
4. Root-cause shape (a) (90s+ "Importing…" park) likely unreachable — the base client arms a
   strict per-request 60s timer (`extension-messaging/src/core/base-client.ts:122-131`), so a
   hanging RPC manifests as shape (b) first. Correct Phase 1 expectations.
5. "Harmless late registrations" under-describes the abandoned SW-side loop on hanging URLs
   (N×90s background dialing keeps the MV3 worker alive; `account-state/service.ts:236-272` +
   `offscreen/client.ts:20`). Document; optionally ledger a service-local signature-unchanged
   fail-fast (skip a network's remaining items after a connectivity-class failure).
6. Inference 3 basis misstated: FIVE `onTokenBalanceUpdated` listeners (`send.vue:103`,
   `TokensView.vue:162`, `BalanceView.vue:218`, `SelectBalanceTypePopup.vue:52`,
   `tokens/[id].vue:52`), and `tokens/[id].vue` treats the emit as fresh-balance — sweep all
   five in Phase 3.

**Low**
7. Phase 3 gate: `test:components` exists only in `apps/extension/package.json:25`, not root.
8. Preflight classification: `getNodeStatus` never throws — refused/no-primary/timeout return
   `Inactive` (`network/service.ts:544-558`); "unreachable = timeout, throw, or Inactive".
   Refused RPCs classify in ~ms (preflight ≈6s, not 21s). State InvalidChain-is-reachable as a
   conscious choice.
9. Torn-record delete lifecycle: clear BOTH marker and torn record on `deleteProfile`
   (`service.ts:888,931` mirror); key the barrier strictly by profileId.
10. Cap parallel preflight fan-out (hostile many-network backup); cite drift:
    `tests/e2e/endpoints.test.ts` (not `network/`).

**E2E conditions (folded into Phase 2)**: senders-only account-state item (forces the dial
without artifact bloat); use a REAL derived account address in the synthetic backup (a
fabricated address trips the account-integrity coordinator and withholds the session —
poisoning the test); close the blackhole server in `finally`; per-test isolation fixtures.

**Endorsements**: Shape A over B (B's per-item-exactness pro is cosmetic — no cancellation
primitive exists; you'd pay an audited-surface signature change for it); Ask 1 RATIFY (drop the
env override — probe URL structurally equals dial URL, both primary-endpoint-resolved:
`network/service.ts:549-552` vs `network/spec.ts:83-87`); budget math verified against real
numbers incl. the storage-bound post-Continue leg; certification rules carried verbatim; no
SAH-lock wedge path (store opens only after the dial resolves; close-on-throw
`chain-runtime.ts:168-173`); marker check must live in the unlock Phase-3 locked blocks, NOT in
`openSessionVerified` (finalizeRestore calls it while the marker is legitimately present);
slice registry rejects unknown slices so a hostile backup cannot inject marker/torn keys
(`backup-migration-registry.ts:191-212,249-252`).
