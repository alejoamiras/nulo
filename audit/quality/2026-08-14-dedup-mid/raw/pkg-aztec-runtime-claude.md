# Quality scan — pkg-aztec-runtime (Claude)

Scope audited: `packages/aztec-runtime/src/**/*.ts` (production files only; `*.test.ts` read as evidence, not finding-eligible). Declared focus: duplication (Duplicate Code, Shotgun Surgery, Divergent Change, Dead Code weighted highest).

## Finding 1 — Async memoize-with-retry idiom hand-rolled 6 times across 5 files

**Smell**: Duplicate Code (Dispensables). A recurring analog: each instance independently reinvents "lazy singleton/keyed promise cache that self-heals (resets to empty) on rejection so a transient failure doesn't poison the cache forever."

**Impact bucket**: structural. Blast radius: 5 files across `pxe/` (`artifact-catalog.ts`, `note-schemas.ts`, `public-events.ts` ×2, `artifact-registry.ts`, `service.ts`). Change frequency: recurring, not a one-off — the pattern was copied at least 3 separate times over ~3 months: the `harden-quality` pass (commit `578861be`, 2026-07-10) touched `artifact-catalog.ts`, `note-schemas.ts`, and `artifact-registry.ts` together (all three carry the pattern), then a later feature commit (`64d85291`, 2026-07-23) added `public-events.ts` with **two more** independent copies. `service.ts`'s copy (`stubClassRegistrations`) predates both. Every new "compute once, cache, retry-on-failure" need has so far been solved by hand-copying the idiom rather than reusing a helper — a live Shotgun Surgery risk: a bug fix to the retry/reset semantics (e.g. an edge case in "when is a rejected promise still in the map") would need to be independently re-applied at up to 6 sites.

**Evidence** (all 6 instances share the same shape: `let/const cache: Promise<T> | Map<K, Promise<T>>`, "if cached, return it", else populate + start async work, attach a `.catch()`/`try-catch` that clears the cache entry on failure so a retry is possible):

1. `packages/aztec-runtime/src/pxe/artifact-catalog.ts:88` (`const cache = new Map<CatalogKey, Promise<CatalogEntry>>()`) + `:93-106` (`getCatalogEntry`) — keyed variant, `.catch()` deletes the map entry.
2. `packages/aztec-runtime/src/pxe/note-schemas.ts:61` (`let cachedSchemas: Promise<NoteSchemaMap> | null = null`) + `:63-89` (`loadProductionNoteSchemas`) — singleton variant, `try/catch` sets `cachedSchemas = null`. The inline comment at `note-schemas.ts:85` literally reads "Allow retry after transient failure (**matches ArtifactRegistry pattern**)" — the author knew this was a re-implementation of an existing pattern and copied it by hand instead of extracting it.
3. `packages/aztec-runtime/src/pxe/public-events.ts:169` (`let transferTagPromise: Promise<Tag> | undefined`) + `:171-182` (`getTransferLogTag`) — singleton variant, `.catch()` resets to `undefined`.
4. `packages/aztec-runtime/src/pxe/public-events.ts:184` (`let bundledTokenClassIdPromise: Promise<Fr> | undefined`) + `:186-194` (`getBundledTokenClassId`) — same shape as #3, in the same file, back to back.
5. `packages/aztec-runtime/src/pxe/artifact-registry.ts:52` (`private initPromise: Promise<void> | null = null`) + `:99-112` (`ensureKnown`) — singleton variant on a class field, `.catch()` sets `this.initPromise = null`. This is the pattern #2's comment explicitly names as the original.
6. `packages/aztec-runtime/src/pxe/service.ts:508` (`private readonly stubClassRegistrations = new WeakMap<object, Promise<Fr>>()`) + `:510-523` (`ensureStubClassRegistered`) — keyed (by PXE instance) variant, `.catch()` deletes the WeakMap entry.

