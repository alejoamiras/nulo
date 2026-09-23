# Cluster A — foundation packages (wallet-core, wallet-crypto, extension-messaging)

## Cluster verdict

This cluster is unusually clean for "LLM under time pressure" — it reads like code that has already been through several audit/refactor rounds (comments literally cite `Q-03`, `Q-05`, `Q-08`, `F-09`, `F-11`, `B-23`, `AUDIT A5` fixes, and the `core/base-client.ts` + `core/base-service.ts` files are explicitly the product of de-duplicating two forked transports). Docstrings are dense but load-bearing (invariants, threat models, byte-format contracts), not filler. The security-critical packages (`wallet-crypto`, `wallet-core/migration`) are intentionally defensive and every apparent redundancy I checked there turned out to be a deliberately separate domain (distinct HKDF `info` strings, distinct AAD, distinct envelope versions) — not sloppy duplication. The single biggest real lever is a literal "listener array + push + splice-to-remove" idiom hand-rolled about a dozen times across the two `testing/*.ts` fake/harness files; next is a small family of near-identical prefix-scan methods in `EntityStorage`. Total realistically removable: **roughly 90–130 LOC**, almost all of it in test-support code, not production logic — this cluster does not need a "verbosity" pass so much as a couple of small internal-helper extractions.

## Findings

### F1 [duplication] `EntityStorage`'s five prefix-scan methods repeat the same "root@ scan" loop
- **Where:**
  - `packages/wallet-core/src/storage/entity_storage.ts:194-204` (`getAll`)
  - `packages/wallet-core/src/storage/entity_storage.ts:206-212` (`getKeys`)
  - `packages/wallet-core/src/storage/entity_storage.ts:214-224` (`getValues`)
  - `packages/wallet-core/src/storage/entity_storage.ts:237-250` (`rawEntries`)
  - `packages/wallet-core/src/storage/entity_storage.ts:258-268` (`rawStringEntries`)
- **Evidence:** every method opens with the identical three lines and the identical filter:
  ```ts
  public async getAll(): Promise<Array<[string, T]>> {
      const path = `${this.root}@`
      const res = await this.storage.get()
      const out: Array<[string, T]> = []
      for (const [k, v] of Object.entries(res)) {
          if (!k.startsWith(path)) continue
  ```
  ```ts
  public async getKeys(): Promise<Array<string>> {
      const path = `${this.root}@`
      const res = await this.storage.get()
      return Object.keys(res)
          .filter((k) => k.startsWith(path))
  ```
  ```ts
  public async rawStringEntries(): Promise<Array<[string, string]>> {
      const path = `${this.root}@`
      const res = await this.storage.get()
      const out: Array<[string, string]> = []
      for (const [k, v] of Object.entries(res)) {
          if (!k.startsWith(path)) continue
  ```
  (`rawEntries` follows the same shape with a `try { JSON.parse(...) } catch {}` instead of `decodeRow`.)
- **Refactor:** add one private helper in the same file/layer (`wallet-core`), e.g.
  ```ts
  private async scopedRows(): Promise<Array<[string, unknown]>> {
      const path = `${this.root}@`
      const res = await this.storage.get()
      const out: Array<[string, unknown]> = []
      for (const [k, v] of Object.entries(res)) if (k.startsWith(path)) out.push([k.substring(path.length), v])
      return out
  }
  ```
  and rewrite the five methods as one-line maps/filters over `scopedRows()` (e.g. `getKeys` becomes `(await this.scopedRows()).map(([id]) => id)`). Purely internal — the public method signatures and behavior are untouched.
