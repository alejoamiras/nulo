# key-model-v2 — recovery-phrase-centric key model + NULO-ACCOUNT-KDF v2

**Status:** APPROVED by owner 2026-08-18 (conditional approve — rider: heightened crypto/entropy adversarial protocol during implementation, see Post-implementation §0 and ledger L28). A1: yes · A2: in-place · A3: yes · A4: fail-closed error + delete/re-import (simplest path). Audit trail: codex R1 reject → adopted; fable R1 conditional approve → adopted; final fresh-context codex reject → adopted; resumed re-verdict conditional approve → conditions adopted.
**Tier:** `/blueprint mid` (rubric: security sensitivity HIGH; novelty/blast/irreversibility/migration/external-coupling low-med — pre-production, no users, no migrations).
**eli5_mode:** Artifact (URL recorded in § Seeds once published; source `eli5.html` in this dir).
**Worktree/branch:** `key-model-v2` / `worktree-key-model-v2`. Recon: [recon.md](recon.md) (see its post-audit Corrections section). Audits: [audit-codex.md](audit-codex.md), [audit-fable.md](audit-fable.md).

## Summary

Pre-production window, one coordinated break. Two halves:

1. **Product model** — make the export taxonomy match the key hierarchy. Wallet level: the 24-word **Recovery Phrase** becomes the only secret export (plain "Secret Key" export + import deleted; Full Backup untouched). Account level: new **Export Account / Import Account** (Nulo-format JSON, encrypted + plaintext variants) for the per-account ownership key — the thing EVM users expect "private key" to mean.
2. **NULO-ACCOUNT-KDF v2** — adopt the real BIP-39 PBKDF2 step (empty passphrase default), derive the account seed from `l1ChainId` (not the XOR composite) under a dedicated Nulo domain tag, replace the borrowed `IVSK_M` separator in seed→signingKey with a Nulo constant, and validate mnemonic imports at the service boundary. Every derived address changes; this is the deliberate, licensed, one-time pre-launch baseline redefinition.

Non-goals: passphrase ("25th word") UI (KDF supports it with `""` default; adding UI later is non-breaking), foreign-account import (non-Nulo artifacts), BIP-32/SLIP-0010 (rejected — ledger L9), storage migrations (pre-production: none), faucet/landing changes, redesign of the composite drift check.

## Success criteria

