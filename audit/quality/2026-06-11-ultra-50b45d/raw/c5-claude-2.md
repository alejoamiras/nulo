# C5 — PXE + messaging transport layer — Claude instance 2

Scope audited: `packages/aztec-runtime/src/**`, `packages/extension-messaging/src/**`, `packages/extension/src/wallet/services/pxe/client.ts`, `packages/extension/src/wallet/utils/offscreen.ts`, `packages/extension/src/wallet/base/**`. All claims verified directly against source; grep evidence reproduced where load-bearing. Git history is shallow (53 squash commits repo-wide, package history starts 2026-05-19), so change-frequency claims are based on the few commits available plus structural reasoning.

## F1: Five parallel enumerations of the ~19-method PXE surface

1. **Title:** Adding or changing one PXE method requires editing up to five hand-maintained copies of the same method list.
2. **Smell name:** Shotgun Surgery (Fowler). Secondary: Duplicate Code in the per-method doc comments.
3. **Impact bucket:** architectural. Blast radius: 5 files in `aztec-runtime` + the extension re-export shim (6th surface) + the extension call sites. Change frequency: empirically confirmed — commit `1dcd21f` (adds `getBlockTimestamp`) touched `spec.ts`, `service.ts`, and `client.ts` in one commit; the quartet is the package's hotspot.
4. **Evidence:** The same ~19-method surface is written out long-hand in:
   - `packages/aztec-runtime/src/pxe/spec.ts:24-81` (`Methods` wire contract, 19 methods)
   - `packages/aztec-runtime/src/pxe/ipxe.ts:27-50` (`IPXE`, 17 of the 19 — drops `network` param, Promise-wraps returns)
   - `packages/aztec-runtime/src/pxe/service.ts:166-427` (`PxeService`, 19 implementations)
   - `packages/aztec-runtime/src/pxe/client.ts:76-201` (`PxeServiceClientBase`, 19 implementations, each `request(...)` + zod rehydrate)
   - `packages/aztec-runtime/src/pxe/proxy.ts:32-102` (`PXEProxy`, 17 pure one-line delegations that only insert `this.network`)
   Doc comments are also copy-pasted per method: `getSyncedBlockHeader` carries near-identical prose at `spec.ts:62-64`, `ipxe.ts:45-49`, `service.ts:369-372`, `client.ts:181-182`; `getBlockTimestamp` at `spec.ts:65-74`, `service.ts:377-382`, `client.ts:188-190`; `clearChainState` at `spec.ts:75-80`, `service.ts:400-407`, `client.ts:197-198`.
5. **Why it harms future change:** every new PXE capability is a 4-5 file edit where three of the edits are mechanical re-typings of the first. The mechanical surfaces (`IPXE`, `PXEProxy`) can silently drift from `Methods` (e.g. `IPXE` already lacks `getNoteSchemas`/`getBlockTimestamp`/`clearChainState` — deliberate today, but nothing distinguishes "deliberately omitted" from "forgot to add"). Copy-pasted doc comments rot independently — `service.ts`'s `getSyncedBlockHeader` doc already names `simulateViaNode` while `client.ts`'s says "tx construction".
6. **Smallest safe refactoring:** Extract Interface via mapped type — derive `IPXE` mechanically from `Methods` (`type IPXE = { [K in PinnedKeys]: (...args: DropFirst<Parameters<Methods[K]>>) => Promise<ReturnType<Methods[K]>> }` with an explicit pinned-key union), and replace `PXEProxy`'s 17 hand-written bodies with a single generic pin-first-argument helper. `service.ts`/`client.ts` stay (they have real per-method behavior: zod schemas differ); keep the per-method doc in `spec.ts` only.
7. **What disappears:** two of five surfaces (~150 LOC of mechanical delegation + interface), the possibility of `IPXE`/`PXEProxy` drifting from `Methods`, and three copies of each method's doc prose.
8. **Instances:** `packages/aztec-runtime/src/pxe/spec.ts:24-81`; `packages/aztec-runtime/src/pxe/ipxe.ts:27-50`; `packages/aztec-runtime/src/pxe/service.ts:166-427`; `packages/aztec-runtime/src/pxe/client.ts:76-201`; `packages/aztec-runtime/src/pxe/proxy.ts:26-103`; `packages/extension/src/wallet/services/pxe/client.ts:24` (shim re-export, 6th surface).

