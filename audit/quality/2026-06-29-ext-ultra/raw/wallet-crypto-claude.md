# QUALITY audit — `packages/wallet-crypto` (typing + dedup lens)

> Scope: `packages/wallet-crypto/src/**` excl. `*.test.ts`. Quality/maintainability only —
> crypto SECURITY is explicitly out of focus (correctness of the derivation chain is not
> assessed here). Cross-package citations included where the smell propagates or duplicates.
> Baseline note: package is **`any`/`unknown`-clean** (0 occurrences in source) — the typing
> debt is entirely *loose-but-concrete* types (bare buffers / bare strings) and the casts they force.

---

### Q1 Primitive obsession on secret/key bytes — bare `ArrayBuffer`/`Uint8Array` for `passhash`, `secret`, `salt` (no branded types)
- **Smell:** Primitive Obsession (Fowler).
- **Lens:** typing
- **Maintenance impact:** architectural
- **Blast radius:** 2 packages, 4 files (wallet-crypto + extension profile service/session-manager).
- **Instances:**
  - `packages/wallet-crypto/src/encryption-key.ts:87` — `static fromPasshash(passhash: ArrayBuffer)`
  - `packages/wallet-crypto/src/encryption-key.ts:97` — `static getPasshash(...): Promise<ArrayBuffer>`
  - `packages/wallet-crypto/src/encryption-key.ts:11` — `deriveKey(salt: ArrayBuffer)` (salt is a bare buffer too)
  - `packages/wallet-crypto/src/password-secret-box.ts:71-74` — `type Sealed = { passhash: ArrayBuffer; encrypted: … }`
  - `packages/wallet-crypto/src/password-secret-box.ts:96` — `sealWithPasshash(passhash: ArrayBuffer, secret: Uint8Array<ArrayBuffer>)`
  - `packages/wallet-crypto/src/password-secret-box.ts:122` — `unsealWithPasshash(passhash: ArrayBuffer, …)`
  - `packages/wallet-crypto/src/password-secret-box.ts:80,103,136` — `secret`/return values typed bare `Uint8Array<ArrayBuffer>` (the "32-byte master secret" concept)
  - Propagation into the extension (same primitive, no brand):
    - `packages/extension/src/wallet/services/profile/session-manager.ts:80` — `passhash: ArrayBuffer`
    - `packages/extension/src/wallet/services/profile/session-manager.ts:202` — `open(profile, secretBuffer, passhash?: ArrayBuffer)`
    - `packages/extension/src/wallet/services/profile/service.ts:817` — `importPasswordProfile(…, passhash: ArrayBuffer)`
    - `packages/extension/src/wallet/services/profile/service.ts:924` — `let passhash: ArrayBuffer | undefined`
- **Evidence:** A `passhash` (the public, persisted KDF-output hash that bears silent session re-derivation), the raw master `secret`, the PBKDF2 `salt`, the AES IV, and any ciphertext are ALL just `ArrayBuffer`/`Uint8Array<ArrayBuffer>` at the type level. They are mutually assignable. `seal`/`sealWithPasshash` take `(passhash, secret)` and `(secret, passhash)` would type-check identically — nothing stops a caller transposing a secret buffer into the passhash slot, or feeding an IV where a salt is expected. The compiler offers zero protection on the most security-sensitive plumbing in the wallet.
- **Why it harms future change:** Any refactor of the passhash flow (e.g. the session-restore fast-path in `session-manager.ts`, or `importPasswordProfile`) moves bare buffers across 4 files with no type guard; a transposition is a silent corruption found only at decrypt time / by the V2 vector test, not at compile time. New call sites inherit the ambiguity.
- **Refactoring:** Introduce branded nominal types in wallet-crypto (`type Passhash = ArrayBuffer & { readonly __brand: "Passhash" }`, likewise `MasterSecret`, `Salt`) and thread them through the public surface. This is **type-only — zero runtime/byte change**, so the frozen V1–V8 vectors stay green. The brand should anchor the extension's profile/session passhash plumbing (the 4 extension sites above), making transposition a compile error.
- **Effort:** days (type-only but ripples through 2 packages + their tests).
- **Confidence:** high

---