- A fresh profile is entropy-originated; its 24 words re-display from stored entropy; the same words re-import to the same accounts (KAT-pinned end-to-end: words → entropy → master → seed → address).
- Wallet-level UI offers exactly: Recovery Phrase, Full Backup. No plain/encrypted Secret Key export or import surfaces remain.
- An account exported on build A imports on build B (same regime) and **signs a live transaction** (P6 network leg); a tampered **encrypted** export, a non-self-consistent plaintext mutation, a tampered stored key, or a doctored backup fails closed at the right blast radius (a self-consistent hostile plaintext file is caught by the import UI's mandatory address confirmation, not by cryptography — §E).
- All gates green: `bun run audit:vue`, `bun run test:e2e`, `bun run e2e:agent` (including the updated frozen-account canary and profile-reimport matrix, prover-ON).

---

## Architecture & Implementation

### A. NULO-ACCOUNT-KDF v2 (the crypto spine)

```
entropy (32B CSPRNG) ⇄ 24 words                    existing codec, packages/wallet-core/src/utils/mnemonic.ts (unchanged)
seed64  = PBKDF2-HMAC-SHA512(NFKD(canonical(words).join(" ")), "mnemonic" + passphrase(""), 2048, 64B)   [BIP-39 standard]
master  = Fr.fromBufferReduce(seed64)               64-byte input — upstream-endorsed low-skew reduce
account = poseidon2HashWithSeparator([master, l1ChainId, type, index], NULO_ACCOUNT_SEED_SEP)
signing = sha512ToGrumpkinScalar([account, NULO_SIGNING_ROOT_SEP])          (was: DomainSeparator.IVSK_M)
secret  = deriveSecretKeyFromSigningKey(signing)    upstream 5.0.1, one-way — hierarchy unchanged
… deriveKeys(secret) → frozen artifact/descriptor → address                 (all unchanged)
```

- **One shared pure function** `deriveAccountSeed(master, l1ChainId, type, index)` (wallet-crypto) is the ONLY implementation of the account-seed formula, consumed by `AccountService` AND the integrity coordinator (which today duplicates the v1 formula in its `DeriveAddress` default, coordinator.ts:52-56, constructed in production WITHOUT an override — audit H1). The canary test keeps its deliberately independent hand-rolled recompute.
- **Constants**: `NULO_ACCOUNT_SEED_SEP` and `NULO_SIGNING_ROOT_SEP` are u32s = first 4 bytes (BE) of `sha256("nulo:account-seed:v2")` / `sha256("nulo:signing-root:v2")` — reproducible provenance, values pinned in KATs. A unit test asserts non-collision against **both** upstream separator spaces — `DomainSeparator` (sha512 context) and `GeneratorIndex` (poseidon context) — plus mutual distinctness of the two Nulo constants (audit L1).
- **Mnemonic canonicalization contract** (audit L6): one exported normalizer (trim, lowercase, collapse whitespace, NFKD) applied identically by import validation and `deriveBip39Seed` — the same user input can never validate one way and KDF another. `getEntropy` already rejects bad checksums (verified: mnemonic.ts:2150-2157).
- **PBKDF2 home**: new `packages/wallet-crypto/src/mnemonic-master.ts` (`deriveBip39Seed(words, passphrase="")` → 64B via `self.crypto.subtle.deriveBits`; `deriveMasterFromMnemonic(words)` → `MasterSecretBytes`). wallet-core's `mnemonic.ts` stays a pure word codec. WebCrypto PBKDF2 already runs in the MV3 SW (encryption-key.ts:15-31); SHA-512 is a param change, no new dependency. 2048 iterations is the BIP-39 spec constant, not our brute-force defense; at-rest defense stays PBKDF2-SHA256/600k + AES-GCM.
- **KATs**: fresh official BIP-39 (trezor) vectors asserted with passphrase `"TREZOR"` (that is how the official seed column is computed — audit M4; the single seed row currently in mnemonic.test.ts is truncated and unasserted), PLUS Nulo-generated `passphrase=""` vectors for the production path.
- **Entropy accounting (honest version — audit M1/C5, final-codex M4)**: the words encode 256 bits; the master is an `Fr`, so its keyspace is capped at log2(r) ≈ 253.6 bits in ANY design (Outline B included) — the mod-r reduce maps the 2^256 phrase space onto ~2^253.6 masters (mean ≈ 2^256/r ≈ 5.29 phrase-preimages per master; finding any collision is a ~2^253 search). Every subsequent value (poseidon output, Grumpkin scalar) is field-sized (~254 bits). Claim under audit: **effective keyspace ≥ ~253.5 bits at every step; modeling PBKDF2-HMAC-SHA512 as a PRF, the 64-byte reduce carries bias ≤ 2^-258; no step reduces below the field's own security level.** Not claimed: "no narrowing", "256-bit master", or anything unconditional about PBKDF2's internals. The passphrase (currently always `""`) is NFKD-normalized per BIP-39 spec, with a Unicode-passphrase KAT pinning it.
- **Passkey path untouched** (independent HKDF chain). Backlog note (out of scope): passkey-credential.ts:75 reduces a **256-bit** HKDF output — the higher-skew case upstream warns about; impact negligible, but worth aligning to a 64-byte expand at the next passkey-breaking change.
- **Recorded trust-model property (audit M9)**: with standard BIP-39 parameters, a phrase reused from another wallet (MetaMask/BTC) yields the exact `seed64` those ecosystems compute and BIP-32 wallets store — such software could derive Nulo's master with no Nulo secrets. This is the standard BIP-39 model, accepted deliberately; import-screen copy will discourage phrase reuse ("use a phrase generated by Nulo").

### B. Chain identity in derivation

- **`l1ChainId` lives in two places, written once at creation-time each**:
  - `Network` row gains persisted `l1ChainId`. Seeded networks (incl. Local) get it **hardcoded in `DEFAULT_SEEDS`** (mainnet 1, testnet 11155111, local 31337 — pairs already documented in chain-ids.ts) — NEVER probed at seed time; seeding is offline-safe and load-bearing (audit M2, C6). Custom networks: `_getChainId` already calls `getNodeInfo()` on every path (network/service.ts:840-851), so `info.l1ChainId` is captured for free and persisted alongside the composite.
  - **`Account` row gains persisted `l1ChainId`**, copied from the Network row at account creation (audit H1-alternative, adopted): the row becomes self-contained for re-derivation — `deriveAccountSeed(master, row.l1ChainId, row.type, row.index)` — which (a) lets the pre-session-open integrity coordinator re-derive without any NetworkService/session dependency, (b) deletes the injected-lookup abstraction from both call sites, and (c) fails closed under tampering exactly like a tampered `index` (a wrong `l1ChainId` re-derives a wrong address → mismatch → block).
- The XOR composite **stays** as the storage-scoping key everywhere (`Account.chainId`, `accountRowId`, purge fan-out, node cache, drift check) — recon §3.4.
- **Fail-closed on absence**: an Account row missing `l1ChainId`, or a non-canonical value (negative, non-integer, > 2^32-1), is an integrity error — never a silent 0 default (a 0 default would collapse the chain separation v2 exists to create).
- **End-to-end binding hardening (final-codex High-3 + re-verdict C-ii)**: endpoint add/update asserts **exact `l1ChainId` equality** against the stored Network row, not just the XOR composite; backup restore cross-checks Account-row `l1ChainId` against the corresponding Network row. Because `DEFAULT_SEEDS` only *initializes* a mutable row, seeded-network rows are additionally validated **against the immutable in-code constants at account creation and during integrity verification** — a tampered seeded row can never mint a poisoned account. Custom networks are live-probe-confirmed at account creation (`getNodeInfo().l1ChainId` must equal the stored value; unreachable node → creation fails with a clear error — custom networks are online-configured by nature). Ledger L25.
- Deliberate, owner-ratified property (Ask A3): two rollups on the same L1 (within one extension major, sharing the frozen artifact) derive the SAME keys/addresses — the EVM mental model; `rollupVersion` is excluded because it bumps on state-preserving upgrades (would silently re-derive accounts).
- `chain-ids.ts`: promote the testnet L1/rollup pair to named exports; faucet's independent pin untouched.

### C. Profile storage: store-both, runtime-bound (audit H2/H3/High-1 adopted)

- `Profile` (password variant): sealed `entropy` becomes **required** alongside the sealed master (`secret`). Both AES-GCM ciphertexts gain **AAD binding**: `EncryptionKey.encrypt/decrypt` grow an AAD parameter; profile fields bind a **purpose tag** (`"nulo:profile-master:v2"` / `"nulo:profile-entropy:v1"`) — a ciphertext swapped between the two slots fails authentication (the actual H3 attack). Purpose-only AAD deliberately avoids the ID-before-seal ordering trap (create/import/restore finalize profile IDs after sealing — final-codex M1); binding `profileId` too is optional hardening only where the ID provably exists pre-seal. The backup builder gets **one atomic paired export** (master + entropy from the same unseal) instead of two separate reads.
- **Runtime pairing verification** (not just a unit test): `deriveMasterFromMnemonic(getMnemonic(entropy)) == master` is checked **wherever entropy is decrypted** — (a) at password unlock, (b) at `exportMnemonic` before words are revealed, and (c) at **backup restore** — mismatch rejects (audit H3). The silent bearer-restore path carries only the master and never decrypts entropy — and cannot reveal words (exporting requires the password, which re-runs the check) — so it runs no *pairing* check; instead it verifies a **master-keyed MAC over the entropy ciphertext** (`HMAC(HKDF(master, "nulo:entropy-mac:v1"), entropyCiphertext)`, stored beside the profile fields, updated on every reseal): a mismatch blocks silent restore and forces a password unlock, where the full pairing check fires. This closes the surviving harm path the re-verdict identified — tampered entropy silently degrading recovery availability while a long-lived bearer keeps the wallet operating (final-codex re-verdict C-i; ledger L24). Pinned by tests: `exportMnemonic` re-verification + MAC-mismatch-blocks-silent-restore. Restore field rules are per-profile-type: epoch-4 **password** backups REQUIRE entropy; **passkey** backups REJECT it (final-codex M2).
- **`changeProfilePassword` reseals BOTH fields atomically** in its existing pre-persist-verify operation (service.ts:698-718) — otherwise entropy stays decryptable under the retired password (audit H2).
- `createProfile`: 32B CSPRNG entropy (plain random bytes, not `Fr.random()`) → derive master → seal both. `importMnemonic`: boundary validation **before any persistence** — canonicalize, exactly 24 words, wordlist membership, checksum → derive → seal both. `exportMnemonic`: words from stored entropy (passkey profiles: existing "not supported" path).
- `exportPlain` keeps returning the **derived master** (backup `master-key` semantics unchanged); backup gains the entropy carrier; **`CURRENT_COMPAT_EPOCH` 3→4** (pre-v2 blobs reject: their account rows would fail v2 re-derivation). Epoch literals hardcoded in e2e fixtures (`import-drivers.ts` `buildSyntheticBackup` "compat-epoch": 3; passkey-backup.test.ts:135) are updated in the same phase (audit M3).

### D. Product cuts (wallet level)

- Delete `export/key.vue` wholesale + nav row + `security/index.vue:203` copy; `exportPlain` **stays** internal (Full Backup dependency). `exportEncrypted` method + UI cut per Ask A1.
- Delete `importPlain` end-to-end; delete `importEncrypted` + `public_key` import surface per Ask A1.
- `useProfileImportFlow` / `ImportMethodPicker` / `ImportSecretForm` / both `import.vue` shells trimmed to seed + full-backup + passkey. Copy: "Seed Phrase" → "Recovery Phrase" (inline SFC edits; no i18n layer). Import-screen copy discourages reusing phrases from other wallets (§A trust-model note).

### E. Export/Import Account (account level)

- **Export JSON v1** (plaintext variant):
  ```json
  { "format": "nulo-account-export", "version": 1,
    "artifactSha256": "…", "classId": "0x…", "descriptorDigest": "…", "kdfDigest": "…",
    "l1ChainId": 31337, "address": "0x…", "signingKey": "0x…64hex",
    "checksum": "<sha256 over the pinned canonical serialization>" }
  ```
  Validity is discriminated by the **frozen digests**, not a bare regime label (the label is being redefined in place — audit M6). `secretKey` is **dropped** (redundant — derivable; and a privacy-root/ownership-key confusion magnet — audit L2 + codex Low). Field elements as `0x`-hex inside the typed envelope. Checksum canonicalization (field order, serialization) is pinned in a spec comment + KAT. Import **rejects** a non-canonical `signingKey` (≥ Fq modulus) — never reduces (audit L3). **The plaintext checksum is corruption detection, NOT authentication** (final-codex High-4): an attacker holding the file can substitute a signingKey and recompute address + checksum into a fully self-consistent hostile file — no offline check can catch that. Mitigation: the import UI displays the recomputed address prominently and requires explicit confirmation against the address the user expects; "tampered export fails closed" applies to the **encrypted** variant (AES-GCM authenticates under the password) and to non-self-consistent mutations of the plaintext one.
- **Encrypted variant**: the same payload wrapped via `EncryptionKey` AES-GCM with AAD `{purpose:"nulo:account-export:v1"}` and a version byte. **No inner guard constant** — AES-GCM authentication suffices; wrong password and corrupted file share one honest error (codex Low, adopted).
- **Service-side authorization (codex High-3, adopted)**: the export RPC itself authenticates in the background — password profiles: the RPC takes the password and verifies by unsealing (the `exportMnemonic` pattern); passkey profiles: the RPC requires WebAuthn ceremony data (the `exportPlain(id, password, credentialData)` Full-Backup pattern). UI confirmation is presentation, not the gate.
- **`NuloAccount.fromSigningKey(signingKey, logger)`** factory; the ctor (currently public — recon correction) is made **private**, with `new()` and `fromSigningKey()` sharing the key-agnostic tail.
- **Storage & lifecycle (codex High-4, adopted)**: `AccountType.Imported = 1`. New root `nulo:core:imported-account-keys`, row id mirroring `accountRowId`; value = signing key encrypted AES-GCM under `HKDF(master, info = "nulo:imported-account-key:v1" || chainId || address)` — **per-row info** so a ciphertext transplanted between rows fails decryption (audit L4). The binding deliberately uses `(master, chainId, address)` and NOT `profileId`: full-backup restore remaps profile IDs before restoring slices, and a profileId-bound ciphertext would be undecryptable after restore (final-codex High-2); the master is itself stable, secret, and travels with the backup. Restore-order rule: the type-1 orphan-drop check runs at restore **finalize**, after all slices land — never mid-restore (final-codex High-2). Tests: profile-ID-remap round-trip + passkey-backup imported-account signing. Lifecycle rules:
  - **Write order + compensation**: key row first, Account row second; on failure delete the key row. Deletion: Account row first, key row second; a sweep on service init removes orphaned key rows.
  - **Duplicate-address import is rejected** (row id `(profileId, chainId, address)` already exists → error; never overwrite a derived row).
  - **Purge fan-out**: the imported-keys repository registers with the existing chain-purge subscribers AND the profile-deletion purge.
  - **Index fix**: `createAccountInternal`'s next-index guard moves to the type-filtered list (today the `length > 0` check is cross-type and `array_max([])` returns 0, so the first Imported account would take index 1 — verified; audit M3-codex/L5-fable).
  - **`ensureDefaultAccount` excludes `Imported`** from the candidate pool.
- **Backup slice**: a **dedicated `imported-account-keys` service name owns the new root** as its own `BACKUP_SLICE_REGISTRY` entry (`optional: true` — a mandatory slice would reject every backup with no imported accounts) + footprint coverage, and is wired into the fixed backup/restore client lists (`full.vue`, `useFullBackupImport`) — the registry maps one service to one descriptor, and AccountService already owns the Account root, so the key root needs its own named owner (final-codex re-verdict C-iii; ledger L26). Restore ordering is explicit: key slices restore **before** orphan reconciliation, which runs **before** session activation. Cross-slice consistency: an epoch-4 backup carrying a type-1 Account row with **no matching key entry** has that row dropped with a surfaced warning at finalize (never restored as a zombie that fails at signing).
- **Signing path**: `getAccountContract` branches — `Nulo_v1` → derive (unchanged); `Imported` → load + decrypt → `fromSigningKey` → assert constructed address == row.address. **Every** failure (missing key row, malformed envelope, AAD/decrypt failure, non-canonical scalar, address mismatch) fails closed. Blast radius per Ask A4 (recommended: **quarantine the single imported account** — disabled + surfaced error; the profile-wide `raiseRuntimeMismatch` block stays reserved for derived rows, whose corruption implicates the master path). Quarantine includes a **repair path** (final-codex Low-2): the quarantined account can be deleted from its surfaced error state and then re-imported — duplicate rejection must never make a quarantined account permanently unrecoverable.
- **Import chain binding**: the imported row binds to the **currently-active network** (composite chainId + its l1ChainId); if the file's `l1ChainId` differs from the active network's, the UI warns and requires explicit confirmation (addresses are chain-independent; the file's value is provenance). Ledger L10.
- **UI**: Export = 4th icon on Manage Accounts rows → popup (auth per above → variant pick, encrypted default → reveal/`downloadFile`); Import = sibling entry next to "Add account" → popup (paste/file + password when encrypted). Imported accounts get a persistent badge + copy: "Not covered by your recovery phrase — keep its export file safe."

### F. Freeze/vector reconciliation

- **Regime record**: in-place redefinition of the launch baseline (Ask A2): `kdf: "nulo-account-kdf-v2"`, new **`kdfDigest`** = sha256 of a canonical formula-spec string (committed alongside), threaded into the `ack`; `address-freeze.test.ts` literals AND the module's own "editing is forbidden" rules text updated in the same reviewed commit (audit L7) — the text gains the one-time pre-launch-redefinition carve-out with this plan referenced. **Timing (final-codex M3): this edit lands in Phase 3**, the phase that completes the full v2 chain — the freeze record flips exactly when the chain it describes is live, never while a hybrid (v2 separators + v1 master path) exists. Transitional dev states between arcs are deliberate and pre-production-only; each arc's own gates stay green on its intermediate state.
- **Vectors**: regenerate seed→signingKey reference vectors via a re-parameterized copy of the regime-b generator (published-tarball posture, Nulo separator injected, provenance documented). **New** KATs: `deriveAccountSeed` vectors + one full-chain vector (words → entropy → master → seed → address), generated by an independent script under `implementations-plan/key-model-v2/reference/`.
- **Formula-coupled test surfaces — the complete list (recon corrected by audits H4/M3)**:
  - `tests/e2e/network/frozen-account-canary.test.ts` — recompute line → v2 (l1ChainId 31337); master capture reworked to the Full-Backup JSON (its `revealSecretKey` helper dies in P4).
  - `tests/e2e/helpers/import-drivers.ts:223-232` — `deriveNuloAccountAddress` hand-codes the v1 formula and feeds `import-paths`, `import-dead-rpc`, `backup-migration` tests → updated to v2 in the same phase as the formula change's smoke exposure; its `importPlainKey` + plain legs deleted with P4.
  - `tests/e2e/network/profile-reimport-matrix.test.ts` — drives the deleted plain-key import UI and asserts via `deriveNuloAccountAddress` → re-based on mnemonic import + v2 helper (P4 edit, P6 run).
  - Epoch-3 literals: `import-drivers.ts` `buildSyntheticBackup`, `passkey-backup.test.ts:135` → bumped with the epoch (P3/P4 as mapped in phases).

### G. Data & control flow (critical paths)

- Create: onboarding → `createProfile` → entropy+master sealed (AAD-bound) → session opens with master Fr → accounts derive via `deriveAccountSeed` with row-carried `l1ChainId`.
- Re-import: words → canonicalize/validate → PBKDF2 → master → same addresses (KAT + reimport-matrix e2e).
- Unlock: unseal both → pairing check → session.
- Import account: file → schema/size validation → digests match build → decrypt (if encrypted) → signingKey canonical → address recompute == file address → key row → Account row (+l1ChainId, active composite) → signing via Imported branch.
- Restore: epoch-4 backup → master-key + entropy (pairing-verified) → profile reseeded → derived accounts re-derive; imported slice (optional) restores key rows; type-1 rows without keys dropped + surfaced.

### H. File-level change map (net)

| Area | Files |
|---|---|
| wallet-crypto | + `mnemonic-master.ts`(+trezor/"" KATs), + `nulo-separators.ts`(+dual-enum non-collision test), + `derive-account-seed.ts`(+KAT), ~ `account-derivation.ts`(v2 separator, +vectors), + account-export envelope module(+test), ~ `encryption-key.ts` (AAD param), ~ `secret-types.ts` (new brands) |
| wallet-core | ~ `mnemonic.test.ts` (checksum-rejection test; canonicalizer + tests), codec unchanged |
| aztec-runtime | ~ `nulo-account.ts` (`fromSigningKey`, ctor→private), ~ `address-freeze.ts`+test (kdf v2 label, kdfDigest, ack, rules text), derivation-vectors regenerated |
| extension: integrity | ~ `account-integrity/coordinator.ts` (shared `deriveAccountSeed`, row-carried l1ChainId) + coordinator tests exercising the REAL default deriver |
| extension: network | ~ `network/spec.ts` (+`l1ChainId`), ~ `network/service.ts` (DEFAULT_SEEDS constants, custom-network capture, threading), ~ `utils/chain-ids.ts` |
| extension: account | ~ `account/spec.ts` (`Imported=1`, `l1ChainId` on row, import/export RPCs), ~ `account/service.ts` (seed v2 via shared fn, l1ChainId at creation, index-guard fix, import/export RPCs + service-side auth, Imported signing branch + quarantine, default-pool exclusion, orphan sweep, purge hooks), + imported-keys repository, ~ client.ts |
| extension: profile | ~ `profile/spec.ts` (entropy required for password profiles), ~ `profile/service.ts` (create/importMnemonic/exportMnemonic, pairing checks, `changeProfilePassword` dual reseal; − importPlain; − exportEncrypted per A1), ~ client.ts |
| extension: backup | ~ registry (epoch 4, entropy carrier + restore pairing check, imported-keys optional slice, type-1 orphan drop), ~ footprint coverage |
| extension: UI | − `export/key.vue`; ~ export/index, security/index, ImportMethodPicker, ImportSecretForm, useProfileImportFlow, both import.vue; + AccountExportPopup, + AccountImportPopup, ~ accounts/index.vue, ~ NewAccountPopup footer copy |
| tests/e2e | ~ canary (formula + capture), ~ `import-drivers.ts` (v2 helper, plain legs deleted, epoch literal), ~ `profile-reimport-matrix.test.ts` (mnemonic-based), ~ `passkey-backup.test.ts` (epoch literal), − plain/encrypted import-export legs, + account export/import smoke, + P6 imported-account signing leg |
| docs | ARCHITECTURE.md (KDF v2, profile row, imported accounts), CLAUDE.md pointer updates, `implementations-plan/index.md` |

### I. Trade-offs & alternatives not taken

1. **PBKDF2 vs entropy-as-master** — Outline B below; both audits picked A conditional on closing the dual-secret consistency surface (§C does). Honest note per fable: H2/H3-class attacks do not exist under B (single field); A's costs are one-time inside a licensed break, B's (nonstandard semantics, no passphrase ever, ~82% foreign-phrase rejection) compound forever.
2. **Store-both vs derive-on-unlock** — store-both (bearer restore can't re-KDF; unlock latency budgeted once), now with runtime binding.
3. **l1ChainId on the Account row vs injected lookup vs reverse table vs re-probe** — row-carried adopted (self-contained re-derivation, works pre-session-open, tamper fails closed); seeds hardcoded, customs captured from the existing probe.
4. **Dedicated signing-root separator vs keeping IVSK_M** — dedicated; reference vectors regenerated with documented provenance.
5. **In-place regime redefinition vs append** — in-place recommended (Ask A2), now including the module's rules-text carve-out.
6. **Imported-key store: own root + per-row-bound envelope vs rows on Account entity** — own root; AAD/per-row HKDF info added.
7. **BIP-32/SLIP-0010** — rejected (ledger L9).
8. **Imported-tamper blast radius: quarantine vs profile-wide block** — owner call (Ask A4), quarantine recommended.

---

## Competing Outline B — "minimal-crypto" (retained for the record)

Same product model, same l1ChainId + tags + validation + regime work, **no PBKDF2** (entropy stays the master verbatim). Pros: single sealed secret — the H2/H3 consistency surface never exists; words re-display for any password profile; smaller P3; no trezor-KAT sourcing. Cons: nonstandard semantics forever; no passphrase without a second address-breaking event; the ≥-modulus rejection (~82% of foreign 24-word phrases) returns; `createProfile` must keep field-bounded generation. Security equal (~253.5-bit ceiling either way). **Both auditors picked A conditional on §C's runtime binding; the draft concurs.**

---

## Phases

### Phase 1 — KDF v2 primitives (packages)
`mnemonic-master.ts` (+ official trezor KATs at passphrase `"TREZOR"`, + Nulo `""` KATs, + a Unicode-passphrase NFKD KAT), canonicalizer (wallet-core) + checksum-rejection test, `nulo-separators.ts` + separator-namespace inventory + non-collision tests (I3: enumerate what the installed 5.0.1 tree actually exports — `GeneratorIndex` may not be), `derive-account-seed.ts` + KAT + independent generator under `reference/`, `account-derivation.ts` v2 separator + regenerated reference vectors, `encryption-key.ts` AAD param (+tests). (Regime-record edit deliberately deferred to P3 — §F timing.)
**Gate** — `bun run lint && bun run typecheck:all && bun run test`. Pass: exit 0; all new KATs green with pinned values committed. Layers: lint/typecheck/unit.

### Phase 2 — chain identity + shared formula (extension services)
Network `l1ChainId` (DEFAULT_SEEDS hardcoded constants; custom-network capture; threading; fail-closed validation; **endpoint add/update asserts exact l1ChainId equality**, not just the composite), Account row `l1ChainId` (spec + creation write; restore-time Account↔Network consistency check), AccountService switches to shared `deriveAccountSeed`, **integrity coordinator switches to the same shared function reading row-carried l1ChainId** — with a coordinator test exercising the REAL default deriver (the existing tests inject fakes and would miss a stale default — audit H1), full-chain KAT wired, canary + `import-drivers.ts` recompute lines updated to v2 (run later).
**Gate** — `bun run lint && bun run typecheck:all && bun run test`. Pass: exit 0; coordinator real-deriver test green; account/network suites green. Layers: lint/typecheck/unit/integration.

### Phase 3 — profile entropy model
Entropy-originated `createProfile`; `importMnemonic` boundary validation + PBKDF2 + store-both (purpose-AAD-bound); pairing checks at every entropy-decryption site (password unlock, export, restore) + the entropy-MAC on the bearer path (mismatch blocks silent restore) + both pinning tests; `changeProfilePassword` dual reseal (atomic with its pre-persist verify) + test; tamper tests (swapped-ciphertext, stale-entropy-after-password-change); `exportMnemonic` from entropy; atomic paired master+entropy export for the backup builder; backup entropy carrier (password blobs REQUIRE entropy, passkey blobs REJECT it) + `CURRENT_COMPAT_EPOCH` 4 + epoch-3-rejection test; **regime record + kdfDigest + rules-text carve-out land here** (§F timing); `exportEncrypted`'s A1 cut co-lands in this arc (its ciphertext becomes non-importable the moment AAD activates — final-codex M1); e2e fixture epoch literals bumped (`import-drivers.ts` buildSyntheticBackup, `passkey-backup.test.ts`).
**Gate** — `bun run lint && bun run typecheck:all && bun run test`. Pass: exit 0; create→export-words→re-import→same-address integration green; tamper + reseal + epoch tests green. Layers: lint/typecheck/unit/integration.

### Phase 4 — product cuts + copy
Delete `export/key.vue` + `importPlain` end-to-end (the encrypted-key surface was already cut in P3, co-landed with AAD — this phase removes any remaining UI stubs); flow/composable trims; copy renames + phrase-reuse discouragement; unit/component test rewrites; e2e helper surgery (`revealSecretKey` retired, `importPlainKey` + plain legs deleted, `profile-reimport-matrix.test.ts` re-based on mnemonic import, canary capture switched to Full-Backup JSON).
**Gate** — `bun run audit:vue && bun run test:e2e`. Pass: both exit 0; reworked smoke suite green. Layers: typecheck/unit/component/build + smoke e2e.

### Phase 5 — Export/Import Account
`NuloAccount.fromSigningKey` + private ctor; export envelope (digest discriminators, no secretKey, pinned canonicalization, encrypted variant AAD, no inner guard); service-side auth (password unseal / passkey ceremony); `AccountType.Imported`; imported-keys root (per-row HKDF info) + repository + orphan sweep + purge hooks; import RPC (schema/size/digests/canonical-scalar/address-recompute, duplicate rejection, active-network binding + l1ChainId-mismatch confirm); index-guard fix; signing branch + quarantine (per A4); default-pool exclusion; dedicated `imported-account-keys` backup slice owner (optional, ordered keys→reconciliation→activation) + type-1 orphan drop at finalize + footprint coverage; UI popups + badge + copy + mandatory address-confirmation on import; component tests; smoke e2e (export→import round-trip, tamper rejection, duplicate rejection).
**Gate** — `bun run audit:vue && bun run test:e2e`. Pass: both exit 0; round-trip + tamper + duplicate smoke green. Layers: typecheck/unit/component/build + smoke e2e.

### Phase 6 — reconciliation + network e2e
Canary run (v2 recompute, Full-Backup capture, prover-ON); reimport-matrix run; **new network leg: import an exported account into a fresh profile and send a live transaction from it** (audit M8); docs; full suite.
**Gate** — `bun run e2e:agent` then `bun run audit:vue`. Pass: network suite green incl. canary, reimport matrix, imported-account signing leg; audit:vue exit 0. Layers: full e2e-live-network + fast layers. (Owner memory: run the network suite solo on the host; re-run before triaging failures.)

---

## Security & Adversarial Considerations

- **Threat model**: attacker-supplied account-export files and backup blobs (HOSTILE: size caps, schema validation, digest discrimination, canonical-scalar rejection, restore pairing check, type-1 orphan drop); tampered `chrome.storage.local` (AAD-bound profile ciphertexts; per-row-bound imported-key envelopes; row-carried l1ChainId fails closed; imported-branch full failure taxonomy; derived rows keep coordinator coverage); ciphertext-swap within a row (AAD purpose tags — the split-brain recovery attack from audit H3/High-1 is closed at unlock/export/restore); clipboard exfil (F-14 scrub reuse); compromised popup (ALL authorization service-side: password-unseal or passkey ceremony in the RPC itself); drifted RPC endpoint (existing composite drift check retained; XOR-collision limitation documented — protocol-level `chainInfoFrom` exact-pair binding covers replay; redesign out of scope).
- **Entropy accounting (owner's named ask — honest form)**: ≥ ~253.5-bit effective keyspace at every step; reduce bias ≤ 2^-258 (64-byte input); no step below the field's own security level. The 2^256→~2^253.6 phrase→master compression is inherent to Fr in any design. Auditors attacked this chain twice; the wording above is the surviving claim.
- **BIP-39 phrase-reuse trust model**: a phrase shared with another BIP-39/BIP-32 wallet lets that software derive Nulo's master (standard-model property, deliberate; UI copy discourages reuse).
- **Cryptography**: WebCrypto PBKDF2-HMAC-SHA512 + AES-GCM(+AAD) + HKDF — platform-native; `@aztec/foundation` 5.0.1 exact-pinned poseidon2/sha512ToGrumpkinScalar/Fr. **No new dependencies**; supply-chain posture unchanged.
- **Domain separation**: dedicated Nulo constants, documented derivation, non-collision tests against the inventoried separator namespaces actually exported by the installed `@aztec/*` tree (revised I3) + mutual-distinctness; per-purpose AAD strings; per-row HKDF info; no guard-constant reuse.
- **Input validation**: mnemonic (canonicalize → 24 words → wordlist → checksum, pre-persistence); account import (schema, size, digests, scalar canonicality, address recompute, duplicate rejection); backup (checksum → epoch 4 → version → pairing check → orphan drop).
- **Secret handling**: zeroize-in-`finally` for all new intermediates (seed64, entropy, decrypted signing keys); no secrets in logs; plaintext export behind service-side auth + explicit warnings, encrypted variant default.
- **Least privilege / CI**: no workflow, token, or endpoint changes.

## Assumptions

**Facts** (verified; recon.md + audit corrections): everything in recon §1/§3 EXCEPT as corrected — `NuloAccount` ctor is **public** today (made private by P5); `createAccountInternal`'s index guard is cross-type (`array_max([])`=0 → first new-type account gets index 1); the coordinator's production `DeriveAddress` default duplicates the v1 formula (coordinator.ts:52-56, runtime.ts constructs without override); formula-coupled test surfaces are FOUR (canary, `import-drivers.ts:223-232`, `profile-reimport-matrix.test.ts`, plus epoch literals in two fixtures) — not one; `getEntropy` rejects bad checksums (mnemonic.ts:2150-2157); `_getChainId` probes `getNodeInfo()` on all paths but **seeded** networks never call it (`_buildNetwork` from `DEFAULT_SEEDS`, offline-safe); trezor official vectors use passphrase `"TREZOR"` and the one seed row in mnemonic.test.ts is truncated/unasserted; foreign-phrase over-modulus probability ≈ 82.3% (1 − r/2^256).

**Inferences** (remaining):
- I3 (revised — final-codex Low-1): `DomainSeparator` import verified; `GeneratorIndex` is reportedly NOT exported by the installed 5.0.1 tree. P1 inventories the actual separator namespaces in `node_modules/@aztec/*` dist and tests non-collision against whatever exists.
- I5 (`gh stack` installed): operational; checked at delivery, installed if missing.

**Asks — RESOLVED by owner 2026-08-18:**
- **A1: YES** — the "Encrypted Key" surface (`exportEncrypted` UI+method, `importEncrypted`/`public_key` import) is cut with the Secret Key page.
- **A2: IN-PLACE** — regime record redefined in place (+ test literals + rules-text carve-out, one reviewed commit); owner ratifies that no build, backup, or exported artifact created under KDF v1 needs to keep working.
- **A3: YES** — same-L1-rollup key/address reuse is intentional; `rollupVersion` stays excluded from derivation.
- **A4: SIMPLEST FAIL-CLOSED** — owner's words: "If it's tampered, throw an error and don't import it." Applied at both boundaries: import-time (auth/consistency failures reject the file) AND signing-time for stored keys (envelope auth failure or address-recompute mismatch → that imported account errors and is unusable; delete + re-import is the repair; derived accounts unaffected; NO profile-wide block, no extra quarantine machinery beyond the error state).

Settled by owner in-conversation (recorded): 24-word-only import; Nulo-format-only account import; encrypted + plaintext export variants; network e2e final gate + smoke on UI phases; no `/harden` scheduled; no passphrase UI this plan; Export/Import Account in scope.

## Decision ledger

| # | Decision | Source | Status |
|---|---|---|---|
| L1 | PBKDF2 adopted (A over B) | draft; both audits concur conditional on §C binding | adopted |
| L2 | Store-both, **runtime-bound** (AAD + unlock/export/restore pairing + password-change reseal) | codex High-1, fable H2/H3/C2/C3 | adopted |
| L3 | l1ChainId: DEFAULT_SEEDS hardcoded + custom-probe capture; **persisted on Account row**; composite stays scoping key; fail-closed on absence | fable H1-alt/M2/C6 (supersedes draft's injected lookup; codex's (profileId,composite) lookup keying moot) | adopted |
| L4 | Dedicated signing-root separator + regenerated reference vectors; dual-enum non-collision tests | draft + fable L1 | adopted |
| L5 | kdfDigest + in-place baseline redefinition incl. rules-text carve-out | recon §4 + fable L7; Ask A2 | pending owner |
| L6 | Imported accounts: own root, per-row-bound envelope, optional backup slice + orphan drop, ordered writes + compensation + sweep, purge hooks, duplicate rejection, index-guard fix, default-pool exclusion, service-side auth | codex High-3/High-4, fable M5/M6/L3/L4/L5 | adopted |
| L7 | Account-export: 0x-hex inside typed envelope; **secretKey dropped**; digest discriminators; no inner guard | owner discussion + codex Low + fable L2/M6 | adopted |
| L8 | Owner's class-ID observation + same-L1 reuse property | owner + recon §6 → Ask A3 | pending owner |
| L9 | BIP-32/SLIP-0010 rejected | prior codex-backed analysis | settled |
| L10 | Import binds to active network; l1ChainId mismatch → warn + explicit confirm | fable M6 | adopted |
| L11 | Entropy claim restated honestly (≥253.5-bit floor; no "no-narrowing"/"256-bit master" claims) | codex M1 + fable M1/C5 | adopted |
| L12 | Imported-tamper quarantine vs profile block | fable M7 (codex High-4 preferred durable block) → Ask A4 | pending owner |
| L13 | P6 imported-account live signing leg; P5 smoke proves import/UI only | codex gates + fable M8 | adopted |
| L14 | BIP-39 phrase-reuse trust model documented + UI discouragement | fable M9 | adopted |
| L15 | Passkey 256-bit-reduce skew: backlog note only (out of scope) | fable M1 side note | adopted (deferred) |
| L16 | Pairing check scoped to entropy-decryption sites; bearer path exempt (cannot reveal words) + pinning test | final-codex High-1 (its bearer-versioning option rejected as unnecessary — exportMnemonic always re-verifies under password) | adopted |
| L17 | Imported-key HKDF binding = (master, chainId, address), profileId dropped (restore remaps IDs); orphan-drop at restore finalize; remap + passkey signing tests | final-codex High-2 | adopted |
| L18 | Endpoint mutation asserts exact l1ChainId; restore Account↔Network consistency; residual offline-tamper risk documented | final-codex High-3 | adopted |
| L19 | Plaintext checksum = corruption detection only; mandatory address-confirmation UX; tamper claims narrowed to encrypted/non-self-consistent | final-codex High-4 | adopted |
| L20 | Purpose-only AAD (no profileId ordering trap); atomic paired master+entropy export; exportEncrypted cut co-lands with AAD | final-codex M1 | adopted |
| L21 | Password backups REQUIRE entropy / passkey backups REJECT it | final-codex M2 | adopted |
| L22 | Regime record + kdfDigest land in P3 (no freeze flip on a hybrid chain); transitional dev states documented | final-codex M3 | adopted |
| L23 | PRF-model bias phrasing; 5.29 mean preimages; NFKD passphrase + Unicode KAT; quarantine delete/re-import repair path | final-codex M4 + Low-2 | adopted |
| L24 | Master-keyed entropy-ciphertext MAC verified on silent bearer restore; mismatch forces password unlock | final-codex re-verdict C-i | adopted |
| L25 | Seeded rows validated against immutable constants at creation + verify; custom networks live-probe-confirmed at creation | final-codex re-verdict C-ii | adopted |
| L26 | Dedicated `imported-account-keys` slice owner + explicit restore ordering (keys → reconciliation → activation) | final-codex re-verdict C-iii | adopted |
| L27 | A4 resolved: simplest fail-closed at both boundaries; no profile-wide block; delete + re-import as repair | owner 2026-08-18 | settled |
| L28 | Crypto adversarial rider: focused codex attack on the implemented crypto diff after P1 and P3, blocking on High findings; post-impl audit repeats the entropy attack on final code | owner 2026-08-18 (approval condition) | adopted |

**Audit verdicts** — R1 codex: `reject` (all findings addressed; audit-codex.md). R1 fable: `conditional approve` (C1–C7 adopted; audit-fable.md). Final fresh-context codex on rev 2: `reject` (all 10 findings adopted as L16–L23; A1–A4 recommendations endorsed). **Resumed final-codex verdict on rev 3: `conditional approve`** (conditions C-i/C-ii/C-iii — ALL adopted into rev 4 as L24–L26, plus its two Low consistency fixes). The gate proceeds on this verdict with every condition adopted.

## Delivery — arcs → stacked PRs

| Arc | Branch | Phases | Stacks on |
|---|---|---|---|
| 1 `kdf-v2-core` | worktree-key-model-v2 (adopted layer 1) | P1 + P2 | dev |
| 2 `profile-entropy-cuts` | `key-model-v2-profile` | P3 + P4 | arc 1 |
| 3 `account-export-import` | `key-model-v2-accounts` | P5 + P6 | arc 2 |

`gh stack init --adopt` at start; `gh stack add` at boundaries; `gh stack submit --draft --auto` early; Conventional-Commit titles ≤93 chars; ready after the post-impl loop converges; `gh stack merge` is the owner's call, never autonomous.

## Post-implementation (self-contained — the implementing session executes THIS, in order)

0. **Crypto adversarial rider (owner condition at approval — runs DURING implementation, not only at the end):** after Phase 1's gate passes and again after Phase 3's gate passes, BEFORE advancing to the next phase, run a focused codex consult (`/codex` at xhigh) on the crypto diff of that phase — the actual implemented KDF code, constants, KAT values, AAD/MAC usage, zeroize discipline — with this ask verbatim: *"Attack the implemented key-generation code as an adversary. Is there ANY divergence from the plan's derivation spec, any step where effective keyspace drops below ~253.5 bits, any domain-separation or AAD/MAC misuse, any secret that escapes zeroization or logging discipline, any KAT that pins the wrong value? The owner's explicit fear is a silent security downgrade — try to find one."* Log each consult + verdict in `lessons/phase-N.md`. An unresolved High finding BLOCKS the next phase.

1. Run `/code-review max --fix` on the full implementation diff. Skim the applied fixes for unintended changes, then commit them **separately** from implementation commits.
2. Codex post-impl audit (`/codex` at xhigh): send (a) the net diff from the plan baseline (pre-code-review), (b) a separate summary of the code-review-applied commits, (c) this plan.md + decision ledger, (d) the adversarial/security ask including the entropy-accounting attack, and (e) verbatim: *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."*
3. Iterative fix loop: verify codex's factual claims against the repo first; apply accepted fixes; commit; log consult + verdict in `implementations-plan/key-model-v2/lessons/`; RESUME the same codex session with the fix diff. Repeat until a round yields no new material findings. Still material after 3 rounds → stop and surface (scope smell).
4. Delivery per the Delivery section; update `implementations-plan/index.md`.

## Seeds (FINAL — approved scope incl. A1–A4 resolutions + the crypto adversarial rider; run inside this worktree)

ELI5 Artifact: https://claude.ai/code/artifact/a550115a-bcf7-40df-af37-2b0c9f600068 (source: `eli5.html` in this dir — redeploying that file from the publishing session keeps this URL).

### Recommended: /goal
```
/goal All six phases marked ✓ in implementations-plan/key-model-v2/plan.md (the per-phase headers in the file, not just the chat), each ✓ backed by its phase's validation gate as defined in plan.md reported passing in the transcript; the crypto adversarial rider executed — after Phase 1 and after Phase 3 a focused codex xhigh attack on that phase's crypto diff is quoted in the transcript with its verdict, and no High finding is left unresolved; for each phase the agent printed LESSONS_FILE=implementations-plan/key-model-v2/lessons/phase-N.md in the transcript; /code-review max --fix complete with fixes committed separately; the codex post-impl fix loop converged (a resumed codex pass reporting no new material findings, quoted in the transcript); the three-arc gh stack exists on GitHub with arc PRs ready (gh stack view output in the transcript); bun run audit:vue, bun run test:e2e, and bun run e2e:agent all report exit 0 in the transcript.
```

### Alternative: /loop 15m
```
/loop 15m Drive implementations-plan/key-model-v2 forward. Never idle waiting for my input. Each firing: (1) Read plan.md + lessons/ (authoritative state), git status, git log --oneline -5; if PRs exist, gh stack view + gh pr view --json statusCheckRollup (no --watch). (2) Waiting on CI is fine if it's progressing (gh run watch up to 10 min; stuck → log as blocked in lessons). Use waits to review the diff or prep the next phase. (3) No task in hand? Pick the next pending step from plan.md. After each meaningful edit run bun run lint + the touched package's tests; commit; gh stack push / gh stack sync as needed. (4) Stuck or facing a decision you'd normally bring to me? Call /codex at xhigh, reach a defensible decision, act, log consult + verdict in lessons/phase-N.md. Hard limits stay hard: never merge, publish, deploy, or expand scope beyond plan.md — surface and hold. (5) Same step failed 5 times? Stop retrying; reassess with codex. (6) Phase green = its validation gate as written in plan.md passes; paste the result, mark ✓ in plan.md, write lessons, print LESSONS_FILE=implementations-plan/key-model-v2/lessons/phase-N.md, advance; at arc boundaries gh stack add per the Delivery table. After Phase 1 and Phase 3 specifically: run the crypto adversarial rider (Post-implementation §0) BEFORE advancing — an unresolved High finding blocks. (7) All phases ✓? Execute plan.md's Post-implementation section verbatim, then write the wrap-up report (what shipped, each contentious decision with ELI5 context, open items) and stop. Keep the ASCII checklist visible each firing (plan.md is the source of truth).
```
