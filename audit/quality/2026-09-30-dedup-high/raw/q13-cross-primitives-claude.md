# q13-cross-primitives — claude

Scope read: `audit/quality/2026-09-30-dedup-high/raw/repo-map/_outer.md`; `audit/quality/2026-08-14-dedup-mid/report.md` and `2026-08-16-extension-mid/report.md` (grepped for these primitives; none of the findings below were previously reported, so no RECURRING tags). Source, via `git grep` across `apps/extension/src` and `packages/*/src` (tests and e2e excluded), with the files opened at the cited lines:
- wallet-core `utils/{encoding,random,lock,deferred,serialization,sleep,errors,index}.ts`
- `apps/extension/src/wallet/utils/passkey-ceremony.ts`
- `apps/extension/src/wallet/services/dapp-session/{integrity,spec}.ts`
- `apps/extension/src/wallet/services/{profile/service,profile/spec,activity-protocol/coordinator,price/service,token/seeder,execution/gas-balance-reader,profile-deletion/coordinator,incoming-transfer/scan-episodes,transaction/{spec,service},account/spec}.ts`
- `apps/extension/src/{stores/balances.store,popup/auth-guard,components/Header,components/JsonViewer/LogsViewer}.*`
- `apps/extension/src/composables/{importPreflight,importChainSync,usePinnedTokens,useProfileBootstrap}.ts`
- `apps/extension/src/utils/{coalesce,guarded-network-activation,string}.ts`
- `apps/extension/src/wallet/logger/store.ts`
- `packages/aztec-runtime/src/pxe/{client,service,opfs-store}.ts` and `account/account-export.ts`
- `packages/extension-messaging/src/{errors,zod-helpers,core/base-client}.ts`
- `packages/wallet-bridge/src/{dispatcher,method-scope-checkers,method-descriptors,field-address}.ts`
- `packages/wallet-crypto/src/{session,password}-secret-box.ts`
- `packages/legal/src/status.ts`
- The two font directories, hashed.

Change frequency is `git log` commits, all-time / since 2026-06-01.

## q13-cross-primitives-C-1: Base64 round-trips bypass the wallet-core codec (and use the stack-overflow idiom it exists to avoid)

- **Smell:** Duplicate Code, in the form of a bypassed shared abstraction. Shotgun Surgery applies if the codec's semantics ever change.
- **Maintenance impact:** structural. Blast radius is 3 packages and 6 files. Change frequency is high: `profile/service.ts` has 25/25 commits, and the two secret-box files have 9 commits in total, 7 of them since June.
- **Evidence:**
  - `@nulo/wallet-core/utils` exports `toBase64` and `fromBase64` (`packages/wallet-core/src/utils/encoding.ts:21,34`). Its header says it replaced "the per-site `Buffer`/loop idioms".
  - `passkey-ceremony.ts:24-31` wraps the codec in two trivial, same-shape local aliases, `encodeBase64` and `decodeBase64`.
  - `dapp-session/integrity.ts` imports `toBase64` (line 19, used at 52) and then decodes the MAC with `Buffer.from(mac, "base64")` at line 59, in the same file.
  - Sites that still use Buffer or a raw btoa/atob:
    - `apps/extension/src/wallet/services/profile/service.ts:1718,1876,1877,1878,2063,2072,2310,2321,2341` (9 sites)
    - `apps/extension/src/wallet/services/account/service.ts:439`
    - `apps/extension/src/wallet/services/dapp-session/integrity.ts:59`
    - `apps/extension/src/popup/pages/settings/security/export/full.vue:348`
    - `packages/wallet-crypto/src/session-secret-box.ts:96-98,128,131,132`
    - `packages/wallet-crypto/src/password-secret-box.ts:219,226,234`
    - `packages/aztec-runtime/src/pxe/client.ts:208`: `btoa(String.fromCharCode(...provision.key))`. This is exactly the spread pattern `encoding.ts:17-18` warns overflows the call stack. It is benign at 32 bytes but unguarded.
    - `packages/aztec-runtime/src/pxe/service.ts:817`: `Uint8Array.from(atob(...), c => c.charCodeAt(0))`, a hand copy of `fromBase64`.
  - Not duplicates: `wallet-core/utils/serialization.ts:32-34` needs Buffer detection on purpose. `popup/app.vue:375` encodes a string, not bytes.
  - `Buffer.from(...)` returns a Node `Buffer`, so 7 of these sites carry `as Uint8Array<ArrayBuffer>` casts (`profile/service.ts:2072,2321,2341`; `password-secret-box.ts:219,226,234`). `fromBase64` already returns `Uint8Array<ArrayBuffer>`, so the casts disappear.
  - The layering allows the fix: wallet-crypto and aztec-runtime both already import `@nulo/wallet-core/utils`.
