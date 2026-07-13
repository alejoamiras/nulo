# Post-implementation adversarial audit — codex gpt-5.6-sol (xhigh)

Session `019f58be-8ccc-70a2-a873-04ac98074773`. Range audited: `git diff origin/dev..HEAD` (28 commits). Prompt: attack coordinator crash-consistency, resurrection, provenance, tombstone fail-closed, and give a ship/block verdict on the D13 residual.

## VERDICT: BLOCK — D13 is a practical ship-blocker; read-gating + successor-event races add more deletion failures.

All findings below were RE-VERIFIED against the code before acting (codex can be wrong; these were not).

### Critical

1. **A tombstoned half-deleted profile can be silently unlocked.** (`profile/service.ts` `unlockProfile:221`, `finalizeRestore:1112`, `getProfileSecret:846`; session-restore callback at `:171` IS gated, these are NOT.) SW dies between the phase-1 tombstone write (`:615`) and `repo.delete` (`:616`); the row survives, the id is reserved, but `unlockProfile`/`finalizeRestore`/`getProfileSecret` read raw `repo.get` with no `isReserved` gate and can open a session on a profile queued for deletion, racing the fire-and-forget resume purge. **Verified: confirmed — those three methods have no `isReserved` check.**

2. **D13 exploitable during normal slow proving/submission — deleted txs reappear.** (`coordinator.ts:112`, `execution/transfer-executor.ts:198,206`, `transaction/service.ts:110`.) A transfer is proving when the profile is deleted; the coordinator purges txs early; execution completes and calls `recordTransaction` → `addTransaction`, whose lock only serialises tx storage — no profileId / epoch / account-existence / tombstone check — so the pending tx is written AFTER its purge and never re-purged. **Verified: confirmed — the transaction service has ZERO `deletionState`/epoch reference; `ProfileDeletionState` is not injected into it. D13 call: BLOCK.**

### High

3. **`purgeForProfile` re-emits fire-and-forget delete events → successor-clobber survives.** (`account/service.ts:227` emits `onAccountDeleted`; `auth-registry/service.ts:84` consumes it via `void purgeForAccounts` (discarded promise); same shape for `token/service.ts` → `token-balance/service.ts:219`.) The coordinator awaits the auth/balance purges directly, but the LATER `account.purgeForProfile`/`token.purgeForProfile` re-emit these events; their async consumers run after the coordinator releases the id, so a successor that reuses the deterministic address / highest token-id gets its rows clobbered. **Verified: confirmed — purgeForProfile emits, consumer is fire-and-forget.**

4. **Account restore concurrent-overwrite race.** (`account/service.ts:242,262`.) Two concurrent popup imports of the same address both pass the intersection check then both write the global address-keyed row (no AccountService-wide restore lock). Restore is also per-row-caught (not all-or-nothing) and only rejects whitespace, not malformed Aztec addresses, and never checks the account's chain belongs to a restored network. **Verified: confirmed — no restore lock; per-row catch.**

### Medium

5. **No-delegate window + false-success UI.** (`profile/service.ts:605`, `reset.vue:43`.) ProfileService can initialise before the last-phase coordinator injects its delegate; an early delete rejects "coordinator not ready". `reset.vue` neither awaits nor catches `deleteProfile`, so it clears local state and shows success regardless. **Verified: confirmed — reset.vue fires un-awaited.**

### Low

6. **Corrupt tombstone = permanent invisible DoS; phase-3 can release without clearing.** (`tombstone-repository.ts:51`, `profile/service.ts:633`.) A corrupt raw row reserves an id forever with no repair/status API; a payload whose `profileId` ≠ raw-key suffix strands the key; `clearIfSame` may no-op while `release` still runs. Backup can't inject this root (unknown slices rejected), so it's local-corruption only — the fail-closed tradeoff, but worth a repair/telemetry path.

### Looks correct (codex)
Composable provenance filtering, tx tuple filtering, token relinking, one-pass remap; restore-time schema parsing + restored-Pending rejection; tx create-only; `runFor` single-flight + fail-fast retry; SW-death-during-phase-2 leaves a resumable tombstone; PXE prefix deletion + error/blocked propagation.

## Disposition
BLOCK accepted. Fixing C1–C2 + H3–H4 + M5 (all within finding-D / finding-H scope). L6 → follow-up (documented tradeoff). See `lessons/phase-10-audit-fixes.md`.
