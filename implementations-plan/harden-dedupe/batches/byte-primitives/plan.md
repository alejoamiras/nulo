---
plan: harden-dedupe / byte-primitives (arc 16 of 25)
tier: mid
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/16-byte-primitives, stacked on harden-dedupe
---

# byte-primitives: one dialect for base64, hex, random hex and byte equality

Finding Q-15 (a to d), from `audit/quality/2026-09-30-dedup-high/`, except the two `wallet-crypto` secret boxes (program Deferred). `@nulo/wallet-core/utils` already owns `toBase64`, `fromBase64` (strict), `bytesToHex`, `getRandomHex` and `array_equals`; about twenty sites still hand-roll them with `Buffer`, `atob`/`btoa` or loops. This batch moves each site onto the helper whose output and acceptance set are already identical, and names the one decode dialect no helper has: the lenient `Buffer` base64 decode, kept lenient at every site that has it. No persisted, wire or displayed byte changes; no decode accepts or refuses anything new.

## Outcome & Quality Bar

- **For whom:** whoever audits how a secret is encoded and decoded. Today the encode and the decode of one value are written in two dialects (`Buffer` here, `toBase64` there), and nothing says which decodes are lenient on purpose.
- **Excellent:**
  - Every encoder produces the same string for every input it can receive, under the test runtime's native `Buffer` and under the polyfill `Buffer` the extension ships. Literal pins prove it per site.
  - Every decoder keeps its exact acceptance set. A cross-product table, green on the unchanged code, pins the lenient dialect under both `Buffer`s and the strict dialect at its one moved site.
  - Each lenient site still receives the same `Buffer` object type it receives today (it flows into `Fr.fromBuffer`, the restore commit and `zeroize`).
  - The staged `@alejoamiras/nulo-wallet-crypto` package is byte-identical: same file inventory, every sha256 equal.
- **Good enough:** the lenient decodes keep `Buffer`. Making them strict is excluded by name in the program's Behaviour rule; dropping the polyfill waits on that call.

## Architecture & Implementation

Read on `harden-dedupe` at `1a08fa52`. Recon's line numbers for `profile/service.ts` and `pxe/service.ts` have moved; these are today's.

### The one new helper (Phase 2)

`fromBase64Lenient(b64: string): Buffer<ArrayBuffer>` in `apps/extension/src/wallet/utils/lenient-base64.ts`, exported from the `@/wallet/utils` barrel (`apps/extension/src/wallet/utils/index.ts:13-16`). Its body is `return Buffer.from(b64, "base64")`, nothing else:

- **Why a wrapper, not a reimplementation.** In the browser, the naked `Buffer` is rewritten by Rollup inject into the `vite-plugin-node-polyfills` shim (`apps/extension/vite.config.ts:45-53, 263-268`), a bundled copy of the `buffer` package whose `base64clean` drops everything from the first `=`, strips characters outside the alphabet, maps `-_` to `+/` and re-pads. Under vitest the same identifier is Bun's native `Buffer`. Calling the identical expression keeps both runtimes' behaviour by construction, and keeps the returned object a `Buffer`.
- **Why in the extension, not wallet-core.** wallet-core is Buffer-free by contract (`packages/wallet-core/src/utils/encoding.ts:1-7`), and every remaining lenient consumer in scope lives in `apps/extension`. That is arc 15's "beside their consumers" seam.
- **TSDoc** states the contract, not its callers: lenient on purpose, so a garbled stored value decodes instead of throwing; it returns the `Buffer` itself; new code uses `fromBase64`.
- **The naked `Buffer` identifier stays.** No `buffer` import and no `globalThis.Buffer`: either would bypass the build's injection or bind a different copy.
- **The behaviour is not the same in both runtimes, and the helper keeps it that way.** Native and shim disagree on some non-ASCII input (Fact 2, Drift D4). The helper normalizes nothing.
- **Imports.** `integrity.ts` imports `@/wallet/utils/lenient-base64` directly, not through the barrel. `profile/service.ts` and `account/service.ts` already import the barrel, so they use it.
- Return type is what `Buffer.from(string, encoding)` already declares (`@types/node` 24.13.3, `buffer.buffer.d.ts:162`), so the `as Uint8Array<ArrayBuffer>` casts at the sites become redundant. Each is deleted only if `typecheck:all` passes without it.

**Rejected:** a Buffer-free lenient decoder. It would have to reproduce the shim's `base64clean` on every input, and six sites hand its result to code that receives a `Buffer` today. One line of difference there is a behaviour change on a frozen path.

