# Phase L — Password/passkey bearer redesign + memory hygiene (F-11, Low) — DEEP

Branch: `fix/hf-l-bearer-redesign` off `fix/harden-findings`. **Last unit; after E** (both edit `session-manager.ts`; the new bearer must also be strict-suppressed, and E's config-allowlist keeps strict un-lowerable by a backup).

**F-11 scope = option (a), SESSION-ONLY (resolved at approval):** NO storage-version bump, NO destructive wipe, existing profiles/accounts preserved — at most a one-time re-unlock for non-strict-mode users.

## The bug
The silent-restore bearer for **non-strict password profiles** is the raw `passhash` (base64) stored in `Session.passhash` (`chrome.storage.session`). `passhash = EncryptionKey.getPasshash(password)` is an **unsalted SHA-256 of the password** — password-equivalent. A session-store leak yields a value that (a) unseals the secret given the profile record, and (b) is cheaply brute-forceable back to a weak password / reusable. `restore()` (`session-manager.ts:374-387`) reads `session.passhash` → `unseal(passhash, profile)` → secret.

## Design — random-token wrapped secret (replaces the passhash bearer)
`open()` (non-strict only): generate a fresh **random token**; compute `wrappedSecret = AEAD_encrypt(masterSecret, key=KDF(token))`; store `{wrappedSecret, token, …}` in the `Session` instead of `passhash`. `restore()`: recover `masterSecret = AEAD_decrypt(wrappedSecret, key=KDF(token))`. The token is **random, not password-derived** → a session leak reveals neither the password nor a password-equivalent (it still reveals the secret — that is the definition of a silent-restore bearer, unchanged from today). **Do NOT touch the AES-GCM/PBKDF2 profile-record core** (`PasswordSecretBox.seal`/`unsealWithPasshash`, verified sound) — only the Session bearer.

Also (memory hygiene): keep the passkey HKDF master-secret in a wipeable `Uint8Array` and `zeroize` it **before** it is wrapped into an `Fr` (`passkey-credential.ts:~60`); wipe the `fromPassword` passhash scratch (`password-secret-box.ts`).

## ✅ NO-RE-REGISTRATION INVARIANT — PROOF (the gate; holds, so no STOP-and-surface)
Claim: a profile created before L still unlocks after L, with no wipe / re-registration / storage-version bump.
1. **The Profile record `{guard, secret}` (chrome.storage.local) is UNTOUCHED.** It is `password → getPasshash → PBKDF2 → AES-GCM(masterSecret)`. L changes ONLY the ephemeral `Session` bearer, never `PasswordSecretBox.seal`/`unseal`, PBKDF2, or the record shape. ⇒ **`unlockProfile(id, password)` reads the same record and decrypts it with the same password — byte-for-byte unchanged.** Existing profiles unlock via password exactly as before.
2. **Machine-checkable guard:** `key-vectors.test.ts` (the profile-record encryption byte-vectors) stays **byte-identical**. If a change to L would alter it, the invariant is violated → CI red → I STOP. (I will run it as the first L gate step.)
3. **The Session bearer is ephemeral** (`chrome.storage.session`, cleared on browser restart). Old-format sessions (with `passhash`) are simply not recognized by the new `restore()`, which **`silentClose`s** them (graceful) → the popup lock screen → the user re-unlocks **once** with their password. That is a one-time re-auth, NOT re-registration (the profile persists; the password works).
4. **Strict-mode users (default)** persist no bearer at all ⇒ no session to invalidate ⇒ zero change.
∴ The only user-visible effect is a single re-unlock for the minority of non-strict users, and only until their next unlock. **No profile is deleted, no account re-registered, no storage version bumped.** Invariant holds. ∎

## Open questions → codex (DEEP, back-and-forth; F-10/I/E consults confirmed codex is up)
- Q1 **Token placement + real threat model.** If both `token` + `wrappedSecret` sit in the same `Session` record, a session leak still recovers the secret (as today). Is the sole win "no password-equivalent in session," or is a stronger split/binding warranted (e.g. bind the wrap key to a per-install SW-memory key so a cold session dump alone can't unwrap)? What's the right cost for a **Low** finding?
- Q2 **Wrapping primitive.** `AES-GCM` with `HKDF(token)`? Reuse `EncryptionKey`/`PasswordSecretBox`, or a new tiny wrapper? IV/nonce handling; token length (≥256-bit).
- Q3 **Invariant audit.** Attack the proof above — any path where L's Session change forces a profile re-registration or breaks `unlockProfile` for an existing profile? Confirm `restore()` must `silentClose` (not throw) on an old `passhash`-shaped or unknown-shaped session.
- Q4 **Strict-mode + E interaction.** Confirm the new bearer is gated by the SAME `strictSecurityMode` check in `open()`/`restore()` (a strict session persists NO bearer; a strict-mode restore that finds a bearer `silentClose`s). E guarantees a backup can't lower strict.
- Q5 **Passkey memory hygiene** — the zeroize-before-Fr + passhash-scratch wipe: any ordering/lifetime subtlety (the secret must survive into the `Fr`, then the raw buffer wiped)?

## Codex DEEP verdict (gpt-5.5 high) — ADOPTED
- **New tiny `SessionSecretBox`** in `wallet-crypto`, NOT `PasswordSecretBox`/`EncryptionKey` (reusing PBKDF2 on a random 256-bit token is wasteful + domain-blurring).
- **Session shape:** `bearer?: { v:1, token:b64(32 rand), wrappedSecret:b64([ver||iv||ct||tag]), salt:b64(32 rand) }`; keep `passhash?` **legacy-only, NEVER accepted by the new restore**.
- **Primitive:** `key = HKDF-SHA256(token, salt, info="nulo:session-wrap:v1")` → AES-GCM-256, fresh 96-bit IV per wrap, **AAD = stable domain || `profile.id`** (NOT `since`/`lockedAt`). Zeroize token/derived/decrypted bytes after copying into `Fr`.
- **NO per-SW-instance in-memory half-key** — gold-plating; it breaks silent restore after MV3 SW suspension. Cold-dump resistance would need a platform keystore / re-auth (out of scope for Low).
- **Invariant weak point = restore shape handling.** `restore()` MUST `silentClose()` (never throw at init) for: any legacy `passhash` password session (even non-strict), missing bearer on a password profile, malformed b64 / wrong token length / **bad AES-GCM tag** / unknown bearer `v`, mixed `passhash`+bearer, and strict-mode + any bearer. Rollout is safe both directions (old code reads new session → no `passhash` → close; new code reads old → legacy bearer → close). No profile loss.
- **Strict mode:** same policy as `passhash`; rename `clearPasshash()`→`clearBearer()` AND mutate the in-memory `activeSession.session` (else `refresh()` rewrites a cleared bearer). **Race:** re-check `strictSecurityMode` AFTER the async decrypt + immediately before setting `activeSession` (a mid-restore strict-toggle-ON could clear storage while restore resurrects an in-memory bearer session).
- **Memory hygiene:** keep `passkey-credential.ts` ordering (derive HKDF bits → copy/reduce into `Fr` → return fresh 32-byte buffer → zeroize raw HKDF bits); callers zeroize that returned buffer after `open()` copies into `Fr`. Fix `EncryptionKey.fromPassword()` to zeroize its local `passhash` scratch AFTER `fromPasshash()` imports it (not before). Document that strings + non-extractable `CryptoKey` internals aren't wipeable.

## Negative tests (planned)
- `key-vectors.test.ts` — **unchanged, byte-identical** (the invariant guard).
- New bearer-mechanism unit test: `open()` non-strict writes a token-wrapped bearer (NO raw passhash in the Session); `restore()` recovers the same secret; a tampered `wrappedSecret`/`token` → `silentClose` (no secret).
- Existing-profile unlock: a profile record from before L unlocks with its password (password path untouched).
- Strict mode: `open()` persists no bearer; `restore()` finding a bearer under strict → `silentClose`.
- Passkey memory hygiene: the raw master-secret buffer is zeroized after the `Fr` is built (spy/inspect).

## Gate (plan.md Unit L — DEEP, network-e2e gated): `bun run --filter '@nulo/wallet-crypto' test` + `bun run test` (incl. **byte-identical** `key-vectors.test.ts`) + `bun run typecheck:all` + `bun run lint` + `NULO_E2E_PROVERLESS=1 bun run e2e:agent` (unlock / silent-restore / passkey flows). Layers: unit · typecheck · lint · network-e2e.
