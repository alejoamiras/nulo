# Codex audit — key-model-v2 (Round 1, gpt-5.6-sol xhigh, fresh session)

> Verdict: reject — all blocking findings adopted into plan.md rev 2 (see decision ledger L2/L3/L6/L7/L11/L13). Paths rewritten repo-relative.

reject (with blocking findings: profile entropy/master are not runtime-bound, P2 omits the integrity coordinator, and account-key export/storage lacks service-side authorization and atomic lifecycle rules)

## High

- [plan §C](implementations-plan/key-model-v2/plan.md:53): “store-both” creates a recovery-breaking split-brain. Existing AES-GCM ciphertexts have no purpose/profile AAD, so an attacker can swap the 32-byte `secret` ciphertext into `entropy`; it decrypts successfully and exports valid-looking but useless words. A test-time invariant does nothing at runtime. Make entropy required for password profiles, bind ciphertexts to profile ID and purpose, and verify `PBKDF2(entropy) == master` during unlock/export/restore. Password change must reseal entropy too; P3 omits that path.

- [account-integrity/coordinator.ts:52](apps/extension/src/wallet/services/account-integrity/coordinator.ts:52): P2 changes AccountService to `l1ChainId`, but the coordinator independently reimplements the old composite-chain formula. It is absent from the file map and P2. Every existing derived account would be blocked at unlock. Extract one shared pure account-seed function and update both consumers.

- [plan §E](implementations-plan/key-model-v2/plan.md:69): password confirmation appears UI-only. The export RPC itself must authenticate in the same background operation; otherwise a compromised popup can call it directly. Passkey profiles also need ceremony-bound authorization, not “password confirm.”

- [plan §E storage/signing](implementations-plan/key-model-v2/plan.md:76): two roots introduce torn writes, orphaned secrets, restore-order failures, and missed profile/network purges. Duplicate-address import can overwrite a derived Account row. Specify one AccountService-owned lock/transaction-with-compensation, duplicate rejection, awaited purges, backup referential integrity, and AEAD AAD. Missing row, malformed envelope, decrypt failure, invalid scalar, and address mismatch must all durably block and close—not only the final mismatch.

## Medium

- [plan §A entropy claim](implementations-plan/key-model-v2/plan.md:28): the claim is false. Reduction necessarily caps the master at `log2(r) ≈ 253.6` bits; Poseidon and the Grumpkin scalar similarly cap outputs. The `≤2^-258` modulo-bias argument assumes a uniform 512-bit input, while fixed PBKDF2 is fed only 2²⁵⁶ possible mnemonics. This is not a practical attack—the remaining strength is enormous—but “no narrowing” and “256-bit master” must be removed and gates cannot prove them.

- [plan §B](implementations-plan/key-model-v2/plan.md:46): `l1ChainId` is not a rollup identifier. Same master/type/index on two rollups sharing an L1 produces exactly the same key/address. That is cross-context reuse by construction. The lookup must also be `(profileId, composite)`, not composite-only, and validate a canonical nonnegative safe integer.

- [account/service.ts:151](apps/extension/src/wallet/services/account/service.ts:151): the “free per-type sequence” claim is wrong: when another type exists, `array_max([]) + 1` yields index 1. Fix the calculation. Also, [NuloAccount’s constructor is public](packages/aztec-runtime/src/account/nulo-account.ts:46), contrary to recon; make it private and share a common tail between `new` and `fromSigningKey`.

- Phase gates are not independent: move canary capture repair before P4 deletes its helper; add coordinator work to P2; add password-change/store-tamper tests to P3; and require a live imported-account transaction in P6. P5 smoke cannot prove signing. KATs prove exact outputs, not entropy or domain-separation security.

## Low

- Drop `secretKey` from account exports; it is redundant and invites consumers to mistake a privacy root for an ownership key. A second “guard” inside an authenticated AES-GCM envelope is also unnecessary.

## Assumption attack

**Facts:** I1 is resolved false—`getEntropy` already verifies checksum at [mnemonic.ts:2153](packages/wallet-core/src/utils/mnemonic.ts:2153). “Private ctor,” “per-type index math,” and “no hardcoded mnemonics in tests” are misstated.

**Inferences:** I2 is unsafe because seeded Local Network currently avoids probing; making profile creation depend on anvil availability is unacceptable. I3 is true. I4 needs explicit framing: the carried Trezor seed uses passphrase `TREZOR`, not the empty default. I5 is operational, not an architectural assumption.