- **LOC delta:** ~ -20 (five ~7-13 line bodies collapse to one-liners plus one ~7-line helper).
- **Risk / tests:** low. No public API change; covered by `packages/wallet-core/src/storage/entity_storage.test.ts`, which already exercises `getAll`/`getKeys`/`getValues`/`rawEntries`/`rawStringEntries` byte-for-byte (the file's own docstring says these tests "lock the wire-shape").
- **Confidence:** high.

### F2 [duplication] Two AES-GCM envelope pack/unpack pairs share the identical `1‖iv(12)‖ct` framing
- **Where:**
  - `packages/wallet-crypto/src/imported-account-key-box.ts:41-55` (`sealImportedSigningKeyV2`) and `:59-76` (`unsealImportedSigningKeyV2`)
  - `packages/wallet-crypto/src/imported-keys-dek-box.ts:40-50` (`sealDekUnderWrapKey`) and `:54-72` (`unsealDekUnderWrapKey`)
- **Evidence:**
  ```ts
  // imported-account-key-box.ts:47-54
  const key = await rowKey(dek, chainId, address)
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, signingKey))
  const out = new Uint8Array(13 + ct.length)
  out[0] = 1
  out.set(iv, 1)
  out.set(ct, 13)
  return toBase64(out)
  ```
  ```ts
  // imported-keys-dek-box.ts:41-49
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12))
  const ct = new Uint8Array(
      await globalThis.crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: IMPORTED_DEK_AAD }, wrapKey, dek),
  )
  const out = new Uint8Array(13 + ct.length)
  out[0] = 1
  out.set(iv, 1)
  out.set(ct, 13)
  return toBase64(out)
  ```
  The two `unseal*` functions mirror each other just as closely (`bytes.length < 13 || bytes[0] !== 1` guard, `subarray(1,13)`/`subarray(13)` split, `finally { zeroize(bytes) }`).
- **Refactor:** extract two tiny package-internal helpers in `wallet-crypto` (not exported from the package index), e.g. `packEnvelopeV1(key, plaintext, aad?)` / `unpackEnvelopeV1(key, sealed, aad?)`, and have both call sites' `seal*`/`unseal*` delegate to them, keeping their own key-derivation (`rowKey` vs the caller-supplied `wrapKey`) and error messages/length checks as thin wrappers. **Do not** fold in `EncryptionKey.encrypt/decrypt` (`encryption-key.ts`) — its framing differs (version byte `0`, IV-derived salt, non-base64 output), so it is a different envelope, not a third copy of this one.
- **LOC delta:** ~ -25.
- **Risk / tests:** **high** despite the small diff — this is consensus-critical, on-disk-ciphertext-format code (imported-account keys / imported-keys DEK), and the repo's own crypto policy is "never roll your own, byte format is frozen." Any refactor must produce byte-identical envelopes. Covered by `packages/wallet-crypto/src/imported-account-key-box.test.ts` and `packages/wallet-crypto/src/imported-keys-dek-box.test.ts` (plus `nonce-uniqueness.test.ts`) — run these before/after and diff no assertions change. Given the risk/reward ratio, this is a "nice to have," not urgent.
- **Confidence:** high (duplication) / treat the merge itself as optional given the risk.

### F3 [duplication] The same "listener array + push + splice-to-remove" idiom is hand-rolled ~12 times across the two test-fake files
- **Where:**
  - `packages/wallet-core/src/testing/fake-browser-api.ts:119-125, 126-132, 141-147, 148-154` (the two `MessagePortLike` halves in `linkedPortPair`), `:187-193` (`FakeRuntimeAdapter.onConnect`), `:245-251` (`FakeWindowsAdapter.onRemoved`)
  - `packages/extension-messaging/src/testing/transport-harness.ts:78-95, 96-113` (`mockClientPort`'s keyed `Map<string, Fn[]>` variant), `:148-153, 154-159` (`connectServiceClient`'s local-array variant), `:216-222, 223-229` (the global `chrome.runtime.onConnect`/`onMessage` stub installed in `beforeEach`)
- **Evidence** (representative pair):
  ```ts
  // fake-browser-api.ts:119-125
  onMessage: (l) => {
      clientMsgListeners.push(l)
      return () => {
          const i = clientMsgListeners.indexOf(l)
          if (i >= 0) clientMsgListeners.splice(i, 1)
      }
  },
  ```
  ```ts
  // transport-harness.ts:223-228
  onMessage: {
      addListener: (listener: Fn) => messageListeners.push(listener),
      removeListener: (listener: Fn) => {
          for (let i = messageListeners.length - 1; i >= 0; i--)
              if (messageListeners[i] === listener) messageListeners.splice(i, 1)
      },
  },
  ```
  Six more near-identical blocks sit beside these two (see the line list above) — same push/splice mechanics, two call conventions (`(listener) => Unsubscribe` in wallet-core's fakes vs. Chrome-native `{addListener, removeListener}` in the harness).
- **Refactor:** add one generic helper — `createListenerBag<T>()` returning `{ items: T[], add(item): void, remove(item): void }` — in `packages/wallet-core/src/testing/` (e.g. `listener-bag.ts`, exported from `testing/index.ts`). `extension-messaging`'s `testing/transport-harness.ts` can already import from `@nulo/wallet-core` (it sits above wallet-core in the layer order), so it wraps the same bag into the Chrome-native `{addListener, removeListener}` shape; `mockClientPort`'s keyed-by-`service` case becomes a `Map<string, ReturnType<typeof createListenerBag<Fn>>>` with get-or-create. Each of the ~12 call sites shrinks from 6-18 lines to 2-4.
- **LOC delta:** ~ -45 (a ~10-line helper replacing roughly 55 lines of repeated push/splice bodies across both files).
- **Risk / tests:** low — this is test-support code only (never shipped in the extension bundle). `fake-browser-api.ts` has a dedicated `fake-browser-api.test.ts`, and `FakeBrowserApi` is imported by 64 files across `apps/`/`packages/`, so any behavioral regression in the port-broker semantics would surface immediately across the suite. `transport-harness.ts` backs the extension-messaging transport contract tests directly.
- **Confidence:** high.

### F4 [verbosity] `mnemonic.ts` unrolls 11-bit/8-bit packing by hand in two places instead of a small loop
- **Where:**
  - `packages/wallet-core/src/utils/mnemonic.ts:2084-2094` (`getMnemonic`'s 11-term OR to look up a word index)
  - `packages/wallet-core/src/utils/mnemonic.ts:2133-2143` (`getEntropy`'s 11-line unrolled bit-assignment for a word index)
  - `packages/wallet-core/src/utils/mnemonic.ts:2151-2160` (`getEntropy`'s 8-line unrolled byte-from-bits pack)
- **Evidence:**
  ```ts
  // 2133-2143
  concatBits[wordIndex * 11 + 0] = (index >> 10) & 1
  concatBits[wordIndex * 11 + 1] = (index >> 9) & 1
  concatBits[wordIndex * 11 + 2] = (index >> 8) & 1
  concatBits[wordIndex * 11 + 3] = (index >> 7) & 1
  concatBits[wordIndex * 11 + 4] = (index >> 6) & 1
  concatBits[wordIndex * 11 + 5] = (index >> 5) & 1
  concatBits[wordIndex * 11 + 6] = (index >> 4) & 1
  concatBits[wordIndex * 11 + 7] = (index >> 3) & 1
  concatBits[wordIndex * 11 + 8] = (index >> 2) & 1
  concatBits[wordIndex * 11 + 9] = (index >> 1) & 1
  concatBits[wordIndex * 11 + 10] = (index >> 0) & 1
  ```
  is the exact mirror-image of the 11-term lookup in `getMnemonic` (`(bits[i*11+0] << 10) | (bits[i*11+1] << 9) | … | (bits[i*11+10] << 0)`), and the file already has a working example of the loop form one function above it (`bytesToBits`, `mnemonic.ts:2052-2064`, an 8-bit unroll that IS a loop-free but at least single-purpose helper) — the two 11-bit sites and the one 8-bit pack in `getEntropy` never call a shared "N-bit pack/unpack" primitive at all.
- **Refactor:** add two tiny local helpers (`bitsToNumber(bits, offset, width)` returning the OR-reduced value, and `numberToBits(value, width, out, offset)` writing it back) and replace all three unrolled blocks with a 2-3 line loop call each.
- **LOC delta:** ~ -25 (30 unrolled lines → ~6 call sites + a ~10-line pair of helpers).
- **Risk / tests:** medium — this is the BIP-39 encode/decode path (wrong bit order breaks every recovery phrase), but it's a pure mechanical transform (no secret derivation math), and `packages/wallet-core/src/utils/mnemonic.test.ts` already pins a "predefined test cases" KAT plus round-trip tests at 16/24/32-byte entropy and checksum-failure cases — sufficient to catch an off-by-one in the refactor.
- **Confidence:** medium (real duplication; whether it's worth touching hand-rolled bit math in a KAT-locked file is a judgment call, not a slam dunk).

### F5 [duplication] `errorMessageFromUnknown`'s exact logic is re-implemented inline 4 times instead of imported
- **Where:**
  - `packages/wallet-core/src/utils/errors.ts:8-14` (the canonical, exported `errorMessageFromUnknown`)
  - `packages/wallet-core/src/migration/staging.ts:17` — `const msg = err instanceof Error ? err.message : String(err)`
  - `packages/wallet-core/src/migration/migrator.ts:454-456` — local `function message(err: unknown): string { return err instanceof Error ? err.message : String(err) }`
  - `packages/wallet-core/src/base/index.ts:85` — `f.r.reason instanceof Error ? f.r.reason.message : String(f.r.reason)`
  - `packages/extension-messaging/src/core/base-client.ts:211` — `const message = cause instanceof Error ? cause.message : String(cause)`
- **Evidence:** `String(x)` on `null`/`undefined`/a plain string already returns exactly `"null"`/`"undefined"`/the string itself, so `err instanceof Error ? err.message : String(err)` is byte-for-byte equivalent to `errorMessageFromUnknown` for every input — this isn't a near-duplicate, it's the same function retyped 4 times.
- **Refactor:** replace all 4 call sites with `errorMessageFromUnknown(err)` — three are inside `wallet-core` itself (trivial relative import), the fourth (`extension-messaging/core/base-client.ts`) already imports several names from `@nulo/wallet-core/utils` in the same file, so it's a one-name addition to an existing import.
- **LOC delta:** ~ 0 to -3 (the win is removing 4 independent copies of security/error-adjacent logic that could silently drift, not raw line count — `migrator.ts`'s standalone `message()` function disappears entirely).
- **Risk / tests:** low. Covered by `packages/wallet-core/src/utils/errors.test.ts`, `packages/wallet-core/src/migration/migrator.test.ts`, and the base-client's own request-lifecycle tests.
- **Confidence:** high.

## Not worth it

- **`Lock` (`utils/lock.ts`) vs `ReadWriteGuard` (`utils/rw-guard.ts`)** — superficially both are "concurrency primitive with a force-release watchdog and a logger," but one is a FIFO mutex and the other is a reader/writer guard with genuinely different queuing semantics; merging them would make both harder to reason about for no LOC win.
- **`WalletError` subclass constructors in `extension-messaging/src/errors.ts`** — ~15 subclasses each call `super(CODE, message, details, "Name")`; boilerplate, but each carries a distinct default message/details shape, and the file is under the ≥20-line-per-copy bar for a new abstraction.
- **`walletErrorFromPayload`'s 13-case switch** (`errors.ts:349-386`) — mostly `return new XError(known.message, known.details)` one-liners; a lookup-table version wouldn't shrink net lines and would obscure the one case (`CapabilityNotGrantedError`) that reads `details` differently.
- **`core/base-client.ts` vs `core/base-service.ts` and their background/offscreen subclasses** — these already ARE the product of a prior de-duplication (their own docstrings say so); the remaining per-transport code (Port lifecycle vs `sendMessage`+uid routing, keepalive, telemetry) is genuinely transport-specific, not residual duplication.
- **The three-function error-message family in `wallet-core/utils/errors.ts`** (`errorMessageFromUnknown`, `getErrorMessage`, `getErrorData`) — looks redundant at a glance, but the file's own comments document why each is deliberately different (one is a type-lying legacy RPC/log sink whose raw non-string behavior is pinned by tests) — not LLM slop, a documented behavior-preservation constraint.
- **`EncryptionKey.encrypt/decrypt`'s envelope framing vs the two boxes in F2** — same "version + iv + ciphertext" shape at a glance, but a different version byte, a different key-derivation path (salt derived from the IV via SHA-256, not a fixed HKDF `info`), and raw-bytes vs base64 output — a real third variant, not a missed merge.
