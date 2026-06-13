# C2 rebuttal — Claude side, round 1 (vs c2-codex-1, c2-codex-2)

All claims below re-verified against source.

## (c) Confirmed (5 deduped Codex findings — all substantively valid)

1. **Startup ordering / temporal coupling** (codex-1 F1) — confirmed; matches claude-1 F4 / claude-2 F1. Only ContactService declares `dependencies` in scope (`packages/extension/src/wallet/services/contact/service.ts:19`); poll fallback at `packages/extension-messaging/src/background/service.ts:187-199`. But see (b)/(d) below.
2. **Backup/restore loop ×8-9** (codex-1 F2, codex-2 F1) — confirmed; ranges spot-checked (`token/service.ts:532-555`, `account/service.ts:213-234`). Matches claude-1 F1 / claude-2 F4.
3. **Profile-deletion cleanup ×6** (codex-1 F3, codex-2 F2) — confirmed, including the "account has no lock" drift (`account/service.ts:194-202`, verified lock-free). Codex undercounts the family: the `clearChainState` twin loop (account:43-50, token:72-79, transaction:74-82, fpc:71-80) shares the root cause (claude-1 F2).
4. **Storage-provisioning sprawl** (codex-1 F4, codex-2 F4) — confirmed in substance; fallback ternaries verified at `contact/service.ts:37-39`, `profile/repository.ts:42-45`, `profile/session-manager.ts:130-132`.
5. **ProfileService Large Class** (codex-1 F5, codex-2 F5) — confirmed; `wc -l` = 1053. Claude-1 F9 (password/passkey three-phase twins) is the sharper actionable slice of the same file.

## (b) Overconfident / wrong

1. **codex-1 F4 factual error**: claims the composition root passes `browserApi` to "ContactService and ProfileService (`runtime.ts:115,125`)". False — `packages/extension/src/wallet/runtime.ts:125` is `new ProfileService(config, logger)`; no port passed. The second recipient is OperationJournalService (`runtime.ts:124`). The error *understates* the smell: ProfileService's port parameter exists (`profile/service.ts:61`) but is never wired in production — the migration is less finished than codex reports.
2. **codex-1 F1 evidence leg**: "the mismatch is already visible in registration order" (AuthRegistry before Execution, Profile before Passkey). Registration order is non-load-bearing: `runtime.ts:107-109` says so explicitly, and phase 0 starts via `Promise.all` (`packages/wallet-core/src/base/index.ts:65-70`) — concurrent, not sequential. The finding survives on its other legs; this leg is noise.
3. **codex-2 non-finding #1 is wrong**: "did not find a concrete init-time call that proves a required startup order." Refuted: `transaction/service.ts:109` (`addTransaction`) has no `ensureInitialized()` guard and dereferences the `null!`-initialized `this.networkService` at :131 — a cold-start null-deref path. claude-2 F1 lists more unguarded siblings (auth-registry:73, dapp-session:53, account:138).

No DO-NOT-FLAG violations found on the Codex side.

## (a) Missed (vs Claude union, all source-verified)

1. **Active-profile guard drift** — codex-2 F3 found the duplication but counted 31 sites across only 4 services and missed the payload: 47 guard-literal sites across 9 services with **four divergent error strings** ("Profile locked" majority; "Wallet locked" `token/service.ts:468`; "Wallet is locked" `dapp-session/service.ts:112`; "unauthorized" `account/service.ts:189`), all bypassing the existing typed `WalletError` channel. codex-1 missed the finding entirely.
2. **`new PxeServiceClient(this.logger)` ×8 in `init()`** (verified: token:57, transaction:52, network:163, fpc:60, note:46, execution:342, token-balance:67, account-state:36) — codex-1 dismissed as non-finding ("no drifted behavior"); weak rejection: 8 unfakeable hidden transport deps directly explain the zero-test services, and the runtime header promises a composition root.
3. **Lock ceremony ×67, three idioms, dead code** — codex-2 non-found named-vs-bare locks as "convention-level"; both missed `account/service.ts:129-134` (verified literal no-op `finally` — body is a guarded `return` plus comments) and token's `holdsLock` variant.
4. **Static module cycle** auth-registry ↔ execution (verified: `auth-registry/service.ts:5` ↔ `execution/service.ts:42`) — both codex instances missed; cycle-free alternatives exist in execution's spec.
5. **Token twin resolvers + 9-family data clump; PXE ensure-registered ×4** (token:289-305/374-390, fpc:245-261/347-357) — both missed.
6. **DappSession six lock-fetch-mutate-emit clones** (dapp-session:142-266) — both missed.

## (d) Contradictions

- **Direct inter-instance**: codex-1 F1 elevates startup ordering to its lead architectural finding; codex-2 explicitly rejects the same smell as a non-finding. Codex-1 (and both Claude instances) are right — see (b)3.
- Minor: same storage finding named "Config sprawl" (codex-1 F4) vs "Alternative Classes with Different Interfaces" (codex-2 F4); immaterial.
