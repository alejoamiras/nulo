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
- **TSDoc** (one short paragraph): which inputs it forgives, that it returns the `Buffer` itself, and that new code uses the strict `fromBase64`. These sites stay lenient because a strict decode would turn a garbled stored or restored value into a thrown error.
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

`pxe/service.ts:859`, `installed.every((b, i) => b === key[i])`, becomes `array_equals(installed, key)` (`packages/wallet-core/src/utils/arrays.ts:1-11`). `every` has no length check; `array_equals` does. They agree because both operands are 32 bytes: `key` passes `:833` first, and `storeKeys` only ever receives such a key (`:869`, its only `set`). `storeKeys` narrows to `Map<string, Uint8Array<ArrayBuffer>>` (`:173`), a type-only change matching what `:828` already builds, so it satisfies `array_equals`' parameter type. The `key.fill(0)` on both outcomes (`:860`) stays.

### Not touched

- **Secret boxes** (program Deferred): `packages/wallet-crypto/src/session-secret-box.ts:91-98, 128-132` and `password-secret-box.ts:219, 226, 234`.
- **Not encodings:** the `Buffer.from(bytes)` copies made for `Fr.fromBuffer` and zeroization (`account/service.ts:386, 434`, `profile/session-manager.ts:317, 636`, `account-integrity/coordinator.ts:134`, `wallet-crypto/src/mnemonic-master.ts:52`, `passkey-credential.ts:88`). The UTF-8 encode at `pxe/opfs-store.ts:209`. Scripts and tests.
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
  - No new copy of secret bytes: `toBase64` reads in place, where `Buffer.from(x)` made a copy, so one fewer copy is left unwiped.
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
   - **base64:** native and shim `Buffer` agree on all 28 rows. Strict `atob` throws `InvalidCharacterError` on 15 of them: length ≡ 1 mod 4, `=` inside or doubled, `-_`, `!`, `*`, non-ASCII, NBSP, a leading `=`. ASCII whitespace and missing padding pass both dialects; `0x`, `0X` and lowercase decode as base64 letters in both.
   - **hex:** native and shim disagree on 5 of 17 rows (`" 00ff"`, `"00 ff"`, `"1g"`, `"-1"`, `"+f"`). The shim uses `parseInt` per pair, so `"-1"` becomes `0xff`.
   - **Hex encode of an `ArrayBuffer`:** identical in both.
   - **`Buffer.from(undefined | 123, …)` errors** name no local, in either `Buffer`.
3. Vitest runs without the polyfill plugin (`apps/extension/vitest.config.ts:12-18`), so today's tests exercise native `Buffer` only. The extension's aggregate run uses jsdom's `atob`; aztec-runtime's own run uses Bun's. Both throw `InvalidCharacterError`.
4. `Fr.fromBuffer` accepts a plain `Uint8Array` on Bun (probe). A helper mutant that drops the `Buffer` type therefore survives at `account/service.ts:442`, so the helper's own table asserts `Buffer.isBuffer` (mutant H2).
5. The existing pins: the `wallet-fingerprint.test.ts:15-20` node:crypto KAT; `passkey-ceremony.test.ts:104, 114`, which use a `Uint8Array` user handle and no `ArrayBuffer`; `integrity.test.ts:63-66` (empty and junk MAC give `false`); `incarnation-fence.test.ts:81-98` (same bytes are idempotent, different bytes are rejected); `client-recovery.pins.test.ts:48-66` (wire methods, key wiped); `service.integration.test.ts:392-398`, which checks only that `exportPlain` is non-empty.

**Inferences:**

- The shim's decoders use no engine builtin beyond `String`, `parseInt` and typed arrays, so the Bun probe of the shim stands for Chrome and Firefox (high confidence).

**Asks for the panel:**

1. **Hex decoder.** Recommended: define none, and leave `passkey-ceremony.ts:41` inline (one runtime site, with test/ship divergence). The alternative is a Buffer-wrapping `fromHexLenient` beside it, with a hex table under both `Buffer`s.
2. **`wallet-fingerprint.ts:37`.** It sits in `wallet-crypto`, which is frozen, but it is not a secret box and not in the npm graph. Recommended: move it. The KAT pins the bytes, and the program row excludes only the boxes. The alternative is to leave it as frozen, with a one-line Deferred entry.
3. **`mintNonce` in the dead coordinator.** Recommended: migrate it, one line. It stays honest whichever way the owner's deletion call goes. The alternative is to leave dead code alone.
4. **Helper home and shape.** Recommended: `apps/extension/src/wallet/utils/lenient-base64.ts`, returning the `Buffer` itself. The alternatives are wallet-core, which breaks its Buffer-free contract, or leaving the six decodes inline with no name for the dialect.