**Why it harms future change**: the retry-after-failure semantics are subtle (e.g. what happens if two callers race the miss, whether the memo should stay poisoned or reset per-key vs whole-cache) and currently exist as 6 independently-typed micro-implementations. A correctness fix discovered in one (e.g. a race where the `.catch()` fires after a new value was already set — see the guard `if (cache.get(key) === entry)` present only in `artifact-catalog.ts:103` but absent from the other 5 sites, which is itself a silent behavioral divergence between "identical-looking" instances) has no single place to land; each call site must be re-audited and re-patched by hand. Every future "load this heavy/derived value once, retry on transient failure" need (a near-certainty in this package, given artifacts/class-ids/log-tags are all Poseidon-heavy) is one more hand-copy away from a 7th divergent instance.

**Smallest safe refactoring**: Extract Function — introduce one small shared helper (e.g. `pxe/async-memo.ts`) exporting a singleton form `memoizeAsync<T>(loader: () => Promise<T>): () => Promise<T>` and a keyed form `memoizeAsyncBy<K, V>(loader: (key: K) => Promise<V>): (key: K) => Promise<V>` (backed by `Map`/`WeakMap` per call site's needs), both encoding the "cache, and clear-on-reject" contract exactly once, with the race guard from instance #1 applied uniformly. Each of the 6 call sites collapses from ~10-15 hand-written lines to a 1-3 line call plus its domain-specific loader body; the `_reset*ForTests` test hooks (`_resetArtifactCatalogForTests`, `_resetNoteSchemasForTests`, `_resetPublicEventMemosForTests`) become trivial calls into the helper's own reset, rather than each re-implementing "set the module let back to undefined/null."

**Instances**: `packages/aztec-runtime/src/pxe/artifact-catalog.ts:88,93-106`; `packages/aztec-runtime/src/pxe/note-schemas.ts:61,63-89`; `packages/aztec-runtime/src/pxe/public-events.ts:169-182`; `packages/aztec-runtime/src/pxe/public-events.ts:184-194`; `packages/aztec-runtime/src/pxe/artifact-registry.ts:52,99-112`; `packages/aztec-runtime/src/pxe/service.ts:508-523`.

---

## Finding 2 — `PxeService` (service.ts) is a Large Class bundling 4 unrelated concerns

**Smell**: Large Class (Bloater), close analog to God Object.

**Impact bucket**: structural, trending architectural. Blast radius: the single 920-line file is 2.5x the next-largest file in the cluster (`public-events.ts` at 420 LOC) and has the highest fan-in/fan-out in the package (11 intra-package imports per the repo map, confirmed on read: `spec`, `effective-class`, `chain-runtime`, `chain-coordinates`, `opfs-store`, `artifact-registry`, `known-artifacts`, `note-schemas`, `schemas`, `public-events`, plus the `@aztec/*`/`@nulo/*` externals). Change frequency: **highest churn file in the entire cluster** — 13 commits touching `service.ts` in the last 6 months vs. 5 for the next-busiest files (`spec.ts`, `client.ts`, `chain-runtime.ts`, `nulo-account.ts`).

**Evidence** — one class (`PxeService`, `packages/aztec-runtime/src/pxe/service.ts:71-920`) owns four largely-independent concerns with no internal module boundary between them:
1. **Concurrency/locking primitives**: `chainGuards` (:130), `chainPurgeEpochs` (:137), `profileBarriers` (:138), `getChainGuard` (:175-183), `getProfileBarrier` (:185-192), `assertGenerationCurrent` (:808-819), `withPxeRead` (:821-861), `withPxeWrite` (:880-909), `logOpFailure` (:871-878).
2. **Profile/chain lifecycle state machine**: `profileLifecycles` (:161), `provisionChainStoreKey` (:725-756), `clearProfileState` (:660-716), `clearChainState` (:631-651).
3. **Storage janitor**: `sweepOrphanStores` (:223-270), `deleteDb` (:765-780) — raw IndexedDB enumeration/deletion, orthogonal to PXE RPC semantics.
4. **PXE domain RPC operations**: `getContractInstance` through `getPublicTokenClassStatus` (:272-620) plus the stub-class memo (:503-524, also Finding 1 instance #6).

**Why it harms future change**: a contributor adding or modifying any single RPC method (concern 4) must load and reason about the two-level `ReadWriteGuard`/epoch/generation-fence machinery (concern 1) and the profile-incarnation state machine (concern 2) merely by being in the same class — `withPxeRead`/`withPxeWrite` are private methods every domain method funnels through, so understanding one requires understanding all three. The class's own doc comments acknowledge this cost directly (":103-129" describes a two-level concurrency model as a load-bearing design the reader must absorb before touching anything else in the file). The 13-commits-in-6-months churn rate confirms this file is a hot spot: every one of those touches risked a merge conflict or a subtle interaction with the locking/lifecycle code, regardless of whether the change was domain-logic-only (e.g. adding a new RPC method) or lifecycle-only (e.g. the most recent commit `095c525e` "re-imported profile boots past its predecessor's tombstone").

**Smallest safe refactoring**: Extract Class (Fowler) — move concern 1 + 2 (locking primitives, purge epochs, profile barriers, the generation fence, `withPxeRead`/`withPxeWrite`) into a dedicated coordinator (e.g. `PxeConcurrencyCoordinator`) that `PxeService` holds and delegates to; move concern 3 (`sweepOrphanStores`, `deleteDb`) into a standalone `pxe-store-janitor.ts` module taking `listChainStoreDirs`/`removeProfileStoreDirs` + an `IProfileReader`-shaped input. `PxeService` then shrinks to concern 4 (the actual RPC method bodies) plus thin calls into the coordinator — the file drops to roughly half its current size, and the intricate locking code becomes independently testable/reviewable without the domain-method noise around it (mirrors the same "own concurrency" pattern `ChainRuntimeRegistry` in `chain-runtime.ts` already uses successfully as a standalone class).

**Instances**: `packages/aztec-runtime/src/pxe/service.ts:71-920` (whole-class finding; representative concern boundaries listed above).

---

## Finding 3 — Identical warn/debug logger-adapter lambda duplicated in `service.ts`

**Smell**: Duplicate Code (Dispensables).

**Impact bucket**: local/cosmetic. Blast radius: 1 file, 2 call sites, 3 lines each. Change frequency: unknown (both call sites were introduced together with the D1/D2 public-events RPC methods; no independent history since).

**Evidence**:
- `packages/aztec-runtime/src/pxe/service.ts:598-599` (inside `getPublicTokenTransferEvents`):
  ```ts
  fetchPublicTokenTransferEvents(node, contract, parsedArgs, (level, msg, ...rest) =>
      level === "warn" ? this.logWarn(msg, ...rest) : this.logDebug(msg, ...rest),
  )
  ```
- `packages/aztec-runtime/src/pxe/service.ts:616-617` (inside `getPublicTokenClassStatus`), byte-identical lambda:
  ```ts
  resolveTokenClassStatus(node, contract, checkpointHash, (level, msg, ...rest) =>
      level === "warn" ? this.logWarn(msg, ...rest) : this.logDebug(msg, ...rest),
  )
  ```
  Both adapt `public-events.ts`'s `PublicEventLogger` type (`(level: "warn" | "debug", msg, ...rest) => void`) onto `PxeService`'s own `logWarn`/`logDebug` methods.

**Why it harms future change**: a third `PublicEventLogger`-consuming call (plausible — `public-events.ts` already exports two node-facing functions that take this exact logger shape, and the module's own header says it owns "the offscreen-side core" of a growing incoming-transfer feature) will almost certainly copy this lambda a third time rather than notice the first two. If the logging levels or the underlying `logWarn`/`logDebug` signatures ever change, both sites must be found and updated in lockstep by hand.

**Smallest safe refactoring**: Extract Function — a private `PxeService` method `private toEventLogger(): PublicEventLogger { return (level, msg, ...rest) => level === "warn" ? this.logWarn(msg, ...rest) : this.logDebug(msg, ...rest) }`, called as `this.toEventLogger()` at both sites. Removes the duplicate lambda entirely; any future `PublicEventLogger`-consuming call reuses the same adapter.

**Instances**: `packages/aztec-runtime/src/pxe/service.ts:598-599`; `packages/aztec-runtime/src/pxe/service.ts:616-617`.

---

## Non-findings

- **`pxe/schemas.ts` vs `pxe/note-schemas.ts` vs `pxe/spec.ts`'s re-exports** (repo-map candidate #1): read all three in full — distinct jobs (RPC-wire zod validation for `NoteDao`/`PackedPrivateEvent`/`NotesFilter`; note-decode field-name/type maps keyed by class-id+slot; the `Methods` RPC-contract type hub that re-exports types it doesn't own). No functional duplication, no shared logic to extract. Naming overlap alone, without duplication/coupling cost, is excluded by the scan brief.
- **`utils/fetch.ts` mirroring upstream `defaultFetch`** (repo-map candidate #2): confirmed — the file's own header states the mirroring intent, and the AbortController-timeout addition is the entire reason it exists (upstream has none). This is a deliberate, documented near-copy of *external* logic to bolt on a missing feature, not internal duplication; no in-repo refactor addresses an upstream-drift risk.
- **`ArtifactRegistry` vs `ChainRuntimeRegistry`** (repo-map candidate #3): read both in full. `ArtifactRegistry.ensureKnown()` is a single memoized promise (not keyed) — it's actually an instance of Finding 1's idiom, not a shared shape with `ChainRuntimeRegistry`. `ChainRuntimeRegistry` is a genuine `Map<string, ChainRuntime>` registry with rebind/dispose/`AggregateError`-on-partial-failure semantics with no analog in `ArtifactRegistry`. The repo map's speculative "same registry shape reimplemented twice" does not hold up — reclassified into Finding 1 instead.
- **`known-artifacts.ts` + `note-schemas.ts` both routing through `artifact-catalog.ts`** (repo-map candidate #4): confirmed already-deduplicated with a clear header comment explaining the prior bug it fixed. No regrowth found — no new artifact-consuming module bypasses the catalog.
- **`chain-coordinates.ts` vs `utils/chain-identity.ts`** (repo-map's own "checked and ruled out"): confirmed independently — a data-dir key codec vs. a live-node trust check; unrelated logic, no shared abstraction to extract.
- **`ArtifactRegistry.resolve`'s unused `_network: ArtifactNetworkContext` parameter**: dead-looking (prefixed `_`, never read in the method body), but the type's own doc comment states it's "kept on the API for future per-chain policy hooks" — Speculative Generality is explicitly excluded by the scan brief ("speculative flexibility... DO NOT FLAG").
- **The service/client/spec triple pattern** (`service.ts` / `client.ts` / `spec.ts` / `ipxe.ts` / `descriptors.ts` all enumerating the same ~25 RPC methods): this is the repo's declared deliberate convention (excluded per scan brief) — and unusually well-guarded here: `descriptors.ts` carries five compile-time `Equal<>` assertions (`_TableMatchesMethods`, `_IPXEMatchesTable`, `_IpxeImpliesNetwork`, `_EveryMethodIsRpc`, `_RequiresNetworkImpliesNetworkFirstParam`) that fail the build on any drift between the method lists, and `proxy.ts` is *generated* from `descriptors.ts`'s table rather than hand-written 18×. This is the opposite of unchecked Shotgun Surgery — a past `subset.ts` hand-maintained pin list was replaced by this derived-table system (per `descriptors.ts:29-30`). No boilerplate here exceeds what the convention requires.
- **`withPxeRead` vs `withPxeWrite` structural overlap** (both fetch `barrier`/`chainGuard`, snapshot `purgeEpochAtEntry`, wrap in try/catch → `logOpFailure`): real but minor overlap (~4-6 lines) in service between two methods whose core control flow (retry-loop-with-rebind vs. single write-locked pass) genuinely differs — extracting the shared preamble would add an indirection layer for a small saving. Folded into Finding 2's evidence rather than raised standalone; not solid enough on its own to be a 4th top-level finding.
- **`account/` package** (`nulo-account.ts`, `fee-options.ts`, `address-freeze.ts`, `frozen-artifact.ts`, `instantiation-descriptor.ts`): read in full — no duplication found. The freeze/descriptor/regime files are explicitly single-source-of-truth by design (each has a header comment naming the split-brain hazard it prevents), and `fee-options.ts`'s `completeFeeOptions` is itself the product of a prior dedup (its header names the exact bug — hardcoded `1e18/1e18` drifting from the fast path — that centralizing it fixed).
- **`adapters/aztec-node-factory-adapter.ts` vs `ports/node-factory-port.ts`**: a single-implementor port/adapter pair with matching doc comments describing the "one production call site" invariant (lint-guarded). Not duplication — the doc overlap is intentional cross-referencing, not copy-paste logic.
