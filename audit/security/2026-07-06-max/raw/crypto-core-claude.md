CLUSTER: crypto-core

## Findings

### [1] Silent-restore bearer is an unsalted single SHA-256 of the password (password-equivalent AND reversible to the plaintext password)

1. **Title** — `passhash` (`SHA-256(password)`) doubles as the PBKDF2 base key and a persistable session bearer; being a single unsalted hash it leaks the plaintext password if the bearer is exposed.

2. **Impact factors** — Confidentiality (secret-material + credential exposure). CIA property: confidentiality. Blast radius: single user per exposed bearer, but escalates *beyond* the wallet — the recovered value is the user's actual plaintext password, commonly reused on other sites. Data sensitivity: maximal (wallet master-secret decryption key + a reusable human password). Exploitability: attack vector local (needs read of `chrome.storage.session` or a process-memory image, not network); attack complexity low (offline GPU/rainbow-table on a raw SHA-256); privileges required high (attacker must already have extension-context code-exec or device/memory access); user interaction none for the crypto step, but the persistence sink requires the user to have turned strict mode OFF (non-default).

3. **Evidence confidence** — high on the construction and the persistence path; moderate on end-to-end exploitability (the persistence sink is gated by a non-default toggle, and reading session storage needs a pre-existing capability).

4. **OWASP / CWE mapping** — OWASP A02:2021 Cryptographic Failures (also A07 Identification & Authentication Failures). CWE-759 (One-Way Hash without a Salt), CWE-916 (Password Hash with Insufficient Computational Effort), CWE-522 (Insufficiently Protected Credentials).

5. **Trace** —
   - Source (construction): `packages/wallet-crypto/src/encryption-key.ts:97-100` — `getPasshash(password) = crypto.subtle.digest("SHA-256", utf8.encode(password))`. One unsalted, single-iteration SHA-256 of the raw password.
   - This value is used directly as the PBKDF2 base key: `packages/wallet-crypto/src/encryption-key.ts:87-90` (`fromPasshash` → `importKey("raw", passhash, "PBKDF2", …, ["deriveKey"])`). Whoever holds the passhash can derive the AES-GCM key and decrypt the master secret *without the password and without knowing it*, bypassing the 600 000-iteration stretch (the stretch runs only on top of the passhash, not to produce it).
   - The same passhash is returned to callers to feed session restore: `packages/wallet-crypto/src/password-secret-box.ts:80-85` (`seal` returns `Sealed.passhash`) and `packages/wallet-crypto/src/encryption-key.ts:78` (`fromPassword`).
   - One-hop into the consuming cluster (DI/produce→consume edge): `apps/extension/src/wallet/services/profile/session-manager.ts:202-214` — `open()` persists the bearer: `passhash: persistPasshash ? Buffer.from(passhash).toString("base64") : undefined`, where `persistPasshash = passhash !== undefined && !this.strictSecurityMode` (`session-manager.ts:211`). Sink: a base64 SHA-256(password) row in `chrome.storage.session`.
   - Reload path reads it back and treats it as password-equivalent: `apps/extension/src/wallet/services/profile/session-manager.ts:374-387` (`unseal(passhashBuffer, profile)`). Trace exits cluster at `session-manager.ts:214`.

6. **Missing control** — No salt and no key-stretching on the value that is treated as a long-lived, password-equivalent credential. A silent-restore bearer should be either the 600k-PBKDF2-derived key material or a high-entropy random wrapping key, never `SHA-256(password)`. Because there is no salt and only one hash iteration, an exposed bearer is invertible to the plaintext password for weak/common passwords at billions of guesses/second (or via precomputed rainbow tables).

7. **Exploit story / violation scenario** — User disables "strict security mode" (a real, user-facing toggle exposed for "stay unlocked" convenience; `strictSecurityMode` config key). On next unlock, `session-manager.open()` writes `base64(SHA-256(password))` to `chrome.storage.session`. An attacker who later obtains extension-context code execution (a compromised/typosquatted dependency in the SW bundle, or any same-extension read primitive) or a browser-process memory image reads that row. Beyond decrypting *this* wallet (which the bearer already permits), the attacker runs an offline single-SHA-256 brute force / rainbow-table lookup and recovers the user's actual plaintext password — which is frequently reused for email/exchange accounts, converting a local wallet compromise into a credential-stuffing pivot.

