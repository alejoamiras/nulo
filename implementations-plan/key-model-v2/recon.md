# Recon — key-model-v2

Phase 0.4 consolidated findings from four parallel read-only recon agents plus a parent gap-closure sweep. Base: `dev` at worktree creation. Feeds the plan draft and every audit — auditors: check the design against this map (does it duplicate or ignore what recon found reusable?).

## 1. Ground truth — the current derivation chain

```
mnemonic words ──getEntropy()──► raw 32B entropy ═══════════════╗  packages/wallet-core/src/utils/mnemonic.ts
                                                                ║  NO PBKDF2 — entropy IS the master, verbatim
Fr.random() (createProfile) ────────────────────────────────────╣  apps/extension/src/wallet/services/profile/service.ts:285
WebAuthn PRF ──HKDF-SHA256──► passkey master ───────────────────╝  packages/wallet-crypto/src/passkey-credential.ts:68-85
                                                                ▼
                                          master: MasterSecretBytes (32B), sealed via PasswordSecretBox
                                                                │
     AccountService.deriveAccountSecret          apps/extension/src/wallet/services/account/service.ts:290-296
                seed = poseidon2Hash([master, chainId, type, index])
                       chainId = Network.chainId = (l1ChainId ^ rollupVersion) >>> 0   (0 for local)
                                                                │
     deriveNuloAccountKeys(seed)                 packages/wallet-crypto/src/account-derivation.ts:29-38
                signingKey = sha512ToGrumpkinScalar([seed, DomainSeparator.IVSK_M])
                secretKey  = deriveSecretKeyFromSigningKey(signingKey)      (upstream, one-way)
                                                                │
     NuloAccount.new(seed)                       packages/aztec-runtime/src/account/nulo-account.ts:60-79
                deriveKeys(secretKey) → frozen artifact + descriptor → address
```

Two distinct KDF layers. The plan's changes (PBKDF2 mnemonic→master; l1ChainId + domain tag in master→seed; new seed→signingKey separator) hit layers the existing frozen KATs **do not pin** — see §4.

## 2. Reuse map