### Q2 Stringly-typed base64/hex wire + on-disk fields — interchangeable secrets in `PasskeyCredentialData` and `EncryptedProfileSecret`
- **Smell:** Primitive Obsession / Stringly-Typed (analog: a domain concept — "base64 of credential id" vs "base64 of secret IKM" — carried as bare `string`, distinguished only by comments).
- **Lens:** typing
- **Maintenance impact:** structural
- **Blast radius:** 2 boundary types; `PasskeyCredentialData` is re-exported to ~13 sites via `passkey/spec.ts`.
- **Instances:**
  - `packages/wallet-crypto/src/passkey-credential.ts:7-14` — `PasskeyCredentialData = { id: string; prf: string; userHandle?: string }` (`id`/`prf` BOTH base64; `prf` is secret IKM; `userHandle` is hex — semantics only in comments at :9/:11/:13)
  - `packages/wallet-crypto/src/password-secret-box.ts:57-66` — `EncryptedProfileSecret = { guard: string; secret: string }` (both base64 ciphertext under the same key)
- **Evidence:** In `PasskeyCredential.create` (`passkey-credential.ts:37,39`), `Buffer.from(params.prf, "base64")` and `Buffer.from(params.id, "base64")` are adjacent; swapping `params.id`↔`params.prf` type-checks and would silently derive a wrong-but-valid-looking key (or leak which field is the secret IKM). Same for `EncryptedProfileSecret`: a transposed `{ guard: secret, secret: guard }` assignment compiles and silently writes a corrupt profile row that only fails on next unseal.
- **Why it harms future change:** These are the on-wire (popup→background) and on-disk (Profile record) boundary shapes — exactly where future serialization/migration edits happen. A field transposition during such an edit is invisible to `tsc` and lands as data corruption.
- **Refactoring:** Brand the fields (`Base64<"credId">`, `Base64Secret<"prf">`, `Hex<"userHandle">`; `Base64<"guard">` / `Base64<"secret">`) or wrap in single-field nominal types. Type-only; encoding stays frozen.
- **Effort:** hours–days
- **Confidence:** high

---

### Q3 `Buffer` ↔ `Uint8Array<ArrayBuffer>` ↔ `ArrayBuffer` triple-representation duality, papered over by casts
- **Smell:** Primitive Obsession (one concept, three runtime representations) + the casts are Temporal-Coupling-adjacent (correctness depends on which representation the byte happens to be in at each hop).
- **Lens:** typing
- **Maintenance impact:** structural
- **Blast radius:** both KDF chains + leaks into the consumer (`profile/service.ts`).
- **Instances (the duality):**
  - `encryption-key.ts` uses `Uint8Array<ArrayBuffer>` for encrypt/decrypt payloads (:34,:54) but `getPasshash` returns raw `ArrayBuffer` (:97)
  - `passkey-credential.ts:53,63` — `deriveMasterSecret(): Promise<Buffer<ArrayBuffer>>` (a THIRD representation for the same "32-byte master secret" concept)
  - `password-secret-box.ts` plumbs everything through `Buffer.from(...)` (:160,:161,:169,:174)
- **Instances (the casts the duality forces — all non-comment):**
  - `password-secret-box.ts:157` — `ENCRYPTION_GUARD as Uint8Array<ArrayBuffer>` — the const is declared `Uint8Array` at `:49`; **fixable at the declaration**, drop the cast entirely.
  - `password-secret-box.ts:169` — `Buffer.from(encrypted.guard, "base64") as Uint8Array<ArrayBuffer>`
  - `password-secret-box.ts:174` — `Buffer.from(encrypted.secret, "base64") as Uint8Array<ArrayBuffer>`
  - `passkey-credential.ts:63` — `masterFr.toBuffer() as Buffer<ArrayBuffer>`
  - `zeroize.ts:39,46` — `buf as Uint8Array` / `buf as ArrayBufferLike` (intrinsic to the generic-narrowing impl; well-tested + documented — **low priority**, list-only)
  - Leaks into consumer: `packages/extension/src/wallet/services/profile/service.ts:628` — `Buffer.from(secret, "base64") as Uint8Array<ArrayBuffer>` (same pattern repeats untyped at :654,:913).
- **Evidence:** A reader can't tell which representation a given secret is in without tracing the call graph; the casts exist solely to reconcile `Buffer.from(...)` (returns `Buffer`/`Uint8Array<ArrayBufferLike>`) with the `Uint8Array<ArrayBuffer>` the crypto methods demand. `:157` is a pure declaration bug — the cast hides that `ENCRYPTION_GUARD` was under-typed.
- **Why it harms future change:** Each new byte-handling site must rediscover the right cast incantation (see the consumer leak). A representation change anywhere (e.g. dropping the Buffer polyfill, see `globals.d.ts`) forces a sweep of every cast.
- **Refactoring:** (1) Fix `ENCRYPTION_GUARD`'s declared type to `Uint8Array<ArrayBuffer>` → delete `:157`. (2) Introduce shared `toBase64()/fromBase64()` helpers returning the canonical `Uint8Array<ArrayBuffer>` (see Q5) → erases `:169`,`:174`, and the consumer cast at `service.ts:628`. (3) Standardize `deriveMasterSecret` to return `Uint8Array<ArrayBuffer>` like the rest of the package (Move/normalize return type) → drop `:63`.
- **Effort:** hours (cast cleanup); the full representation unification is days.
- **Confidence:** high