## Phases

### Phase 1: pin today's behaviour (test only, consumers unchanged)

Every test passes on the unchanged code and lands in its own commit. Mutants are applied to a scratch copy of the file, the run must turn red, and the original is copied back (never `git checkout`). Results go in `implementations-plan/harden-dedupe/lessons/arc-16-byte-primitives.md`.

- **Lenient sites**, one distinguishing input each, a canonical value with `!` appended (the lenient decode drops it, `atob` throws), plus a URL-safe rewrite where the value contains `+` or `/`:
  - `service.integration.test.ts`:
    - Restore from a `restorePairFor` pair, with `masterKey`, `entropy` and `importedKeysDek` each junked in turn. Each restore succeeds and `exportPlain` returns the canonical `masterKey`.
    - A restore with `importedKeysDek` absent rejects with exactly `Invalid imported-keys dek length` (the `?? ""`).
    - `exportBackupMaterial` on a row whose `dekSealed` carries the junk suffix returns `dekReplaced: false` and the original DEK.
  - `account/import-export.test.ts`: the plaintext `exportAccount` is identical when the stubbed `exportPlain` returns the master canonical, junked or URL-safe.
  - `dapp-session/integrity.test.ts`: a valid MAC verifies junk-suffixed, URL-safe, unpadded and with inner ASCII whitespace; the existing `false` rows stay.
- **Strict site** (new `packages/aztec-runtime/src/pxe/store-key-decode.test.ts`, beside `incarnation-fence.test.ts`). `provisionChainStoreKey` over the rows below, each on a fresh service. Throw rows assert `InvalidCharacterError` by `name` only, and that nothing is installed (a follow-up provision of the canonical key installs, from the unseen state).
  - **Installs:** a canonical 32-byte key whose base64 has `+` and `/`; the same unpadded; with ASCII whitespace.
  - **Throws:** URL-safe; `!` appended; an extra `=`; NBSP appended; `é` appended.
  - **Refused by length:** `""` (`got 0`), `QUJD` (`got 3`).