### Reuse as-is
- `SecretRevealCard.vue`, `SecretUnlockSection.vue`, `SecretExportLayout.vue`, `SecretCountdownClose.vue`, `useSecretClipboardCopy.ts`, `useSecretCountdown.ts` — shared export-page machinery; `export/seed.vue`'s usage is the template.
- `exportMnemonic`/`importMnemonic` service+client+spec entries (profile/service.ts:1240-1286 / 1101-1107) — become the sole wallet-level secret surface (internals change, wiring stays).
- `SessionManager` (session-manager.ts) — origin-agnostic over the 32B master; `open()` at :226 and `restore()` at :463 call `Fr.fromBuffer`; zero changes needed if callers keep handing it the derived master.
- `PasswordSecretBox` / `EncryptionKey` (packages/wallet-crypto) — seal/unseal any 32B buffer; PBKDF2-SHA256/600k + AES-GCM already runs in the MV3 **service worker** via `self.crypto.subtle` (encryption-key.ts:15-31), so PBKDF2-**SHA512** `deriveBits` is a drop-in sibling — no new dependency, no offscreen round-trip. (ARCHITECTURE.md's "offscreen owns key derivation" row is stale; SW is where this runs today.)
- `PasskeyCredential` chain — fully independent (different KDF, IKM, labels); `Fr.fromBufferReduce` at passkey-credential.ts:75 is the established idiom for wide-KDF-output→field reduction.
- `zeroize` conventions — caller owns + zeroes in `finally`; callee copies (Fr.fromBuffer copies).
- Account-integrity coordinator **already skips non-`Nulo_v1` types by design** (coordinator.ts:146-151, comment anticipates a future type; both boot-rehydrate and unlock paths funnel through it). `accountSetDigest` (types.ts:20-22) is type-generic.
- `instantiation-descriptor.ts` (`frozenConstructorArgs` etc.) is a pure function of the signing **public** key — reusable unmodified for imported accounts. `address-freeze.ts` regime + frozen artifact: same artifact validates imported accounts (Nulo-format-only import ⇒ same contract shape).
- `NuloAccount` private ctor (nulo-account.ts:46-58) already takes `secretKey + instance + completeAddress + SchnorrAccountContract` — structurally ready for a `fromSigningKey` factory; only `new()`'s top (seed→keys) needs splitting.
- Full-backup envelope idioms: `compat-epoch` hard-reject + `backup-schema-version` (backup-migration-registry.ts:54-69), checksum = integrity-not-auth framing, `IMPORT_BLOCKING_ACK` pattern (footprint-coverage.test.ts:27-30).
- Branded secret types + single mint functions (secret-types.ts) — new export/import flows must mint their own brands.
- UI patterns: `NewAccountPopup.vue` (add-account), `EditAccountPopup.vue` + `cacheStore.accountToEditIdx` convention (per-account action popup), Manage Accounts row icons (settings/accounts/index.vue:79-142) — Export Account slots in as a 4th icon; Import Account as a sibling popup entry.

### Adapt with changes
- `mnemonic.ts` — keep the pure entropy↔words codec; ADD the PBKDF2 step as a new function (house it in `packages/wallet-crypto` next to passkey-credential.ts, keeping wallet-core pure word-math — matches the wallet-core→wallet-crypto layer boundary). **Verify during implementation whether `getEntropy` enforces the checksum on decode** (test file verifies round-trips; rejection path unconfirmed).
- `account-derivation.ts` — new dedicated separator replaces the borrowed `DomainSeparator.IVSK_M` (decision D3 in plan).
- `AccountService.deriveAccountSecret` + `createAccountInternal` + `getAccountContract` — new seed formula; `getAccountContract`'s hard `"unknown account type"` throw (service.ts:236-238) becomes a branch (derived vs imported), NOT a loosened guard.
- `ProfileService.createProfile` — becomes entropy-originated (today it's `Fr.random()` with **no mnemonic involvement**; words are re-encoded on demand only in `exportMnemonic`). `importMnemonic` gains validation + PBKDF2. `exportMnemonic` reads stored entropy.
- `Profile` row (profile/spec.ts:27-44) — gains a sealed-entropy field alongside guard/secret.
- `export/index.vue`, `security/index.vue:203`, `ImportMethodPicker.vue`, `ImportSecretForm.vue`, `useProfileImportFlow.ts`, both `import.vue` shells — cut plain-key (and pending ratification, encrypted-key) branches; copy renames. No i18n layer exists — copy is inline per-SFC find-and-replace.
- `frozen-account-canary.test.ts` (~:119-123) — hand-recomputes the seed formula test-side (`poseidon2Hash([master, Fr(0), Fr(0), Fr(index)])`); must be updated in lockstep AND its master-capture path reworked (it uses `revealSecretKey(popup, TEST_PASSWORD, "plain")`, a UI the plan deletes — switch capture to the full-backup JSON `master-key`/entropy fields).
- e2e helpers: `import-drivers.ts:96-108` (`importPlainKey`), `fixtures/helpers.ts:1570-1595` (`revealSecretKey`) — retire/narrow.

## 3. Hard constraints & asymmetries the naive plan would get wrong

1. **`exportPlain` is NOT deletable.** `export/full.vue:126` calls it to populate the backup's `master-key` field, and the passkey branch returns `credentialId` (spec.ts:244-258; exercised by passkey-backup tests + service.integration.test.ts:325-443). The cut is **UI-only** (delete `export/key.vue` + nav row); the service method stays internal.
2. **`importPlain` IS deletable end-to-end** — single caller `useProfileImportFlow.ts:159`; full-backup import never touches it (useFullBackupImport.ts builds `RestoreSecret` from `master-key` directly and calls `restore()`).
3. **`l1ChainId` is not stored anywhere.** `NetworkService._getChainId()` (network/service.ts:833-844) XORs and discards the raw value; `NetworkRowSchema` keeps only the composite. XOR is not invertible. Options: (a) persist `l1ChainId` on the Network row (general; pre-prod schema change is licensed), (b) preset reverse-lookup table (breaks for custom networks), (c) live re-probe at account creation (makes creation network-dependent). Recon recommends (a).
4. **Keep the composite as the storage-scoping key.** `Account.chainId`, `accountRowId`, purge fan-out (`chainPurgeSubscribers`), the AztecNode cache map, endpoint-mismatch checks all key on the composite — re-keying them ripples far outside scope. Pass `l1ChainId` **only** into the seed formula.
5. **Master-secret change transitively rotates** `derivePxeStoreKey` (pxe-store-key.ts:29-34 — existing PXE stores become undecryptable; pre-prod reset, document it) and `deriveDappSessionMacKey` (self-heals).
6. **`exportPlain`/backup `master-key` semantics must remain "the derived master"** — never entropy. `restore()`'s password branch (service.ts:1421-1497) seals the field verbatim as the master; conflation corrupts every restore.
7. **Store-both (sealed entropy + sealed master)** beats derive-on-unlock: unlock already pays PBKDF2-600k once (unlockProfile's 3-phase split exists precisely for that cost, service.ts:317-389), and `SessionManager.restore()`'s silent bearer path structurally cannot re-run a mnemonic KDF. Cost: one paired-fields invariant to test.
8. **Imported accounts need a new storage root** for their signing key (the Account row never carried secret material). That root must get an explicit `BACKUP_SLICE_REGISTRY` decision — unregistered roots are rejected by `normalizeBackupData` (backup-migration-registry.ts:250-254), and an unregistered-but-emitting service silently restores rows that cannot sign.
9. **Imported-account integrity is nobody's job unless the plan assigns it.** The coordinator skips non-derived types; `getAccountContract`'s import branch must itself recompute the address from the loaded signing key + frozen descriptor and fail closed on mismatch (mirror `raiseRuntimeMismatch`, service.ts:287).
10. **`ensureDefaultAccount` (service.ts:139-148) picks lowest index across ALL types** — exclude imported accounts from the default-account candidate pool (explicit decision).
11. **Index math is per-type** (service.ts:152) — a new `AccountType` value gets its own sequence; no collision. `AccountType.Nulo_v1 = 0` numeric is consensus-critical and untouched.

## 4. Vector/KAT/fixture blast radius — the counterintuitive part

**The three existing frozen KATs need ZERO edits** — they all start from an arbitrary literal `seed: Fr` and pin `seed → signingKey/secretKey/address`:
- `packages/aztec-runtime/src/account/derivation-vectors.test.ts` (+ `implementations-plan/aztec-5.0.0-stable/reference/regime-b/vectors.json`, generated from published npm 5.0.1 tarballs)
- `packages/wallet-crypto/src/account-derivation.test.ts`
- `apps/extension/src/wallet/crypto/key-vectors.test.ts` (V7a; V1-V11/P1 pin unrelated primitives)

…**unless the plan changes the seed→signingKey separator** (D3): that invalidates the seed→signingKey half and requires regenerating regime-b-style reference vectors from a re-parameterized generator script (same independent posture: `reference/regime-b/derive-vectors.ts` re-run with the new constant, never generated from the wallet's own helper).

**What does NOT exist and must be created:** a KAT for the account-seed formula `poseidon2Hash([...])` itself — nothing in the tree pins it today (key-vectors V9 only pins the `AccountType.Nulo_v1 === 0` literal). Add a vectors JSON + independent generator: fixed `(master, chain-input, type, index)` → seed, plus one full-chain vector (words → entropy → master → seed → address).

**`address-freeze.ts` has no mechanical tripwire for KDF changes**: the `kdf` field is a bare label, not a digest — the "ack embeds digests" test covers `artifactSha256`/`classId`/`descriptorDigest` but NOT `kdf`. This plan's changes would not red any freeze test unless the label is hand-bumped. Plan should add a `kdfDigest` (hash of a canonical formula spec, mirroring `descriptorDigest`) and thread it into the ack. Policy collision to resolve explicitly: the module's append-only rule vs pre-production baseline redefinition (CLAUDE.md licenses the latter for storage; the freeze test makes in-place edits loud by design). Nothing has shipped — in-place redefinition in one reviewed commit is defensible but must be a stated decision.

**Test/fixture sweep results (gap closed by parent `rg` pass):** no hardcoded mnemonics (BIP-39 word hits are the English word "abandoned"), no hardcoded 60+-hex derived addresses anywhere in `apps/extension/tests/` or unit tests. House style is dynamic profile creation + read-back assertions. The only formula-coupled test is `frozen-account-canary.test.ts` (§2). Unit `account/service.test.ts` uses fake addresses via `FakeBrowserApi`.

**Tests that break on the product cuts** (all mapped, per-file): `useProfileImportFlow.test.ts:60-70,133-144,192-205`; `ImportSecretForm.test.ts:42-46,55-68,91-98`; `service.integration.test.ts:631-637` (swap its strict-mode probe to another method — redundant coverage exists at :600-618); e2e `security-backup.test.ts:34-46` (+ :48-62 iff encrypted-key surface is cut), `import-paths.test.ts:37-50,88-140` (+ encrypted legs), `onboarding-import.test.ts:28-41` (+ encrypted leg). NOT affected: `backup-roundtrip.test.ts`, `passkey-backup.test.ts`, `passkey-paths.test.ts`, seed-phrase legs everywhere.

## 5. Open scope question surfaced by recon (→ approval gate)

The "Encrypted Key" surface (`exportEncrypted` — the profile-row GUARD+secret ciphertext pair — and its `importEncrypted`/`public_key` import counterpart) is a **third mechanism**, distinct from both the plain Secret Key and the Full Backup. The owner's "keep only recovery phrase + encrypted backup" is ambiguous about it. Recommendation: cut it together with the Secret Key page (it is redundant with Full Backup, and its ciphertext's semantics get murkier once the profile row carries entropy+master). Affects whether `export/key.vue` is deleted wholesale (recommended) or half-kept, plus the encrypted legs of 4 test files (§4).

## 6. Chain-identity constants

`apps/extension/src/utils/chain-ids.ts` pins `MAINNET_L1_CHAIN_ID = 1`, `TESTNET: 1816023401` (L1/rollup pair only in a comment — promote to named exports if needed). The faucet independently pins the same pair in `apps/faucet/src/lib/chain-constants.ts` (release chain-guard single-sources it) — keep in sync if constants move; the faucet does not derive wallet accounts, so it is otherwise out of scope. `assertLiveChainIdentity`/`chainInfoFrom` (packages/aztec-runtime/src/utils/chain-identity.ts) already keep the pair split for protocol-level replay binding; the composite-only drift check is a known limitation noted in the plan's security section.