---

### Q4 Hex-encode loop triplicated across three packages → extract `bytesToHex`
- **Smell:** Duplicate Code (Fowler).
- **Lens:** dedup
- **Maintenance impact:** local (structural across the 3 packages)
- **Blast radius:** 3 production files in 3 packages.
- **Instances (ALL production occurrences, verified repo-wide; `node_modules` excluded):**
  - `packages/wallet-crypto/src/encryption-key.ts:114` — `[...hashArray].map((b) => b.toString(16).padStart(2, "0")).join("")`
  - `packages/wallet-core/src/utils/random.ts:9` — `for (const b of bytes) hex += b.toString(16).padStart(2, "0")`
  - `packages/bridge-core/src/content-hash.ts:43` — `for (const b of digest) hex += b.toString(16).padStart(2, "0")`
  - Related same-family BigInt variant (note, not identical loop): `packages/bridge-core/src/content-hash.ts:26,30` — `…toString(16).padStart(64, "0")` (`word`/`wordFromBigInt`).
- **Evidence:** Three byte→hex encoders, hand-rolled with the identical `b.toString(16).padStart(2,"0")` idiom, differing only in `.map().join()` vs `for…+=`. `wallet-core` is already a dependency of both `wallet-crypto` and `bridge-core`, and its `src/utils/index.ts` barrel is the natural home (it already exports `array_equals`, `getRandomHex`).
- **Why it harms future change:** A correctness fix (e.g. handling of odd-length input, performance via lookup table) must be applied in 3 places or they drift; `random.ts`'s `getRandomHex` and `encryption-key`'s `getHashHex` already differ stylistically for the same operation.
- **Refactoring:** Extract Function → one `bytesToHex(bytes: Uint8Array): string` in `@nulo/wallet-core/utils` (alongside `array_equals` in `arrays.ts`); have all three call it. Duplication of the byte-encoding idiom disappears.
- **Effort:** hours
- **Confidence:** high

---

### Q5 Base64 encode/decode duplicated with TWO divergent implementations → extract `toBase64`/`fromBase64`
- **Smell:** Duplicate Code (Fowler), aggravated — same operation implemented two different ways that can drift.
- **Lens:** dedup
- **Maintenance impact:** structural
- **Blast radius:** 4 packages.
- **Instances:**
  - **Strategy A — hand-rolled `btoa`/`atob` + charCode loop:** `packages/bridge-core/src/recovery-crypto.ts:35-39` (`toBase64`), `:41-46` (`fromBase64`); `packages/extension/src/utils/full-backup-helpers.ts:19` (`Uint8Array.from(atob(...), c => c.charCodeAt(0))`).
  - **Strategy B — `Buffer.from(...)`:** `packages/wallet-crypto/src/password-secret-box.ts:160,161,169,174`; `packages/wallet-crypto/src/passkey-credential.ts:37,39`; `packages/extension/src/wallet/services/profile/session-manager.ts:214,374`; `packages/extension/src/wallet/services/profile/service.ts:628,654,761,913`; `packages/extension/src/wallet/utils/passkey-ceremony.ts:19,23`; `packages/wallet-core/src/utils/serialization.ts:31,33`.
- **Evidence:** `recovery-crypto.ts` rolls its own `btoa`-based base64 while the rest of the codebase uses `Buffer.from(...).toString("base64")`. Two encoders for the identical operation is exactly the divergence risk: the charCode-loop variant and the Buffer variant can disagree on edge cases (large inputs, surrogate handling) and only one will get fixed. The Buffer-strategy sites also each carry the `as Uint8Array<ArrayBuffer>` cast from Q3.
- **Why it harms future change:** Removing the Node `Buffer` polyfill (a live tension — see `globals.d.ts` rationale) would require touching every Strategy-B site; consolidating first makes that a one-line swap. A correctness fix to base64 handling has no single home today.
- **Refactoring:** Extract `toBase64(bytes): string` / `fromBase64(b64): Uint8Array<ArrayBuffer>` into `@nulo/wallet-core/utils` (returning the canonical representation from Q3), and replace all sites. Collapses two implementations into one and erases several Q3 casts.
- **Effort:** hours
- **Confidence:** high