## F2: Background vs offscreen transport stacks — duplicated base classes with divergent error contracts

1. **Title:** Two full parallel Service/ServiceClient stacks duplicate correlation, fallback, init-wait, and logging — and reject with incompatible error types.
2. **Smell name:** Duplicate Code (Fowler) + Alternative Classes with Different Interfaces (Fowler) — two sibling `ServiceClient` classes do the same job (request correlation over a Chrome messaging primitive) but expose different reject contracts (typed `WalletError` vs plain strings).
3. **Impact bucket:** architectural. Blast radius: 4 base-class files (973 LOC) + every consumer that handles errors from both transports (42 background subclasses, PXE offscreen client). Change frequency: low so far (1 commit each since import), but this is the wallet's only transport layer — any protocol change (new envelope field, new terminal state) lands here.
4. **Evidence:**
   - `ensureInitialized` is **verbatim identical** at `packages/extension-messaging/src/background/service.ts:187-199` and `packages/extension-messaging/src/offscreen/service.ts:158-170` (same 30 s/500 ms poll loop, same error string).
   - The `logDebug/logInfo/logWarn/logError` quadruplet (~16 LOC) is copy-pasted four times: `background/client.ts:233-247`, `background/service.ts:201-215`, `offscreen/client.ts:282-296`, `offscreen/service.ts:172-186`.
   - The A6 `jsonStringify` fallback exists twice in different shapes: extracted method `trySendJsonFallback` (`background/service.ts:139-185`) vs inline catch block (`offscreen/service.ts:99-139`) — same retry-with-`resultIsJson` logic, same warn copy.
   - The client-side `resultIsJson` re-parse + its explanatory comment are duplicated: `background/client.ts:116-123` vs `offscreen/client.ts:115-121`.
   - **Divergent error surface:** the background client rejects with reconstructed `WalletError` subclasses or `new Error(...)` (`background/client.ts:108-114`), while the offscreen client rejects with **plain strings** (`offscreen/client.ts:72` `reject("Client disconnected")`, `:206` `reject(\`Offscreen request timed out...\`)`, `:237` `reject(\`Offscreen send failed...\`)`, `:111` `reject(error)` where `error` is a string). The offscreen service never emits `errorPayload` (`offscreen/service.ts:84-95`) even though the shared `ResponseContent` type declares it (`messages.ts:46-48`) — so `WalletError` class identity survives popup↔SW but is destroyed SW↔offscreen.
5. **Why it harms future change:** any cross-cutting transport change (new terminal status, envelope versioning, error taxonomy) must be implemented twice in structurally different code, and tested twice. A consumer catch block written against the background transport (`err instanceof RpcTimeoutError`, `err.message`) silently misbehaves against the offscreen transport, where `err` is a string with no `.message`. Extending structured errors to the PXE boundary (the most failure-prone boundary in the wallet) requires first reconciling the two stacks.
6. **Smallest safe refactoring:** Extract Superclass / Pull Up Method — a transport-agnostic base owning the correlation map, timeout bookkeeping, `resultIsJson` parse, log quadruplet, `ensureInitialized`, and the A6 fallback, parameterized by a small port adapter (`send`, `addListener`, `removeListener`). Align the offscreen reject type to `WalletError` subclasses as part of the pull-up (the error classes already exist: `RpcTimeoutError`, `RpcDisconnectedError`).
7. **What disappears:** ~150-200 LOC of duplication (init-wait, log helpers, fallback, parse), the inline-vs-extracted fallback divergence, and the two-error-vocabularies problem for every future consumer.
8. **Instances:** `packages/extension-messaging/src/background/service.ts:139-185,187-199,201-215`; `packages/extension-messaging/src/offscreen/service.ts:99-139,158-170,172-186`; `packages/extension-messaging/src/background/client.ts:108-123,233-247`; `packages/extension-messaging/src/offscreen/client.ts:61-79,109-124,176-245,282-296`; `packages/extension-messaging/src/messages.ts:46-48`.