### (a) Encoders: same output, Buffer to helper (Phase 3a, 3b)

| site | today | after | frozen path |
|---|---|---|---|
| `apps/extension/src/wallet/services/profile/service.ts:1653` (`exportPlain`) | `Buffer.from(unsealed.secret).toString("base64")` | `toBase64(unsealed.secret)` | backup `master-key`; feeds account export |
| `profile/service.ts:1811-1813` (`exportBackupMaterial`) | three `Buffer.from(x).toString("base64")` | three `toBase64(x)` | backup blob |
| `profile/service.ts:1985` (`sealDekWithPasshash`) | `Buffer.from(await key.encrypt(…)).toString("base64")` | `toBase64(await key.encrypt(…))` | persisted `dekSealed`, inside the envelope MAC |
| `apps/extension/src/popup/pages/settings/security/export/full.vue:348` | `Buffer(await key.encrypt(…)).toString("base64")` | `toBase64(await key.encrypt(…))` | sealed full backup |
| `packages/aztec-runtime/src/pxe/client.ts:208` | `btoa(String.fromCharCode(...provision.key))` | `toBase64(provision.key)` | wire to the offscreen document |
| `packages/aztec-runtime/src/account/account-export.ts:80` | `Buffer.from(sha256(Buffer.from(canonical, "utf8"))).toString("hex")` | `bytesToHex(sha256(Buffer.from(canonical, "utf8")))` | account-file checksum (`CANONICAL_FIELDS` FROZEN, `:63-64`) |
| `apps/extension/src/wallet/utils/passkey-ceremony.ts:139` | `Buffer.from(userHandleOption).toString("hex")` | `bytesToHex(new Uint8Array(userHandleOption))` | WebAuthn user handle, the profile identity |
| `packages/wallet-crypto/src/wallet-fingerprint.ts:37` (Ask 2) | `Buffer.from(digest).toString("hex")` | `bytesToHex(new Uint8Array(digest))`, the shape of `encryption-key.ts:141` | persisted fingerprint, inside the envelope MAC |

Why each is identical:

- **Input types.** Every input is a `Uint8Array` produced by wallet code: `unseal`'s result, the DEK (`unsealDekWithPasshash` or `generateImportedKeysDek`), `EncryptionKey.encrypt`'s `Uint8Array<ArrayBuffer>` (`packages/wallet-crypto/src/encryption-key.ts:42-58`), `derivePxeStoreKey`'s 32 bytes (`packages/wallet-crypto/src/pxe-store-key.ts:36-45`), aztec's `sha256`, which returns `Buffer.from(hash.sha256().update(data).digest())`. The two `ArrayBuffer` inputs are a WebAuthn `userHandle` (DOM type `ArrayBuffer | null`) and a `subtle.digest` result. Both get an explicit `new Uint8Array(…)`, because `bytesToHex` iterates and an `ArrayBuffer` is not iterable.
- **Output.** `toBase64` is standard padded base64 and `bytesToHex` lowercase zero-padded hex, byte-identical to native `Buffer` (`packages/wallet-core/src/utils/encoding.test.ts:22-44`, including a 200,000-byte input). Phase 2 adds the same parity against the shipped shim.
- **Await shape.** Every replacement is a synchronous expression in the same position. `:1653` stays a `return` evaluated before its `finally` zeroizes; `:1985` and `full.vue:348` keep their single `await`.
- **Spread versus chunk** (`pxe/client.ts:208`): the spread throws `RangeError` only above the engine's argument limit; the key is always 32 bytes (`pxe-store-key.ts:43-44`). Below the limit the strings are identical, since `toBase64` takes one 32 KiB chunk.
- **The inner UTF-8 encode** at `account-export.ts:80` stays: it feeds aztec's `sha256`, and it is not a Q-15 primitive.

### (b) Decoders: lenient stays lenient, strict stays strict (Phase 3c, 3d)