- **Encoders, by literal:**
  - `exportPlain` after a restore returns exactly the pair's `masterKey`.
  - `exportBackupMaterial`'s `masterKey` and `entropy` equal the pair's strings, and its `importedKeysDek` is canonical: `toBase64(fromBase64(x)) === x`, 32 bytes.
  - The persisted `dekSealed` is canonical, 84 characters, version byte `0`, and decrypts to the DEK.
  - `full.test.ts`: the encrypted download is canonical base64 that `EncryptionKey` decrypts to the compact payload. If the file stubs `encrypt`, it pins the exact string for the stub's bytes.
  - `client-recovery.pins.test.ts`: the provision wire arguments equal `[profileId, <literal base64 of 32 × 0x07>, "gen-A"]`.
  - `account-export.test.ts` (aztec-runtime's node suite): `buildAccountExport(SIGNING_KEY, L1, <address literal>).checksum` equals a literal.
  - `passkey-ceremony.test.ts`: an `ArrayBuffer` user handle, the DOM's real shape, yields the same hex as the `Uint8Array` row.
  - The fingerprint KAT already exists.
  - New `profile/spec.test.ts`: `mintPxeGeneration` under a stubbed `getRandomValues` that fills a known pattern returns that exact 32-character string, and asks for 16 bytes. Plus a `coordinator.test.ts` row for `mintNonce` if Ask 3 is adopted.
- **Mutants that must turn red (applied to the original code):**

  | id | mutant | killed by |
  |---|---|---|
  | L1–L6 | each lenient site swapped to `fromBase64` | its junk row |
  | L7 | `?? ""` dropped at `:2242` | the absent-DEK row (`Buffer.from(undefined)` throws a different text) |
  | S1 | `:828` swapped to `Buffer.from(…, "base64")` | URL-safe and `!` rows install |
  | S2 | `:859` forced to `same = true` | the existing different-bytes test |
  | E1 | each encoder made unpadded or URL-safe | its literal or canonical-form pin |
  | E2 | each hex encoder upper-cased | its literal or KAT |
  | E3 | `mintPxeGeneration` drawing 32 bytes | the exact-string row |

### Phase 2: the helper (additions only)

- `lenient-base64.ts` and its barrel line.
- `lenient-base64.test.ts`:
  - **The cross-product table:** each row's literal bytes, from Fact 2, for `fromBase64Lenient` under native `Buffer` and again under `vi.stubGlobal("Buffer", ShippedBuffer)` (imported from `vite-plugin-node-polyfills/shims/buffer`, the module the build injects), with `Buffer.isBuffer` true under each.
  - The rows cover odd length (≡ 1, 2, 3 mod 4), `0x` and `0X` prefixes, lowercase, ASCII whitespace (leading, trailing, inner, newline, tab), padding (missing, doubled, inner, leading, all `=`), the URL-safe alphabet, empty, non-ASCII (`é`, an emoji, NBSP), `!` and `*`.
  - A strict column asserts `fromBase64`'s outcome per row, so the table documents where the two dialects part.
  - **Encoder parity with the shipped `Buffer`:** `toBase64` and `bytesToHex` against `ShippedBuffer.from(x).toString(…)` for an empty input, single bytes, high bytes, a non-multiple of 3, 200,000 bytes, a `new Uint8Array(arrayBuffer)` and a `Buffer` input.
- **Mutants:**
  - H1: the body becomes `fromBase64`.
  - H2: it returns `new Uint8Array(Buffer.from(…))`.
  - H3: it trims first.
  - All must turn red.

### Phase 3: migrate (Phase 1 and 2 test files frozen)

- **3a:** the base64 encoders.
- **3b:** the hex encoders.
- **3c:** the lenient decoders, deleting each cast that typecheck no longer needs.
- **3d:** `pxe/service.ts` (`fromBase64`, `array_equals`, the `storeKeys` type).
- **3e:** the random hex.
- Imports follow each file's existing source: `@nulo/wallet-core/utils` in packages and `profile/service.ts:22`; `@/wallet/utils` for the helper; an explicit import under `full.vue`'s `/** Utils */` header (the script is plain JS, `:11`).
- **The mutants re-run on the migrated code:**
  - each helper call swapped for the other dialect;
  - each `new Uint8Array(…)` wrapper removed at `:139` and `wallet-fingerprint.ts:37`, which throws, since an `ArrayBuffer` is not iterable;
  - `array_equals` swapped for a prefix compare.
  - Every survivor gets a test or a probe that shows an identical outcome.

**Validation gate (after each phase):**

- **Commands:** each touched workspace's tests; `bun run lint`, `typecheck:all`, `test:all`, `test:ci-gating`, `audit:vue`, `lint:actions`; `bun run build`, after which `git diff` shows no change to `auto-imports.d.ts`, `components.d.ts` or `.eslintrc-auto-import.json`.
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

Each is shot on Chrome and Firefox, dark and light, plus a `--stability` run, from a new `byte-primitives` surface file. No touched site renders its value on screen: the encoded strings are downloaded, persisted or sent over a port.

## Drift kept as today (routed to follow-ups)

None is user-visible on a realistic path, so none goes to the alignment arc:

- **D1.** `passkey-ceremony.ts:41`'s hex decode accepts different garbage under the shipped shim than under Bun's `Buffer` (Fact 2). Tests therefore exercise a decoder that differs from the shipped one. The input is a wallet-minted lowercase handle.
- **D2.** `integrity.ts:58-62`'s `catch` is reachable only by a non-string `mac`. Kept.
- **D3.** The lenient/strict split itself, excluded by name in the program's Behaviour rule.

## Deferred

- `packages/wallet-core/src/utils/serialization.ts:32-34`: two `Buffer` base64 encoders inside the Buffer-free package. They are not in Q-15's list, and the input there is a JSON `number[]`, whose coercion would need its own proof.
- `passkey-ceremony.ts:29-31`: `decodeBase64`, a one-line alias of `fromBase64`. Not a duplicate implementation.
- Q-15 (e): arc 15. The secret boxes: program Deferred.

## Decisions (delegated)