8. **Preconditions** — For the persisted sink: `strictSecurityMode = false` (NOT the default; default is `true` at `apps/extension/src/wallet/config/config.ts:18`), plus attacker read-access to `chrome.storage.session` (extension-context exec or memory dump). For the pure-crypto weakness (password recovery from any exposed passhash): any leak of the passhash — a future log line, a serialization, or the transient in-memory copy captured in a dump — suffices, independent of the toggle.

9. **Why mitigations fail** — `strictSecurityMode` defaulting to `true` shrinks the persistence exposure but does not fix the construction: (a) the passhash still exists and flows through memory on every unlock even in strict mode, and (b) the toggle is user-controllable, so a convenience-seeking user re-enables the sink. The 600 000-iteration PBKDF2 (`encryption-key.ts:1-2,11-27`) protects the *stored ciphertext* against a from-scratch password brute force, but it does NOT protect the passhash bearer — the bearer *is* the PBKDF2 input, so anyone holding it skips the iterations entirely, and its single-SHA-256 form is what enables password recovery. `chrome.storage.session` being memory-only/extension-private raises the bar to local/extension-exec attackers but does not change the marginal harm (plaintext-password recovery) once that bar is met.

10. **Instances** — Root cause: `packages/wallet-crypto/src/encryption-key.ts:97-100` (`getPasshash`). Bearer-producing call sites: `packages/wallet-crypto/src/encryption-key.ts:78` (`fromPassword`), `packages/wallet-crypto/src/password-secret-box.ts:80-85` (`seal`), `:136-147` (`reseal` returns a new passhash). Password-equivalent consumption: `packages/wallet-crypto/src/encryption-key.ts:87-90` (`fromPasshash`), `packages/wallet-crypto/src/password-secret-box.ts:96-99,122-125` (`sealWithPasshash`/`unsealWithPasshash`). Persistence sink (one hop, out of cluster): `apps/extension/src/wallet/services/profile/session-manager.ts:211-214`.

### [2] Master secret survives unzeroed in the Fr internal buffer after `deriveMasterSecret`

1. **Title** — `PasskeyCredential.deriveMasterSecret` reduces the HKDF output into an `Fr`, whose internal copy of the master-secret bytes is never zeroed and lingers in heap until non-deterministic GC.

2. **Impact factors** — Confidentiality (secret-material lifetime). CIA property: confidentiality. Blast radius: single user (the profile master secret from which signing keys derive). Data sensitivity: maximal. Exploitability: attack vector local (requires a process-memory image or in-extension read primitive); attack complexity high (must locate + time the read against GC); privileges required high; user interaction none.

3. **Evidence confidence** — high (the missing zeroization is visible in source and acknowledged in `zeroize.ts` caveats); the *exploitability* is low.

4. **OWASP / CWE mapping** — OWASP A02:2021 Cryptographic Failures. CWE-226 (Sensitive Information in Resource Not Removed Before Reuse) / CWE-316 (Cleartext Storage of Sensitive Information in Memory).