**Asks:** A1: cut it. A2 should ask whether any build, backup, or artifact escaped—not merely whether users exist. Also ask whether same-L1 rollup key reuse is intentional, whether account exports may cross L1s, and how passkey-backed export is authorized.

## Outline A vs B

Pick A, conditionally. Real BIP-39 semantics, acceptance of every valid 24-word phrase, and future passphrases outweigh P3’s pre-launch schema cost. It does not increase the final master beyond ~253.6 bits; its justification is interoperability and UX. Without runtime binding of entropy to master, B is safer.

## What looks fine

Keeping the XOR composite for storage scope, persisting exact L1 identity separately, dedicated separators with pinned vectors, the compat-epoch bump, hostile-input size/schema checks, and deriving privacy keys one-way from the signing root are sound.
---

# Codex audit — key-model-v2 (Final fresh-context pass on rev 2, gpt-5.6-sol xhigh, new session)

> Verdict on rev 2: reject — all findings adopted into rev 3 (ledger L16–L23). Resumed re-verdict on rev 3 appended below when received.

reject (with blocking findings: silent restore bypasses entropy/master binding; imported-key backups break after profile-ID remapping; L1 identity is not end-to-end bound; plaintext tamper detection is impossible as claimed)

### High

- `plan.md §C/P3; profile/service.ts:231; session-manager.ts:392` — Silent bearer restoration unwraps only the master and has no password with which to decrypt entropy. Therefore the promised unlock-time pairing check cannot run: tampered/lost entropy can coexist with an active wallet. Version the bearer to carry and verify entropy too, or disable silent restoration for password profiles.

- `plan.md §E backup; useFullBackupImport.ts:487` — Per-row HKDF includes `profileId`, but restore routinely remaps profile IDs before restoring slices. Backed-up ciphertext then cannot decrypt under the new ID; moreover accounts restore before generic slices/finalization, so the orphan-drop rule can discard valid imported accounts. Use a stable logical binding such as `(master, chainId, address)`, or define a portable rewrap format and explicit restore order. Add collision-remap and passkey-backup signing tests.

- `plan.md §B; network/service.ts:_getChainId` — Account-carried `l1ChainId` solves the coordinator’s pre-session constraint and detects direct Account-row tampering, but Network-row tampering before account creation produces a self-consistent poisoned account that the coordinator accepts. Endpoint add/update currently validates only the XOR composite; a different `(l1ChainId, rollupVersion)` pair can collide. Require exact L1 equality on endpoint mutation and Account↔Network consistency on restore/creation.

- `plan.md Success criteria/§E` — A plaintext export checksum is not authentication. An attacker can replace `signingKey`, recompute its address and checksum, and create a fully valid attacker-controlled file. Treat the checksum as accidental-corruption detection only; require prominent derived-address confirmation and narrow “tampered export fails closed” to encrypted exports or non-self-consistent mutations.

### Medium

- `plan.md §C/H/P3; password-secret-box.ts` — The AAD retrofit omits the required `PasswordSecretBox` API refactor and final-ID-before-seal ordering. Create/import/restore currently choose or remap IDs after sealing. Also, P3 makes `exportEncrypted` ciphertext non-importable before P4 deletes that surface. Co-land A1’s cut with AAD activation and add one atomic backup-material export returning paired master+entropy.

- `plan.md §C restore` — “Whenever both fields are present” is too weak: epoch-4 password backups must require entropy; passkey backups must reject entropy. Otherwise required password rows cannot be constructed consistently.

- `plan.md Phases P1–P3` — P1 changes signing derivation and the regime record before P2/P3 activate the remaining formula, leaving mergeable hybrid KDFs. Keep runtime switches and freeze-record mutation dormant until one atomic phase/arc.

- `plan.md §A` — The `≤2^-258` bias bound assumes uniform 512-bit input; PBKDF2 over the mnemonic domain only supports a PRF-model claim. Mean phrase preimages are approximately 5.29, not 5.7. The passphrase must also be NFKD-normalized; add a Unicode-passphrase KAT.

### Low

- `plan.md I3` — `GeneratorIndex` is not exported by the installed Aztec 5.0.1 tree. Replace this inference with an inventory of actual separator namespaces.

- `plan.md §E/A4` — Durable quarantine needs an authenticated repair or deletion path; duplicate rejection otherwise makes a quarantined imported account permanently unrecoverable.

A1 — Agree; cut it atomically with P3’s AAD change.

A2 — Agree, conditional on ratifying that no prior build, backup, or artifact remains supported.

A3 — Agree, provided cross-rollup address linkage is explicitly accepted.

A4 — Agree; single-account quarantine is appropriate, with durable status and repair/deletion UX.
---

