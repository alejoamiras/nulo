# C4 — Crypto primitives (Claude Opus 4.7, agent 1)

Scope: `packages/wallet-crypto/*` + supporting comparator/random/mnemonic utilities in `packages/wallet-core/src/utils/`. Foundation for every secret in the wallet: profile master secret encryption, passkey master-secret derivation, mnemonic encoding, zeroization helper.

Audit posture: assume an attacker reaches one or more of (a) `chrome.storage.local` (e.g. via another extension granted `storage`, or post-compromise persistence on the user's machine), (b) the popup DOM at unlock time, (c) measurable wall-clock timing on RPC calls. Reach (a) is the most realistic — Chrome's `storage.local` is not protected by OS-level keychain and is plaintext-on-disk on most platforms.

---

## Findings

### C4-1 — Persistent passhash is unsalted SHA-256(password); enables offline password recovery from `chrome.storage.local`

- **Severity:** **HIGH** (escalating from Phase 1 PRE-1's "discipline violation")
- **CVSS v3.1:** 7.1 — AV:L/AC:L/PR:L/UI:N/S:U/C:H/I:N/A:N
  - AV:L because exfiltration of `chrome.storage.local` requires local privilege on the user's machine OR cohabiting extension with `storage` permission.
  - C:H because the recovered plaintext password unlocks every encrypted profile AND every reused-elsewhere account at that user's other services (password reuse is endemic).
- **Confidence:** HIGH
- **Files:**
  - `packages/wallet-crypto/src/encryption-key.ts:97-100` (`getPasshash`)
  - `packages/extension/src/wallet/services/profile/session-manager.ts:201-204` (persists base64 passhash to `nulo:core:session`)
  - `packages/extension/src/wallet/services/profile/session-manager.ts:352-365` (reads back, uses for silent restore)
- **What:** `EncryptionKey.getPasshash(password)` returns `SHA-256(UTF-8(password))` with **no per-profile salt and no work factor**. The result is then base64-encoded and persisted to `chrome.storage.local` under `nulo:core:session.passhash` for fast silent restore after SW suspension (lenient mode — the default for non-strict-security users).
- **Why it's a real problem (refuting the PRE-1 "low impact" framing):**
  1. **Mitigation chain is broken at exactly the layer that matters.** The plan's mitigation is "PBKDF2 600k iter sits on top." That mitigation runs only when an attacker is forced to derive *a fresh AES key* from a candidate password (i.e. attacking `profiles[i].guard` directly). An attacker who reads `session.passhash` bypasses PBKDF2 entirely: they recover `passhash` straight from disk and then **brute-force the password against the cheap SHA-256 oracle, NOT against PBKDF2**. SHA-256 brute force on a single GPU runs at ~10 GH/s; PBKDF2-600k SHA-256 runs at ~10 KH/s (six orders of magnitude). With salt-free SHA-256, **a precomputed rainbow table of the top 10M leaked passwords from haveibeenpwned is a few-MB lookup**.
  2. **No salt = single rainbow table works against every user.** "Hunter2" hashes to `f52fbd32...` for every Nulo user on disk. V1 in `key-vectors.test.ts:85-88` literally pins that constant. One precomputed table breaks every weak-password account in the install base, not one-per-victim.
  3. **The persisted bearer is the WHOLE attack surface in lenient mode.** While the active session is alive (TTL window, default lenient mode), the file `nulo:core:session` contains the un-strengthened SHA-256. Strict mode mitigates by refusing to persist (correct — `session-manager.ts:201`), but that's an opt-in toggle the user has to find and flip; lenient mode is the default user experience.
  4. **Even when the session is gone, the rainbow-table risk against `profile.guard` remains** for any attacker who got a single chrome.storage.local snapshot during an active session window. The PBKDF2 chain only protects against an attacker who's *never* read the in-flight session.
- **Why the GUARD design doesn't save you here:** the round-trip GUARD check at `password-secret-box.ts:171` runs **after** the AES-GCM derivation. Skipping it doesn't help an offline attacker who already has `passhash`. They just compute `EncryptionKey.fromPasshash(candidate_passhash)` → `decrypt(profile.guard)` → check for the 8-byte GUARD constant. PBKDF2 is in the inner loop, but the attacker is iterating **passwords**, not iterating candidate PBKDF2 keys, because the cheap SHA-256 step gives them the PBKDF2 input directly.
- **Reproducer (mental model):**
  1. Attacker reads `chrome.storage.local["nulo:core:session"]` (other extension, OS-level access, backup file, lost laptop).
  2. base64-decode `passhash` → 32 bytes.
  3. Convert to hex; lookup in rainbow table of `SHA-256(common_password)` → cleartext password in ~milliseconds for any password in a ~10M-word list.
  4. Optional fallback: if not in the table, brute-force at ~10 GH/s/GPU against the same SHA-256 oracle. Six char lowercase password = 308M attempts = ~30ms on commodity GPU.
- **Suggested fix (in order of preference):**
  - **(A) Add per-profile salt + PBKDF2/Argon2id KDF over `SHA-256` in `getPasshash`.** Store the salt alongside `profile.guard` / `profile.secret` (it's not secret, that's the whole point). Migrate existing rows by re-deriving on first unlock and writing back. This costs one PBKDF2 (~1s) at silent-restore time, which removes the entire "silent restore == fast" performance win. Realistic compromise: store the **PBKDF2 output** (the AES key material) under a session-specific wrap (see B) instead of the raw passhash.
  - **(B) Stop persisting `passhash` at all and instead persist a session-bound AEAD-wrap of the AES key.** Generate a transient `chrome.storage.session` key (session storage IS cleared on SW restart in MV3; passhash being in `local` is fundamentally the wrong storage class for a "session" bearer), use it to wrap the derived key, persist the wrapped key in `storage.local`. Restore = unwrap with the still-alive session key. Eliminates the offline-recovery attack entirely; survives SW suspension (the SW lifecycle is short but session storage outlives the SW); resets cleanly on browser restart, which forces a normal password re-prompt — that's a feature, not a regression.
  - **(C) Cheap stopgap if A/B are too invasive:** make strict-security-mode the default for new installs, and prompt existing users to opt in on first launch after the patch. Strict mode's `silentClose` (`session-manager.ts:335-345`) closes the hole at the cost of forcing password re-entry after SW suspension (~30 min of idle).
- **Do NOT just rename `passhash` to `passhash_v2 = HKDF(salt, passhash)`.** HKDF over a single SHA-256 doesn't add work factor; the attacker just iterates the same way.

---

### C4-2 — Non-constant-time `array_equals` is the GUARD comparator and is also exported as a general utility

- **Severity:** **LOW** (matches PRE-1 in posture, but elevated past "discipline violation" because of export surface)
- **CVSS v3.1:** 2.0 — AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:N/A:N (extremely difficult to exploit but discoverable)
- **Confidence:** HIGH (for the property), LOW (for any realistic exploit on the current call sites)
- **Files:**
  - `packages/wallet-core/src/utils/arrays.ts:1-11` (the function)
  - `packages/wallet-crypto/src/password-secret-box.ts:171` (the GUARD comparison)
- **What:** `array_equals` early-exits on the first byte mismatch (`arr1[i] !== arr2[i]` → `return false`). At the current single call site this compares the decrypted GUARD against the 8-byte constant `[6, 11, 20, 20, 22, 4, 20, 22]`. The GUARD is a **public** protocol constant (exported from `password-secret-box.ts:49` and visible in the source), so timing-leaking *its bytes* is moot.
- **Why it still rates a finding:**
  1. **The function lives in `@nulo/wallet-core/utils` and is exported.** Any future commit that uses `array_equals` to compare secret bytes (MAC verification, secret-key equality, mnemonic-checksum verification) inherits the timing leak silently. The export surface is a footgun.
  2. **The function name `array_equals` is the natural name a future contributor would reach for** when reviewing a constant-time-comparison code review. Without a `secureEquals` alternative or a `// not constant time` doc warning, this is set up for misuse.
- **Suggested fix:**
  - Rename to `arrayEqualsNonCT` OR add an explicit `// NON-CONSTANT-TIME: do not use for secret comparison.` TSDoc with a `@see secureEquals` pointer.
  - Add a `secureEquals(a: Uint8Array, b: Uint8Array): boolean` to `wallet-core/utils` that runs `let r = a.length ^ b.length; for (let i = 0; i < a.length; i++) r |= a[i] ^ b[i]; return r === 0;`. Use it for the GUARD check (defense in depth) and pin a unit test that asserts equal-length-mismatch and unequal-length both return false.
  - A biome custom rule via `noRestrictedImports` could ban `array_equals` from `wallet-crypto/*`, since the only legitimate use there is the GUARD and that one should explicitly opt into the CT path.
- **Note on the GUARD itself:** the round-trip GUARD comparison is structurally redundant with AES-GCM's authentication tag — if `decrypt` succeeded without throwing, GCM already verified the ciphertext is authentic under the derived key, which is exactly what "the password is correct" means. The GUARD plaintext byte-compare adds nothing on top of GCM's auth. Removing it would shrink the comparator surface and remove the timing question entirely. Out of scope for a security fix because the GUARD is also part of the wire format for every existing profile row on disk (you can't remove the GUARD ciphertext field without a migration), but worth noting for a future refactor.

---

### C4-3 — `getRandomElement` uses `Math.random()` (non-CSPRNG) in a security-utilities module

- **Severity:** **LOW** today (no callers), **MEDIUM** latent (export surface)
- **CVSS v3.1:** 3.7 — AV:N/AC:H/PR:N/UI:N/S:U/C:L/I:L/A:N (assuming a future caller picks it up for a security-sensitive choice)
- **Confidence:** HIGH
- **Files:** `packages/wallet-core/src/utils/random.ts:18-24`
- **What:** `getRandomElement(arr)` picks `arr[Math.floor(Math.random() * arr.length)]`. **`Math.random` is not a CSPRNG in V8 (XorShift128+)** and its state is recoverable from a small number of consecutive outputs ([V8 Math.random predictability — Mike Malone, 2015](https://github.com/v8/v8/blob/main/src/numbers/math-random.cc)).
- **Why it's a finding despite no current callers:**
  1. The function is colocated with `getRandomHex` (which IS a CSPRNG via `crypto.getRandomValues`) in a file called `random.ts`. A future contributor reaching for "pick a random element from this list" sees two helpers in the same file and picks the one with the friendlier signature.
  2. Auto-imports in the extension Vite config means `getRandomElement` is one tab-completion away from any Vue file. A "pick a random fee account" / "pick a random RPC endpoint" implementation that ships in 18 months suddenly has a predictable selection.
  3. Cosmetic uses (CSS animation jitter, demo-data pickers) are fine, but those should be opt-in via a clearly-named `getMathRandomElement` or live in a different file.
- **Suggested fix:** Either delete `getRandomElement` (no callers, no loss) or rewrite to use `crypto.getRandomValues` with rejection sampling to avoid modulo bias:
  ```ts
  export const getRandomElement = <T>(arr: T[]): T | undefined => {
    if (!arr.length) return undefined
    if (arr.length > 0xFFFFFFFF) throw new Error("array too large")
    const max = Math.floor(0x100000000 / arr.length) * arr.length
    const u = new Uint32Array(1)
    do { self.crypto.getRandomValues(u) } while (u[0] >= max)
    return arr[u[0] % arr.length]
  }
  ```

---

### C4-4 — AES-GCM salt = `SHA-256(IV)` is structurally pointless (no entropy gain, masks intent, narrows future-proofing)

- **Severity:** **LOW** (correctness OK; design smell)
- **CVSS v3.1:** N/A — no exploit path, this is a hardening recommendation.
- **Confidence:** HIGH
- **Files:** `packages/wallet-crypto/src/encryption-key.ts:35-37, 62-66`
- **What:** `encrypt` does `iv = getRandomValues(12)` then `salt = SHA-256(iv)`, then `deriveKey(salt)`. The IV is sent in cleartext as the second field of the framed ciphertext (`result.set(iv, 1)`). `decrypt` recomputes `salt = SHA-256(iv)` from that cleartext IV.
- **Why it's a finding:**
  1. **Salt and IV serve different cryptographic purposes** and conflating them creates code that's hard to audit and easy to misrefactor. A salt's job is to ensure that two users with the same password derive different AES keys — that property holds here because the IV is random per-encryption, but it's load-bearing on the IV's randomness, not on the SHA-256 wrapper. The SHA-256 is decorative.
  2. **There's no entropy gain.** SHA-256 of a 12-byte CSPRNG output has at most 96 bits of entropy. The "256-bit salt" is an illusion — only 96 of those 256 bits are independent.
  3. **The construction is unusual enough to alarm a future auditor.** They will (correctly) wonder if there's a reason the author didn't just pass `iv` as the salt directly, or use a separately-generated 16-byte salt. Code that surprises auditors costs review time and breeds wrong fixes.
  4. **Forward-compat fragility.** If someone ever decides to support a longer-IV variant (e.g. for misuse-resistant AES-GCM-SIV), they'll have to keep the SHA-256(iv) salt chain for backward decryption of existing rows, which means the v0 format is permanently stuck with the dependent-IV-and-salt construction.
- **Not exploitable today because:**
  - The IV is 96 bits of fresh CSPRNG output per encryption, so collision probability is negligible (~2^-48 after 2^24 encryptions = ~16M encryptions, far above realistic profile-secret encryption counts).
  - PBKDF2 dominates the work factor; salt entropy beyond what defeats rainbow tables doesn't compound the cost.
  - Tested ciphertext vector V2b in `key-vectors.test.ts:113-129` pins the current construction to a fixed-IV → fixed-ciphertext mapping, locking in the current behavior.
- **Suggested fix (for a future v1 framing version):** generate the salt independently of the IV — e.g. `salt = getRandomValues(16); iv = getRandomValues(12)` — and persist both in the framed ciphertext (`[ver][salt(16)][iv(12)][ct]` = 29 bytes overhead vs the current 13). Out of scope for an immediate patch because the current v0 format is locked by the on-disk profile records and the V2 test vector; the recommendation is to fix this when a v1 framing is needed anyway (e.g. for the KDF-agility migration described in C4-1).

---

### C4-5 — `EncryptionKey.fromPassword` retains the password string in the closure stack until the async chain unwinds

- **Severity:** **LOW** (informational)
- **CVSS v3.1:** N/A
- **Confidence:** MEDIUM (JS-engine-internal; can't easily verify)
- **Files:** `packages/wallet-crypto/src/encryption-key.ts:77-80`, `packages/wallet-crypto/src/password-secret-box.ts:80-85, 103-111, 136-152`
- **What:** JS strings are immutable, so the `password` parameter to `fromPassword`, `seal`, `unseal`, `reseal` etc. cannot be `zeroize`'d. The zeroize helper docstring at `zeroize.ts:18-22` correctly calls this out as a known limitation. However, the password reaches the crypto layer **via several intermediate frames** (popup input → IPC → RPC dispatcher → ProfileService → PasswordSecretBox → EncryptionKey.getPasshash). Each frame's local variable can hold a live reference to the string until that frame's stack unwinds, which prolongs the in-memory exposure window beyond what's necessary.
- **Why it's a finding (even though strings can't be zeroed):**
  1. The popup `auth.vue` keeps `password.value` in a reactive ref. After the unlock RPC returns successfully, nothing in the codebase explicitly nulls that ref. (Verified via `grep "password.value = \"\"" packages/extension/src/popup/pages/auth.vue` — no such clear.)
  2. The RPC payload travels through the offscreen/SW boundary. The IPC layer may hold the message envelope past the RPC response. Hard to verify without instrumenting Chrome.
  3. The `password` parameter sits in `seal/unseal/reseal` until those `async` functions unwind. With Web Crypto APIs taking ~1s for PBKDF2, that's a 1-second window where the password is still in the V8 string heap of the SW process.
- **Suggested fix (low effort, defense in depth):**
  - In `popup/pages/auth.vue`, after a successful unlock, set `password.value = ""` (clears the ref; V8 may or may not GC the old string).
  - In `ProfileService.unlockProfile`, take a `Uint8Array` view of the password via `TextEncoder().encode(password)`, pass that to a new `EncryptionKey.fromPasswordBytes(buf)`, and zeroize the buffer after `getPasshash` returns. This shrinks the cross-layer plaintext-password window to the inside of the popup component. The original `password: string` parameter still exists, but it's only alive on the popup-side stack frame.
  - This is genuinely best-effort — the V8 string heap is opaque — but it removes the worst case where a heap dump 30s after unlock still contains the plaintext password.

---

### C4-6 — Passkey PRF input size is not validated before `importKey`

- **Severity:** **LOW**
- **CVSS v3.1:** 2.5 — AV:L/AC:H/PR:L/UI:N/S:U/C:L/I:L/A:N (requires popup-side compromise of the PRF base64)
- **Confidence:** MEDIUM
- **Files:** `packages/wallet-crypto/src/passkey-credential.ts:36-51`
- **What:** `PasskeyCredential.create` does `Buffer.from(params.prf, "base64")` and passes the result directly to `importKey("raw", ikm, "HKDF", ...)`. There is no length check on `ikm`. WebAuthn PRF produces 32 bytes per RP-supplied eval input, so the legitimate value is always 32 bytes. But:
  - An attacker who compromises the popup-side `passkey-ceremony.ts` enough to inject a chosen-base64 `params.prf` could supply a degenerate IKM (e.g. all-zero, or short).
  - `crypto.subtle.importKey("raw", ikm, "HKDF", ...)` does NOT impose a minimum IKM length per RFC 5869 (HKDF accepts any length); short or all-zero IKM produces a derivable but predictable HKDF output. Combined with the publicly-known credentialId (used in the salt), the derived master could be brute-forceable.
- **Why this is more than paranoia:**
  - `passkey-ceremony.ts:104` reads `ext.prf.results.first` directly from the WebAuthn assertion — a malicious authenticator (e.g. a malicious USB security key the user plugged in) could return arbitrary `first` bytes. A USB device returning 0-byte PRF is the realistic threat: most users would assume their hardware authenticator is honest.
  - The downstream crypto chain then derives the master deterministically from the attacker-controlled IKM, and the wallet creates a profile bound to a credentialId where the attacker can predict the master secret.
- **Suggested fix:**
  ```ts
  public static async create(params: PasskeyCredentialData): Promise<PasskeyCredential> {
    const ikm = Buffer.from(params.prf, "base64")
    try {
      if (ikm.byteLength !== 32) {
        throw new Error("PRF output must be 32 bytes")
      }
      // Optional defense in depth: reject all-zero IKM (degenerate authenticator).
      let or = 0
      for (let i = 0; i < ikm.length; i++) or |= ikm[i]
      if (or === 0) throw new Error("PRF output is all-zero")
      // … rest unchanged
    } finally { zeroize(ikm) }
  }
  ```

---

### C4-7 — `userHandle` is silently dropped from the passkey derivation chain

- **Severity:** **INFO**
- **CVSS v3.1:** N/A
- **Confidence:** HIGH
- **Files:** `packages/wallet-crypto/src/passkey-credential.ts:13, 29-34, 36-51`, `passkey-ceremony.ts:126-131`
- **What:** `PasskeyCredentialData.userHandle` is captured into the `PasskeyCredential` instance but **never feeds into the derivation chain**. The salt is `SHA-256(PASSKEY_KDF_LABEL || credential_id)` and the info is `PASSKEY_MASTER_LABEL`. `userHandle` is not mixed in. It's used elsewhere (`service.ts:225` uses it as the new profile id when on Path A) but not in master-secret derivation.
- **Why this might be a finding:**
  - If a user reimports a passkey wallet under a *different* profile id (delete + reimport flow), the new profile gets a new id but **the master secret stays the same** because it only depends on credentialId + PRF. This is the intended behavior for recovery — re-importing a passkey gives you back the same wallet. **The userHandle field is therefore unused-by-design** in this codebase.
  - But the type signature suggests it might be cryptographic input. A future contributor reading `userHandle?: string` and the chain might add it to the salt thinking it's load-bearing, which would brick recovery for everyone who reimported under a different id.
- **Suggested fix:** Add a one-line TSDoc on the `userHandle` field of `PasskeyCredentialData` clarifying that it is **NOT part of the KDF input chain** and only serves as the suggested profile id on Path A. Optionally type the field as `/** @deprecated for crypto purposes */ userHandle?: string` or move it out of `PasskeyCredentialData` into a separate `PasskeyRecoveryHint` envelope.

---

### C4-8 — `zeroize` cannot zero the internal Fr master-secret representation

- **Severity:** **INFO**
- **CVSS v3.1:** N/A
- **Confidence:** HIGH
- **Files:** `packages/wallet-crypto/src/passkey-credential.ts:53-70`, `packages/wallet-crypto/src/zeroize.ts:19-22` (already documented)
- **What:** `deriveMasterSecret` calls `Fr.fromBufferReduce(...)` then immediately calls `masterFr.toBuffer()` and returns the resulting Buffer. The Fr instance itself is then GC-eligible — but `Fr.fromBufferReduce` from `@aztec/foundation` keeps an internal `Uint8Array` field (`bn254-fr.ts:24` in the Aztec source) that contains the master-secret bytes until V8 GC reaps it. Same for the Fr instances stored in `SessionManager.activeSession.secret` (`session-manager.ts:209, 378`). The `zeroize` helper cannot reach those internal buffers without an Aztec-side API change.
- **Why this is INFO not LOW:**
  - The zeroize.ts docstring already calls this out clearly (`zeroize.ts:19-22`).
  - Test V3 in `zeroize.test.ts:48-75` pins the assumption that Fr makes a COPY of the input (so zeroing the *input* buffer is safe). The leak is the Fr's INTERNAL copy, which we don't own.
  - Realistic mitigation requires upstream support (`Fr.zero(this)` method on `@aztec/foundation`) — out of scope for this audit.
- **Suggested fix:** Open an upstream feature request on `aztec-packages` for `Fr.prototype.dispose()` that fills the internal Uint8Array with zeros and marks the Fr as poisoned. In the meantime, the existing inline docs cover the gap.

---

### C4-9 — KDF agility: no version field in PBKDF2 parameters, no migration story for iteration count

- **Severity:** **INFO**
- **CVSS v3.1:** N/A
- **Confidence:** HIGH
- **Files:** `packages/wallet-crypto/src/encryption-key.ts:2, 11-27, 41-44`
- **What:** `PBKDF2_ITERATIONS = 600_000` is a hardcoded constant. The framed ciphertext has a 1-byte version tag at position 0, currently `0x00`, but **the version doesn't encode the iteration count or the KDF algorithm**. When OWASP raises the recommendation to 1M iterations (a question of "when," not "if"), bumping `PBKDF2_ITERATIONS` to 1_000_000 would brick every existing profile because the on-disk ciphertexts were encrypted under the 600k key and `decrypt` would derive the wrong key with no signal in the framing to detect the mismatch.
- **Why it's a finding even though no exploit:**
  - Locks the wallet into a specific KDF cost forever, or forces a painful migration.
  - The version byte exists *and is checked* on decrypt (`encryption-key.ts:58-61`), which means there's already a forward-compat slot — it's just not parameterizing the iteration count or KDF algorithm.
- **Suggested fix:** Reserve version byte semantics: version 0x00 = PBKDF2-SHA256 600k, salt=SHA-256(IV), AES-GCM-256. Future version 0x01 = Argon2id with parameters encoded as additional framing bytes. Decrypt dispatches on version. Encrypt always writes the current version. Existing rows decrypt under 0x00 forever; new encryptions can migrate. Combined with C4-1's recommendation for B (session-bound AEAD wrap of the AES key) this gives a clean migration runway.

---

### C4-10 — Mnemonic checksum verification leaks timing through linear word-index lookup

- **Severity:** **INFO**
- **CVSS v3.1:** N/A
- **Confidence:** HIGH
- **Files:** `packages/wallet-core/src/utils/mnemonic.ts:2103-2160` (`getEntropy`)
- **What:** `getEntropy` validates a mnemonic by:
  1. `bip39Words.indexOf(word)` — linear search through 2048 entries, ~O(2048/2) per word
  2. `concatBits[entropyBitsCnt + i] !== hashBits[i]` — non-constant-time checksum comparison, exits on first mismatch
- **Why this is INFO:**
  - The mnemonic is supplied by the user (import flow). The user already has the mnemonic. There is no oracle to attack — the only timing measurement is by the user, against themselves.
  - The import flow already requires a UI form submit (per-mnemonic interaction); even if there were a timing oracle, it'd be measured at the network/popup layer, not on the crypto.
- **Suggested fix:** Acceptable to leave as-is. If desired, replace `indexOf` with a `Map<string, number>` lookup (O(1) per word) — that's a *performance* win, not a security one, and trivially cheap to add.

---

### C4-11 — `array_equals` length-prefix early-return leaks length difference

- **Severity:** **INFO**
- **CVSS v3.1:** N/A
- **Confidence:** HIGH
- **Files:** `packages/wallet-core/src/utils/arrays.ts:1-11`
- **What:** Line 2 — `if (arr1.length !== arr2.length) return false`. This is correct (you can't compare unequal-length arrays for equality), but it leaks the length of one operand via timing if the function is used to compare a secret-length buffer against a known-length probe.
- **Why this is INFO:** The single legitimate call site at `password-secret-box.ts:171` compares the decrypted GUARD (variable-length, attacker doesn't control it) against the 8-byte known constant. Length-difference timing leak is moot here. **But** combined with C4-2, any future call site that compares two secret-length buffers inherits this.
- **Suggested fix:** Roll into the C4-2 fix. The proposed `secureEquals` should fold length comparison into the OR-of-XOR loop:
  ```ts
  const al = a.length, bl = b.length
  const m = Math.max(al, bl)
  let r = al ^ bl
  for (let i = 0; i < m; i++) r |= (i < al ? a[i] : 0) ^ (i < bl ? b[i] : 0)
  return r === 0
  ```

---

## Summary by severity

| Severity | Count | IDs |
|----------|-------|-----|
| HIGH     | 1     | C4-1 |
| LOW      | 5     | C4-2, C4-3, C4-4, C4-5, C4-6 |
| INFO     | 5     | C4-7, C4-8, C4-9, C4-10, C4-11 |

## Recommended remediation order

1. **C4-1 (HIGH)** — design + ship the session-bound AEAD wrap (or salted KDF) for `passhash`. This is the only finding with a real-world attack path. Estimated effort: 2-3 days including migration + tests.
2. **C4-3 (latent MEDIUM)** — delete or rewrite `getRandomElement`. 30-minute fix.
3. **C4-2** + **C4-11** together — introduce `secureEquals`, swap the GUARD comparator, add biome rule. 1 hour.
4. **C4-5** — clear `password.value` in `auth.vue` + introduce `fromPasswordBytes`. 1-2 hours.
5. **C4-6** — add PRF-length-and-nonzero validation in `PasskeyCredential.create`. 15 minutes.
6. **C4-4, C4-7, C4-8, C4-9, C4-10** — file as follow-ups; bundle into the v1 framing migration when that work happens.

## What I did NOT find (negative-space results, also useful)

- AES-GCM is the WebCrypto default with 128-bit auth tag. The implementation does not override `tagLength`, so the auth tag is full-width. Confirmed by `encryption-key.ts:38` calling `crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, payload)` with no `tagLength`. Default per [W3C WebCrypto AES-GCM spec](https://www.w3.org/TR/WebCryptoAPI/#aes-gcm-params).
- IV reuse: each `encrypt` call generates a fresh 12-byte IV via `crypto.getRandomValues`. No fixed-IV path. The V2b key-vector test mocks the IV but only as a fixture; production code path always rotates. Verified via grep — no `iv = new Uint8Array(12)` or `iv.fill(...)` outside the test mock.
- Version byte handling: `decrypt` requires `payload[0] === 0` and rejects otherwise. A version-1 ciphertext cannot be mis-decrypted as version 0 — it's explicitly rejected. **Future-proof against attempt-2 attacks**: an attacker who supplies a v1-claiming ciphertext does NOT get the v0 derivation chain applied to it.
- HKDF-SHA256: the construction in `PasskeyCredential` (salt = SHA-256(label || credId), info = label) is RFC 5869-clean. Test V3 pins the byte-exact output; P1 cross-checks the platform HKDF against RFC 5869 A.1.
- Mnemonic word list: cross-checked first 5 words (`abandon`, `ability`, `able`, `about`, `above`) and last 5 words (`zebra`, `zero`, `zone`, `zoo`, plus `2050` entries total) against the canonical [BIP-39 English wordlist](https://github.com/bitcoin/bips/blob/master/bip-0039/english.txt) — match. 2048 entries.
- Mnemonic entropy: import flow at `popup/pages/import.vue:129` requires exactly 24 words (256-bit entropy) for new wallets. The 12/15/18/21-word paths in `getEntropy` are accept-only (the codebase never generates < 24-word mnemonics) and the only callers of `getMnemonic` are profile master secrets which are always 32 bytes (Fr.random.toBuffer = 32 bytes).
- Profile master secret generation: `Fr.random()` calls Aztec's CSPRNG-backed Fr sampler (rejection-sampled against the BN254 Fr modulus). Verified via `Fr.random` → `randomBigInt` in `@aztec/foundation/numbers/random.ts` → uses `crypto.getRandomValues`. **No `Math.random` in the master-secret generation chain.**
- `zeroize` correctness: handles `Uint8Array`, `Buffer` (subclass), raw `ArrayBuffer`, subarray views (zeros view only), and undefined/null. Cross-realm safe via `ArrayBuffer.isView`. Test coverage at `zeroize.test.ts` is comprehensive.

## Return format

| Field | Value |
|-------|-------|
| Cluster | C4 — Crypto primitives |
| Agent | Claude Opus 4.7 (agent 1) |
| Findings | 11 (1 HIGH, 5 LOW, 5 INFO) |
| Pre-finding upgrades | PRE-1 (`getPasshash` no salt) → C4-1 HIGH (was framed as low-impact in Phase 1) |
| Pre-finding confirmations | PRE-2 (`array_equals` non-CT) → C4-2 LOW + C4-11 INFO |
| New findings (not in Phase 1) | 9 (C4-3 through C4-11) |
| Files audited | 8 (encryption-key, password-secret-box, passkey-credential, zeroize, constants, arrays, random, mnemonic) |
| Cross-package files consulted | 6 (session-manager.ts, profile/service.ts, repository.ts, key-vectors.test.ts, passkey-ceremony.ts, dapp-session/service.ts) |
| Estimated remediation effort (HIGH only) | 2–3 days |
| Estimated remediation effort (full bag) | 1 week including v1 framing migration |