## F3: Dead subpaths `/lazy-listener` and `/subscribe-with-snapshot` — and the helper one of them exists to replace is re-implemented in a test

1. **Title:** Two fully-tested public subpaths have zero production consumers; the snapshot-subscription pattern they codify is hand-rolled elsewhere instead.
2. **Smell name:** Dead Code (Fowler) + Duplicate Code. Also Speculative Generality — built for consumers that never arrived.
3. **Impact bucket:** structural (package API surface). Blast radius: 2 modules (217 LOC src + 420 LOC tests) + 2 `package.json` export entries + 1 divergent re-implementation. Change frequency: zero since initial import — dormant.
4. **Evidence:**
   - `grep -rn "makeLazyListener\|LazyListener\|lazy-listener"` across all packages: **zero hits** outside `packages/extension-messaging/src/lazy-listener.{ts,test.ts}`. Exported as a subpath at `packages/extension-messaging/package.json` (`"./lazy-listener"`). Not covered by the extension's auto-import config (that covers `src/utils|composables|stores|components` inside the extension package only, and this is a workspace-package subpath, not a registration target) — confirmed dead.
   - `grep -rn "subscribeWithSnapshot\|subscribe-with-snapshot"`: zero production imports. The only executable hit is `packages/extension/src/wallet/services/profile/client.test.ts:38`, which **defines its own local `subscribeWithSnapshot` function** re-implementing the same handler-first/snapshot-second discipline. Two more files reference the pattern by name in comments only: `packages/extension/src/wallet/services/operation-journal/client.ts:90` ("Same pattern as `subscribeWithSnapshot`") and `packages/extension/src/wallet/services/operation-journal/spec.ts:17` — i.e. production code re-implements the pattern inline rather than importing the helper.
   - Inversely, these two dead modules are the package's **best-tested** code: `lazy-listener.test.ts` 203 LOC, `subscribe-with-snapshot.test.ts` 217 LOC (see F4).
5. **Why it harms future change:** every transport-layer refactor (F2) must keep two unused modules compiling and their 420 test LOC green. Worse, the race the helper was built to close (snapshot-vs-event ordering, documented at `subscribe-with-snapshot.ts:1-28`) now has three independent encodings — the unused helper, the journal client's inline version, and the profile test's local copy — which can diverge in exactly the subtle ordering details the helper was created to pin down.
6. **Smallest safe refactoring:** Remove Dead Code for `/lazy-listener` (delete module + test + export entry). For `/subscribe-with-snapshot`: either adopt it at the two call sites that re-implement the pattern (Substitute Algorithm at `operation-journal/client.ts`, replace the local test helper) — the better outcome since the race-closing logic gets one home — or delete it too and accept the inline versions as canonical.
7. **What disappears:** 346 LOC of unused production code, 420 LOC of tests for unused code, two public API entries, and (if adopted instead) the triple-encoding of the snapshot-race fix.
8. **Instances:** `packages/extension-messaging/src/lazy-listener.ts:1-129`; `packages/extension-messaging/src/lazy-listener.test.ts`; `packages/extension-messaging/src/subscribe-with-snapshot.ts:1-88`; `packages/extension-messaging/src/subscribe-with-snapshot.test.ts`; `packages/extension-messaging/package.json:14-15`; `packages/extension/src/wallet/services/profile/client.test.ts:38-56`; `packages/extension/src/wallet/services/operation-journal/client.ts:90`.

