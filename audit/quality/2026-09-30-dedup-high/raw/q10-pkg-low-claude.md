# q10-pkg-low — claude

Scope read: packages/wallet-crypto/src/{encryption-key,imported-account-key-box,imported-keys-dek-box,session-secret-box,password-secret-box,nulo-separators,dual-secret-hkdf}.ts (+ grep of every `getRandomValues`, `TextEncoder("nulo:`, `Buffer.` site); packages/extension-messaging/src/{errors,background/client,background/service,offscreen/client,offscreen/service,core/base-client (settle/ready-deadline),core/base-service}.ts; packages/wallet-core/src/utils/{lock,keyed-lock,rw-guard,encoding,random,arrays,sleep,errors,error-json}.ts, jobs/{types,fsm,error}.ts. Cross-checked: apps/extension/src (profile/service.ts, profile/spec.ts, activity-protocol/coordinator.ts, stores/balances.store.ts, popup/auth-guard.ts, components/Header.vue, LogsViewer.vue, composables/importPreflight.ts, importChainSync.ts, wallet/utils/offscreen.ts, execution/execution-mutex.ts), packages/aztec-runtime/src/pxe/{client,service}.ts, packages/aztec-runtime/src/account/account-export.ts. jscpd-production.md had no rows in this cluster. Prior Q-07 (transport error-shaping quintet) and Q-14 (ctor identity tail) from 2026-08-14 are FIXED (errors.ts:24-46 owns `new.target.prototype` once; base-client owns the error makers) and are skipped. Prior 2026-08-16 Q-03 (EventHandler swallow) is out of dedup scope and not re-reported.

## q10-pkg-low-C-1: Adding a `WalletError` subclass means editing three parallel 21-entry structures, and forgetting one fails silently

- **Smell:** Shotgun Surgery (with Switch Statements): one conceptual fact, "code X reconstructs as class X", is encoded three times.
- **Maintenance impact:** structural. Blast radius 1 file, but it is the wire-error contract for every service and client (40 extension files import `./errors`). `errors.ts` has 22 commits total, 20 since 2026-06-01, the hottest file in the cluster.
- **Evidence:** in `packages/extension-messaging/src/errors.ts`, each of the 21 subclasses declares `static CODE` and a class (`:50-463`); the same 21 codes are restated in the `KnownWalletErrorPayload` union (`:472-493`) and again in the `walletErrorFromPayload` switch (`:503-558`). Each case is `return new X(known.message, known.details)`; only `CapabilityNotGrantedError` (`:~520`) and the three no-arg classes (`SessionEndedError`, `TermsAcceptanceRequiredError`, `OperationNotRecordedError`) differ. `ScopeViolationError` already drops `details` by hand. A class with no switch case is not a compile error: it falls to `default` and arrives as a bare `WalletError`. `instanceof` then fails on the client, which is the exact failure the file header says this module prevents. `errors.test.ts` covers 9 hand-written round-trips, not all 21, and cannot catch a new class.
- **Why it harms future change:** every new wire error (about one a month) needs class + union member + case. The compiler checks none of the three links. The bug shows up later as a toast or retry path that silently stops matching `instanceof`.
- **Smallest safe refactoring:** Replace Conditional with Polymorphism via a table. Each class gets `static fromPayload(p)`, defaulting to `new this(p.message, p.details)` and overridden by the four odd ones. One `const WALLET_ERROR_CLASSES = [RpcTimeoutError, ...] as const` keyed by `CODE` replaces the switch. Derive the union from it, or drop it. Add one test that round-trips every entry. It stays in `extension-messaging/src/errors.ts`; no layer change.
- **What disappears:** the 22-line union and about 55 switch lines collapse to a 21-name array plus a 4-line lookup. The "forgot the case" failure becomes impossible if the array is also the source for a "every `CODE` is registered" test.
- **Instances:** `packages/extension-messaging/src/errors.ts:472-493`, `:503-558`; the class declarations at `:50-463`.