5. **Trace** —
   - `packages/wallet-crypto/src/passkey-credential.ts:53-70` — `deriveBits(HKDF)` → `masterBits` (zeroed in `finally`, `:68`, good) → `Fr.fromBufferReduce(Buffer.from(new Uint8Array(masterBits)))` (`:60`) makes a **second** copy of the secret inside the `Fr` object → `masterFr.toBuffer()` (`:63`) makes a **third** copy that is returned to and owned by the caller.
   - Only `masterBits` is zeroed. `masterFr` (holding copy #2) is dropped without wiping; the transient `Buffer.from(new Uint8Array(masterBits))` argument (`:60`) is also unzeroed. Both become GC-eligible but persist in heap for an unbounded window. Documented limitation: `packages/wallet-crypto/src/zeroize.ts:20-22` ("`Fr` internals … CANNOT be zeroed").

6. **Missing control** — No wipe of the intermediate `Fr` (the `@aztec/foundation` `Fr` type exposes no zeroization hook, so the copy cannot be scrubbed without a patched constructor or a scratch buffer that is reduced in place). The `Buffer.from(new Uint8Array(masterBits))` temporary is likewise not tracked for zeroization.

7. **Exploit story / violation scenario** — An attacker with a browser-process memory image (device access) or an in-extension read primitive dumps the SW heap after a passkey unlock and scans for 32-byte high-entropy runs; the master secret persists in the abandoned `Fr` buffer past the point the caller believes it has been cleaned up, widening the recovery window beyond the caller-owned buffer it dutifully zeroes.

8. **Preconditions** — A passkey-type profile unlock has run in the SW; attacker has heap-read capability (memory dump / extension-context exec). No network vector.

9. **Why mitigations fail** — The function correctly zeroes the buffers it *can* (`masterBits`, `:68`), and the caller zeroes the returned buffer, but neither can reach the copy embedded in the `Fr` object; `zeroize()` explicitly cannot scrub `Fr` internals (`zeroize.ts:20-22`). Defense-in-depth zeroization elsewhere in the package is therefore incomplete for the highest-value secret it produces.

10. **Instances** — `packages/wallet-crypto/src/passkey-credential.ts:60` (Fr copy), `:60` (`Buffer.from(new Uint8Array(masterBits))` temporary). Same inherent limitation applies wherever `Fr.fromBuffer*` wraps a secret, but this is the crypto-core instance that mints the master secret.

## Notes

Checked and judged NOT findings (no concrete reachable exploit, or framework-guaranteed):

- **AES-GCM per-message construction is sound.** `encryption-key.ts:34-47`: IV = 12 random bytes from `self.crypto.getRandomValues` (CSPRNG, no `Math.random` anywhere in the package — verified by grep). `salt = SHA-256(iv)`, `key = PBKDF2(SHA-256(pw), salt, 600k) → AES-GCM-256`. Because the derived key is a 1:1 function of the IV, every message gets a *unique (key, nonce) pair*; catastrophic GCM nonce-reuse can only occur on a 96-bit IV collision (~2⁻⁹⁶), which also collides the key. No nonce-reuse break. Deriving the salt from the (public) IV is unusual but cryptographically fine — salts are not secret and a 96-bit random salt still defeats precomputation.
- **AES-GCM integrity is enforced.** WebCrypto `decrypt` verifies the tag and throws on mismatch; `tryDecrypt` (`password-secret-box.ts:192-198`) maps that to `null`. The 1-byte version frame (`encryption-key.ts:41-44,58-61`) is outside the AEAD but only value `0` is accepted (single version) → tampering fails closed. Guard/secret ciphertext swap fails closed too (32-byte secret ≠ 8-byte `ENCRYPTION_GUARD` → `array_equals` false).
- **`array_equals` is non-constant-time** (`packages/wallet-core/src/utils/arrays.ts:1-11`, early return on first mismatch) but the guard comparison it feeds (`password-secret-box.ts:171`) is only reached *after* AES-GCM has already authenticated the ciphertext — an attacker cannot produce a valid tag without the key, so the timing channel leaks nothing exploitable. Not a finding.
- **PBKDF2 cost is current.** `encryption-key.ts:1-2` uses 600 000 iterations of PBKDF2-SHA256, matching OWASP 2023 guidance. (Doc drift only: `packages/wallet-crypto/README.md:17` still says "250k iterations" — the running value is the stronger 600k; cosmetic, not a security finding.)
- **`Fr.fromBufferReduce` modulo bias** (`passkey-credential.ts:60`): reducing a uniform 256-bit HKDF output mod the ~254-bit BN254 scalar field yields negligible bias (~2⁻²⁵⁴); the resulting master secret retains ~254 bits of entropy. Not a finding.
- **`getPasshash` materializes raw password bytes** in an unzeroed `utf8.encode(password)` Uint8Array (`encryption-key.ts:98-99`). Marginal: the `password` arrives as an immutable JS string that is itself un-zeroable, so this copy adds no *incremental* exploitable exposure. Defense-in-depth only, not raised as a finding.
- **`reseal` throw-path** (`password-secret-box.ts:136-152`): if `sealInternal` throws after `newPasshash` is derived, the `finally` zeroes `oldPasshash` + `secret` but not `newPasshash`. Error path only, and `newPasshash` is designed to escape to the caller anyway. Not a finding.
- **`getHashHex`** (`encryption-key.ts:107-115`) is a correct plain SHA-256→hex. Its only caller uses it as a backup-integrity checksum (`apps/extension/src/composables/useFullBackupImport.ts:226`, a different cluster). A non-keyed hash gives no tamper-resistance against an active attacker who can recompute it, but that is a use-site concern outside this cluster — flagging here only as a pointer for the `ext-popup-sensitive`/composables reviewer.