---

### Q6 Parallel "encrypt-then-verify-by-reopening" seal primitive in `bridge-core/recovery-crypto.ts`
- **Smell:** Duplicate Code / Divergent Change (two independent verified-seal abstractions over the same `EncryptionKey` that must evolve in lock-step but can't).
- **Lens:** dedup
- **Maintenance impact:** structural (cross-package)
- **Blast radius:** 2 packages (wallet-crypto `PasswordSecretBox` ↔ bridge-core recovery-crypto).
- **Instances:**
  - `packages/wallet-crypto/src/password-secret-box.ts:168-187` — `unsealInternal` does an `ENCRYPTION_GUARD` round-trip integrity check (encrypt a known constant, decrypt + `array_equals` compare) to detect wrong-key/corruption.
  - `packages/bridge-core/src/recovery-crypto.ts:55-60` (`sealSecret`), `:62-65` (`openSecret`) — its own seal/open over `EncryptionKey`; `:72-86` (`sealRecordSecret`) and `:168-187` (`sealDepositRecord`) implement a `reopened !== secret` round-trip self-test that conceptually mirrors the GUARD round-trip.
- **Evidence:** Both layers independently encode "encrypt, then prove it by reopening before trusting the blob." `PasswordSecretBox` proves via a fixed GUARD constant; `recovery-crypto` proves via re-derive-and-compare-plaintext. Same concept, two implementations, no shared primitive — and bridge-core sits ABOVE wallet-crypto in the layer graph, so a shared verified-seal primitive in wallet-crypto is import-direction-feasible.
- **Why it harms future change:** A hardening change to the verified-seal contract (e.g. constant-time compare, AAD binding) must be made twice and kept consistent by convention only. They will drift.
- **Refactoring:** Consider Extract Class / Pull Up — a single `verifiedSeal`/`verifiedUnseal` primitive in wallet-crypto that both consume. **Wise-dedup caveat:** the two are not byte-identical (GUARD-constant vs reopen-compare; password vs per-record signature key), so unify the *verification shape* only — don't force the key-derivation differences together. Validate against both packages' vector/round-trip tests.
- **Effort:** days
- **Confidence:** moderate

---

## Minor (named, low-value — not separately scored)

### Q7 HKDF domain-separator labels split from `PASSKEY_PRF_LABEL`
- **Smell:** Divergent Change (analog) — three frozen domain separators of ONE derivation chain live in two files.
- `packages/wallet-crypto/src/constants.ts:10` holds `PASSKEY_PRF_LABEL = "nulo:profile:v1"`; the sibling labels `nulo:kdf:v1`/`nulo:master:v1` are module-private at `packages/wallet-crypto/src/passkey-credential.ts:20,21`. All three are "**DO NOT CHANGE**" vector-locked separators. Co-locating them (read-only, no byte change) makes the frozen-contract surface legible in one place. Effort: hours. Confidence: moderate.

### M1 README doc drift (security-relevant constant + wrong file map)
- `packages/wallet-crypto/README.md:17` states PBKDF2 **"250k iterations"**; source `packages/wallet-crypto/src/encryption-key.ts:2` is **`600_000`**. A misleading doc for a security-critical KDF cost.
- `packages/wallet-crypto/README.md:20` lists `ENCRYPTION_GUARD` as living in `src/constants.ts`; it is actually exported from `src/password-secret-box.ts:49`. (`constants.ts` holds only `PASSKEY_PRF_LABEL`.)
- Smell: doc/code drift. Effort: minutes. Confidence: high.

---

## Out-of-focus notes (NOT scored — flagged per prompt rules)

- **Resolved, not a finding:** the repo-map's "confirm no stale `tryDecrypt` twin in the extension" — verified clean. `tryDecrypt` exists only in `password-secret-box.ts:192` (plus its doc reference at `:191`); no leftover copy in the extension. The doc comment "matches the original `ProfileService.tryDecrypt`" is historical narration, harmless.
- No correctness/security bugs surfaced during this read; the duality casts (Q3) are type-laundering, not runtime defects (the underlying bytes are correct — the V-vector tests pin that).

---

## Summary
**8 findings (6 scored Q1–Q6 + 2 minors).** Highest-value: **Q1 — primitive obsession on `passhash`/`secret`/`salt` as bare `ArrayBuffer`/`Uint8Array`** with no branded types; a type-only fix that hardens the wallet's most sensitive plumbing across wallet-crypto *and* the extension's profile/session services against silent buffer transposition.