## q10-pkg-low-C-2: Base64/hex codecs re-implemented beside `toBase64`/`fromBase64`/`bytesToHex`/`getRandomHex` that wallet-core exists to provide

- **Smell:** Duplicate Code (semantic, re-implementing an existing helper). This is also Shotgun Surgery on the codec: the "drop the Node Buffer polyfill" goal in `wallet-core/src/utils/encoding.ts:1-6` cannot land while ~35 sites bypass it.
- **Maintenance impact:** structural. Blast radius 7 files across 3 packages plus the extension. Change frequency is moderate: `profile/service.ts` has the most commits of the files involved.
- **Evidence:** `encoding.ts` documents "byte-identical to the `Buffer`/loop idioms these replaced". It is still bypassed in these places.
  - `wallet-crypto/src/session-secret-box.ts:92-98,128-132`: `Buffer.from(x).toString("base64")` ×3 and `Buffer.from(b64,"base64")` ×3. The `tokenCopy` wipe at `:91-102` exists only because `Buffer.from` makes a second live copy of the bearer; `toBase64(token)` makes none.
  - `wallet-crypto/src/password-secret-box.ts:219,226,234`: `Buffer.from(..., "base64")` ×3, in the same file that imports `toBase64` at `:40` and uses it at `:196-198`. Encode and decode in one file use different codecs.
  - `wallet-crypto/src/wallet-fingerprint.ts:37`: `Buffer.from(digest).toString("hex")`, equal to `bytesToHex`.
  - `apps/extension/src/wallet/services/profile/service.ts:1718,1876-1878,2063,2072,2310,2321,2341`: 10 `Buffer.from(.., "base64")` / `.toString("base64")` sites around the same sealed-secret blobs. `account/service.ts:439`, `dapp-session/integrity.ts:59`, `utils/passkey-ceremony.ts:41,139` (hex) do the same.
  - `packages/aztec-runtime/src/pxe/client.ts:208` `btoa(String.fromCharCode(...provision.key))` (the spread idiom `encoding.ts:14-15` warns against) and `pxe/service.ts:817` `Uint8Array.from(atob(..), c => c.charCodeAt(0))` (hand-written `fromBase64`).
  - Hex mint ×2: `apps/extension/src/wallet/services/activity-protocol/coordinator.ts:48-52` `mintNonce()` and `profile/spec.ts:103-107` `mintPxeGeneration()`. Both draw 16 random bytes and hex them, which is exactly `getRandomHex(32)` (`wallet-core/src/utils/random.ts:9-14`).
  - Byte equality: `aztec-runtime/src/pxe/service.ts:848` `installed.every((b, i) => b === key[i])` vs `array_equals`.
- **Why it harms future change:** a codec-level change (strict vs lenient decode, dropping the Buffer polyfill, a wipe policy) has to be made in two dialects. `Buffer.from(b64, "base64")` is lenient and never throws, while `fromBase64` is strict and throws, so a migration is a behavior change, not a rename. The call sites that matter (`unsealInternal`, `unwrapPair`, backup restore) should be chosen on purpose, not by whichever idiom the author knew.
- **Smallest safe refactoring:** Replace calls with the existing helpers. Use `fromBase64` inside the `try` blocks that already catch (`session-secret-box.ts:126-136`), and `getRandomHex(32)` for both mints. Keep one exception-parity test per decode site, because of the strict/lenient difference. The helpers already live in `@nulo/wallet-core/utils`, the lowest package, so no new home is needed. Do the wallet-crypto and mint sites first (no on-disk shape changes). Leave `profile/service.ts` to its own PR, since it sits on the frozen blob paths.
- **What disappears:** ~35 `Buffer` call sites, `tokenCopy`'s try/finally in `wrapPair` (-7 lines), the two 4-line mint functions, and the ambient `Buffer` declaration in `wallet-crypto/globals.d.ts` becomes removable for this package.
- **Instances:** as listed above. Line numbers are from `git grep` at HEAD.

