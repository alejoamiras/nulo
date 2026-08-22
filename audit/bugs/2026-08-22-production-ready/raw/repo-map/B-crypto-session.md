# Map B — Crypto + session model

> Mapper (explore agent), 2026-08-22. Repo-relative paths.

## 1. KDF v2 core — `packages/wallet-crypto/src/**`

### Module inventory (barrel `index.ts:18-56`)

| Module | Role |
|---|---|
| `mnemonic-master.ts` | BIP-39 sentence → PBKDF2 64-byte seed → field reduce → master |
| `derive-account-seed.ts` | THE one account-seed formula (poseidon2, L1-chain-keyed) |
| `account-derivation.ts` | seed → Schnorr signing key (ownership root) → privacy secret |
| `nulo-separators.ts` | Consensus-critical domain separators |
| `encryption-key.ts` | PBKDF2-600k + AES-GCM framing; passhash = SHA-256(password) |
| `password-secret-box.ts` | Password wrap of {guard, master, entropy} triple |
| `passkey-credential.ts` | WebAuthn PRF → HKDF → master / DEK wrap key |
| `entropy-mac.ts` | Envelope MAC v2 over all four sealed slots |
| `session-secret-box.ts` | Silent-restore bearer wrapping `master‖dek` |
| `imported-keys-dek-box.ts` | Credential-sealed imported-keys DEK slot |
| `imported-account-key-box.ts` | Per-row AES-GCM sealing of imported signing keys under the DEK |
| `wallet-fingerprint.ts` | One-way duplicate-recovery-phrase detector |
| `pxe-store-key.ts` | HKDF(master, profileId-salted) → PXE SQLite ChaCha20 key |
| `secret-types.ts` | 8 branded nominal types + identity mint fns |
| `zeroize.ts` | Best-effort wipe helper |

### Mnemonic handling
- `deriveBip39Seed(words, passphrase="")` — `mnemonic-master.ts:26-47`. Canonicalization via `canonicalizeMnemonic` (`packages/wallet-core/src/utils/mnemonic.ts:2109-2113`): NFKD → lowercase → trim → whitespace-collapse; empty ⇒ `[]`. Salt = `"mnemonic"` + NFKD(passphrase). PBKDF2-HMAC-SHA512, 2048 iterations, 512 bits (`:23,:33-37`) — spec constant, not a brute-force defense. `finally` zeroes sentenceBytes + saltBytes (`:39-46`); sentence string + CryptoKey internals unwipeable.
- `deriveMasterFromMnemonic(words)` — `:50-62`: `Fr.fromBufferReduce(seed64Copy)`; wipes deriveBits output and Buffer copy (`:59-60`).
- **Gap:** `deriveBip39Seed` does not itself validate word count/checksum — validation lives at import boundary (`service.ts:1435-1438`: exactly 24 words) and in `getEntropy`.
- `getEntropy(words)` — `wallet-core/src/utils/mnemonic.ts:2115-2182`: `%3` length check throws (`:2116-2118`); unknown word throws (`:2130`); checksum mismatch throws (`:2169`); entropy wiped on every non-return path (`:2175-2181`).
- `getMnemonic(entropy)` — `mnemonic.ts:2067-2101`: throws on empty or `%4 ≠ 0` (`:2068-2070`).

### Chain identity + separators
- `nulo-separators.ts:14,17` — `NULO_ACCOUNT_SEED_SEP = 2720999938`, `NULO_SIGNING_ROOT_SEP = 914717451`; provenance tests recompute from label + non-collision vs upstream DomainSeparators.
- `assertCanonicalL1ChainId` — `derive-account-seed.ts:19-23`: rejects non-safe-int / negative / > 0xffffffff. `l1ChainId` is EXACT L1 chain id, never XOR-composite storage id, never silently defaulted.
- `deriveAccountSeed(master, l1ChainId, type, index)` — `:25-31`: poseidon2HashWithSeparator([master, l1ChainId, type, index], SEP); type/index safe-nonneg-checked. Single formula; consumers: `apps/extension/src/wallet/services/account/service.ts:217,385,521`, `services/account-integrity/coordinator.ts`.
- `deriveSigningKeyFromSeed(seed)` — `account-derivation.ts:31-33`: sha512ToGrumpkinScalar([seed, NULO_SIGNING_ROOT_SEP]). Signing key never crosses PXE seam.

