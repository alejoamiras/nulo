# M4.6 — Best-effort zeroization (~hours)

> **Audit tier** (per `implementations-plan/M4/README.md` meta-plan): self-review only — small, well-bounded, no external audits.

## Context & entry state

Today no zeroize helper exists in the repo. Decrypted secrets, raw passhash buffers, and PRF/HKDF intermediates live as `Uint8Array<ArrayBuffer>` / `Buffer` in memory until the JS engine GCs them. Reading them out of process memory after the wallet is "locked" is plausibly trivial under an attacker model with read access to the SW heap.

M4.6 ships **best-effort** zeroization. After every legitimate use of a sensitive buffer, we overwrite it with zeros. Engine GC reclamation timing remains opaque (we cannot force it), but no live JS reference holds the cleartext.

**Scope-limiting note (BOTH audits flagged this).** M4.6 does NOT plug the `session.passhash` base64 persistence at `packages/extension/src/wallet/services/profile/session-manager.ts:161`. That bearer material lives in `chrome.storage.session` until the SW's "browser session" ends and is restored as a `Buffer.from(session.passhash, "base64")` on every restart (`session-manager.ts:242`). M4.2 owns that fix. M4.6 zeroes only the in-memory copies that flow through ProfileService / SessionManager / wallet-crypto helpers — what's already on disk in `chrome.storage.session` is M4.2's territory.

**Codex pass-through findings** (synthesis from meta-plan audit at `implementations-plan/M4/README.md` audit log):
- Replace per-buffer "zeroed-state" assertions with **helper-level tests + call-site invariant** (call-site test: "zeroize is *invoked* at every documented site"). The buffer-state-after-zero test is theater — JS GC says nothing about memory residue.
- Document explicit list of **unavoidable copies / GC caveats** (`CryptoKey`, `Fr` internals, immutable strings, persisted base64).
- Audit confirmed real targets: `password-secret-box.ts:142`, `session-manager.ts:242`, `passkey-credential.ts:35`. (Verified against current master.)

**Plan-agent pass-through finding**: M4.6 is best-effort while persisted passhash is still live. → ship with explicit "limitation block" in the README + commit message.

### Current buffer touchpoints (verified against `55f88a4`)

