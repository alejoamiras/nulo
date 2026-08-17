# Arc 6 — fix-ui-storage (B-09, B-22, B-23, B-24, B-25, B-26, B-27, B-28, B-30)

[light] tier of the 2026-08-16 dual-audit remediation. Nine UI / storage / composable bugs. Prove-first per finding; one codex xhigh complete-arc-diff pass at the end.

Source of truth: `audit/bugs/2026-08-16-extension-mid/findings/consolidated.md`.

| ID | Sev | Fix (commit) |
|----|-----|------|
| **B-09** | Potential Critical | SelectProfilePopup routed its scope switch through `commitScopeChange` (was a raw `appStore.profile =`) — the in-flight-send guard now applies (d4e11984). |
| **B-22** | Major | `migrationIdle`'s post-subscribe re-check gained a rejection handler — a transient storage error no longer leaves the whole UI storage facade hung (0f385aad). |
| **B-23** | Major | `EntityStorage.decodeRow` stopped delete-by-id on the read path (raced a concurrent valid write) — KEEP the malformed row, leave deletion to a serialized repair path (14d3e3d1). |
| **B-24** | Major | The 3 copy-pasted import-rollback deletes → one `rollbackCreatedProfile` helper w/ bounded retry + a distinct "Import incomplete" cleanup-pending error on persistent failure (0c7358cc). |
| **B-25** | Major | send.vue `onBalanceAdded` called `.push` on the singular `tokenBalance` COMPUTED (crash) — extracted `send-balance-events.ts` reducers append to the `tokenBalances` ARRAY (e1b271f8). |
| **B-26** | Major | IncomingTrustPopup gained an `isSubmitting` latch + a `payloadKey()`-guarded close so a double-click can't dismiss the next queued prompt (e1b271f8). |
| **B-27** | Major | `useProfileBootstrap` single-flights the activation core per profile id (module-level, identity-guarded) so import-recovery joins the in-flight bootstrap instead of stomping its shared clients (a91d06ca). |
| **B-28** | Minor | IncomingTrustPopup captures the toast token symbol before the await (mid-RPC identity switch no longer mislabels it) (e1b271f8). |
| **B-30** | Minor | send.vue disconnects executionService in onBeforeUnmount (idempotent); execute/index.vue moves account/network disconnects into an outer finally (bb90fb41). |

## Prove-first
Every finding has a RED-against-pre-fix pin: reducer add/update (B-25); double-click + key-guard + captured-label (B-26/28, reactive cache mock); switch-admitted/refused (B-09); rejecting re-check hangs (B-22, timeout); no-read-path-remove + retention + valid-write-survives (B-23); persistent-rollback retries 3× + cleanup-pending (B-24); init-throws-after-construction disconnects both (B-30); concurrent bootstrap+hydrate construct clients once (B-27).

## Validation
Repo gates (lint, typecheck:all, full extension + wallet-core suites) + audit:vue + armed smoke (arc 6 ∈ armed-smoke list); CI runs smoke + network e2e as required gates.