- **Why it harms future change:** dropping the Buffer polyfill (the stated goal of `encoding.ts`) stays blocked at about 20 sites, and only `grep` finds them. The client/service pair for the PXE key is split across two idioms. The encode/decode for one secret can't be audited in one place.
- **Smallest safe refactoring:** Replace Buffer Usage with the Shared Codec. Mechanical swap to `toBase64`/`fromBase64` imported from `@nulo/wallet-core/utils`; delete the two passkey aliases.
  - **One semantic difference to test on the decode sites:** `Buffer.from(x, "base64")` never throws and silently skips invalid characters, whereas `atob` throws. `integrity.ts:58-62`, for example, wraps the decode in a try/catch that currently can never fire.
  - The wallet-crypto decode sites currently fail later, at AES-GCM, for malformed input. After the swap they would throw earlier, from `atob`.
  - Either wrap with a try/catch where "malformed" means "wrong secret", or add a lenient `fromBase64Lenient`.
- **What disappears:** about 20 call-site idioms, 7 `as` casts, 2 alias functions, and the last spread-overflow path.
- **Instances:** the list above.

## q13-cross-primitives-C-2: Hand-rolled promise-chain serializers (7 copies) next to `Lock`

- **Smell:** Duplicate Code, plus a Parallel Implementation of an existing primitive (Alternative Classes with Different Interfaces). Change-wise it is Shotgun Surgery: the "chain continues past a rejection" rule is re-derived per site.
- **Maintenance impact:** architectural-local. Blast radius is 7 files in extension popup, background and stores. Change frequency is moderate: `seeder.ts` 6/6, `price/service.ts` 4/4, `logger/store.ts` 3/3, the rest 1-2.
- **Evidence:** each site keeps a `Promise` tail, appends with `tail.then(op)` and swallows the rejection so the next link still runs. Each re-implements the same "rejection must not wedge the queue" comment and invariant.
  - `apps/extension/src/popup/components/modules/send/fee-send-selection.ts:75-82` (`enqueue`)
  - `apps/extension/src/utils/guarded-network-activation.ts:18,46-50` (`tail`)
  - `apps/extension/src/wallet/logger/store.ts:20,127-132` (`enqueueStorageOp`)
  - `apps/extension/src/wallet/services/incoming-transfer/scan-episodes.ts:60,176`
  - `apps/extension/src/wallet/services/token/seeder.ts:168,311-318` (`withMarkerLock`)
  - `apps/extension/src/wallet/services/price/service.ts:104,231-` (`configTransition`)
  - `apps/extension/src/composables/usePinnedTokens.ts:88-100` (per-key variant that also evicts its map entry)
  - wallet-core already has `Lock` and `KeyedLock` with `withLock`, used in 15+ services. Those add a 5-minute force-release watchdog, which is wrong for some of these. `Lock` accepts `maxHoldMs: null` and `KeyedLock` accepts `{ maxHoldMs: null }`, so the watchdog can be off.