## F4: Test-location inversion — both packages' production code is tested only from inside the extension

1. **Title:** 1,551 LOC of tests for `extension-messaging` and `aztec-runtime` modules live in the extension package; the packages' own suites cover almost nothing they ship.
2. **Smell name:** Test brittleness / misplaced tests (community canon; a form of Inappropriate Intimacy — the packages' correctness depends on a sibling package's test harness and suite).
3. **Impact bucket:** structural. Blast radius: 7 test files across 2 packages; every CI/validation path that assumes per-package test isolation. Change frequency: tests change whenever the base classes change.
4. **Evidence:**
   - `packages/extension/src/wallet/base/` contains **only** tests + a re-export shim: `background/client.test.ts` (449 LOC), `offscreen/client.test.ts` (387), `errors.test.ts` (133), `zod-helpers.test.ts` (86) — all importing from `@nulo/extension-messaging/*` (verified import blocks).
   - `packages/extension/src/wallet/services/pxe/artifact-registry.test.ts` (297) and `chain-runtime.test.ts` (199) import from `@nulo/aztec-runtime/pxe` — tests for aztec-runtime classes (`ArtifactRegistry`, `ChainRuntimeRegistry`) living in the extension.
   - Meanwhile `extension-messaging`'s in-package tests cover only the two zero-consumer modules (F3) plus a 46-LOC `errors.test.ts`; its `test` script is `vitest run --passWithNoTests`. The 973 LOC of base classes carry **zero in-package tests**. The package even ships its own harness (`src/testing/setup.ts`, fake-browser) whose doc comment concedes "most extension tests already have their own setup wire".
   - `errors.ts` is tested from **two places simultaneously** with overlapping round-trip cases: `packages/extension-messaging/src/errors.test.ts` (JobCancelled/CapabilityNotGranted round-trips) and `packages/extension/src/wallet/base/errors.test.ts` (WalletError/InvalidPassword/RpcTimeout round-trips).
5. **Why it harms future change:** editing `background/client.ts` and running `bun run test` inside `extension-messaging` passes green while the real contract tests sit in another package — the feedback loop for the package is broken, and a future package extraction/publish (or per-package CI path filter) silently loses its coverage. The split `errors` tests mean a new error class can be "fully tested" in one location while the other location's round-trip table goes stale.
6. **Smallest safe refactoring:** Move Function (move test files next to their subjects). The blockers are already solved: the package ships `@webext-core/fake-browser` + `testing/setup.ts`; the extension-located tests use the extension's `vitest.setup.ts` chrome stubs, which the package harness replicates. Merge the two `errors` test files in the process.
7. **What disappears:** the cross-package test dependency, the false-green per-package test runs, the duplicated errors-test split, and (combined with F3) the inversion where the package's only tested modules are its dead ones.
8. **Instances:** `packages/extension/src/wallet/base/background/client.test.ts`; `packages/extension/src/wallet/base/offscreen/client.test.ts`; `packages/extension/src/wallet/base/errors.test.ts`; `packages/extension/src/wallet/base/zod-helpers.test.ts`; `packages/extension/src/wallet/services/pxe/artifact-registry.test.ts`; `packages/extension/src/wallet/services/pxe/chain-runtime.test.ts`; `packages/extension-messaging/src/errors.test.ts`; `packages/extension-messaging/src/testing/setup.ts`.

## F5: Intra-file duplication inside `PxeService` — guard wrappers, deleteDatabase promisification ×4, SYNC-DEBUG preflight ×2

