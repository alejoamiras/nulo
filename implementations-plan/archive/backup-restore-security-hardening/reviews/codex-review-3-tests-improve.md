Coverage gaps: pre-existing foreign-account provenance, 3+ network pairing, legitimate unchanged-ID no-op, schema-real integration, and fail-on-missing-sandbox e2e.

### (a) Regression-test pin verdicts

1. **Pins.** `useFullBackupImport.test.ts:563` deliberately returns `newProfile.id === profile.id` while the network row carries `victim-profile-id`. Under the old guard, remapping is skipped and `networkClient.restore` receives the victim ID, so the assertion at line 598 fails. This genuinely exercises the guarded path.

2. **Pins.** `useFullBackupImport.test.ts:667` makes token 2 fail while token 1 succeeds with the same contract. The old new-side-only map resolves token 2’s balance to `n1`, so `restore([])` fails; the token-balance log would also be absent. Tight enough to pin the fix, although asserting the dropped row’s ID/message would be stronger than length alone.

3. **Pins.** `useFullBackupImport.test.ts:699` creates both events on the same `token-balance` key: row 10 is dropped before restore, row 11 returns a restore error afterward. Reverting append-to-assignment leaves only row 11, so length is 1 rather than 2. Improve it to assert both IDs and both diagnostic messages; length 2 could theoretically pass through duplicate entries.

### (b) Missing coverage worth adding

- **Exact provenance exploit:** seed existing victim account `V`; import only account `A`; include txs for both. Assert only `A` reaches transaction restore and raw storage never contains `V`. Current unit test merely uses an unknown address, while the e2e imports into a fresh extension. Neither distinguishes the fix from a weaker “allow any address existing globally” implementation.

- **Chain provenance:** import `(chain 1, address A)` and supply a tx `(chain 2, address A)`. It currently passes because the allow-set uses address only (`useFullBackupImport.ts:441-455`).

- **3+ index matrix:** four inputs: changed-success, failed, unchanged-success, changed-success, with ambiguous duplicate display fields. Assert child network IDs become `[M1, N2, N3, M4]` and `createdNetworks` contains exactly results 1/3/4. Existing coverage is only two networks.

- **Legitimate unchanged profile:** root ID `P`, every child already owned by `P`, restore returns `P`; assert all slices remain semantically identical and import finishes.

- **Schema-real service integration:** current token fixtures omit required `profileId/name/symbol/decimals`, and balances omit `updatedAt` (`useFullBackupImport.test.ts:608-615, 672-677`). Mocks make the transformation tests valid, but prove nothing about rows surviving #220 codecs. Add one real-service/raw-storage test using complete `TokenSchema` and `TokenBalanceRawSchema` rows, with positive reads after restore.

- **E2e sandbox contract:** `backup-restore-integrity.test.ts:38` is itself guarded by `skipIf(!hasConfig)`, so absence skips both tests and passes. Make the contract test unconditional in the required CI project. The actual security assertion correctly uses raw storage at lines 97-107, not UI.

- Replace the “single-network delete” test at `cross-profile-isolation.test.ts:409` with a real `NetworkService.deleteNetwork` call; it currently repeats the exact same manually invoked subscriber loop as the preceding test.

### (c) Concrete code improvements

- **Simplify token relinking radically:** `useFullBackupImport.ts:502-550` is over-engineered. `TokenService.restore`/`restoreRows` guarantees one ordered result per input. Pair old/new tokens by index and map old ID directly to successful new ID. That removes semantic-key ambiguity and avoids dropping a successful token’s balance merely because a duplicate token failed. Also correct IDs from `string` to `number`.

- At `useFullBackupImport.ts:441-455`, authorize transactions by `(chainId,address)`, not address alone. Reuse that successful-account set to reject token balances for foreign accounts/chains.

- At `useFullBackupImport.ts:389-423`, assert arrays and equal input/result cardinality before index pairing; use actual `Network`/`Restored<Network>` types instead of stale `rpcUrl` and `chainId: string`.

- Split `remapIdInBackupData` (`full-backup-helpers.ts:103`) into explicitly named `normalizeAllIds` and `remapMatchingId(oldId,newId)`. The optional argument changes semantics and the current `newId, oldId` order is a maintenance footgun.

- Validate rows before persistence in `account/service.ts:227`, `token/service.ts:558`, `transaction/service.ts:303`, and `token-balance/service.ts:277`. Parse with each service schema inside the per-row error capture; otherwise malformed attacker rows are written successfully and become codec-hidden on subsequent reads.