- **Why it harms future change:** there are already four different rejection policies in the copies. The logger site uses `.then(op, op).catch(()=>{})`. `scan-episodes.ts:176` routes rejections to `onPersistError`. `guarded-network-activation.ts` lets the error reach the caller but not the tail. `seeder.ts` lets the error reach the caller. A fix to one (for example, a timeout) needs seven hunts.
- **Smallest safe refactoring:** Extract Function into wallet-core, `utils/serial.ts`. Exports `createSerialQueue()` returning `run<T>(op): Promise<T>`, which returns the op's own result or rejection to its caller while the tail always continues. Optionally take a key for the per-key variant, which `KeyedLock` already covers, so prefer `KeyedLock({maxHoldMs:null})` for `usePinnedTokens`. Lowest shared package is wallet-core (no `chrome.*`, popup-safe).
- **What disappears:** about 7 × 6-10 lines of chain plumbing and their duplicated comments.
- **Instances:** as listed.

## q13-cross-primitives-C-3: "Race a promise against a timer" reimplemented 8 times with no shared helper

- **Smell:** Duplicate Code (same structure, different reject/resolve payload). A Parallelize Function opportunity: it is one function with a `onTimeout` parameter.
- **Maintenance impact:** structural-local. Blast radius is 8 files across 3 packages. Change frequency is medium: `Header.vue` 7/7, `base-client.ts` 8/8, `balances.store.ts` 6/6.
- **Evidence:** create a timer, race it against the work, clear the timer in `finally` (or not):
  - `apps/extension/src/stores/balances.store.ts:124-139` (`withTimeout`, exported, labeled `Error`). It is the only one that clears its timer without `finally`.
  - `apps/extension/src/popup/auth-guard.ts:82-90` (`withinDeadline`; adds `request.catch(()=>{})` so a late rejection isn't unhandled)
  - `apps/extension/src/components/Header.vue:35-43` (resolves a sentinel `{answered:false}` instead of rejecting)
  - `packages/extension-messaging/src/core/base-client.ts:286-301` (typed `makeTimeoutError`, `finally` clear)
  - `packages/aztec-runtime/src/pxe/opfs-store.ts:127-135` (`ChainStoreOpenTimeoutError`, then a quarantine policy)
  - `apps/extension/src/composables/importPreflight.ts:41-46` and `importChainSync.ts:115`. Both race against `realSleep(ms)` (defined at `importPreflight.ts:31`, a copy of wallet-core `sleep`) and never cancel the timer.
  - `apps/extension/src/components/JsonViewer/LogsViewer.vue:190-195`. It never clears the timer and races against a string rejection.
  - `apps/extension/src/wallet/utils/offscreen.ts:333` is a different shape (an existing `ready` gate with its own timer) and is not counted.
  - Several copies carry their own "swallow the loser's late rejection" comment, which is exactly the subtle part a shared helper should own.
- **Why it harms future change:** the subtle parts (unhandled late rejection, timer cleanup) are implemented correctly in 3 copies and missed in others. The tests for one site teach nothing about the next.
- **Smallest safe refactoring:** Extract Function into `@nulo/wallet-core/utils`, `raceDeadline<T,F>(work: Promise<T>, ms: number, onTimeout: () => F): Promise<T | F>`. It clears the timer in `finally` and observes the loser's rejection. `onTimeout` can throw (for reject variants) or return a sentinel (for `Header.vue`). Move `sleep` use in `importPreflight` to it. Keep `withTimeout` as a one-line wrapper only if its 3 call sites want the label.
- **What disappears:** about 8 timer-plus-race blocks, about 50-60 lines, one timer leak in `LogsViewer.vue` and two in the import composables.
- **Instances:** as listed.

## q13-cross-primitives-C-4: Dead byte-identical font copies in the extension (756 KB)

- **Smell:** Duplicate Code plus Dead Code (assets). The ownership moved to `@nulo/design` but the old copies were left behind.
- **Maintenance impact:** cosmetic-structural, blast radius 5 binary files. A two-commit history, dormant. It matters because `@nulo/design` fonts are licence-pinned by SHA-256 in the notices policy, and an undeclared second copy of the same licensed file invites a stale swap.
- **Evidence:**
  - `apps/extension/src/assets/fonts/{InterVariable,JetBrainsMono-latin,MaterialSymbolsOutlined,SpaceGrotesk-latin,SpaceGrotesk-latin-ext}.woff2` have the same SHA-256 as `packages/design/src/fonts/*.woff2`, file for file (hashed).
  - Zero references to `assets/fonts` anywhere outside `implementations-plan` docs: `git grep -n -i "assets/fonts"` across `apps`, `packages`, `scripts` and `.github`, excluding the binaries, hits only plan docs.
  - `packages/design/src/base.css:17,26,27` references `./fonts/…`.
  - Live consumers of the design copy: `apps/extension/scripts/store-art.ts:14`.
  - No registration path covers the extension copies: there are no Vite alias, CSS url, or manifest references. `implementations-plan/M3/6/plan.md:139` records the old design ("STAYS") that the design-system externalization superseded.
- **Why it harms future change:** a font swap can land in the wrong directory and appear to work or not; the store-art script and the build read different copies.
- **Smallest safe refactoring:** Remove Dead Code. `git rm -r apps/extension/src/assets/fonts`. Verify with a build plus the notices generator (its font claim is bound to the design copy's hash).
- **What disappears:** 5 files, 756 KB of repo weight.
- **Instances:** `apps/extension/src/assets/fonts/*.woff2` (5 files).

## q13-cross-primitives-C-5: `isRecord` and "object-shaped" predicates re-declared 11 times with two drifted meanings

- **Smell:** Duplicate Code with drift (Shotgun Surgery if the meaning must change). The copies disagree on whether arrays count.
- **Maintenance impact:** local, blast radius 10 files in 3 packages. Change frequency is high for `wallet-bridge/dispatcher.ts` (34/29), which is a dApp-facing trust boundary where the exact predicate matters.
- **Evidence:**
  - Excludes arrays (`typeof === "object" && !== null && !Array.isArray`):
    - `packages/wallet-bridge/src/dispatcher.ts:307`
    - `packages/wallet-bridge/src/method-scope-checkers.ts:395`
    - `packages/wallet-bridge/src/method-descriptors.ts:115` (`isPlainRecord`)
    - `apps/extension/src/composables/usePinnedTokens.ts:24`
    - `apps/extension/src/wallet/services/incoming-transfer/scan-episodes.ts:32`
    - `apps/extension/src/popup/components/modules/send/fee-send-selection.ts:14-15` (`asObject`, inline)
  - Includes arrays (`typeof === "object" && !== null`):
    - `apps/extension/src/popup/windows/capabilities/details-table.ts:88`
    - `apps/extension/src/popup/windows/capabilities/permission-rows.ts:253`
    - `packages/wallet-bridge/src/dispatcher.ts:767` (`isObj`, in the same file as the array-excluding copy at :307)
    - `apps/extension/src/wallet/services/dapp-session/spec.ts:69` (`tolerantRecord`) and `apps/extension/src/wallet/services/transaction/spec.ts:168` (`tolerantObject`), which are the same predicate as zod `custom` callbacks
  - Near variant: `packages/legal/src/status.ts:66` (`isPlainObject`, prototype check; deliberately stricter, leave).
  - `wallet-core/utils/index.ts` exports no such guard.
- **Why it harms future change:** `dispatcher.ts` has both meanings in one file, so a later edit can silently pick the wrong one at a wire-validation site; the capability-details UI accepts arrays where the bridge rejects them.
- **Smallest safe refactoring:** Extract Function into `@nulo/wallet-core/utils` (`guards.ts`): `isRecord` (non-null, non-array object) and `isObjectLike` (non-null object). Replace the copies; keep `legal`'s stricter one. Wallet-bridge, extension and legal can all import wallet-core, so the helper sits at the bottom of the layer chain.
- **What disappears:** 10 local definitions.
- **Instances:** the list above.

## q13-cross-primitives-C-6: bytes to hex and hex to bytes reimplemented around `getRandomHex`/`bytesToHex`

- **Smell:** Duplicate Code (semantic: two functions are literally `getRandomHex(32)`).
- **Maintenance impact:** local, blast radius 4 files. Low-frequency, but the two mint functions produce security-relevant identifiers ("128 bits of provenance").
- **Evidence:**
  - `apps/extension/src/wallet/services/activity-protocol/coordinator.ts:49-53` (`mintNonce`) and `apps/extension/src/wallet/services/profile/spec.ts:105-108` (`mintPxeGeneration`) both draw 16 random bytes and hex-encode them by hand. `getRandomHex(32)` at `packages/wallet-core/src/utils/random.ts:9` does precisely that. The extension already imports `getRandomHex` from `@/wallet/utils` elsewhere (`id-allocators.ts:14`).
  - `packages/aztec-runtime/src/account/account-export.ts:80` uses `Buffer.from(sha256(...)).toString("hex")` instead of `bytesToHex`.
  - `apps/extension/src/wallet/utils/passkey-ceremony.ts:41,139` use `Buffer.from(…,"hex")`; wallet-core has no `fromHex`.
- **Why it harms future change:** the secure-random contract lives in `random.ts` (ceil, slice, no-Buffer); the hand copies skip it and keep the polyfill alive.
- **Smallest safe refactoring:** Replace with Shared Helper. `mintNonce()` and `mintPxeGeneration()` become `getRandomHex(32)`. `bytesToHex` at `account-export.ts`. Add `hexToBytes` to `encoding.ts` for the passkey site (and its mirror `bytesToHex` at :139).
- **What disappears:** 2 functions, 2 Buffer idioms.
- **Instances:** as listed.

## q13-cross-primitives-C-7: The `0x` + 64-hex field predicate is declared 6 times with different case rules

- **Smell:** Duplicate Code with drift.
- **Maintenance impact:** local, 6 files in 2 packages.
- **Evidence:** all six check the same thing (a 32-byte field as `0x` plus 64 hex digits), but differ in case handling:
  - `apps/extension/src/composables/usePinnedTokens.ts:13` (`CONTRACT_RE`): lowercase only
  - `apps/extension/src/popup/pages/send-submit.ts:11` (`TX_HASH`): either case (`/i`)
  - `apps/extension/src/utils/transfer-intent.ts:77` (`HEX_ADDRESS_RE`): either case
  - `apps/extension/src/utils/string.ts:28-31` (`isValidHex`): a runtime `RegExp`, either case, used by about 12 popup call sites
  - `packages/wallet-bridge/src/field-address.ts:7` (`FIELD_ADDRESS`): either case, plus a modulus check
  - `apps/extension/src/wallet/services/execution/call-decoder.ts:33` (`FIELD_RE`): 1 to 64 digits (a legitimately different shape)
- **Why it harms future change:** a pinned-token address the contact form accepts (uppercase) is silently dropped by `usePinnedTokens`; tightening or loosening a format means editing 5 files.
- **Smallest safe refactoring:** Extract Function (`isHexField(value, {case?})`) into `@nulo/wallet-core/utils`; `isValidHex` becomes a one-line wrapper or alias. Keep `field-address.ts` as the layer that adds the modulus check, built on the shared predicate.
- **What disappears:** 4 regex declarations; one `new RegExp` per call.
- **Instances:** as listed.

## Non-findings considered

- **Stable stringify (H):** only one real implementation (`dapp-session/integrity.ts:34`). `account-export.ts` canonicalizes with a frozen, pinned `[key,value]` array, not a recursive sort, so it is not duplicate logic. `wallet-core/utils/serialization.ts` is an Aztec-compat replacer, a different job.
- **Ad-hoc `extends Error` classes vs `WalletError` (F):** about 20 classes exist outside `extension-messaging/errors.ts`, each with the `this.name = …` boilerplate. They are in-process typed signals that never need wire identity, and `WalletError` is explicitly the RPC-boundary hierarchy. `WalletError`'s own `new.target` handling is deliberately done once. Not a finding. See the incidental note below.
- **Locks and queues (G):** `Lock`/`KeyedLock`/`Queue`/`rw-guard` are single, well-used primitives (15+ consumers). `ExecutionMutex` (abort and capacity semantics), `BalanceJobQueue` and `DiscoveryQueue` are domain queues with extra policy, not copies. `createRunFence` is shared by 5 consumers. `coalesce.ts` is a debounce with a max wait, not single-flight.
- **Single-flight maps:** `gas-balance-reader`, `balances.store legFlights`, `profile-deletion/coordinator`, `onboarding-tab`, `seeder.run`, `price`, `useProfileBootstrap`. The simple `if (inflight) return inflight; … finally delete` core repeats, but each adds an epoch or generation check with different join rules (`gas-balance-reader.ts:88-110` refuses a later-epoch joiner). A shared helper would need an epoch option; the saving is about 3-4 lines per site and risk is high, so not flagged. Revisit if a fourth epoch-less copy appears.
- **`sleep` (D):** `realSleep` at `importPreflight.ts:31` is one redundant copy (covered in C-3). `e2e/migration-fixture.ts:41` is fixture code. The backoff loops (`balances.store.ts:618`, `seeder.ts:623`) have different policies.
- **Storage wrappers (I):** the facade, wallet-core storage, and `mac-storage.ts` are layered by design per CLAUDE.md. The `src/e2e/chrome-storage-*.ts` gates are test-harness and out of scope.
- **Logger and redaction (J):** one `REDACTED_KEYS` and one `URL_KEYS` in `wallet/logger/utils.ts`, one `scrubUrls`; the static guard imports the same sets. No repeated lists found.
- **Zod primitives (K):** no repeated hex/address/bigint schema constants. The only repeated pieces are the two `tolerant*` guards (folded into C-5) and the regex predicates (C-7).
- **Error-message helpers:** `getErrorMessage` and `errorMessageFromUnknown` in wallet-core are documented as deliberately different. `truncateErrorMessage` in `account-state/normalize.ts` is a different job.
- **`padStart(2,"0")` (L):** `useSecretCountdown.ts:23` formats mm:ss, `PrestoStatusCard.vue:17` and `LegalConsent.vue:46` format ordinals. Three one-liners with different meanings; not worth a helper.
- **`Buffer` use in `wallet-core/utils/serialization.ts:32-34`:** required for Buffer detection, documented in the file header.
- **Design tokens mirror (M):** `apps/extension/src/design/tokens.ts` is a re-export, as documented. Only the fonts are a real duplicate (C-4).

## Incidental bugs noticed (for the bugs run)

- `apps/extension/src/components/JsonViewer/LogsViewer.vue:190-197`: `fetchLogs` races the fetch against a 500 ms timer that is never cleared, and on timeout rejects with a bare string, `"Logs fetch timeout"`. The timer keeps running after a fast success (harmless), but with a slow service the function silently returns the `catch` fallback while the real request is still in flight and its later result is dropped (the `await fetch` after the race is unreachable on timeout).
- `apps/extension/src/wallet/services/dapp-session/integrity.ts:58-62`: `verifyDappSession` wraps `Buffer.from(mac, "base64")` in a try/catch, but `Buffer.from` never throws on malformed base64, so the catch is dead. A malformed MAC decodes to garbage bytes, and only the length-zero check (`:63`) and the `subtle.verify` fail path reject it. This is fail-closed, but the error branch is unreachable.
- `apps/extension/src/wallet/services/account/spec.ts:68` and `transaction/spec.ts:223`: `ImportedAccountUnusableError` and `TxConfirmationTimeoutError` are declared in client-visible spec files and documented as surfaced to the UI (`account/spec.ts:63-66`). Both extend plain `Error`, so after the RPC boundary flattens non-`WalletError` throws to `new Error(message)` (`extension-messaging/src/errors.ts` header), a client `instanceof` check can never match. No popup code catches either type. If the UI is meant to offer "delete and re-import" for an unusable imported account, the error identity is lost. Counter-example: throw `ImportedAccountUnusableError` from `AccountService` (`account/service.ts:371`); the popup receives a plain `Error`.

## Cross-rebuttal (claude on codex)

**1. Codex findings**
- **X-1 (eight promise-deadline copies): agree.** Same set as my C-3. The cleanup divergence it cites (`balances.store.ts:124-138` clears the timer in both handlers, `LogsViewer.vue:189-200` never keeps the handle) is real. The `opfs-store.ts` quarantine caveat is a good boundary. I stand by my count of 8 and see no meaningful difference from Codex's list.
- **X-2 (sixteen byte-encoder bypasses): partially agree.** It covers my C-1 and C-6, and the `getRandomHex(32)` substitution is correct: `coordinator.ts:49-53` `mintNonce` and `profile/spec.ts:105-108` `mintPxeGeneration` are the same 16-byte to 32-hex recipe. The "sixteen sites" count is padded, because it counts adjacent fields separately and leaves out the decode sites. Its deliberate exclusion of the `Buffer.from(x,"base64")` decoders matches my caveat, but it leaves out the `integrity.ts:59`, `password-secret-box.ts:219,226,234` and `account/service.ts:439` bypasses that I listed. It also doesn't mention the `as Uint8Array<ArrayBuffer>` casts that disappear, or the dead try/catch at `integrity.ts:58-62`. Codex's version is the narrower, safer subset.
- **X-3 (profile-activation waiters): agree on the duplication, disagree on priority.** `unlockWait.ts:33-61` and `waitForProfileActive.ts:30-47` do repeat the predicate, timer and `stop()` lifecycle. But each has 1 commit, the typed-failure join is the point of `awaitProfileActivation` (its own doc rules out composing the two), and the result is about 12 shared lines. I rate it local and low: a fair low-priority find that I missed, not worth an extract.
- **Non-finding M (fonts): disagree.** Codex waves the fonts away as generated or vendored. They are hand-committed binaries with zero references, byte-identical to `packages/design/src/fonts`, so my C-4 (dead duplicate, `git rm`) stands.
- **Incidental `console-sniffer.ts:12-18` (warn flushed as info): agree.** The buffer stores only `args`, so the original method is lost (lines 12-18 show `overridden(...data)` with no method). This is a real bug for the bugs run, and I missed it.

**2. What Codex missed that I still stand by**
- C-2: 7 hand-rolled promise-chain serializers next to `Lock`. Codex only reviewed `Lock` and `KeyedLock` and found nothing duplicated.
- C-4: the dead font copies (above).
- C-5: `isRecord` re-declared 11 times with two drifted meanings. Codex lists only 6 of them and calls them "tiny language-level predicates", which overlooks that the meanings drift (array-rejecting vs permissive).
- C-7: the `0x` + 64-hex predicate declared 6 times with different case rules. Codex folds this into `isValidHex` and `canonicalSlotHex` "different jobs" without comparing the case handling.
- C-1 details that Codex dropped: the `btoa(String.fromCharCode(...key))` spread at `pxe/client.ts:208`, and the dead catch mentioned above.

**3. What both missed**
- Nothing new that I can back with file:line evidence in this light pass. After reading both reports I would rather not invent filler.
