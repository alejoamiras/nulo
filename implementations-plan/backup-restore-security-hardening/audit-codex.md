Verdict: reject — Phase 8 is neither complete nor crash-consistent, D3 is contradicted by its implementation phases, and retaining deletion backstops preserves an active cross-profile destruction path.

### 1. Contradictions found

- D3 says service restore boundaries are authoritative. Phases 1–3 only schema-parse `transaction`, `auth-registry`, and `token-balance`; provenance remains a composable filter. Any direct restore caller can still graft foreign-account rows. Services must accept the restored profile ID and verify account/token/network ownership themselves.
- Phase 8 calls `onProfileDeleted` “UI notify only” while D7 explicitly retains its destructive subscribers. Those statements cannot both be true.
- P7 makes `purgeChain` fail critically, but retained `NetworkService.onProfileDeleted` catches that failure and deletes the network row anyway. Resume then lacks the coordinates required to retry PXE erasure.
- D8 persists only addresses/token IDs, silently dropping the codex leg’s network snapshot. Combined with the retained network handler, this can permanently lose the failed PXE target.
- The goal says an account is bound to “the chain it was created on,” but P3 never verifies that `Account.chainId` belongs to a successfully restored network.
- `RestoreResult` itself is compatible with index filtering only if every restore returns exactly one ordered result and consumers use `ok.row`. The plan should state and test this invariant. Its failure branch also drops the input needed for useful diagnostics.
- P4/P5 maps are ambiguous for duplicate attacker-controlled source IDs. Two old networks with the same ID cannot fit an `old→new Map`; likewise duplicate old token IDs make balances unattributable. Reject duplicate source IDs or drop all dependent rows for an ambiguous ID.

### 2. D4 / D6 / D7

- D4 — include derive-verification in this PR. The phantom is not inert. After activation, `IncomingTransferService.hydrateSchedulers` starts PXE polling for every visible account; token-balance projection issues calls scoped to it; restored pending transactions poll attacker-selected hashes; UI/dApp lookup treats the row as an account until signing finally fails. Verification must occur before `onActiveProfileChanged`. Introduce a silent pre-activation validation stage, or retain the pending secret long enough for `AccountService.restore` to derive-check. A sweep after normal `finalizeRestore` is already too late unless activation side effects are gated.
- D6 — use a separate `ProfileDeletionCoordinator`. The dependency direction is Profile → account/token/network/etc. → coordinator. Making ProfileService own all later services creates a conceptual startup cycle and leaves no clean post-`services.start()` resume hook. Start the coordinator last via declared dependencies and attach a narrow deletion delegate to ProfileService; never have ProfileService depend on it topologically.
- D7 — remove destructive backstops. They are harmful, not redundant. They race the awaited sequence, double-emit non-idempotent events, delete snapshot sources, and can turn critical failures into false success. Most seriously, the retained PXE `onProfileDeleted` handler deletes `keyval-store` regardless of surviving profiles—direct cross-profile destruction. Keep events only for notification/cache invalidation after successful deletion.

### 3. Security holes and required phase changes

- P8 omits awaited cleanup for contacts, dApp sessions, orphan accounts/tokens/FPCs, and profile-scoped journal rows. Network traversal only removes children having a surviving network. Add explicit `clearProfile` methods for every profile-bearing root and include them in the coordinator.
- P1 validates only selected services. Malformed contact/FPC rows can still become codec-hidden; deletion’s `getValues()` will never see them, leaving private data indefinitely. Validate every persistent restore writer before write.
- P3 needs an AccountService-wide lock. Two concurrent imports can both pass the global address collision check and then overwrite the shared address-keyed account row.
- Tombstone crash matrix fails:
  - Crash after tombstone write but before profile-row deletion leaves a visible/unlockable tombstoned profile because P8 gates only restore/ID allocation.
  - Partial cleanup plus retained network backstop can delete the network row after PXE failure; resume cannot retry it.
  - Invalid tombstones are hidden by `EntityStorage` decoding, permitting ID reuse unless raw key presence fails closed.
  - After cleanup but before tombstone clear, rerun is safe only with one idempotent coordinator—not concurrent event cascades.
- Keep the profile row hidden/reserved until cleanup succeeds. Gate `getProfiles`, unlock, finalize, creation, and every mutation on tombstone state; then delete row and tombstone under the facade lock.
- The facade lock does not fence already-running execution. Token metadata fetches, transaction polling, or approved execution can commit after purge. Service locks merely serialize this race. Every commit must re-check a deletion epoch/tombstone or live ownership after acquiring its lock; execution lanes must be cancelled/drained.
- P7 must also fix the shared `keyval-store` policy and standalone network-deletion crash consistency, not just IndexedDB callbacks.

These remain one coherent PR; splitting would leave exploitable intermediate states. The entropy regressions are D7’s duplicate cascade and P4/P5’s ambiguous-ID maps.

### 4. Unsafe assumptions

- “Phantom is inert” is false.
- “Account-state carries no forgeable account field” is misleading: it carries arbitrary sender addresses and contract instance/artifact data and uses unsafe address parsing.
- “Token restore is ordered one-result-per-input” is true today, but not an enforced contract and does not solve duplicate old IDs.
- “Backstops are correctness-equivalent” is decisively false.
- “Corrupt tombstone must not brick creation” is unsafe if implemented fail-open; quarantine its ID and surface deletion-pending instead.
- “Chain-distinct addresses justify address-only authorization” depends on derive-verification—the very invariant D4 defers.