# Codex re-verdict on rev 3 (resumed session)

conditional approve (with conditions: authenticate the entropy carrier before silent-session activation; independently source/verify l1ChainId at account creation; specify the imported-key backup slice owner and ordering)

### High

- `§C/L16` — A harm path survives. Tampered entropy can remain undetected while a no-TTL bearer repeatedly restores the wallet, allowing continued deposits and operation after the locally redisplayable recovery phrase has become unusable. Failure may surface only when the bearer is lost—precisely when recovery is needed. No false words or exfiltration occurs, but recovery availability silently degrades. A master-keyed MAC over the entropy ciphertext would detect mutation during silent restore without decrypting entropy or versioning the bearer.

- `§B/L18` — `DEFAULT_SEEDS` only initializes the mutable Network row; it is not the trust root when AccountService later copies `row.l1ChainId`. Direct pre-creation tampering therefore still creates a coordinator-valid but clean-reimport-inconsistent account, including for seeded networks. Compare seeded rows against immutable constants; live-probe custom networks at account creation, or explicitly obtain owner acceptance of this recovery-poisoning risk.

### Medium

- `§E/L17; backup-migration-registry.ts; full.vue; useFullBackupImport.ts` — The new root still lacks a concrete slice owner. The registry maps one service to one descriptor, while AccountService already owns the Account root and export/import use fixed client lists. Specify a new service/client or multi-root descriptor, with key restoration completed before orphan reconciliation and session activation.

### Low

- `§A/Security` still says `GeneratorIndex`/“dual-enum,” contradicting revised I3. P4 still schedules encrypted-key deletion already assigned to P3.
---

# P3 crypto rider — consult (post-Phase-3, blocking gate)

> Verdict: FAIL (1 High: cross-profile transplant). Fixes applied in the following commit; envelope-wide MAC + pairing checks at reseal/backup-export/finalize + zeroize-on-throw. Re-verdict appended after.

fail (blocking findings: same-password cross-profile transplants can bypass or launder the recovery binding)

## High

- Purpose-only AAD blocks cross-slot swaps, but same-slot ciphertexts remain portable between profiles sharing a password. Replacing A’s entropy with B’s authentic entropy decrypts successfully. [`changeProfilePassword`](<apps/extension/src/wallet/services/profile/service.ts:739>) performs no pairing check, then rewrites the MAC at [service.ts:766](<apps/extension/src/wallet/services/profile/service.ts:766>), laundering the mismatch into a bearer-valid profile. Account integrity still passes because master A and its accounts remain unchanged. I reproduced: transplant decrypts, old MAC rejects, pair mismatches, rewritten MAC accepts.

  Conversely, transplanting B’s `secret` leaves A’s entropy/MAC intact, so bearer restore accepts at [session-manager.ts:462](<apps/extension/src/wallet/services/profile/session-manager.ts:462>) because the MAC covers only entropy. Password unlock/export later fails, silently degrading recovery availability—the previously classified High harm. Pair-check before reseal, backup export, and finalize; MAC a canonical encoding of the entire ciphertext envelope, not entropy alone. The same missing check lets [exportBackupMaterial](<apps/extension/src/wallet/services/profile/service.ts:1367>) report success with an unrestorable pair.

## Medium

- The e2e derivation oracle still computes KDF v1—unseparated Poseidon over composite `chainId`—at [import-drivers.ts:223](<apps/extension/tests/e2e/helpers/import-drivers.ts:223>). Its backup fixture also stamps epoch 3 and omits entropy at [import-drivers.ts:297](<apps/extension/tests/e2e/helpers/import-drivers.ts:297>); the passkey fixture remains epoch 3 at [passkey-backup.test.ts:135](<apps/extension/tests/e2e/passkey-backup.test.ts:135>). These fixtures now test guaranteed rejection, not successful v2 restore.

## Low

- Exceptional-path zeroization is incomplete: locally derived passhashes can escape wiping when sealing/resealing throws ([password-secret-box.ts:94](<packages/wallet-crypto/src/password-secret-box.ts:94>), [password-secret-box.ts:167](<packages/wallet-crypto/src/password-secret-box.ts:167>)); create/restore/finalize also establish `finally` blocks after sensitive allocations. No plaintext logging was found.

The KDF spec/digest/KATs otherwise match, with a ~253.5967-bit floor. Zero-salt HKDF is sound; MAC-field tampering only forces re-unlock. Restore validation precedes writes, and password reseal persists one atomic JSON row. A whole coherent quadruple transplant is intentionally indistinguishable without profile-ID binding; existing account rows normally catch it.