**`@nulo/wallet-crypto`:**
- `EncryptionKey.getPasshash(password)` — returns 32-byte SHA-256(password) ArrayBuffer. Used as PBKDF2 IKM.
- `EncryptionKey.fromPasshash(passhash)` — calls `crypto.subtle.importKey("raw", passhash, "PBKDF2", false, ["deriveKey"])`. After `importKey` returns, `passhash` is no longer needed by the engine for that key (the key holds its own internal state).
- `EncryptionKey.encrypt/decrypt` — operates on `Uint8Array<ArrayBuffer>`. Returns the plaintext to caller (caller owns it).
- `PasswordSecretBox.seal(password, secret)` (line 82) — derives `passhash` locally, calls `sealInternal`. Returns `{ passhash, encrypted }`. The `passhash` ESCAPES (caller stores it). The local `passhash` reference inside `seal` is the same object as the returned one — no separate copy to zero.
- `PasswordSecretBox.sealWithPasshash(passhash, secret)` (line 92) — passhash is a parameter (caller-owned). NOT zeroed inside.
- `PasswordSecretBox.unseal(password, encrypted)` (line 99) — derives `passhash` locally, calls `unsealInternal`, returns secret. The local `passhash` does NOT escape — can be zeroed in finally.
- `PasswordSecretBox.unsealWithPasshash(passhash, encrypted)` (line 108) — passhash is parameter (caller-owned). NOT zeroed inside.
- `PasswordSecretBox.reseal(oldPassword, newPassword, encrypted)` (line 116) — derives `oldPasshash` + `newPasshash` locally; returns `{ passhash: newPasshash, encrypted: newEncrypted }`. `oldPasshash` does NOT escape (zero in finally). `newPasshash` ESCAPES (caller stores).
- `PasswordSecretBox.unsealInternal(key, encrypted)` (line 142) — decrypts `guard` plaintext locally, byte-compares to `ENCRYPTION_GUARD`, then decrypts secret. The `guard` local plaintext can be zeroed after the comparison (it's just `ENCRYPTION_GUARD` bytes — not actually a secret, but defensible to zero anyway for the call-site invariant test).
- `PasskeyCredential.create(params)` (line 35) — `ikm = Buffer.from(params.prf, "base64")` is local; after `importKey("raw", ikm, "HKDF", ...)`, ikm can be zeroed. `params.prf` (string) cannot be zeroed (immutable; GC only).
- `PasskeyCredential.deriveMasterSecret()` (line 44) — `masterBits` (ArrayBuffer from `deriveBits`) feeds into `Fr.fromBufferReduce(Buffer.from(new Uint8Array(masterBits)))`. After `Fr` is constructed, the ArrayBuffer view can be zeroed. Returns `masterFr.toBuffer()` (caller owns the returned buffer).

**`packages/extension/src/wallet/services/profile/`:**
- `session-manager.ts:157` (`open`) — receives `secretBuffer` + optional `passhash` from caller (ProfileService). Constructs `Fr.fromBuffer(Buffer.from(secretBuffer))` (line 165). The `Buffer.from(secretBuffer)` makes a copy into a new Buffer. After `Fr` parses + the Session record persists the base64 of passhash, the manager doesn't retain references to either input buffer's bytes. Caller can zero `secretBuffer` and `passhash` after `open()` returns.
- `session-manager.ts:215` (`restore`) — `passhash = Buffer.from(session.passhash, "base64")` (line 242), `secretBytes = await unseal(passhash.buffer, profile)` (line 243). Both `passhash` and `secretBytes` are local; can be zeroed in finally after `Fr.fromBuffer(Buffer.from(secretBytes))` runs (line 253).
- `service.ts:84` (`createProfile`) — `secret = Fr.random().toBuffer()` (86), seal yields `{ passhash, encrypted }` (87), `sessionManager.open(profile, secret, passhash)` (104). After `open` returns, both can be zeroed.
- `service.ts:118` (`unlockProfile`) — Phase 2 derives `secret` (139) + `passhash` (149); Phase 3 calls `sessionManager.open(current, secret, passhash)` (168). After Phase 3 succeeds, both can be zeroed. **Care**: if Phase 3 throws (revalidate-failure), the secret + passhash should still be zeroed (try/finally).
- `service.ts:325` (`changeProfilePassword`) — `resealed.passhash` + `secret` (343) flow into `sessionManager.open` (345). Zero after.
- `service.ts:556` (`importPasswordProfile`) — receives `secret` + `passhash` from caller; passes both to `sessionManager.open` (570). Caller zeros (the `import*` public methods at lines 432, 453, 463 derive these locally).
- `passkey-recovery-coordinator.ts:47` — `recovery.secret: Buffer<ArrayBuffer>` returned through the recovery flow; consumers (e.g. `service.ts:201, 256, 266`) call `sessionManager.open(profile, recovery.secret)`. Zero after.

## Architecture invariants (preserved)

1. **M2.6 crypto vectors must pass byte-identically** (`packages/extension/src/wallet/crypto/key-vectors.test.ts`). Zeroization runs *after* every crypto/storage operation completes. No vector input is altered before use.
2. **RPC method shapes unchanged**. M4.6 is purely internal — no popup-visible behavior changes.
3. **`SessionManager.open / restore / close / refresh` semantics unchanged**. Zeroization happens in the **caller** (ProfileService) for parameter buffers, in the **callee** for locally-allocated buffers (`restore`'s `passhash`, etc.). The manager itself does not zero buffers it doesn't own.
4. **`PasswordSecretBox` public API unchanged**. Only internal try/finally additions.
5. **`PasskeyCredential` public API unchanged**. Internal zeroization of `ikm` in `create` + `masterBits` view in `deriveMasterSecret` only.
6. **Lock semantics in `ProfileService` unchanged**. Zeroization happens **inside** the existing locked / unlocked phases, not by adding new lock boundaries.

## Unavoidable copies / GC caveats (documented, NOT remediated by M4.6)

These belong in the M4.6 commit message + a `SECURITY.md` updated section, so reviewers and future contributors don't think M4.6 promises more than it delivers.

1. **Persisted `session.passhash` base64 in `chrome.storage.session`** (`session-manager.ts:161`) — REMAINS. M4.2 territory.
2. **`Fr` internal storage**. `Fr.fromBuffer(buf)` parses `buf` into the field-element representation. After construction the original `buf` can be zeroed, BUT we cannot zero `Fr.value` from outside without depending on `@aztec/foundation` internals. The `Fr` instance itself (`ActiveSession.secret: Fr`) holds the cleartext for the session lifetime. Locking the wallet (`SessionManager.close`) drops the `ActiveSession` reference but does not zero `Fr.value`.
3. **`CryptoKey` (PBKDF2 baseKey, AES-GCM derived key, HKDF baseKey)** — non-extractable; managed by the Web Crypto engine. No external API to zero. Engine-internal.
4. **Immutable strings** — `password: string` and `params.prf: string` parameters are JS strings, immutable and potentially interned. We CANNOT zero them. Caller-provided + GC-only.
5. **Base64 round-trips** create new strings. `Buffer.from(buf).toString("base64")` produces a new string holding the encoded form; we zero the buffer but the string lives until GC. The base64 string itself does not contain raw key material that an attacker couldn't recompute (it's just a re-encoding), but it does extend the lifetime of the secret in different memory regions.

## Targets (single sub-step)

One commit. Two files of new code (helper + helper test), wire-up edits across 3 files (`password-secret-box.ts`, `passkey-credential.ts`, `session-manager.ts`, plus 2-3 ProfileService methods).

### Step 1 — Add `zeroize` helper

**New file:** `packages/wallet-crypto/src/zeroize.ts`

```ts
/**
 * Best-effort: overwrite the bytes of `buf` with zeros.
 *
 * Returns `buf` so the helper can be used in a chained pattern:
 *
 *   ```ts
 *   try { … } finally { zeroize(passhash) }
 *   ```
 *
 * Accepts `Uint8Array`, `Buffer` (which is a subclass of Uint8Array),
 * `ArrayBuffer`, and `undefined` (no-op). When passed a `Uint8Array`
 * subarray view, only the view's bytes are zeroed — the backing
 * buffer outside the view is left untouched.
 *
 * ## Caveats (DO NOT confuse with cryptographic memory hygiene)
 *
 * - JS engine GC is opaque; this helper does NOT control when the
 *   memory pages holding the original bytes are reclaimed or zeroed
 *   by the OS. Other live references to the same bytes (copies,
 *   `Buffer.from(...)` clones, base64 strings) are unaffected.
 * - `CryptoKey`, `Fr` internals, and string parameters CANNOT be
 *   zeroized by this helper. Document those at the call site.
 * - This is a defense-in-depth measure: it tightens the window
 *   between "secret used" and "secret reclaimed by GC", not a
 *   guarantee that the bytes are unrecoverable from process memory.
 */
export function zeroize<T extends Uint8Array | ArrayBuffer | undefined>(buf: T): T {
	if (buf === undefined) return buf
	if (buf instanceof ArrayBuffer) {
		new Uint8Array(buf).fill(0)
	} else {
		// Uint8Array, Buffer (Uint8Array subclass), or any TypedArray-like
		;(buf as Uint8Array).fill(0)
	}
	return buf
}
```

**Index re-export:** `packages/wallet-crypto/src/index.ts` adds `export { zeroize } from "./zeroize"`.

### Step 2 — Wire into `PasswordSecretBox`

`packages/wallet-crypto/src/password-secret-box.ts`:

- `seal` (line 82) — `passhash` is returned to caller; do NOT zero (caller owns).
- `sealWithPasshash` (line 92) — `passhash` is parameter; caller owns. No zero.
- `unseal` (line 99) — `passhash` is locally derived, does not escape. Add `try { … return await this.unsealInternal(key, encrypted) } finally { zeroize(passhash) }` around lines 100-103.
- `unsealWithPasshash` (line 108) — caller-owned. No zero.
- `reseal` (line 116) — `oldPasshash` does not escape (zero in finally); `newPasshash` escapes (returned). Wrap the body so `zeroize(oldPasshash)` runs after the early-return on `if (!secret)` AND on the success path.
- `unsealInternal` (line 142) — `guard` plaintext local. Wrap in try/finally to `zeroize(guard)`.

### Step 3 — Wire into `PasskeyCredential`

`packages/wallet-crypto/src/passkey-credential.ts`:

- `create` (line 35) — `ikm` is local, used only for `importKey`. Wrap so `zeroize(ikm)` runs in finally.
- `deriveMasterSecret` (line 44) — `masterBits` is the `ArrayBuffer` returned by `deriveBits`. After `Fr.fromBufferReduce(Buffer.from(new Uint8Array(masterBits)))`, zero the bytes via `zeroize(new Uint8Array(masterBits))`. Note: do this BEFORE the `return` so the caller's `masterFr.toBuffer()` (a fresh buffer) is not affected.

### Step 4 — Wire into `SessionManager`

`packages/extension/src/wallet/services/profile/session-manager.ts`:

- `open` (line 157) — `secretBuffer` + `passhash` are caller-owned. No zero inside `open`. (Caller zeros — see Step 5.)
- `restore` (line 215) — local `passhash` (242) + `secretBytes` (243) do not escape; `Fr.fromBuffer(Buffer.from(secretBytes))` (253) makes a copy. Wrap the unseal-and-construct block in try/finally:
  ```ts
  let passhash: Buffer | undefined
  let secretBytes: Uint8Array<ArrayBuffer> | null = null
  try {
    passhash = Buffer.from(session.passhash, "base64")
    secretBytes = await unseal(passhash.buffer, profile)
    if (!secretBytes) {
      // … silentClose path …
      return
    }
    this.activeSession = {
      profile, session,
      secret: Fr.fromBuffer(Buffer.from(secretBytes)),
    }
  } finally {
    if (passhash) zeroize(passhash)
    if (secretBytes) zeroize(secretBytes)
  }
  ```

### Step 5 — Wire into `ProfileService`

`packages/extension/src/wallet/services/profile/service.ts`:

- `createProfile` (line 84) — wrap the `secret` + `passhash` lifetime:
  ```ts
  const secret = Fr.random().toBuffer() as Buffer<ArrayBuffer>
  const { passhash, encrypted } = await this.secretBox.seal(password, secret)
  try {
    // … existing create-and-open body …
  } finally {
    zeroize(secret)
    zeroize(passhash)
  }
  ```
- `unlockProfile` (line 118) — Phase 2 → Phase 3 path. Zero `secret` + `passhash` in a finally that wraps Phase 3, so revalidate-failure also zeros.
- `changeProfilePassword` (line 325) — wrap `resealed.passhash` + the locally `unsealWithPasshash`'d `secret` (343) + zero in finally before returning.
- `importPasswordProfile` (line 556) — `secret` + `passhash` are parameters. Zero in finally — but document that the **calling public methods** (line 432, 453, 463) derive the buffers and trust `importPasswordProfile` to zero them after `sessionManager.open` returns.
- Passkey paths: `recovery.secret` (line 201, 256) — wrap the call to `sessionManager.open(...)` in try/finally with `zeroize(recovery.secret)`.

(Step-5 wire-up is mechanical; I'll grep one more pass during execution for any path I missed.)

## Test plan (helper-level + call-site invariant)

**ONE new test file** at `packages/wallet-crypto/src/zeroize.test.ts`:

1. **`zeroize(Uint8Array)` writes zeros**: `zeroize(new Uint8Array([1,2,3,4]))` → all bytes 0; returns the same array (chained-call ergonomics).
2. **`zeroize(undefined)` is a no-op**: required for optional `passhash` paths. Returns `undefined`.
3. **`zeroize(ArrayBuffer)` zeros via Uint8Array view**: `const ab = new Uint8Array([1,2,3]).buffer; zeroize(ab); new Uint8Array(ab)` is `[0,0,0]`.
4. **`zeroize(Buffer)` zeros**: `Buffer.from([1,2,3])` → all zero. (Buffer is a Uint8Array subclass; this just confirms TypedArray behavior.)
5. **Subarray view scope**: `const a = new Uint8Array([1,2,3,4,5]); zeroize(a.subarray(1, 4)); a` → `[1,0,0,0,5]`. Validates we don't accidentally zero past the view.

**Self-review checklist** (worked through during execution; not a committed artifact):
- For each callsite in Steps 2-5, verify a `try/finally` wraps the buffer's lifetime.
- For each callsite, verify the `zeroize(...)` argument is the last reference to the buffer.
- For each parameter buffer (caller-owned), verify a comment in the callee documents "caller is responsible for zeroing".

**NOT TESTED** (defended by the audit):
- Buffer-state-after-zero for callsite-scoped buffers (theater; JS GC may have moved the underlying memory by the time the assertion runs).
- `CryptoKey` / `Fr` / immutable-string scrubbing (engine-managed; out of M4.6's reach).
- E2E behavior (zeroization is invisible at the e2e layer).
- M2.6 crypto vectors aren't extended — they continue to verify byte-identical KDF output across the change.

**Existing tests**: verify M2.6 vectors at `packages/extension/src/wallet/crypto/key-vectors.test.ts` still pass byte-identically after each step. No deletions / no tightening.

## Verification commands

```bash
bun run --filter '@nulo/wallet-crypto' test     # new zeroize.test.ts passes
bun run --filter '@nulo/wallet-crypto' typecheck
bun run typecheck:all                            # caller wire-ups type-check
bun run test:all                                 # M2.6 vectors byte-identical
bun run check:imports                            # boundary rules clean
bun run build                                    # no regressions
```

Manual QA (10 min): unlock a password profile, lock it, unlock it again, change password — all flows work. (No visible UX change expected — pure internal hardening.)

## Risks tracked

1. **`Fr.fromBuffer` copy semantics assumed.** I believe `Fr.fromBuffer(Buffer.from(bytes))` parses `bytes` into Fr's internal field-element representation (a copy). If `Fr` retains a reference to the input buffer, zeroing it corrupts `Fr`. **Mitigation**: write a self-test in `zeroize.test.ts` that constructs `Fr.fromBuffer(buf)` from a known input, zeroes `buf`, then asserts `Fr.toBuffer()` returns the original bytes. If it fails, switch to `Fr.fromBuffer(Buffer.from(bytes))` (which forces a copy via Buffer.from) and document the pattern as load-bearing.
2. **GC timing.** Documented in helper JSDoc + commit message; no runtime fix available.
3. **Persisted `session.passhash` leak still exists** until M4.2. Plan + commit message + `SECURITY.md` update explicit on this.
4. **Caller responsibility for parameter buffers** — `PasswordSecretBox.{sealWithPasshash, unsealWithPasshash}` and `SessionManager.open` do NOT zero parameter buffers. Documented at each callsite. ProfileService callers zero in their own try/finally.
5. **Performance.** Zeroizing a 32-byte buffer is O(32). Negligible. Not benchmark-worthy.

## Rollback

`git reset --hard <prev-commit-sha>` rolls back to pre-M4.6 state. M4.6 ships as one commit; revert is trivial.

## Decision log (for the audit-diff slot, even though self-review tier)

- Helper lives in `@nulo/wallet-crypto` rather than `@nulo/wallet-core`. Reason: the only consumers are crypto-adjacent (PasswordSecretBox, PasskeyCredential, SessionManager). Co-locating with the things it protects makes the helper less likely to drift away from its purpose.
- Single helper, not per-type variants. `zeroize(buf)` accepts `Uint8Array | ArrayBuffer | Buffer | undefined` — covers all call shapes without duplication.
- `try/finally` over `then/finally` chains for readability + consistent error path.
- Per-callsite zeroize-was-called tests skipped (audit BLOCKER) in favor of a code-review checklist + helper-level coverage. This is the right tradeoff: white-box per-site assertions test mock behavior, not the invariant.
