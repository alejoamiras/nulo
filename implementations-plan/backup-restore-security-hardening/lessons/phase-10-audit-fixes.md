# Phase 10 — post-impl audit fixes (codex BLOCK → resolved) — lessons

**Status: ✓ core (commits `32b035b`, `1eb3026`).** The codex post-impl audit (`audit-codex-postimpl.md`, session `019f58be`) returned **BLOCK**; an independent review subagent corroborated + extended it. All CRITICAL/HIGH fixed; two write paths deferred WITH codex's explicit backing; LOWs triaged below.

## Fixed
- **C1 (critical) — half-deleted profile unlockable.** `unlockProfile` (phase 1+3), `unlockPasskeyProfile` (phase 1+3), `finalizeRestore`, `getProfileSecret` now reject a reserved id. Raw `repo.get` / session were blind to the reservation; only `getProfiles` + the session-restore callback were gated.
- **id-reuse fail-open (subagent) — passkey id-gen bypassed the reserved set.** `importPasskeyProfile` + passkey `restore` fallbacks used `repo.generateUniqueId()` (storage-only; a tombstoned profile's row is deleted so its id is absent from storage but reserved) → could hand back a reserved id → resumed purge clobbers the new profile. Routed both through `nextUnreservedId()`.
- **H3 (high) — purgeForProfile re-emitted delete events.** `Account/Token.purgeForProfile` no longer emit `onAccountDeleted`/`onTokenDeleted`; the coordinator awaits every dependent purge (tx/auth via purgeForAccounts, balances via purgeForTokens, incoming via clearProfile) DIRECTLY, so the re-emit was redundant and its fire-and-forget consumers could clobber a successor reusing the deterministic address / token id. Consumers verified fully covered by the coordinator (codex confirmed). `_deleteTokenById(id, emit=false)` for the silent path.
- **H4 (high) — AccountService.restore had no lock.** Wrapped in `restoreLock` so two concurrent same-address imports can't both pass the intersection check + both write.
- **M5 (medium) — reset.vue faked success.** Now awaits `deleteProfile` + shows an error on rejection (deleteProfile already throws "deletion coordinator not ready" if the delegate is absent, closing the no-delegate window's user-facing half). Removed IncomingTransfer's fire-and-forget `onProfileDeleted` sub (D7 deviation; coordinator calls `clearProfile` awaited).
- **C2 / D13 (critical, verdict BLOCK) — the epoch fence was DEAD CODE.** `ProfileDeletionState` was a private ProfileService field, never injected; `assertCurrent`/`isCurrent` had zero callers; `resumePendingDeletions` never armed the epoch. Wired per codex's design (`1eb3026`): shared state via `getDeletionState()`; `init` hydrates each valid tombstone's epoch (`hydrateDeletion` — set-to-at-least, NOT beginDeletion, so it can't diverge from the stored epoch); Execution captures `{profileId, epoch}` at AUTHORIZATION (before prove, never inside proveAndSend) + threads an `ExecutionFence` through the transfer + dapp-send executors to `addTransaction`; `addTransaction` asserts epoch-current + owning-account-exists under the tx lock, BOTH bound to the captured profileId (successor address-reuse → different profileId → getAccount undefined → rejected). Pin: `transaction/service.test.ts`.

## Deferred — WITH codex's explicit backing (do NOT claim D13 complete)
codex's D13 verdict (response-2): "**BLOCK until the tx-path fence is implemented. Token-metadata and balance-projection MAY be deferred**" as tracked pre-production follow-ups. Their eventual fix uses the SAME profile epoch (existence-only remains unsafe under numeric-id / address reuse):
- **token-metadata** (`token/service.ts` writes): capture epoch before PXE/network work, `assertCurrent` under the token lock immediately before persist.
- **balance-projection** (`balance-job-queue.ts`): carry the epoch in the queued job, assert immediately before `repo.set`, AND verify the balance still has the expected `(id, token, account)` identity (id-existence alone permits successor-id clobber).
These are inert-to-exploit relative to the tx path (far less periodic than the 1s tx poller; the demonstrated resurrection vector — a completing transfer — is now fenced). Tracked in `plan.md` § Follow-ups.

## LOW triage
- **Coordinator.purge has no direct unit test** (subagent #4): covered by the e2e round-trip (end-state) + the ProfileService integration harness (stub delegate). Ordering turned out not load-bearing (network-tail re-emits idempotent). Follow-up: a `coordinator.test.ts`.
- **Duplicate old-token-id not rejected in composable relink** (subagent #6): not cross-profile exploitable (both new tokens belong to the importer; chain-equality holds). Follow-up.
- **Corrupt-tombstone permanent DoS / no repair API** (codex L6): the fail-closed tradeoff, local-corruption only (backup can't inject the root). Follow-up: a repair/telemetry path.

## Gotchas
- Every real-service-graph test that constructs `TransactionService`/`ExecutionService` now needs its ProfileService stub to expose `getDeletionState()` (composition test, cross-profile-isolation fake, the new tx test). A SHARED instance per harness so Execution's capture + Transaction's assert see the same epoch map.
- `addTransaction` gained a TRAILING optional `fence?` param — non-execution callers (and every existing test) are unaffected (undefined fence → no assert).
- The 3 dapp-send `recordTransaction` closures live across `executeSendTransaction`, `executeAztecSendTx`, and `executeNoFromSendTx` (the default_entrypoint delegate) — all three needed the fence threaded.