### Master derivation chains per profile type
- **Password profile**: 32 CSPRNG entropy bytes (`createProfile` `service.ts:365`) → words → `deriveMasterFromMnemonic`. Import identical (`importMnemonic` `service.ts:1429-1444`). Row stores BOTH sealed entropy + sealed master ("store-both").
- **Passkey profile**: PRF bytes → HKDF → reduce. No entropy exists; recovery = credential ceremony.
- Both converge on `deriveAccountSeed`.

### v1 → v2 relationship
- KDF v1 redefined in place inside V5 pre-launch window — ratified `packages/aztec-runtime/src/account/address-freeze.ts:15-19`. Pre-production ⇒ no migrations, no compat derivations. One compile-time regime per extension major (`address-freeze.ts:88-92`); REGIMES append-only once shipped.
- Retired crypto-v1 primitives deleted in commit `3bad9390`; tests rebuilt retired constructions independently for forgery checks.
- Naming artifacts: `PROFILE_AAD.entropy` labeled `nulo:profile-entropy:v1` while guard/master are `:v2`; passkey internal labels `nulo:kdf:v1`/`nulo:master:v1`/`nulo:dek-wrap:v1` are current-generation despite names (`passkey-credential.ts:30-34`, DO NOT CHANGE).

## 2. Passkey surface

### WebAuthn ceremony → PRF
- Popup-side single source: `apps/extension/src/wallet/utils/passkey-ceremony.ts`. PRF input = SHA-256(UTF8(PASSKEY_PRF_LABEL)) (`buildPrfInput :33-36`). Create options: resident key required, UV required; both create/get wire `extensions.prf.eval.first`.
- **PRF hard-required. NO non-PRF fallback anywhere.** Missing extension ⇒ throw (`:102,:105,:127-128`). Single fallback branch: create→get re-prompt when authenticator reports prf.enabled=false at creation but serves PRF on assertion (`:113-118`) — still PRF-or-nothing.
- SW-side materialization: `PasskeyService.materializeCredential(data)` → `PasskeyCredential.create`. Dual transport: PATH A (popup modal supplies data) vs PATH B (SW opens window) — routed by `ProfileService.acquireRecovery` (`service.ts:732-750`) via `PasskeyRecoveryCoordinator` (`passkey-recovery-coordinator.ts:49-140`).