## q10-pkg-low-C-3: Three byte-identical AES-GCM `version ‖ iv ‖ ct` frame writers/readers inside wallet-crypto

- **Smell:** Duplicate Code (Extract Function opportunity). This is also a Data Clump: the `(12, 13, version-byte, length guard, wipe-on-every-path)` group travels together.
- **Maintenance impact:** local to `wallet-crypto`, but the files are byte-frozen and security-sensitive. Change frequency is low (`imported-account-key-box` 2 commits, `imported-keys-dek-box` 1, `session-secret-box` 3, none of the three after 2026-06 except their creation), so weight this below C-1 and C-2.
- **Evidence:**
  - Seal: `imported-account-key-box.ts:45-58` and `imported-keys-dek-box.ts:38-48`. Both do `getRandomValues(12)`, `encrypt`, `new Uint8Array(13 + ct.length)`, `out[0] = 1`, `out.set(iv,1)`, `out.set(ct,13)`, `toBase64`. They differ only in the `additionalData` and the key source.
  - Open: `imported-account-key-box.ts:62-77` and `imported-keys-dek-box.ts:52-73`. Both do `fromBase64`, `bytes.length < 13 || bytes[0] !== 1`, `subarray(1,13)`, `subarray(13)`, decrypt, then the same `finally { zeroize(bytes) }` with near-identical comments.
  - Third copy: `encryption-key.ts:43-56,78-96`, the same frame with version `0` and `13` literals.
  - `session-secret-box.ts:80-90` is a fourth variant (no version byte).
- **Why it harms future change:** a framing change (a v2 frame, a wider nonce, a different length guard) must be made in 3 to 4 places. Bytes are vector-frozen, so any drift is a data-loss bug, not a style nit. Each copy's wipe-on-every-path discipline is also re-derived by hand.
- **Smallest safe refactoring:** Extract Function into an internal `aes-gcm-frame.ts` (not exported from `index.ts`): `packFrame(version, iv, ct)` and `openFrame(bytes, version)` returning `{iv, ct}` or throwing the same message. Keep the `encrypt`/`decrypt` calls, the HKDF key derivation and the AAD in each module, since those are the real differences. Bytes are unchanged, so `nonce-uniqueness.test.ts` and `key-vectors.test.ts` are the guard.
- **What disappears:** about 30 lines across 3 files; the `13`/`12` magic numbers exist once.
- **Instances:** `imported-account-key-box.ts:45-77`, `imported-keys-dek-box.ts:38-73`, `encryption-key.ts:43-56,78-96`.

## q10-pkg-low-C-4: "Race a promise against a timer" hand-rolled 6 times; `sleep` exists in wallet-core but 5 more prod sites inline it

- **Smell:** Duplicate Code (semantic). The bodies differ in what they do on expiry (reject, resolve a fallback) but all share the same timer-plus-`Promise.race`-plus-`clearTimeout` core. Also Misplaced Function: the only exported `withTimeout` lives in a Pinia store.
- **Maintenance impact:** structural. Blast radius 9 files in `extension-messaging` and `apps/extension`. The races sit on the lock, auth and balances paths, so the timer-cleanup and late-rejection handling matters.
- **Evidence:**
  - `apps/extension/src/stores/balances.store.ts:124-139` exported `withTimeout` (reject after `ms`, clears the timer both ways). It is auto-imported globally (`types/auto-imports.d.ts:352`), so a store is now a de facto util module.
  - `apps/extension/src/popup/auth-guard.ts:81-90` `withinDeadline`: same reject-after-ms, plus `request.catch(() => {})` to swallow the late rejection.
  - `apps/extension/src/components/Header.vue:33-43` `readForLock`: same race, but resolves `{answered:false}` on expiry.
  - `packages/extension-messaging/src/core/base-client.ts:~283-300` `awaitReadyWithinDeadline`: same reject-after-remaining-ms plus `finally clearTimeout`.
  - `apps/extension/src/components/JsonViewer/LogsViewer.vue:191-195`: the same race without `clearTimeout`.
  - `apps/extension/src/composables/importPreflight.ts:41-47` and `importChainSync.ts:115` race against `realSleep(budget)`, and `realSleep` is itself a copy of `sleep`.
  - `sleep` copies: `importPreflight.ts:31` (`realSleep`), `popup/auth-guard.ts:66`, `stores/app.store.ts:648`, `execution/gas-balance-reader.ts:227`, against `@nulo/wallet-core/utils` `sleep` (`wallet-core/src/utils/sleep.ts:1`, re-exported through `@/wallet/utils` and already used in `transaction/service.ts` and `auth-registry/service.ts`). `core/adapters/system-clock.ts:14` is a legitimate `ClockPort` impl and is excluded.