1. **Title:** `PxeService` (507 LOC, package size outlier) hand-rolls the same three mechanics repeatedly.
2. **Smell name:** Duplicate Code (Fowler); the file as a whole trends toward Large Class (RPC dispatch + concurrency + IndexedDB lifecycle + debug instrumentation in one class).
3. **Impact bucket:** local-to-structural. Blast radius: 1 file, but it is the offscreen runtime's core. Change frequency: 2 of 2 possible commits touched it — it moves with every PXE feature.
4. **Evidence:**
   - `withPxeRead` (`service.ts:429-447`) vs `withPxeWrite` (`service.ts:449-468`): identical try/log/guard/getOrInit/fn/catch shape; differ only in `chainGuard.read` vs `chainGuard.write` and log labels. Even the log style diverges slightly (read logs "starting", write logs "waiting for lock" + "lock acquired") for no behavioral reason.
   - Promise-wrapped `indexedDB.deleteDatabase` with onsuccess/onerror/onblocked appears three times: `service.ts:133-141` (orphan PXE DBs), `service.ts:148-157` (keyval-store), `service.ts:416-424` (clearChainState) — plus a **fourth, divergent** fire-and-forget at `service.ts:487-491` (`const _ = indexedDB.deleteDatabase(db.name)`) that silently drops the blocked/error handling the other three have.
   - `[SYNC-DEBUG]` preflight block (read header + node tip, log, swallow) duplicated verbatim between `proveTx` (`service.ts:270-277`) and `simulateTx` (`service.ts:290-297`).
5. **Why it harms future change:** a fix to lock instrumentation, deleteDatabase blocked-handling, or the sync-state probe must be found and applied 2-4 times; the existing fourth deleteDatabase copy proves the drift already happened (no blocked-warn there). The read/write wrapper pair is also where any future guard-policy change (e.g. per-op timeout, metrics) lands — twice.
6. **Smallest safe refactoring:** Extract Method ×3: `withPxe(mode: "read" | "write", label, network, fn)` collapsing the wrapper pair; `deleteIndexedDb(name, logger)` used at all four sites; `logSyncState(label, pxe, node)` for the SYNC-DEBUG block.
7. **What disappears:** ~60 LOC of duplication, the read/write log-style divergence, and the inconsistent deleteDatabase error handling.
8. **Instances:** `packages/aztec-runtime/src/pxe/service.ts:133-141,148-157,270-277,290-297,416-424,429-447,449-468,487-491`.

## F6: Lazy-init-with-retry-reset idiom hand-rolled three times, one copy synced by comment

1. **Title:** Three promise-cache-with-reset-on-failure implementations, one of which declares its duplication in a comment.
2. **Smell name:** Duplicate Code (Fowler); the note-schemas copy is "sync-by-comment" (comment-coupled duplication — a Comments-as-deodorant variant: the comment substitutes for extracting the shared mechanism).
3. **Impact bucket:** structural. Blast radius: 3 files in `aztec-runtime`. Change frequency: low individually, but the idiom is the package's standard answer to "expensive init" and will be copied again.
4. **Evidence:**
   - `ArtifactRegistry.ensureKnown` (`artifact-registry.ts:99-112`): `initPromise` field, `.catch(() => { this.initPromise = null; throw err })`.
   - `loadProductionNoteSchemas` (`note-schemas.ts:64-94`): module-level `cachedSchemas` promise with `cachedSchemas = null` on failure — comment at `:90` literally says "(matches ArtifactRegistry pattern)".
   - `ChainRuntimeRegistry.getOrInit` (`chain-runtime.ts:214-229`): `initPromises` map entries with `.catch((err) => { this.initPromises.delete(k); throw err })` — same reset-on-failure semantics, keyed variant.
5. **Why it harms future change:** the failure-retry semantics (does a second caller during a failed init retry or get the stale rejection? is the reset race-safe?) are encoded three times and verified independently; a bug found in one (e.g. reset racing a concurrent awaiter) must be re-discovered in the others. The "matches X pattern" comment is the maintenance instruction — it asks future editors to manually keep copies in sync.
6. **Smallest safe refactoring:** Extract Function — a `lazyInit<T>(loader: () => Promise<T>)` (and a keyed `lazyInitMap<K, T>`) in `@nulo/wallet-core/utils` (layer-legal: aztec-runtime already depends on wallet-core). Substitute at the three sites.
7. **What disappears:** three divergence-prone encodings of retry-reset semantics and the comment-based sync contract.
8. **Instances:** `packages/aztec-runtime/src/pxe/artifact-registry.ts:99-112`; `packages/aztec-runtime/src/pxe/note-schemas.ts:64-94`; `packages/aztec-runtime/src/pxe/chain-runtime.ts:214-229`.

