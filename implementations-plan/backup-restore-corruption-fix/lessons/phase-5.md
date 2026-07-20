# Phase 5 — post-impl audit fixes (code-review max + codex adversarial) — lessons

**Status: ✓ complete.** Gate: `bun run --cwd apps/extension test src/composables/useFullBackupImport.test.ts` → 41 pass (38 + 3 new regression tests); `bun run typecheck` exit 0; `bun run lint` exit 0.

## What triggered this phase
After all 4 plan phases were ✓, the mandated `/code-review max --fix` + codex post-impl adversarial audit both ran on the shipped branch diff (`origin/dev...HEAD`). They **converged independently** on the same defects — the dual audit earned its cost a second time.

## Findings + resolutions (4 total)
| # | Sev | Source | Fix |
|---|---|---|---|
| P2 conditional profileId | **CRITICAL** (codex) / LOW (review) | both | **Fixed** — unconditional all-rows `remapIdInBackupData(data, "profileId", newProfile.id)`. The old `if (newProfile.id !== profile.id)` guard skipped normalization when the root id was unchanged, so a crafted backup with an UNUSED root id but VICTIM-id child rows wrote them verbatim → graft into the victim profile. codex escalated the review's LOW to CRITICAL with a concrete exploit (unused root U + child rows carrying victim V → account-state grafts PXE state into V). |
| P3 old-side ambiguity | **MEDIUM** (codex) | codex | **Fixed** — detect ambiguity from duplicate OLD `(chainId,contract)` too, not just successfully-restored NEW tokens. If two old tokens share a key and ONE fails restore, the new side looks unambiguous → the failed token's balances would graft onto the survivor. |
| P3 restoreErrorLog clobber | **LOW** (both) | both | **Fixed** — `recordRestoreErrors` now APPENDS (`[...existing, ...errors]`) instead of assigning. The token-balance drop diagnostic (recorded pre-restore at line 531) was clobbered by the loop's later `recordRestoreErrors(TOKEN_BALANCE, …)` when a real balance-restore error also occurred. |
| P1 unawaited tx cleanup | **HIGH** (codex) | codex | **Deferred → P4, documented** (plan §"Deferred: P4" + `transaction/service.ts` init comment). See consult below. |

## The P1 codex consult (architecture fork — acted on the stronger argument)
Removing the chainId subscriber (P1) left `onAccountDeleted` as the SOLE tx-cleanup path, but it's dispatched via `EventHandler.invoke` (fire-and-forget, discards the async promise) → SW-kill mid-cascade orphans txs; re-adding the chain resurrects them (deterministic address).

I proposed **Option D** (re-add an awaited, ordering-independent chain-purge subscriber that GCs txs by account-existence) and resumed the post-impl codex session to attack it. **codex verdict: `defer-to-P4-documented`** — and it was RIGHT, catching a real bug in Option D I'd missed:
- **`EntityStorage.getValues()` drops codec-invalid-but-preserved account rows** → Option D's `!globalAddrs.has(tx.account)` orphan predicate would misclassify those rows' valid txs as orphans and **permanently delete them, violating the storage keep-for-repair policy.**
- Option D is only a **partial** fix anyway: profile-delete fires `onProfileDeleted` fire-and-forget BEFORE `purgeChain` runs Option D, so profile-delete stays un-awaited.
- Plus a snapshot-ordering race (globalAddrs read before txs → concurrent account+tx creation → legit tx deleted).
- Given **zero users**, it's an orphan-leak/resurrection (narrow), not corruption. Ship the 3 clear fixes; defer the atomicity to P4.

**Correct P4 design (codex):** an end-to-end **awaited deletion coordinator** — `AccountService` snapshots the exact `Account[]`, passes authoritative addresses to *awaited* cleanup subscribers before completing deletion; tx cleanup filters by that positive set (no global enumeration, no orphan inference, no subscriber-order dependence). P4 must also make `ProfileService.deleteProfile` await the profile cascade.

Acted on codex's stronger argument per the loop rule: deferred, did NOT implement Option D.

## Gotchas
- The pre-existing P3 ambiguity test only covered NEW-side duplicates (both tokens restore). The old-side-duplicate-with-one-failure case is a DISTINCT path — needed its own fixture (token 2 restores with a `restoreError`, balance references token 2).
- `ServiceCollection.start()` is topological with `Promise.all` PARALLEL init within a phase (`packages/wallet-core/src/base/index.ts:65`). AccountService + TransactionService declare no `dependencies` → both phase 0 → chain-purge-subscriber registration order is RACY. So `purgeChain`'s docstring "TransactionService first" ordering was never actually guaranteed — a fact that killed the ordering-dependent variant of Option D.