- **Why it harms future change:** each copy makes its own call on whether the timer is cleared, whether the loser is observed (unhandled-rejection risk), and what the expiry value is. The lock-read and the PXE/balance reads are exactly the places those choices matter. A fix such as "swallow the loser's rejection", already applied only in `auth-guard.ts` and `offscreen.ts:326`, never propagates.
- **Smallest safe refactoring:** Move Function plus Parameterize Function. Add `withTimeout<T>(p, ms, onExpire: () => Error | T)` (or a pair, `withTimeout` and `raceTimeout`) to `@nulo/wallet-core/utils` next to `sleep`; it always clears the timer and observes the loser. Re-export it through `@/wallet/utils`. Point the six sites at it, and delete `realSleep` and the three inline sleeps. `base-client` can import it directly (extension-messaging already depends on wallet-core).
- **What disappears:** about 45 lines of race boilerplate, 4 inline sleeps, and the globally auto-imported store export.
- **Instances:** as listed above.

## Non-findings considered

- **Lock / KeyedLock / ReadWriteGuard / ExecutionMutex (repo-map S10):** `Lock` (ticket + watchdog), `ReadWriteGuard` (reader tokens, FIFO writers, per-token ageing) and `ExecutionMutex` (AbortSignal + per-origin caps) have different semantics. `KeyedLock` is already the Extract Class of the `Map<string, Lock>` idiom. The shared queueing is not the part that changes together, so merging would add a parameter soup.
- **`KnownJobErrorKind` union plus `KNOWN_JOB_ERROR_KIND_TABLE` (`jobs/types.ts`):** names are typed twice, but `satisfies Record<KnownJobErrorKind, true>` turns drift into a compile error. Deriving the union from an `as const` array would be nicer but costs nothing to leave.
- **`baseErrorJson` (S8):** already consolidated; both callers (`serialization.ts`, `jobs/error.ts`) use it and the divergent extras are documented.
- **`getErrorMessage` vs `errorMessageFromUnknown`:** deliberate, documented split (wire bytes must not change).
- **`nulo:*` TextEncoder labels across 8 files (S7):** each label is module-private beside its one use, and `nulo-separators.ts` is the registry only for the numeric consensus separators, which the file header says. Centralising the HKDF labels would hurt locality. A cross-file uniqueness test is a different (correctness) concern.
- **Background/offscreen client `onMessage` tails and `connect`/`disconnect`:** residual `if Response handleResponse else handleEvent` is 5 lines, twice, and the two transports validate different envelope fields (`from`, `to`), so it is under the threshold. `DEFAULT_RPC_TIMEOUT_MS` / `DEFAULT_REQUEST_TIMEOUT_MS` are different policies with different rationale comments.
- **Background vs offscreen `Service` seams:** exactly the template-method seams `BaseService` was built for (the spec/client/service triad is documented); nothing left duplicated.
- **`hasIntersectionByKeys` (S11):** single consumer (`account/service.ts`), not duplicated. Speculative-Generality at most, and `safeStringify` collision-proneness is a correctness matter.
- **Dead-export candidates in repo-map** (`./activity` causal merge, telemetry sinks, etc.): not pursued here. The list is name-grep evidence only, and the activity merge algebra is exercised by property tests and may be reached through subpath imports; a dead-code claim would need the registration check the prompt requires, which I did not complete.
- **AES-GCM duplication with `password-secret-box`:** it delegates to `EncryptionKey`, so no fourth frame copy exists there.
- **jscpd rows:** none in this cluster.