## F7: Composite `${profileId}:${chainId}` key scheme duplicated across `PxeService` and `ChainRuntimeRegistry`

1. **Title:** The chain-key format and its prefix-scan deletion idiom are implemented independently in two classes that must stay in lockstep.
2. **Smell name:** Primitive Obsession (Fowler — a domain identity encoded as an ad-hoc string) + Duplicate Code; the lockstep requirement is a Shotgun Surgery seed.
3. **Impact bucket:** structural. Blast radius: 2 files, 4 sites. Change frequency: low, but both files sit on the profile-delete / chain-purge path that recent audit work (per-profile barriers, purge cascade) keeps touching.
4. **Evidence:**
   - Key construction: `PxeService.chainKey` (`service.ts:102-104`) and `ChainRuntimeRegistry.key` (`chain-runtime.ts:188-190`) — both `` `${profileId}:${chainId}` ``.
   - Prefix-scan deletion: `service.ts:478-481` (`const prefix = \`${profile.id}:\`` + startsWith loop over `chainGuards`) and `chain-runtime.ts:265-275` (same prefix + startsWith loops over `runtimes` and `initPromises`).
   - Both copies share an unenforced invariant: `profileId` must never contain `":"`, or prefix-scan collides across profiles. Nothing pins this in either file.
5. **Why it harms future change:** changing the key scheme (or adding a third per-(profile, chain) map — the pattern is already at 3 maps across the two classes) means finding every `startsWith(prefix)` loop by memory. A profile-id format change interacts with the hidden `":"` invariant in two places that don't reference each other.
6. **Smallest safe refactoring:** Extract Class (minimal): a `chainKey(profileId, chainId)` + `profilePrefix(profileId)` pair (or a tiny `ChainKey` value object) in one module imported by both; optionally assert the no-colon invariant once there.
7. **What disappears:** the duplicated format string, the duplicated scan idiom, and the doubly-implicit colon invariant.
8. **Instances:** `packages/aztec-runtime/src/pxe/service.ts:102-104,478-481`; `packages/aztec-runtime/src/pxe/chain-runtime.ts:188-190,265-275`.

## F8: Dead exports and zero-caller methods on the aztec-runtime public surface, one with a stale contradicting doc

1. **Title:** The `pxe/index.ts` barrel exports several symbols with no callers anywhere; `ArtifactRegistry.clear()`'s doc claims a call site that deliberately no longer exists.
2. **Smell name:** Dead Code (Fowler); the `clear()` doc is a lying comment (Comments-as-deodorant analog — the comment asserts behavior the code deliberately abandoned).
3. **Impact bucket:** local. Blast radius: 4 files. Change frequency: dormant.
4. **Evidence (grep-verified, no DI/auto-import coverage — these are workspace-package barrel exports, not extension auto-import targets):**
   - `_resetNoteSchemasForTests` (`note-schemas.ts:97-99`, exported at `pxe/index.ts:7`): **zero call sites anywhere, including tests** — `service.test.ts:23` mocks the module instead.
   - `ChainRuntimeRegistry.peek()` (`chain-runtime.ts:195-197`): callers are only the extension-located test (`packages/extension/src/wallet/services/pxe/chain-runtime.test.ts:104-185`); zero production refs.
   - `ChainRuntimeRegistry.clear()` (`chain-runtime.ts:235-240`): zero production callers (test-only, same file).
   - `ArtifactRegistry.clear()` (`artifact-registry.ts:130-134`): zero production callers; its doc says "Called during onProfileDeleted" while `service.ts:483-486` documents the **deliberate decision NOT to call it** ("Skipping the clear here was a deliberate Week 3 change").
   - `DefaultArtifactClassIdVerifier` / `verifyArtifactClassId` / `ClassIdVerifyLogger` (exported at `pxe/index.ts:13-18`): used only inside `artifact-registry.ts`; the extension tests build their own fake verifiers from the type.
   - `NoteDaoSchema` / `PackedPrivateEventSchema` / `NotesFilterSchema` (`pxe/index.ts:24`): zero refs outside `packages/aztec-runtime/src/pxe`.
   - `OFFSCREEN_KEEPALIVE` (`packages/extension/src/wallet/utils/offscreen.ts:4`): zero consumers — and it duplicates the unexported magic string `KEEPALIVE_MESSAGE = "OFFSCREEN_KEEPALIVE"` at `packages/extension-messaging/src/offscreen/service.ts:13`, so the one place the literal matters doesn't use the exported constant.
