Verdict: **not safe to implement as written**. I did **not** find dApp reachability for raw `getToken/deleteToken`, but the plan still under-tests a privacy boundary and misses at least one current cross-profile leak.

**BLOCKER**
- `TokenBalanceService.backup()` is a real backup/export leak: it requires an active profile, then returns `repo.getAll()` unfiltered. See [service.ts](/Users/alejoamiras/Projects/nulo/nulo-1/apps/extension/src/wallet/services/token-balance/service.ts:259). Since token balances have no `profileId`, backup must filter transitively through active-profile tokens/accounts. The plan’s gate does not test backup/export isolation.

**HIGH**
- Token by-id is not dApp-reachable from what I can prove. dApp path is `handleWalletMessage` → `WalletSdkDispatcher.dispatch`; unsupported methods are rejected, and the only token reader hook is scoped `isTokenRegistered` via `getTokens(profileId, chainId)`. See [background.ts](/Users/alejoamiras/Projects/nulo/nulo-1/apps/extension/src/wallet/services/wallet-sdk/background.ts:95) and [dispatcher.ts](/Users/alejoamiras/Projects/nulo/nulo-1/packages/wallet-bridge/src/dispatcher.ts:293). But `getToken`, `deleteToken`, `getTokenInterface` are still extension Port RPCs and id-enumerable. Leaving them open is defensible only as an explicit non-fix, not as “isolation invariant satisfied.”
- Auth-registry is misstated: there is no by-id getter, but `revokeAuthwits(account, ids)` fetches each id without checking `authwit.account === account`, then uses those rows in a revoke tx. See [service.ts](/Users/alejoamiras/Projects/nulo/nulo-1/apps/extension/src/wallet/services/auth-registry/service.ts:185). That needs a characterization/owner decision too.
- The “single cross-profile isolation test” is not a sufficient gate. It must cover backup/export, real `ProfileService.deleteProfile()` event fanout, inactive-profile deletion, `NetworkService.purgeChain` subscriber failures/order, FK-scoped token-balance/auth-registry behavior, and the full `useFullBackupImport` restore order.

**MEDIUM**
- Phasing hides cascade coupling. Network purge assumes subscriber order: transaction, token, fpc, account, journal. See [network/service.ts](/Users/alejoamiras/Projects/nulo/nulo-1/apps/extension/src/wallet/services/network/service.ts:577). Many services register during startup, not through an explicit dependency-ordered cascade registry, so per-service PRs can look green while lifecycle cleanup drifts.
- “No base class because two stores lack `profileId`” is overstated. A repository/policy class with explicit `profileId` args plus an owner resolver could handle direct and FK-scoped rows. Free functions are fine, but the plan’s impossibility claim is too strong.
- `auth-registry max(getValues().id)+1 === nextNumericId(getKeys())` is only true when storage key equals row id. Gaps are fine; malformed/non-numeric or key/value-divergent rows are not.

**LOW**
- Keeping account out of `restoreRows` is reasonable because duplicate-address precheck is whole-batch. It could still share a lower-level per-row writer helper after the precheck, but not required.

**Sound**
- DApp raw token reachability appears correctly ruled out.
- Preserving restore order in `useFullBackupImport` is correctly called out.
- The active-profile vs caller-profile distinction is real and important.
- `purgeRows` extraction is a good boundary if cascade tests pin its ordering.