## Incidental bugs noticed (for the bugs run)

- None with a confirmed counter-example. Leads only: `wallet-crypto/src/password-secret-box.ts:223` and `apps/extension/src/wallet/services/profile/service.ts:2015,2330` compare secret-derived bytes with the non-constant-time `array_equals`; the guard compare is on a public constant, but the `profile/service.ts` pair compares re-derived vs stored master.

## Cross-rebuttal (claude on codex)

### 1. Codex findings

- **X-1 (promise deadlines, 8 sites): agree, with one caveat.** It matches my C-4 and is better on one point: it adds `opfs-store.ts:124-135` (verified: the same race with `clearTimeout` in a `finally`), which I missed. Its caveat is right too: the OPFS abandoned-worker quarantine must stay at the call site. I still stand by the `sleep` half of C-4 (`realSleep`, `auth-guard.ts:66`, `app.store.ts:648`, `gas-balance-reader.ts:227`), which Codex did not cover. Its table says LogsViewer and the two import races leave the timer scheduled, which matches what I found.
- **X-2 (AES-GCM frame, 3 modules): agree.** Same as my C-3. Codex correctly keeps `session-secret-box` out (no version byte). I listed it as a "fourth variant", but it is not a clean fit, so I withdraw it from the extraction.
- **X-3 (master reduction + wipe tail): agree, low weight.** Verified. `mnemonic-master.ts:50-61` and `passkey-credential.ts:85-99` are the same `Buffer.from` copy, then `Fr.fromBufferReduce`, then `asMasterSecretBytes(toBuffer())`, then a two-buffer zeroize `finally`. I missed it. The duplicated tail is only about 8 lines each in two files, with 1 and 5 recent commits, and both are vector-frozen. The win is marginal and the helper needs an ownership contract, so rank it below X-1, X-2 and X-4.
- **X-4 (nonce mints vs `getRandomHex(32)`): agree.** Same as the mint half of my C-2. Codex is right that it is a pure function-body swap with no strict/lenient decode risk.
- **Codex "blanket Buffer base64 replacement is unsafe": agree.** I made the same point, since strict `atob` vs lenient `Buffer`. But "PXE base64 conversions have less impact" understates `pxe/client.ts:208`, which uses the `String.fromCharCode(...spread)` idiom that `encoding.ts` warns against.
- **Codex incidental bug (`event-handler.ts:40-48`): agree, confirmed.** `invoke` runs `for...of` over the live `#callbacks`, and `remove` splices that same array. A listener removing itself mid-invoke skips its successor. This is a real bug, not a dedup finding. Route it to the bugs run.

### 2. Codex missed, I stand by

- **C-1:** the `WalletError` three-way table (`errors.ts:472-493`, `:503-558`, plus the class declarations) is not in Codex's report or its non-findings. A forgotten switch case fails silently, and the file is the hottest in the cluster.
- **C-2 (Buffer base64/hex bypass):** ~35 `Buffer.from(..,"base64")` sites. Two are in `password-secret-box.ts:219,226,234` and `session-secret-box.ts`, one file of which already imports `toBase64`. Codex only dismissed the blanket replacement and never named the wallet-crypto call sites. My note still holds that these need a per-site exception-parity check.
- **C-4 sleep copies:** see above.
- **Non-constant-time `array_equals` lead** (`password-secret-box.ts:223`, `profile/service.ts:2015,2330`). This is for the security run, not a dedup item.

### 3. Both missed

1. **Duplicate Code, byte equality.** `aztec-runtime/src/pxe/service.ts:848` (`installed.every((b, i) => b === key[i])`) and the `atob` decode at `:817` duplicate `array_equals` and `fromBase64`. I listed these inside C-2, but neither report made them a standalone item. They are low-weight, so fold them into the C-2 PR.
2. No second item that I can defend with file:line evidence.
