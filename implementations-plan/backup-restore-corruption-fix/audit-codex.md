reject (blocking findings: restore-time tx provenance is still attacker-controlled; `deleteNetwork` cascade assumption is false; network remap pairing is incomplete for new-shape rows)

**Security/Adversarial**
- High: `TransactionService.restore` will write every backup tx as supplied, keyed by attacker-chosen `hash`, and would also accept attacker-supplied `profileId` unless the plan adds provenance checks. See [service.ts](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/transaction/service.ts:313). A crafted backup can set `tx.profileId` to the new profile while `tx.account` is another wallet account, or set it to another profile to survive/target future `(profileId, chainId)` purges. Plan only says “populate at creation sites” and does not require restore to derive/verify tx profile from restored account rows: [plan.md](/home/homelab/Projects/nulo/nulo-3/implementations-plan/backup-restore-corruption-fix/plan.md:35).
- High: adding `profileId` to tx rows changes purge authority, so it cannot be trusted from backup data. Restore must reject/drop txs unless `(tx.profileId, tx.chainId, tx.account)` matches an imported account row, and probably rewrite `profileId` from that account after profile remap. `Account` has authoritative `profileId/chainId/address`: [spec.ts](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/account/spec.ts:15).
- Medium: P2’s helper change is necessary but not sufficient against crafted blobs with duplicate or ambiguous old IDs. The plan says “presence-guard” but not uniqueness/failure policy: [plan.md](/home/homelab/Projects/nulo/nulo-3/implementations-plan/backup-restore-corruption-fix/plan.md:64).

**Assumptions (Facts/Inferences/Asks)**
- Medium: Fact cites are stale/misleading. `onProfileDeleted` is actually [network/service.ts](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/network/service.ts:684), not `:189,313`; line 313 is `deleteNetwork`’s `purgeChain`. `deleteNetwork` does call `purgeChain`: [network/service.ts](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/network/service.ts:301).
- High: Inference “`deleteNetwork` does NOT cascade-delete accounts” is false. `AccountService` registers a chain-purge subscriber: [account/service.ts](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/account/service.ts:47), and its `clearChainState` deletes `(profileId, chainId)` accounts and emits `onAccountDeleted`: [account/service.ts](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/account/service.ts:56). The Ask should be: do we still need `TransactionService` subscribed to chain purge at all, or can account deletion be the tx cleanup source?
- Medium: “Every tx account belongs to exactly one profile” is only true by current storage keying and duplicate-address restore rejection: [account/service.ts](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/account/service.ts:232). It is unsafe as a restore assumption because a crafted tx need not correspond to a restored account unless checked.
- Low: “Only two call sites” is true for source code, but tests also call the helper and need signature updates: [full-backup-helpers.test.ts](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/utils/full-backup-helpers.test.ts:122).

**Plan correctness**
- High: P1 is not correct as written for both purge triggers because it rests on a false account-cascade premise. `deleteNetwork` already purges accounts, so the plan must justify why `profileId` tx purge is better than removing/reordering the tx subscriber. Current `clearChainState` wipes by `chainId`: [transaction/service.ts](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/transaction/service.ts:79).
- High: tx creation enumeration is incomplete. Storage creation sites are `addTransaction`, `updateTx`, and `restore`: [transaction/service.ts](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/transaction/service.ts:117), [transaction/service.ts](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/transaction/service.ts:246), [transaction/service.ts](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/transaction/service.ts:313). Callers include transfer and three dApp paths: [transfer-executor.ts](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/execution/transfer-executor.ts:207), [dapp-send-executor.ts](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/execution/dapp-send-executor.ts:308), [dapp-send-executor.ts](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/execution/dapp-send-executor.ts:433), [dapp-send-executor.ts](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/execution/dapp-send-executor.ts:595).
- Medium: required `profileId` in `TxSchema` will make existing dev tx rows unreadable-but-kept under the codec: [entity_storage.ts](/home/homelab/Projects/nulo/nulo-3/packages/wallet-core/src/storage/entity_storage.ts:76). The plan acknowledges “no migration” but not the invisible-row dev impact.
- High: P2 network remap still needs a correct old→new pairing. Current code matches on `name/rpcUrl/chainId`: [useFullBackupImport.ts](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/composables/useFullBackupImport.ts:401), but real network rows have `endpoints[]`, no top-level `rpcUrl`: [network/spec.ts](/home/homelab/Projects/nulo/nulo-3/apps/extension/src/wallet/services/network/spec.ts:26).
- Medium: validation gates mostly exist, but `bun run e2e:agent backup-restore-integrity` is a bare vitest filter; the documented wrapper examples use file paths, and the file does not exist yet.
---

## Final fresh-context pass (v2) — verdict: reject

reject (blocking findings: P1 foreign-account txs are not inert; P2 name+chainId network pairing is forgeably ambiguous)