5. **Why it harms future change:** every barrel export is implicit API a refactor must preserve; the dead ones make the real consumed surface (~10 symbols per the map) look twice as large. The `clear()` doc actively misleads: a future contributor "restoring" the documented call would reintroduce the cross-profile bundle-reload regression that `service.ts:483-486` explains was deliberately removed.
6. **Smallest safe refactoring:** Remove Dead Code (delete `_resetNoteSchemasForTests`, drop the unused barrel entries, inline-or-delete `peek`/`clear` after moving their tests per F4) + fix the `clear()` doc to match the live decision. For `OFFSCREEN_KEEPALIVE`: export the constant from `extension-messaging/offscreen` (the owner of the sender) and delete the extension copy, or just delete the dead extension constant.
7. **What disappears:** ~8 phantom API entries, one actively-misleading doc, and one magic-string duplication across a package boundary.
8. **Instances:** `packages/aztec-runtime/src/pxe/note-schemas.ts:97-99`; `packages/aztec-runtime/src/pxe/index.ts:7,13-18,24`; `packages/aztec-runtime/src/pxe/chain-runtime.ts:195-197,235-240`; `packages/aztec-runtime/src/pxe/artifact-registry.ts:127-134`; `packages/extension/src/wallet/utils/offscreen.ts:4`; `packages/extension-messaging/src/offscreen/service.ts:13`.

## F9: `NetworkInfo` declared twice in the same package + an unused `_network` parameter kept "for future hooks"

