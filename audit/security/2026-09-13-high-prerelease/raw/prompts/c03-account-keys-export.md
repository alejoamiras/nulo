You are a Phase 2 cluster auditor in a map-reduce security audit. Working directory is the repo root (a git worktree of origin/dev). READ FIRST, in this order: `audit/security/2026-09-13-high-prerelease/raw/CONTEXT.md`, then `audit/security/2026-09-13-high-prerelease/raw/SECURITY-PROMPT.md` (the exact audit prompt + negative list + output format — follow it exactly), then the repo-map files named below for orientation. Then read the cluster source files IN FULL (not excerpts). Verify every claim against the code; cite file:line. Do not modify any file except your output file.

# Cluster c03-account-keys-export — account derivation wiring, imported keys, account export/import, address freeze

Repo maps: `raw/repo-map/extension-services-secrets.md`, `raw/repo-map/aztec-runtime.md` (§1 account/, §3 secrets, §8), `raw/repo-map/wallet-crypto.md`.

Source files (read all, in full):
- `apps/extension/src/wallet/services/account/{service.ts, spec.ts, imported-keys-repository.ts, client.ts}`
- `packages/aztec-runtime/src/account/{nulo-account.ts, frozen-artifact.ts, instantiation-descriptor.ts, address-freeze.ts, account-export.ts, fee-options.ts, index.ts}` + `artifacts/PROVENANCE.md`
- `apps/extension/src/wallet/services/account-integrity/coordinator.ts` (derivation side)
- `apps/extension/src/wallet/services/network/service.ts` lines ~330-400 and ~980-1060 (`assertCanonicalStoredL1`, `resolveVerifiedL1ChainId`, `_probeChainIdentity`), `apps/extension/src/wallet/services/network/spec.ts`
- Popup pages that drive account export/import: `apps/extension/src/popup/pages/settings/security/**` and `apps/extension/src/composables/*account*` / `*export*` / `*import*` (find via grep for `exportAccount`, `importAccount`, `previewImportAccount`)
- Tests: `account/service.test.ts`, `account/import-export.test.ts`, `packages/aztec-runtime/src/account/*.test.ts` (freeze/KAT), `packages/aztec-runtime/src/account/account-export.test.ts`.

Specific questions:
1. `deriveAccountSeed(master, l1ChainId, type, index)`: where does `l1ChainId` come from at (a) account creation, (b) re-derivation for signing, (c) integrity check, (d) import? Can an attacker (lying RPC, tampered Network/Account row, hostile backup) make the wallet derive under a wrong `l1ChainId` and either sign for the wrong chain or silently produce a different address? Is the XOR-composite chainId collision (held HIGH from July) closed at EVERY signing sink now?
2. Imported accounts: `sealImportedSigningKeyV2(dek, chainId, address, key)` binds via HKDF info. Can a sealed key be transplanted across (chainId,address) rows or profiles; what happens on unseal failure (A4 rule); does the import flow verify the supplied key actually derives the claimed address BEFORE persisting?
3. Account export envelope (NULO-ACCOUNT-EXPORT v1): plaintext export carries the signing key; encrypted export via `EncryptionKey.fromPassword`. Is the encrypted form authenticated over ALL fields (AAD coverage: address, chainId, regime)? Can a hostile file substitute a signing key + recompute address+checksum (stated posture) — and does the IMPORT side re-derive the address from the key and refuse a mismatch? What does `previewImportAccount` show the user and can it be spoofed?
4. Address freeze: confirm the descriptor/artifact/regime digests are actually enforced at runtime (not only in tests) on the path that first-deploys an account and on the integrity path. Is there any runtime code path that derives an address WITHOUT going through `NuloAccount`/frozen artifact (grep `getContractInstanceFromInstantiationParams`, `computeContractAddressFromInstance`, `deriveKeys`)?
5. `NuloAccount` payload chunking + authwits: can a chunk boundary change which calls are covered by an authwit or fee payer; `buildTxExecutionRequest` lacks `assertLiveChainIdentity` (documented gap) — trace whether every caller asserts it before reaching this function.
6. What key material does the PXE receive (`registerAccount(secretKey)`), and can the offscreen document (or anything with PXE access) recover the signing key or seed?
7. Cross-profile: can profile A's account row be read/signed with under profile B's session (`require-owned-row`, inline `profileId` checks at every mutate/sign path)?
8. Account row id codec (`parseAccountRowId` byte-canonical round-trip): any way to forge a row whose key parses to a different (profileId,chainId,address) than its body claims?

Write your report to `audit/security/2026-09-13-high-prerelease/raw/c03-account-keys-export-claude.md`.