**Security/Adversarial**
- High: The P1 tradeoff claim is false. `TransactionService.restore` writes txs verbatim by `hash` (`transaction/service.ts:308-320`), and `getTransactions` filters only by `account` (`transaction/service.ts:92-94`). A crafted backup can restore a tx whose `account` is an existing account in another profile; it will show in that profile’s activity (`app.store.ts:153-156`). After removing the chain subscriber, deleting the imported profile will not purge that row because `onAccountDeleted` only fires for deleted account rows (`transaction/service.ts:170-181`). The old subscriber was unsafe collateral cleanup, but the new plan cannot call these txs “inert.” Fix or explicitly scope a tx-restore provenance filter to imported/restored accounts.
- High: P2’s proposed `name+chainId` pairing is attacker-ambiguous. `NetworkService.restore` returns one result per input and spreads failed raw fields back into the result (`network/service.ts:627-666`). A backup with invalid network A and valid network B sharing `name+chainId` makes `useFullBackupImport.ts:401-406` pair B with A if implemented as planned, then scoped remap grafts A’s `account-state` onto B; `AccountStateService.restore` trusts `item.networkId` to choose the PXE target (`account-state/service.ts:192-206`, `:215-229`). Pair by restore-result index, or enforce uniqueness across candidates and skip ambiguous mappings.

**Assumptions**
- Medium: “Duplicate in-backup network ids” is now a stale trigger. Current backup normalization rejects duplicate root row ids before restore (`backup-migration-registry.ts:170-174`, `:257-260`; `backup-migrator.ts:89-90`). Test the real remaining cases: live-storage id collision and ambiguous failed/successful same `name+chainId`.
- Medium: Whole-profile deletion is still async-event best-effort. `ProfileService.deleteProfile` emits without awaiting (`profile/service.ts:568-570`), and `EventHandler.invoke` does not await async listeners (`event-handler.ts:22-26`). This is P4, not created by v2, but the plan should not imply deleteProfile completion proves tx cleanup completion.
- Low: The cited `entity_storage.ts` path is stale for the app; the behavior lives in `packages/wallet-core/src/storage/entity_storage.ts:61-82`, re-exported by `apps/extension/src/wallet/storage/index.ts:1-9`.

**Plan Correctness**
- P1’s rework does resolve v1’s rejected `tx.profileId` trust hole, and removing the chainId-only tx subscriber is directionally correct for the over-wipe (`transaction/service.ts:60`, `:79`; `account/service.ts:56-63`). But Phase 1 must add an integration test through real `AccountService`/`NetworkService`/`TransactionService`, plus a hostile foreign-account tx test or an explicit provenance filter.
- P3’s `(chainId, contract)` key is correct for same-contract cross-network balances because balances lack `chainId` (`token-balance/spec.ts:11-18`) and `Token` has it (`token/spec.ts:11-17`). Add an ambiguity guard for duplicate old `(chainId, contract)` rows rather than last-wins.
- Validation nit: `e2e:agent` exists, but the gate should pass the concrete file path, e.g. `bun run e2e:agent tests/e2e/network/backup-restore-integrity.test.ts`; the runner forwards args to vitest (`agent.sh:156`, README `:18-20`).
---

## v3 confirmation (resume) — verdict: conditional approve → conditions met this revision

conditional approve (conditions: remove the stale contradictory P1/P2 text, and pin the filters/remaps to successful restored rows only)

The v3 mechanisms close the two HIGH findings if implemented as described:

- P1 is closed if the tx allow-set is built from successfully imported accounts only, e.g. `newAccounts.filter(a => !a.restoreError).map(a => a.address)`, and foreign/unknown tx drops are recorded even when filtering before `transactionService.restore`. That blocks cross-profile tx injection and makes removal of the chain subscriber defensible.
- P2 index-pairing closes the failed-A/valid-B same-`name+chainId` graft. `NetworkService.restore` preserves one result per input in order, so `newNetworks[i]` ↔ `data.network[i]` is the right pairing. Remap only when `newNetworks[i]` is successful.
- P3 duplicate `(chainId, contract)` skip-and-record closes the last-wins ambiguity.

What still blocks approval is internal plan contradiction:

- `plan.md:75` still says foreign-account txs are inert and unchanged. That directly contradicts the new P1 fix and must be deleted/replaced.
- `plan.md:93-94` still carry the old false Inferences: orphan txs are inert and network matching can use `name+chainId`. These must be updated or removed.
- `plan.md:72` still lists duplicate in-backup network ids as the crafted P2 case, despite `plan.md:85` correctly saying normalization rejects duplicate root ids.
- `plan.md:64` still says fixtures should expect a network-match fallback to `name+chainId`; P2 now explicitly abandons field matching.

After those stale sections are scrubbed and the “successful restored rows only” detail is explicit, I’d approve v3.