1. **Title:** Two exported types named `NetworkInfo` with different shapes live two files apart; one exists only to feed a parameter the function ignores.
2. **Smell name:** Speculative Generality (Fowler — `artifact-registry.ts:15-16` admits the param is "kept on the API for future per-chain policy hooks even though the current resolver doesn't read it") + a name-collision flavor of Alternative Classes with Different Interfaces.
3. **Impact bucket:** local. Blast radius: 2 files + every `resolve()` caller threading a value that goes nowhere. Change frequency: dormant.
4. **Evidence:** `packages/aztec-runtime/src/pxe/chain-runtime.ts:42-46` exports `NetworkInfo { profileId; chainId; rpcUrl }` (the real one, re-exported by `pxe/index.ts:1` and consumed across service/client/spec/proxy). `packages/aztec-runtime/src/pxe/artifact-registry.ts:13-17` exports a second `NetworkInfo { chainId }` whose only use is the parameter `_network: NetworkInfo` at `artifact-registry.ts:162` — underscore-prefixed because `resolve()` never reads it. `PxeService.getContractArtifact` (`service.ts:198-200`) dutifully passes `network` into it.
5. **Why it harms future change:** same-name/different-shape types in one directory are an editor-auto-import trap (importing the wrong `NetworkInfo` type-checks in some positions because the registry's is a structural subset). The dead parameter taxes every caller and test fixture with an argument that does nothing, and the "future policy hooks" justification is exactly the speculation Fowler's smell names — if per-chain policy arrives, adding the parameter back is a mechanical change.
6. **Smallest safe refactoring:** Change Function Declaration (Remove Parameter) on `ArtifactRegistry.resolve`, then delete the registry-local `NetworkInfo`.
7. **What disappears:** the name collision, the dead parameter threading at every call site, and one speculative type.
8. **Instances:** `packages/aztec-runtime/src/pxe/artifact-registry.ts:13-17,162`; `packages/aztec-runtime/src/pxe/chain-runtime.ts:42-46`; `packages/aztec-runtime/src/pxe/service.ts:199` (caller threading the unused arg).

## Non-findings

- **`errors.ts` `walletErrorFromPayload` switch (errors.ts:220-246):** considered Switch Statements smell (every new error = subclass + switch case). Rejected: both edits are in the same file, the switch is the documented house convention, and `CapabilityNotGrantedError` needs bespoke reconstruction logic a code→ctor registry wouldn't simplify. Cost is two adjacent edits, not change amplification.
- **Upstream-mirror family (`fee-options.ts` completeFeeOptions/MIN_FEE_PADDING, `utils/fetch.ts`, `getSyncedBlockHeader` mirror claims, `skipKernels` pin):** considered Duplicate Code against `@aztec/*`. Rejected: deliberate, documented, version-pinned (4.2.0 exact) drift surfaces with regression pins (`fee-options.test.ts:101-104`); the upstream symbols are private/unexported, so there is nothing to import instead.
- **`MIN_FEE_PADDING` "own-test-only export":** rejected as dead code — the export exists precisely to enable the upstream-value regression pin.
- **`spec.ts`/`service.ts`/`client.ts` triple per service:** house convention, excluded by prompt; only its measurable duplication (F1) is flagged.
- **`offscreen/messages.ts` `MessageExt` intersection types:** considered Lazy Class; rejected — 15 LOC that genuinely encode the routed-vs-port envelope difference.
- **`PXEProxy` as Middle Man:** rejected as a standalone smell — it performs real adaptation (pins the network); the issue is its mechanical body duplication, covered in F1.
- **`zod-helpers.ts` validateParams/validateResult near-twins:** rejected — 2 small functions with different message prefixes; extracting a shared core would add indirection for ~6 LOC.
- **`utils.ts` wrapParams/unwrapParams index-record encoding:** considered Primitive Obsession; rejected — wire-format encoding with a single owner, both directions in one 21-LOC file.
- **`offscreen.ts` Firefox dual-path (~30 LOC dead-in-Chrome branch):** documented feature-flag-in-spirit with explicit caveats; conditional platform code, not a smell with a refactoring payoff today.
- **`chain-runtime.ts` holding three classes (278 LOC):** considered Large Class/file; rejected — the three classes are cohesive (runtime, its factory, its registry) and the file is under the repo's outlier sizes.
- **`testing/setup.ts` unexported "consumers can import" doc:** the doc contradicts the manifest (no `./testing/setup` export), but fixing it is folded into F4's move-tests work; not worth a separate finding.

## Out-of-scope observations

- `offscreen/service.ts:45-50` returns `false` from the message listener and fires `onMessage` without awaiting — any throw before the inner try lands as an unhandled rejection (correctness, not quality).
- `background/client.ts:89-92` `onDisconnect` calls `connect()` fire-and-forget — reconnect failure is unobservable to callers (correctness/resilience).
- `offscreen/client.ts` rejecting with non-`Error` strings defeats stack traces in crash reporting (borderline correctness; the quality side is in F2).
- `service.ts:487-491` fire-and-forget `deleteDatabase` inside `onProfileDeleted` may race the barrier release (data-lifecycle correctness; quality side covered in F5).
- `ensureOffscreenRunning` module-level mutable promise/resolver singletons (`offscreen.ts:6-9`) are a concurrency hazard if two callers interleave create/timeout windows (correctness).