**Lenient, to `fromBase64Lenient`** (the property read stays at the call site, so a malformed row's native `TypeError` text is unchanged):

| site | today | consumer, kept as is | frozen path |
|---|---|---|---|
| `profile/service.ts:1994` | `Buffer.from(dekSealed, "base64") as Uint8Array<ArrayBuffer>` | `key.decrypt`, inside `try { … } catch { return null }` | persisted `dekSealed` |
| `profile/service.ts:2211` | `Buffer.from(secret.masterKey, "base64")` | the 32-byte check, `array_equals`, the restore commit, `zeroize` | backup restore (attacker-controlled) |
| `profile/service.ts:2222` | `Buffer.from(secret.entropy, "base64") as …` | the 32-byte check, `getMnemonic` | backup restore |
| `profile/service.ts:2242` | `Buffer.from(secret.importedKeysDek ?? "", "base64") as …` | the 32-byte check; the `?? ""` stays at the site | backup restore |
| `apps/extension/src/wallet/services/account/service.ts:442` | `Buffer.from(master, "base64")` | `Fr.fromBuffer`, then `zeroize` | account signing-key derivation (`Nulo_v1`) |
| `apps/extension/src/wallet/services/dapp-session/integrity.ts:59` | `new Uint8Array(Buffer.from(mac, "base64"))` | the same `try`/`catch`, length check, WebCrypto `verify` | persisted session-row MAC |

**Strict, to wallet-core's `fromBase64`:**

- `packages/aztec-runtime/src/pxe/service.ts:828`: `Uint8Array.from(atob(storeKeyBase64), (c) => c.charCodeAt(0))` becomes `fromBase64(storeKeyBase64)`. Both call `atob` once on the same argument, so the same inputs throw the same `DOMException` on every engine. `atob` yields only code units 0 to 255, so iterating by code point (`Uint8Array.from`) and by index (`fromBase64`) give the same bytes. `:833`'s length refusal and every lifecycle check after it are unchanged.

**No hex decoder is added** (Ask 1). `passkey-ceremony.ts:41`, `Uint8Array.from(Buffer.from(userHandle, "hex"))`, is the only runtime hex decode (the other, `apps/extension/scripts/seed-preflight-metadata.ts:57`, is a script). A helper with one consumer removes no duplication. The probe also found that the shim and Bun disagree on five hex inputs (Drift D1), so the decode stays inline, untouched.

### (c) Random hex (Phase 3e)

- `apps/extension/src/wallet/services/profile/spec.ts:104-108` `mintPxeGeneration` becomes `return getRandomHex(32)` (`packages/wallet-core/src/utils/random.ts:9-15`): one `getRandomValues` call on 16 bytes, read from its return value as today, encoded lowercase and padded, 32 characters. The persisted `pxeGeneration` format is unchanged.
- `apps/extension/src/wallet/services/activity-protocol/coordinator.ts:48-53` `mintNonce`, the same change (Ask 3). The module is dead code kept for the owner's yes/no line. Its one difference, reading the argument rather than the return value, is invisible with the real `getRandomValues`, which fills in place and returns its argument.

### (d) Byte equality (Phase 3d)

`pxe/service.ts:859`, `installed.every((b, i) => b === key[i])`, becomes `array_equals(installed, key)` (`packages/wallet-core/src/utils/arrays.ts:1-11`). `every` has no length check; `array_equals` does. They agree because both operands are 32 bytes:

- `key` passes `:833` first.
- `storeKeys` only ever receives such a key (`:869`, its only `set`).
- The installed key is never detached. The store open hands its worker a copy before the transfer (`packages/aztec-runtime/src/pxe/opfs-store.ts:112-114`).

On a detached `installed` array (length 0), `every` would return `true` and `array_equals` `false` (Opus probe). That case is unreachable, and the new answer is strictly safer. Both comparisons short-circuit, so no constant-time property is lost or gained. `storeKeys` narrows to `Map<string, Uint8Array<ArrayBuffer>>` (`:173`), a type-only change matching what `:828` already builds, so it satisfies `array_equals`' parameter type. The `key.fill(0)` on both outcomes (`:860`) stays.

### Not touched

- **Secret boxes** (program Deferred): `packages/wallet-crypto/src/session-secret-box.ts:91-98, 128-132` and `password-secret-box.ts:219, 226, 234`.
- **Not encodings:** the `Buffer.from(bytes)` copies made for `Fr.fromBuffer` and zeroization (`account/service.ts:386, 434`, `profile/session-manager.ts:317, 636`, `account-integrity/coordinator.ts:134`, `wallet-crypto/src/mnemonic-master.ts:52`, `passkey-credential.ts:88`). The UTF-8 encode at `pxe/opfs-store.ts:209`. `apps/extension/src/popup/app.vue:375` (`btoa` of an SVG string for a data URL: text, not bytes). Scripts and tests.
- **Outside Q-15's list:** see Deferred.

### Complexity and coupling

- Every edit replaces an expression in place; no function grows, and none is in the complexity manifest.
- wallet-core is not edited, so the npm bundle, which inlines `@nulo/wallet-core/utils` (`encryption-key.ts:2`), cannot change. `wallet-fingerprint.ts` is outside `public.ts`'s import graph (`public.ts:6-8`, `account-derivation.ts:24-28`). The stage comparison still runs.
- No open or building arc (20, 21, 22b, 23, 24) touches any file here (checked by `git diff --name-only` against each branch).

## Security & Adversarial Considerations

- **Who controls the input.**
  - A full backup is attacker-controlled: its checksum is integrity, not authentication. It reaches `:2211`, `:2222` and `:2242`.
  - `chrome.storage.local` is writable by anything that reaches the profile directory. It reaches `:1994` and `integrity.ts:59`.
  - The service worker controls the PXE store-key wire (`pxe/service.ts:828`).
  - The authenticator controls the WebAuthn user handle (`:139`).
  - A consolidation that unified the two dialects would widen or narrow what each accepts. Each site keeps its own dialect, and Phase 1 pins one distinguishing input per site.
- **Lenient MAC decode** (`integrity.ts:59`). A MAC with junk appended decodes to the same bytes, so it verifies today and still will. That is not a forgery: the decoded bytes must still be the HMAC. Phase 1 pins it so a strict swap, which would drop such rows, fails.
- **Restore.** Today a garbled backup field decodes leniently and then meets the 32-byte checks and the entropy/master pairing check (`:2212`, `:2223`, `:2228-2237`, `:2243`). All stay at their lines, in their order, before anything is sealed.
- **Secret hygiene.**
  - Each lenient site gets the same `Buffer` object back and zeroizes it on the same paths.
  - The encoders still read the secret before the `finally` that wipes it.
  - `pxe/client.ts:215` still wipes `provision.key`.
  - The same number of unwiped raw copies: a `Buffer` before, a latin1 string after. The wipes are unchanged.
- **Engine error text.** No moved expression can receive a malformed value it could not receive before:
  - The lenient decodes take the same argument, whose read stays at the site, and `Buffer.from`'s own `TypeError` names no local (probe, Fact 2).
  - The strict decode calls `atob` with the same value.
  - The encoders' inputs are typed outputs of wallet crypto, never parsed data. A missing `provision.key` would make the `finally`'s `provision.key.fill(0)` throw, which replaces the try's error identically before and after.
  - So no Chrome or Firefox text probe is needed. The shim is plain JavaScript, so its acceptance set does not depend on the engine.
- **Logging:** no new log line.
- **npm surface:** `public.ts` and wallet-core untouched; staged package compared parent against head.

## Assumptions

**Facts** (read 2026-10-03 on `harden-dedupe` at `1a08fa52`):

1. Every site and line above, as read today. No `fromBase64Lenient` exists. `getRandomHex`, `bytesToHex`, `toBase64`, `fromBase64` and `array_equals` are already exported from `@nulo/wallet-core/utils` (`index.ts:2, 5, 13`).
2. **Probe** (scratch, Bun 1.4.2; the shim loaded from `vite-plugin-node-polyfills@0.28.0`'s `shims/buffer/dist/index.js`).
   - **base64, ASCII input:** native and shim `Buffer` agree on every ASCII row probed.
   - **base64, non-ASCII input:** they do not always agree. Native decodes some non-ASCII code units as alphabet values; the shim strips them. The rows below come from both audit legs (Drift D4):

     | input | native | shim |
     |---|---|---|
     | `"QUīJD"` | `414f89` | `414243` |
     | `" QUJD"` | `fd0509` | `414243` |
     | `"QU😀JD"` | `41` | `414243` |

   - **Strict `atob`** throws `InvalidCharacterError` on:
     - length ≡ 1 mod 4;
     - an `=` inside, doubled or leading;
     - `-` or `_`, `!` or `*`;
     - any non-ASCII input.

     ASCII whitespace and missing padding pass both dialects. `0x`, `0X` and lowercase decode as base64 letters in both.
   - **hex:** native and shim disagree on 5 of 17 rows (`" 00ff"`, `"00 ff"`, `"1g"`, `"-1"`, `"+f"`). The shim uses `parseInt` per pair, so `"-1"` becomes `0xff`.
   - **Hex encode of an `ArrayBuffer`:** identical in both.
   - **`Buffer.from(undefined | 123, …)` errors** name no local, in either `Buffer`.
3. Vitest runs without the polyfill plugin (`apps/extension/vitest.config.ts:12-18`), so today's tests exercise native `Buffer` only. The extension's aggregate run uses jsdom's `atob`; aztec-runtime's own run uses Bun's. Both throw `InvalidCharacterError`.
4. `Fr.fromBuffer` accepts a plain `Uint8Array` on Bun (probe). A helper mutant that drops the `Buffer` type therefore survives at `account/service.ts:442`, so the helper's own table asserts `Buffer.isBuffer` (mutant H2).
5. **Existing pins:**
   - `wallet-fingerprint.test.ts:15-20`: a node:crypto KAT.
   - `passkey-ceremony.test.ts:104, 114`: create mode only. No get-mode row carries a non-null user handle, so `:139`'s encode is unpinned today.
   - `integrity.test.ts:63-66`: empty and junk MACs give `false`.
   - `incarnation-fence.test.ts:81-98`: same bytes are idempotent, different bytes are rejected.
   - `client-recovery.pins.test.ts:48-66`: wire methods and key wipe, with a `0x07` key whose base64 has no `+` or `/`.
   - `service.integration.test.ts:392-398`: checks only that `exportPlain` is non-empty.
6. 32 bytes of `0xfb` encode as `+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/s=`, which contains `+`, `/` and `=`. That is the encoder fixture throughout.

**Inferences:**

- The shim's decoders use no engine builtin beyond `String`, `parseInt` and typed arrays, so the Bun probe of the shim stands for Chrome and Firefox (high confidence). Skipping a Chrome/Firefox text probe rests on input provenance and the unchanged throwing primitives.

**Asks:** all four were answered by the panel (Plan audit, below).

## Phases

### Phase 1: pin today's behaviour (test only, consumers unchanged)

Every test passes on the unchanged code, under native `Buffer` and, where marked "both", again under `vi.stubGlobal("Buffer", ShippedBuffer)` (imported from `vite-plugin-node-polyfills/shims/buffer`), with `afterEach(vi.unstubAllGlobals)`. The phase lands in its own commit.

Fixtures for encoder pins contain `+`, `/` and `=` in their encoding (Fact 6). A random value is made deterministic with a scoped `getRandomValues` stub, and its precondition is asserted in-test. Survivor evidence names its input domain.

- **`profile/service.integration.test.ts`:**
  - **Encoders.** A profile created under a scoped `getRandomValues` fill of `0xfb` (deterministic entropy, DEK and IVs). Then:
    - `exportBackupMaterial`'s `entropy` and `importedKeysDek` equal the Fact 6 literal;
    - its `masterKey` equals an independent `Buffer` encoding of the master derived from that entropy, with the `+/=` precondition asserted;
    - `exportPlain` returns the same string;
    - the persisted `dekSealed` passes the `+/=` precondition, is canonical (`toBase64(fromBase64(x)) === x`), is 84 characters and has version byte `0`.
  - **Lenient restore, both.** One restore with all three fields junked (`!` appended), and one with all three URL-safe. Each succeeds and `exportPlain` returns the canonical `masterKey`. A single row kills each site's strict swap, because each site throws on its own field.
  - **Refusals:**
    - `importedKeysDek` absent gives exactly `Invalid imported-keys dek length` (the `?? ""`);
    - a 31-byte entropy gives `Invalid entropy length`;
    - a 31-byte master gives `Invalid master key length`.
  - **Stored DEK, both.** `exportBackupMaterial` on a row whose `dekSealed` carries a junk suffix returns `dekReplaced: false` and the original DEK.
- **`account/import-export.test.ts`, both:** `deriveAccountSeed` is mocked to record `masterFr.toString()`. For the canonical, junked and URL-safe master strings, the recorded value equals `Fr.fromBuffer` of the canonical bytes.
- **`dapp-session/integrity.test.ts`, both.** A deterministic HMAC key (fixed raw bytes, non-extractable) and a row whose MAC has the `+/=` precondition. The MAC verifies when junk-suffixed, URL-safe, unpadded and with inner ASCII whitespace; the existing `false` rows stay. This drives `:59`'s outer `new Uint8Array` under the shipped binding.
- **New `packages/aztec-runtime/src/pxe/store-key-decode.test.ts`** (strict site). Each row on a fresh service:
  - **Installs:** the `0xfb` key canonical, unpadded, and with ASCII whitespace.
  - **Throws `InvalidCharacterError`** (by `name`): URL-safe; `!` appended; an extra `=`; NBSP appended; `é` appended. After each, `storeKeys` and `profileLifecycles` have no entry for the profile, and provisioning a **different** generation installs, which a prematurely set `live` would refuse.
  - **Length refusals:** `""` gives `got 0`, `QUJD` gives `got 3`.
  - **Ordering:** malformed input against a profile in `deleting` state still throws `InvalidCharacterError`. The decode precedes every lifecycle check.
  - **Equality:** a live key, then the same bytes, then a key differing only in its last byte, which is rejected `… different key for this generation …`.
  - **Wipe:** a `Uint8Array.prototype.fill` spy records the pre-fill contents. On both equality outcomes, a 32-byte decoded copy holding the provisioned bytes is zero-filled.
- **`client-recovery.pins.test.ts`:** the fixtures at `:49` and `:73` become `0xfb`. The provision wire arguments equal `[profileId, "+/v7…+/s=", "gen-A"]`.
- **`account-export.test.ts`** (aztec-runtime's node suite): `buildAccountExport(SIGNING_KEY, L1, <address>).checksum` equals a literal.
- **`passkey-ceremony.test.ts`:** two get-mode rows with a non-null handle, one `ArrayBuffer` and one `Uint8Array`, each asserting the literal `"a3f29b14"`. `StubAssertionResponse` widens to `ArrayBuffer | Uint8Array | null`.
- **`full.test.ts`:** the encrypted download, under a scoped `getRandomValues` fill, passes the `+/=` precondition, is canonical, and decrypts to the compact payload.
- **New `profile/spec.test.ts` and a `coordinator.test.ts` row:** `mintPxeGeneration` and `mintNonce` under a stubbed `getRandomValues` return the exact 32-character string and ask for 16 bytes.

### Phase 2: the helper (additions only)

- `lenient-base64.ts` and its barrel line.
- `lenient-base64.test.ts`, one row per distinguishing class, with expected bytes per runtime and a strict column for `fromBase64`:

  | class | input | native | shim | strict |
  |---|---|---|---|---|
  | canonical | `QUJD` | `414243` | `414243` | `414243` |
  | missing padding | `QUI` | `4142` | `4142` | `4142` |
  | length ≡ 1 mod 4 | `QUJDR` | `414243` | `414243` | throws |
  | short | `Q` | empty | empty | throws |
  | empty | `""` | empty | empty | empty |
  | ASCII whitespace | `"QU JD\n"` | `414243` | `414243` | `414243` |
  | doubled padding | `QUI==` | `4142` | `4142` | throws |
  | inner `=` | `QU=JD` | `41` | `41` | throws |
  | leading `=` | `=QUJD` | empty | empty | throws |
  | `0x` prefix | `0xQUJD` | `d3141424` | `d3141424` | `d3141424` |
  | case | `qujd` | `aae8dd` | `aae8dd` | `aae8dd` |
  | URL-safe | `QUJD-_8` | `414243fbff` | `414243fbff` | throws |
  | junk | `QUJ!D` | `414243` | `414243` | throws |
  | Latin Extended | `"QUīJD"` | `414f89` | `414243` | throws |
  | Unicode space | `" QUJD"` | `fd0509` | `414243` | throws |
  | astral | `"QU😀JD"` | `41` | `414243` | throws |
  | non-string array | `[65, 66, 67]` | `414243` | `414243` | throws |

  Every row also asserts `Buffer.isBuffer` under its runtime.
- **Encoder parity with the shipped `Buffer`:** `toBase64` and `bytesToHex` against `ShippedBuffer.from(x).toString(…)` for:
  - an empty input, a single byte, high bytes and a non-multiple of 3;
  - 200,000 bytes;
  - a `new Uint8Array(arrayBuffer)` and a `Buffer`;
  - a nonzero-offset view with distinguishable surrounding bytes, so an accidental `.buffer` encode fails.
- **Helper mutants:**

  | id | mutant | killed by |
  |---|---|---|
  | H1 | the body becomes `fromBase64` | the throwing rows |
  | H2 | it returns `new Uint8Array(Buffer.from(…))` | `isBuffer` |
  | H3 | it trims first | `" QUJD"` under native; `[65, 66, 67]` under both |
  | H4 | a Buffer-free reimplementation (strip, map `-_` to `+/`, re-pad, `atob`) | `QU=JD` and `isBuffer` |

  If H3 cannot be killed on some runtime, a probe shows why and the lessons log records it.

### Phase 3: migrate (Phase 1 and 2 test files frozen)

- **3a:** the base64 encoders.
- **3b:** the hex encoders.
- **3c:** the lenient decoders, deleting each cast that typecheck no longer needs.
- **3d:** `pxe/service.ts` (`fromBase64`, `array_equals`, the `storeKeys` type).
- **3e:** the random hex.
- **Imports:**
  - `@nulo/wallet-core/utils` in the packages and in `profile/service.ts:22`.
  - `@/wallet/utils` for the helper in `profile/service.ts` and `account/service.ts`; `@/wallet/utils/lenient-base64` in `integrity.ts`.
  - `full.vue`: `import { toBase64 } from "@nulo/wallet-core/utils"`, under its `/** Utils */` header (the script is plain JS, `:11`).

### Mutation audit

One script holds the full mutant set: the Phase 1 site mutants, the helper mutants, and the migrated-code mutants (each helper call swapped for the other dialect; each `new Uint8Array(…)` wrapper removed at `:139` and `wallet-fingerprint.ts:37`; `array_equals` as a prefix compare).

- A mutant counts as killed only when a named test fails.
- Results persist across reruns.
- The original file is restored from memory and a scratch copy, never with git.

| id | mutant | expected killer |
|---|---|---|
| L1–L6 | each lenient site swapped to `fromBase64` | its junk or URL-safe row |
| L7 | `?? ""` dropped at `:2242` | the absent-DEK row |
| G1–G3 | the master, entropy and DEK length guards removed (`:2212`, `:2223`, `:2243`) | the refusal rows |
| G4 | the PXE length guard removed (`:833`) | the length rows |
| G5–G7 | the PXE lifecycle guards removed | `incarnation-fence.test.ts`, or a focused row where it does not fail |
| S1 | `:828` swapped to the lenient decode | the URL-safe and `!` rows |
| S2 | `:859` forced to `same = true` | the last-byte row |
| S3 | the decode moved after the lifecycle checks | the ordering row |
| W1 | `:860`'s `key.fill(0)` removed | the wipe rows |
| E1 | each base64 encoder made URL-safe or unpadded | its literal or canonical pin on a `+/=` fixture |
| E2 | each hex encoder upper-cased | its literal or KAT |
| E3 | `mintPxeGeneration` or `mintNonce` drawing 32 bytes | the exact-string rows |

**Validation gate (after each phase):**

- **Commands:** `bash scratchpad/hd/gates.sh <worktree> <logdir>` (lint, `typecheck:all`, `test:all`, `test:ci-gating`, `audit:vue`, `lint:actions`). Then `bun run build`, after which `git diff` shows no change to `auto-imports.d.ts`, `components.d.ts` or `.eslintrc-auto-import.json`.
- **npm:** `bun scripts/publish/stage.ts wallet-crypto --version 0.1.0 --out <scratch>` at the parent and at the head, same toolchain: identical file inventories and every sha256 equal.
- **Pass criteria:** all exit 0. In Phase 3, `git diff` touches no Phase 1 or Phase 2 test file.
- **Screenshots:** § UI impact.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, with the adversarial, assumption-attack and implementation-critique asks.
   - Per site, it checks the input type, the dialect, the returned object type and the zeroize path.
   - It carries the no-over-engineering and comment-quality rules verbatim (the error-registry plan's wording).
   - An Opus panelist reviews in parallel.
2. **Fix loop:** at most 5 rounds, each logged in this arc's lessons file.
3. **Delivery:** push, open a ready PR against `harden-dedupe` at the bottom of the gh stack, add both e2e labels, and squash-merge once the gates are green on suites that actually ran.
4. **Close-out:** with the program plan.

## Delivery

One arc, `hd/16-byte-primitives`, stacked on `harden-dedupe`. Code review: off.

## UI impact

**Logic only.** No template, copy or style changes. `full.vue`'s script changes one expression, so the zero-diff gate captures that page (`/popup/settings/security/export/full`). Its states:

- `finished`: the backup is created, before encryption.
- `encrypted`: the done banner, with Download enabled.

Each is shot on Chrome and Firefox, dark and light. The run compares base `1a08fa52` against the code head, then a separate `--stability` run follows, from a new `byte-primitives` surface file. No touched site renders its value on screen: the encoded strings are downloaded, persisted or sent over a port.

## Drift kept as today (routed to follow-ups)

None is user-visible on a realistic path, so none goes to the alignment arc:

- **D1.** `passkey-ceremony.ts:41`'s hex decode accepts different garbage under the shipped shim than under Bun's `Buffer` (Fact 2). Tests therefore exercise a decoder that differs from the shipped one. The input is a wallet-minted lowercase handle.
- **D2.** `integrity.ts:58-62`'s `catch` is reachable only by a non-string `mac`. Kept.
- **D3.** The lenient/strict split itself, excluded by name in the program's Behaviour rule.
- **D4.** The lenient base64 decode differs between test and ship on non-ASCII input (Fact 2's three rows). Only an attacker editing storage or a backup can produce such input. Not normalized.

## Deferred

- `packages/wallet-core/src/utils/serialization.ts:32-34`: two `Buffer` base64 encoders inside the Buffer-free package. They are not in Q-15's list. The first consumes a JSON `number[]`, whose coercion would need its own proof; the second an existing `Buffer`.
- `passkey-ceremony.ts:29-31`: `decodeBase64`, a one-line alias of `fromBase64`. Not a duplicate implementation.
- Q-15 (e): arc 15. The secret boxes: program Deferred.

## Decisions (delegated)

### Plan audit: Codex (GPT-6 Astra, xhigh), REVISE, high confidence; Opus panelist, REVISE, no blocker

Both legs confirmed byte identity by probe at every moved site.

**Adopted from both legs:**

1. **Native/shim lenient-base64 drift.** Added as D4. The Phase 2 table gets per-runtime columns with the three rows from Fact 2, and Fact 2's "agree on all rows" is narrowed to ASCII input. The rows are recorded, not normalized: the helper must keep each runtime's behaviour.
2. **Callers under the shipped `Buffer`.** The restore, signing-key and MAC rows run under both bindings, with scoped `vi.stubGlobal`. Helper parity alone would not prove caller integration, or the outer `new Uint8Array` at `integrity.ts:59`.
3. **H3 ("trims first").** Codex showed it survives the original rows on both runtimes; Opus argued it is unrealistic. Kept, and killed with Codex's inputs: `" QUJD"` under native, `[65, 66, 67]` under both. Also added Opus's realistic H4, a Buffer-free reimplementation.
4. **E1 and URL-safe kills.** Every encoder pin uses a `+/=` fixture (Fact 6), made deterministic by a scoped `getRandomValues` stub where the value is random. A `0x07` key cannot tell URL-safe from standard.
5. **Failed-call state at `:828`.** Both maps must be absent right after a rejection, and a different generation must provision afterwards. Codex's in-memory mutant, which set `live` before the decode, passed the original retry check.
6. **Guard and wipe mutants.** Added G1–G7, S3 and W1, with focused rows for the entropy-length refusal, the decoded-key wipe on both outcomes, the decode-before-lifecycle order and a last-byte key pair. Codex found that deleting `:860` passed every planned test.
7. **`:859` equivalence.** The copy before transfer (`opfs-store.ts:112-114`) is the invariant. The detached-array probe is recorded as unreachable and strictly safer. Both comparisons short-circuit.
8. **`passkey-ceremony.ts:139`.** Fact 5 was wrong: no get-mode row passes a non-null handle. Added `ArrayBuffer` and `Uint8Array` rows with a literal.
9. **The signing-key row.** It records `masterFr` through a mocked `deriveAccountSeed`, so it asserts the derivation input directly, not the export.
10. **Secret-hygiene wording.** The plan said "one fewer copy"; corrected to the same number of unwiped raw copies.
11. **Ask 1 supersedes arc 15's seam.** `async-primitives/plan.md`'s seam and program row 15 said this arc defines a hex decoder. With one runtime site, a helper removes no duplication, and the test and ship decoders disagree (D1). Program row 15 is amended to say so.
12. **Offset view.** A nonzero-offset view is added to the encoder parity table.

**Nits, adopted:**

- Name `full.vue`'s import source.
- `integrity.ts` imports the helper directly, not through the barrel.
- The TSDoc states the contract, not its callers, and the naked `Buffer` stays.
- The Phase 2 table is trimmed to one row per class.
- `popup/app.vue:375` is listed under Not touched.

**Asks, both legs agree:**

1. No hex decoder.
2. Migrate `wallet-fingerprint.ts:37`, keeping the KAT and the npm stage comparison.
3. Migrate `mintNonce`.
4. The helper lives at `apps/extension/src/wallet/utils/lenient-base64.ts` and returns the `Buffer`.
