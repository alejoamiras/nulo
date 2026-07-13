Verdict: reject: Phase 8 still cannot take the promised complete lock-free snapshot; PXE profile deletion is not fully coordinated; malformed tombstones fail open; and P2 trusts an attacker-controlled endpoint.

### Remaining holes

- `plan.md:80`; `account/service.ts:66-69`; `network/service.ts:228-234` — the cited Phase-1 APIs do not exist. `getAccounts(profileId, *)` requires a concrete `chainId`, while `getNetworks()` calls `requireActiveProfile()`, re-entering the ProfileService lock. Trigger: delete a profile containing an account on a network-less chain. Either deadlock while snapshotting or omit its address/network, leaving tx/auth/PXE state. Phase 8 must add explicit lock-free `getAccountsRaw(profileId)` and `getNetworksRaw(profileId)` APIs and test network-less snapshots.

- `packages/aztec-runtime/src/pxe/service.ts:186,522-543`; `plan.md:12,80-82` — v2 counts only seven destructive `onProfileDeleted` consumers, missing the offscreen PXE subscriber. The Phase-1 emit can race the coordinator and its handler still performs unawaited prefix deletion. Removing it also loses its only profile-wide prefix sweep: per-network `purgeChain` cannot erase an orphan/codec-hidden PXE DB lacking a network row. Phases 7–8 must explicitly remove this subscription and replace it with an awaited, failure-propagating `clearProfileState(profileId)` that scans the DB prefix and applies the shared-keyval policy.

- `entity_storage.ts:61-73`; `plan.md:31,79,82` — D11 only fails closed for schema-invalid JSON. Syntax-invalid tombstones are automatically removed by `decodeRow`; after resume calls `getValues()`, `getKeys()` stops reserving the ID. Trigger: truncated/corrupt tombstone → deletion payload lost → ID reuse/successor-clobber. Phase 8 needs a tombstone store whose decode never auto-deletes, or raw/non-dropping enumeration.

- `transaction/spec.ts:174`; `transaction/service.ts:209-211`; `network/service.ts:535-540`; `plan.md:46` — `submittedEndpointUrl` is backup-controlled, merely `string`, and `getNodeForUrl` dials it directly. Supplying any value bypasses P2’s missing-endpoint rejection. Phase 2/3 must either reject all restored pending transactions or normalize/allowlist the URL and require exact membership in a successfully restored network for that profile and chain.

- `plan.md:23,52`; `token-balance/service.ts:277-289` — D3 promises token ownership verification, but Phase 3 specifies only account provenance. A direct restore can pair an imported account with another profile’s token ID. Require token ownership and token-chain/account-chain equality at the TokenBalance boundary.

### Mis-folded / new

H4 and D11 are mis-folded as above. Omitting the eighth PXE subscriber/profile-wide replacement is the consolidation’s new hole.

Dropping `RestoreResult<T>` is acceptable for finding H, provided every success writes **and returns** parsed/canonical data, never the raw input carrying `restoreError`. No discriminated union is security-required.

D6’s last-started coordinator topology is viable, D12/D13 and H5 are stated correctly, and P4/P5 are complete only if **all** roots sharing a duplicated source ID are rejected and every dependent row is dropped. One PR remains coherent and necessary.