### HKDF chain (`passkey-credential.ts`)
- `create({id, prf, userHandle})` `:49-71`: ikm=fromBase64(prf); salt=SHA-256("nulo:kdf:v1"‖credentialIdBytes); HKDF base key with both deriveBits+deriveKey; local ikm zeroed in finally.
- `deriveMasterSecret()` `:73-99`: HKDF-SHA256 expanded to **512 bits** (#426; info="nulo:master:v1") → Fr.fromBufferReduce → 32-byte master. Rationale pinned: 256-bit expand leaves residues ≈20% relative skew; 64-byte input bias ≤ ~2⁻²⁵⁸. OKM copy wiped all paths.
- `deriveDekWrapKey()` `:109-117`: same extract, distinct expand info="nulo:dek-wrap:v1" → non-extractable AES-GCM-256 CryptoKey. Deterministic per credential ⇒ backups may carry dekSealed verbatim.

### What wraps what
```
profile credential (password passhash-key | PRF-derived wrap key)
   └─seals→ imported-keys DEK (fresh CSPRNG 32B per profile)      [AAD IMPORTED_DEK_AAD]
               └─HKDF(dek, info="nulo:imported-account-key:v2|chainId|address") → AES-GCM per imported signing-key row
password credential ─PBKDF2 key→ seals {guard, master, entropy}   [PROFILE_AAD.guard/.master/.entropy]
envelopeMac = HMAC-SHA256( HKDF(master‖dek), guard.secret.entropy.dek )
```
- DEK box: `IMPORTED_DEK_AAD = "nulo:profile-imported-dek:v1"` (`:29`), len 32, envelope base64 version(1)||iv(12)||ct; unseal length check + zeroize pt on wrong length; envelope wiped every path incl. adversarial throw.
- Imported-key row box: per-row `info = "nulo:imported-account-key:v2|<chainId>|<address>"`; deliberately excludes profileId so backup restore can remap ids and rewrap instead.
- **DEK rationale** (`secret-types.ts:55-60`): two same-phrase profiles share master ⇒ any master-rooted key is sibling-readable; isolation requires distinct credentials (same password across same-phrase profiles collapses it — accepted residual).
- Envelope MAC v2 `entropy-mac.ts`: keyed HKDF(master‖dek) — NOT master-only, because threat-model attacker HOLDS shared master; preimage = 4 slots joined with "." (not in base64 alphabet); 32+32 length enforced; IKM wiped; constant-time verify via WebCrypto. MAC failure never profile-blocks: forces DERIVED-ONLY sessions.

### Duplicate guards
- **Duplicate phrase (soft)**: `wallet-fingerprint.ts` — hex(sha256("nulo:wallet-fingerprint:v1"‖master)), stored plaintext on every row; checked by `assertNotDuplicateWallet` (`service.ts:1858-1869`) UNDER the same facade lock as row commit; match throws typed DuplicateWalletError naming colliding profile unless allowDuplicate. Documented partial-phrase oracle caveat.
- **Duplicate credential (hard)**: `assertNotDuplicateCredential` (`service.ts:1877-1884`) — hard reject regardless of allowDuplicate.

## 3. Encryption-at-rest

### EncryptionKey framing
- `getPasshash(password)` `:122-125` — unsalted SHA-256(UTF8(password)), branded Passhash. PBKDF2 *base-key input*, not the at-rest KDF itself.
- Per-encryption key derivation `deriveKey(salt)` `:15-31`: PBKDF2-SHA256, 600k iterations, salt = SHA-256(iv) → AES-GCM-256.
- Frame: version(1)=0x00 ‖ iv(12) ‖ ct‖tag; decrypt enforces ≥13 bytes + version 0. Optional AAD byte-must-match both sides — slot-swap detection.
- Fresh CSPRNG iv per call; pinned by nonce-uniqueness.test.ts across every box.

### PasswordSecretBox semantics
- `ENCRYPTION_GUARD` fixed 8-byte round-trip constant (DO NOT CHANGE). Wrong-password ⇒ returns null, never throws; error mapping is the facade's job (table at `:14-28`).
- `EncryptedProfileSecret` = base64 {guard, secret, entropy}; encoding frozen.
- `sealInternal` `:195-209`: entropy length must be exactly 32; three AAD-bound encryptions. Purpose-only AAD, no profileId (ids finalize after sealing).
- `unsealInternal` `:214-249`: guard decrypted first + byte-compared; after guard passes a later null means corrupted/transplanted ciphertext surfaced as null; handoff flag ensures decrypted master wiped on EVERY non-return path incl. hostile-slot throws.
- `reseal(old,new,…)` `:166-191`: always re-encrypts master AND entropy atomically (missing entropy would leave recovery decryptable under retired password); oldPasshash wiped in finally.
- Caller-owned params never zeroized inside; locally-derived always are.

### Zeroize discipline
- `zeroize.ts:33-49` fills views or ArrayBuffers. Caveats: CryptoKey internals, Fr internals, immutable strings cannot be zeroed — those sites documented.
- Created-and-wiped inventory: passhash scratch; seed64/copy; PRF ikm; master OKM pair; MAC IKM concat; fingerprint preimage; session pair/token/salt/pt; secret copies at session commit; every facade unseal site.
- Known un-zeroizable escapes (accepted): password strings, PRF base64 strings, Fr internals, exportPlain's returned base64 master string.

### Session bearer (`session-secret-box.ts`)
- `wrapPair(master, dek, aad)` `:69-102`: 32+32 enforced; random token/salt/iv; ONE AES-GCM frame over master‖dek (atomicity); info "nulo:session-wrap:v1"; pair copy allocated inside try so throws wipe it.
- `unwrapPair(wrapped, aad)` `:109-154`: **v-only-2 gate** (`:113`) — legacy v1 master-only records ⇒ null ⇒ silent close, never a dek-less session; never throws; defensive double-wipe of pt.

## 4. Session manager — `apps/extension/src/wallet/services/profile/session-manager.ts`

Config defaults: `sessionTtl = 1_800_000` ms (30 min), `strictSecurityMode = true` (`config/config.ts:20,:26`). Storage root `nulo:core:session` in chrome.storage.session; TTL alarm name `nulo:core:session:ttl`. Lock-agnostic: callers run methods under ProfileService.lock; injected `runExclusive` serializes out-of-band closes against locked writers.

- **`open(profile, secretBuffer, passhash?, dek?)`** `:229-303`. Ordering:
  1. `persistBearer` gate `:243`: passhash present AND not strict AND password-type AND dek present (degraded session persists NO bearer).
  2. Wrap bearer AAD = profile.id.
  3. Build Session {profile, bearer, since, lockedAt}.
  4. **In-memory first**: copy secret → Fr.fromBuffer (copy wiped in finally); zeroize replaced session's dek; set activeSession; emit onChange.
  5. Storage write `:271-294`: on failure best-effort delete + read-back; if record survives undeleted, UNDO memory transition + emit undefined.
  6. Alarm scheduled AFTER commit; scheduling failure falls back to reactive expiry.
  - Whole body swallows errors into logs — degraded-success contract.
- **`close()`** `:308-336`. Memory-first: zeroize dek → drop activeSession → emit undefined; THEN session.delete() with its OWN catch (swallowed delete NOT benign — bearer would resurrect next start); alarm cleared last. Durable guarantee via `hasPersistedSession()` fail-closed read-back (read error ⇒ "still persisted").
- **`refresh()`** `:354-373`: getActive (closes if expired); mutates since/lockedAt on SHARED in-memory object; persists; clear+recreate alarm (stale-fire gate uses persisted lockedAt).
- **`restore(lookup)`** `:436-554` — init-only, silent, called exactly once. Order: corrupt-record fail-closed skip → TTL expiry ⇒ silentClose → missing/tombstoned profile ⇒ silentClose → **passkey profile: skipped entirely, record left in place** → shape gate: legacy passhash OR strict+bearer OR missing bearer ⇒ silentClose → unwrapPair null ⇒ silentClose → strict re-check AFTER async unwrap → verifyEnvelopeMacV2 mismatch ⇒ silentClose → Fr.fromBuffer try/catch (out-of-range crafted master ⇒ silentClose) → commit activeSession → reschedule alarm. Pair buffers wiped in outer finally.
- **`silentClose()`** `:590-599`: storage.delete FIRST, then zeroize dek + clear memory + clearLockAlarm (order differs from close()).
- TTL logic: isExpired = ttl !== 0 && deriveLockedAt(session) <= now; reactive gate in async getActive; proactive via AlarmDispatcher with stale-fire gate `alarm.scheduledTime === deriveLockedAt(...)` under runExclusive; config TTL change handled sync-update + void applyTtlChange (ttl=0 clears; already-elapsed locks immediately; else reschedule).
- Strict mode toggle ON drops any persisted bearer (memory object mutated too, else refresh would rewrite it) without force-locking — clearBearer under runExclusive.
- `getSecret` throws "Profile locked", returns live Fr; `getDek` returns COPY; undefined = degraded; `patchActiveProfile`; `isActive`.

## 5. Profile service facade — `apps/extension/src/wallet/services/profile/service.ts`

One Lock; every RPC under runExclusive unless noted. RPC surface `:64-87`.

- **`createProfile(name, password)`** `:358-413`: CSPRNG entropy → words → deriveMasterFromMnemonic → fresh DEK → secretBox.seal (returns passhash fast-path) → seal DEK under passhash → computeEnvelopeMacV2 → under lock: dup-guard, nextUnreservedId, row write, emit, openSessionVerified. Finally zeroizes secret/entropy/dek/passhash AFTER lock release.
- **`unlockProfile(id, password)`** `:421-529` — three phases so ~1s PBKDF2 never holds lock: (1) locked snapshot + tombstone/type guards; (2) unlocked unseal → null ⇒ InvalidPasswordError, then pairing check assertEntropyMasterPair (CORE failure BLOCKS) + getPasshash; (3) locked revalidate: existence, reservation, type, ciphertext-equality vs snapshot (password changed underneath ⇒ refuse); DEK unseal + envelope-MAC verify — either failure discards DEK and opens **derived-only** + emits onImportedKeysDegraded (never profile-blocks); openSessionVerified; finally wipes buffers.
- **Passkey create/unlock**: createPasskeyProfile `:540-596` (id = pre-reserved userHandle or generated BEFORE prompt; lock-time id-conflict ⇒ retryable ProfileIdConflictError); unlockPasskeyProfile `:616-705` (snapshot → unlocked ceremony → revalidate credentialId binding incl. anti-profile-B-unlocks-A and rotation check; DEK failure ⇒ derived-only; no MAC needed on passkey rows since per-credential wrap key fails closed).
- **`changeProfilePassword`** `:854-990`: reseal (null ⇒ old-password error) → re-unseal new cipher → fail-closed if null → pairing check pre-persist → integrity pre-check with close-on-drift → DEK: unsealed-old + MAC-valid ⇒ rewrap; MAC-invalid ⇒ REFUSE (don't launder transplanted slot); unrecoverable ⇒ mint fresh (self-heal); DEK resealed in SAME atomic row write; MAC recomputed; reopen if active swallowing only post-commit AccountAddressInconsistencyError; five-buffer finally wipe.
- **Exports**: exportPlain `:1446-1569` (passkey branch = credentialId return + sealed-DEK probe; password branch = single unseal + epoch revalidation + pairing check + base64 master); exportBackupMaterial `:1577-1660` (atomic paired export; DEK travels plaintext beside master — forward-reach limitation documented + accepted; exports even under MAC corruption); exportImportedKeysDek `:1678-1722` (fresh-auth, no MAC gate); exportMnemonic `:1735-1787` (words from stored entropy + pairing check + post-derivation locked revalidation).
- **`deleteProfile(id, tornGuard?)`** `:1191-1303` — three phases: (1) under lock: sweep pendings, snapshot, beginDeletion (reserve + epoch bump), tombstone write with commit-ambiguity read-back, row delete, session close BEFORE emit, pending-secret + rewrap-context zeroize, integrity record clears, marker clear LAST among fallible cleanups; (2) OUTSIDE lock: delegate.runFor purge; (3) under lock: clearIfSame(epoch) + release. Torn reap keeps tombstone for idempotent re-purge. Deletion delegate injected by last-started coordinator.
- **`resumePendingDeletions(bootCutoff?)`** `:1326-1427`: corrupt tombstones logged-not-dropped (fail closed); valid tombstones resumed idempotently; torn-import sweep gated on boot cutoff + 7-day age floor with generation-pin + exact-marker-tuple compare-and-delete.
- Deletion fencing: ProfileDeletionState (`profile-deletion-state.ts:19-77`) — reserved set seeded from RAW tombstone keys at init (corrupt tombstones still reserve), epochs hydrated, captureExecutionFence atomic under facade lock, shared with Execution/Transaction via getDeletionState.
- **`pendingRestoreSecrets`** `:120` (memory-only): stashed by passkey restore(); consumed+removed-from-map-before-await by finalizeRestore (`:2463-2474`); TTL-swept at 30 min with zeroize; deleted+zeroized by deleteProfile. Sibling **pendingDekRewraps** `:132-135`: TTL-bound rewrap context consumed by consumeDekRewrapContext (TTL enforced at consume too); leftovers zeroized at finalize.
- **`finalizeRestore`** `:2353-2476`: under lock; sweeps (except own id); tombstone/marker guards; clears restore-pending marker at ENTRY; no-op if already active; password branch mirrors unlock phase-3 with full degradation machine; passkey branch consumes stash.
- **`openSessionVerified`** `:1081-1154` — chokepoint for ALL session opens: deletion epoch capture → torn-marker gate (corrupt blocks; generation-mismatch purges) → integrity delegate verify, or fail-closed durable-block check during startup window (catch closes any prior session) → pre-open reservation check → sessionManager.open → post-open epoch/reservation bracket → post-open isActive invariant.
- **`importMnemonic`** `:1429-1444`: canonical-form validation (24 words) + getEntropy + derive, then delegates to importPasswordProfile `:1915-1955` (dup-guard under commit lock, six-row-shape stamping, finally wipes 4 buffers). importPasskeyProfile `:1961-2010` adds hard credential-dup + soft phrase-dup + reserved-id fallback for absent userHandle.

## 6. Key vectors / freeze pins (LOCKED behavior)

Vector-locked (`apps/extension/src/wallet/crypto/key-vectors.test.ts`):
- V1 passhash fixture; V2a/V2b EncryptionKey frame bytes incl. PBKDF2-600k + salt=SHA-256(iv); V3 passkey master — reference-generated via node:crypto, never re-pin from implementation; V6 backup-checksum hex; V7a signing-key chain — "if this fails every wallet's signing key changed"; V8 PASSKEY_PRF_LABEL literal; V9 AccountType.Nulo_v1 === 0; V11 PXE store key + label; P1 RFC-5869 platform-HKDF cross-check.
- `packages/wallet-crypto/src/bip39-official-kat.test.ts` — all 24 official BIP-39 English rows at passphrase "TREZOR" + negative test (#429).
- account-derivation.test.ts + aztec-runtime derivation-vectors/account-seed-vectors — reference JSON from implementations-plan/key-model-v2/reference/vectors.json.
- nulo-separators.test.ts — provenance + namespace non-collision. reduction-entropy.test.ts — computed min-entropy accounting. nonce-uniqueness.test.ts — structural fresh-nonce pins on all boxes. mnemonic-master/zeroize/encryption-key/session-secret-box/entropy-mac test suites incl. master-holder forgery-must-fail.
- Freeze record: address-freeze.ts canonical NULO_KDF_SPEC text + digest + regime entry + ack string forcing intent into any digest diff.

Free (not vector-pinned): session TTL/alarm behavior, degradation state machine wiring, repository shapes beyond storage-layer pins, UI flows.

## 7. Fresh-diff focus (stack #420: dev ← #417 ← #418 ← #419 ← #426 ← #427, then #429)

- **#417** introduced mnemonic-master/nulo-separators/derive-account-seed, rewrote account-derivation to signing-key-root model, purpose-AAD in encryption-key, reference-vector infra. Moved off EVM-shaped model.
- **#418** store-both (sealed entropy + master) with PROFILE_AAD, pairing checks at every entropy-decryption site, atomic triple-reseal, backup compat-epoch 3→4, deleted plain-secret export, copy sweep. Closed High: same-password cross-profile transplant.
- **#419** NULO-ACCOUNT-EXPORT v1 envelope, AccountType.Imported, imported keys sealed under HKDF(master, per-row info) [pre-DEK], prover-ON frozen-account canary green, zeroization-gap fixes.
- **3bad9390** deleted retired v1 primitives; forgery tests rebuilt in-test.
- **#426** deriveMasterSecret expand 256→512 bits; V3 re-pinned; NULO_KDF_SPEC gained missing passkey clause (digest rotated).
- **#427** isolation-hole fix: ImportedKeysDek brand, imported-keys-dek-box, deriveDekWrapKey, imported-key box v2 rooted in DEK, envelope MAC v2 keyed HKDF(master‖dek) over 4 slots, SessionSecretBox v2 master‖dek frame, all six row-construction sites stamp dekSealed+walletFingerprint, degradation state machine (core failure BLOCKS; DEK-or-MAC failure ⇒ derived-only + warning + NO bearer), clone divergence (fresh destination DEK + source→destination rewrap), soft dup-phrase / hard dup-credential guards.
- **#429** evidence arc — no production code.

Old paths still existing (deliberately, reject-gates/labels): legacy Session.passhash field (written only by pre-F-11 code, restore() never accepts it); bearer format v:1 accepted nowhere; Session.passhash clearing logic retained in clearBearer; v1-named current-generation labels throughout (byte-frozen once profiles exist — do not modernize). No KDF-v1 derivation path exists anywhere.
