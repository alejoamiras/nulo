### Finding: Dead activity-protocol type `ActivityScopeReset`

1. **Title:** Dead activity-protocol type `ActivityScopeReset`
2. **Smell name:** Dead Code
3. **Maintenance impact:** cosmetic. Blast radius: 1 file (`activity/model.ts`), 0 consumers anywhere in the repo. Change frequency: introduced in a single commit (`#325`, the activity-silo feature) and untouched since.
4. **Concrete evidence:** `packages/wallet-core/src/activity/model.ts:58-63` declares and exports:
   ```ts
   export interface ActivityScopeReset {
       control: "scope-reset"
       scope: ActivityScope
       incarnation: ActivityIncarnation
   }
   ```
   A repo-wide grep for `ActivityScopeReset` (excluding stale `.claude/worktrees/*` checkouts) returns only this declaration — zero imports/usages in `apps/extension`, `packages/aztec-runtime`, `packages/wallet-bridge`, or elsewhere. It's re-exported through the package's public `./activity` subpath (`activity/index.ts` `export * from "./model"`), so it isn't hidden — it's a genuinely unused public export. The only function that plausibly would consume a "scope reset" payload, `resetScope()` (`activity/causal.ts:256`), takes a bare `ActivityIncarnation` instead. This isn't covered by Vue auto-import or a design-package resolver (it's a `wallet-core` library export, not an `apps/extension/src/{composables,stores,utils}` file).
5. **Why it harms future change:** A reader of the causal-protocol vocabulary reasonably assumes `ActivityScopeReset` is the wire/control shape broadcast when a scope resets, and will waste time reconciling it against `resetScope`'s actual (different) signature — or worse, build a new consumer against the unused type while the real reset path silently diverges.
6. **Smallest safe refactoring:** Dead Code removal — delete the interface and its doc comment; if an "authoritative reset" wire message is genuinely planned, reintroduce it in the PR that wires it to `resetScope`/the coordinator so it's never speculative.
7. **What disappears:** the described-but-unimplemented "authoritative scope-reset control message" concept and the reconciliation confusion it invites.
8. **Instances:** `packages/wallet-core/src/activity/model.ts:58-63` (sole occurrence).

### Finding: Triplicated root-filtered iteration inside `EntityStorage`

1. **Title:** Triplicated root-filtered iteration inside `EntityStorage`
2. **Smell name:** Duplicate Code
3. **Maintenance impact:** local (contained to one class/file). Blast radius: 1 file to fix, but `EntityStorage` itself is instantiated in ~41 downstream files, so any bug in "how we filter+iterate a root" has to be fixed 3-4x by hand today. Change frequency: `entity_storage.ts` has 3 substantive commits (`#272` security-harden, `#220` harden-quality Q-01, `#105` dead-symbol removal) — an actively revisited file.
4. **Concrete evidence:** `getAll()` (`storage/entity_storage.ts:106-116`), `getValues()` (`:126-136`), and `rawEntries()` (`:149-162`) each independently do: build `path = \`${this.root}@\``, `await this.storage.get()`, loop `Object.entries(res)`, `if (!k.startsWith(path)) continue`, then diverge only in what gets pushed. `getKeys()` (`:118-124`) is a fourth, lighter variant of the same filter via `.filter().map()`. Worse, `rawEntries()` reimplements a piece of `decodeRow`'s policy inline (`:155-159`, bespoke `try { JSON.parse } catch { /* skip */ }`) instead of reusing it.
5. **Why it harms future change:** a change to the filtering rule (e.g. a future namespacing scheme, or moving off the `@` separator) requires touching 4 independent loops instead of 1, and the JSON-parse-failure handling in `rawEntries` can silently drift from `decodeRow`'s policy since it isn't the same code.
6. **Smallest safe refactoring:** Extract Method — a private helper (e.g. `entriesUnderRoot(res: Record<string, unknown>): Array<[string, unknown]>`) that yields `[idSuffix, rawValue]` pairs under `${root}@`; `getAll`/`getValues`/`getKeys`/`rawEntries` become thin call-sites over it.
7. **What disappears:** 3-4 independently-maintained copies of the same prefix-filter loop, and the risk of one variant's filtering silently drifting from the others.
8. **Instances:** `packages/wallet-core/src/storage/entity_storage.ts:106-116` (getAll), `:118-124` (getKeys), `:126-136` (getValues), `:149-162` (rawEntries).

### Finding: `EntityStorage`/`ValueStorage` share an unextracted constructor + write/delete shape

1. **Title:** `EntityStorage`/`ValueStorage` share an unextracted constructor + write/delete shape
2. **Smell name:** Duplicate Code — distinct from the module map's already-noted `decodeRow`-vs-`get()` failure-policy divergence, which is intentional and documented and NOT what this finding is about. This finding is about the surrounding scaffolding that duplicates for no policy reason.
3. **Maintenance impact:** structural — crosses two files that are both foundational storage primitives. Blast radius: 2 files to fix; `EntityStorage` has ~41 consumers and `ValueStorage` ~13 depending on this contract staying correct. Change frequency: both files were touched together in the same harden-quality arc (`#220`, Q-01) — they're already co-maintained in practice, which is exactly where duplicated scaffolding costs the most.
4. **Concrete evidence:** identical `private readonly storage: MinimalStorageArea` / `root: string` / `parse?: (raw: unknown) => T` fields and constructor body (`entity_storage.ts:22-24,39-43` vs `value-storage.ts:4-6,22-26`); identical write path `this.storage.set({ [key]: JSON.stringify(value) })` (`entity_storage.ts:98-100` vs `value-storage.ts:37-39`); identical delete path `this.storage.remove(key)` (`entity_storage.ts:102-104` vs `value-storage.ts:41-43`). Only `decodeRow`/`get()`'s read-failure policy legitimately differs.
5. **Why it harms future change:** a change to the write path (e.g. routing through the package's own `utils/serialization.ts` codec instead of raw `JSON.stringify`, or adding a write-time hook) must be hand-applied to both classes; nothing signals they're paired beyond one importing a type from the other, so a future patch to one is easy to forget applying to the other.
6. **Smallest safe refactoring:** Extract a shared internal base (e.g. an unexported `StorageRecord` holding `storage`/`root`/`parse` + `set()`/`delete()`), with `EntityStorage`/`ValueStorage` composing it and overriding only the (intentionally divergent) decode policy — leave `decodeRow`/`get()` bodies untouched per their own comments.
7. **What disappears:** 2 independently-maintained copies of construction/write/delete scaffolding; a future write-path change becomes a one-place edit.
8. **Instances:** `packages/wallet-core/src/storage/entity_storage.ts:21-26,39-43,98-104`; `packages/wallet-core/src/storage/value-storage.ts:3-6,22-26,37-43`.

### Finding: Verbatim-duplicated clone+track blocks in `causal.ts`'s `applyMutation`

1. **Title:** Verbatim-duplicated clone+track blocks in `causal.ts`'s `applyMutation`
2. **Smell name:** Duplicate Code
3. **Maintenance impact:** local (one pure function, one file). Blast radius: 1 file, but it's the causal reducer the whole activity-silo feature (`#325`) is property-tested against. Change frequency: 1 commit since introduction — young, still-evolving code (the module's own header flags an open "KNOWN GAP" in `applySnapshot`), exactly the condition under which duplicated branches are likely to drift apart.
4. **Concrete evidence:** `applyMutation` (`activity/causal.ts:112-142`) contains two byte-for-byte identical 4-line blocks:
   ```ts
   const next = cloneState(state)
   next.buffered.push(mutation)
   next.maxEventSeen = maxCounter(next.maxEventSeen, mutation.revision.seq)
   return { state: next, decision: "buffered" }
   ```
   at `:119-122` (cold/no-incarnation case) and `:135-138` (newer-incarnation/fork case). A near-identical 3-line variant (same two statements minus `buffered.push`) appears at `:127-129` (stale-incarnation case), and the shared opening pair "clone + bump `maxEventSeen`" recurs a fourth time at the top of `applyCurrent` (`:71-72`).
5. **Why it harms future change:** the module's header explicitly warns that `maxEventSeen` is diagnostic-only and must never become a rejection threshold — a subtlety currently encoded correctly by hand in 4 places. A future edit to that bookkeeping has 4 call sites to update in lockstep; missing one silently reintroduces the exact "global-max threshold drops out-of-order records" bug class the header comment warns against.
6. **Smallest safe refactoring:** Extract Method — fold the two identical `"buffered"` blocks into one `bufferMutation(state, mutation)` helper, and extract a `withSeenBump(state, seq)` helper for the shared clone+max-bump step used at all 4 sites (including `applyCurrent`'s opening lines).
7. **What disappears:** 2 verbatim-duplicated return blocks, 2 more structurally-identical variants, and the 4-site invariant currently kept in sync only by hand.
8. **Instances:** `packages/wallet-core/src/activity/causal.ts:71-72, 119-122, 127-129, 135-138`.

### Finding: `EventHandler.invoke()` swallows subscriber exceptions with no log, unlike every sibling swallow in the package

1. **Title:** `EventHandler.invoke()` swallows subscriber exceptions with no log, unlike every sibling swallow in the package
2. **Smell name:** error-handling analog — exception swallowing.
3. **Maintenance impact:** structural — `EventHandler` is the package's sole pub/sub primitive; the swallow undermines observability across the whole event-driven surface built on it even though the defect itself sits in one method. Blast radius: 1 file to fix; `EventHandler`/`.invoke(` usage spans roughly 52 files across `apps/extension` and other `@nulo/*` packages (services, `ServiceCollection` wiring, etc., per repo-wide grep). Change frequency: file untouched since the initial import commit — long-standing, and notably not revisited even while the rest of the package's error-handling (locks, jobs/error.ts, storage) was actively hardened in the same period (`#220`, `#272`).
4. **Concrete evidence:** `packages/wallet-core/src/utils/event-handler.ts:22-28`:
   ```ts
   public invoke(payload: T) {
       for (const callback of this.#callbacks) {
           try {
               callback(payload)
           } catch {}
       }
   }
   ```
   Contrast with every other swallowed catch in the same package — all carry an explanatory comment justifying the swallow: `utils/lock.ts:56-59,96-100`, `jobs/error.ts:46-51,60-62`, `storage/entity_storage.ts:76-82`. `EventHandler.invoke()` is the one bare, uncommented, unlogged `catch {}` in the package, and unlike `Lock`/`ReadWriteGuard` it has no optional `ILogger` constructor param to log through even if someone wanted to.
5. **Why it harms future change:** adding or editing an event subscriber is a very common change shape in this codebase; if the new subscriber throws, the failure is invisible — no log line, no rethrow, nothing reaches `LoggerStore`. Debugging "my new listener isn't running" degrades into bisecting the change instead of reading a log, and because one `EventHandler` instance typically backs several independent subscribers, a silently-broken one doesn't stop its siblings from looking fine.
6. **Smallest safe refactoring:** mirror the package's own established pattern — add an optional `ILogger` constructor param and wrap the swallow in a best-effort `tryLog`-style call (as `utils/lock.ts` already does), or at minimum add the same kind of justifying comment the rest of the package uses.
7. **What disappears:** the one silent, undocumented failure path in an otherwise consistently-defended-and-commented package; a broken subscriber becomes debuggable via the existing log pipeline instead of invisible.
8. **Instances:** `packages/wallet-core/src/utils/event-handler.ts:22-28` (single instance; flagged for inconsistency with the package-wide swallow-with-comment convention and its wide consumer blast radius).

## Non-findings considered

- **`Lock` (utils/lock.ts) vs `ReadWriteGuard` (utils/rw-guard.ts) "two parallel mutex implementations"** — verified: the two classes are structurally different enough (single-boolean FIFO callback queue vs. multi-reader token-map + writer-priority condition-variable) that merging them is not an obviously safe or valuable refactor; the two cross-reference each other in comments, so the parallelism is a deliberate, understood tradeoff, not an accident. The only literally-duplicated code is a 4-line "if armed, clearTimeout + unset field" idiom (`lock.ts:79-82` vs `rw-guard.ts:197-202`) — real but below the bar of a reportable finding (trivial, low-churn — 2 commits each since import, well-tested: 411/579 test LOC).
- **`EntityStorage` vs `ValueStorage`'s `decodeRow`/`get()` failure-policy divergence itself** (drop-on-JSON-syntax-failure vs. throw-on-any-failure) — verified intentional and explicitly documented in both files' constructor comments; this is a deliberate contract difference, not an accidental duplication. (The *surrounding* constructor/set/delete scaffolding duplication is reported separately above.)
- **Three coexisting error-normalization paths** (`errorMessageFromUnknown`/`getErrorMessage`/`getErrorData` in `utils/errors.ts`, `normalizeError` in `jobs/error.ts`) — verified: consumer sets are disjoint (`errorMessageFromUnknown` is internal-only, consumed solely by `jobs/error.ts`; `getErrorMessage`/`getErrorData` are consumed by ~30 extension UI/service files; `normalizeError` is consumed by the job/execution layer plus `apps/faucet`), so a change to one path does not force touching the others. `utils/errors.ts`'s own comment flags this as a known, owner-tracked item ("tracked for Q-01") already partially remediated in the prior harden-quality arc (`#220`, Q-01/Q-07) with the remaining wire-boundary-decode work explicitly deferred as an owner call — not new debt to re-flag here.
- **`utils/index.ts` barrel re-exporting 10+ unrelated modules** (arrays, encoding, errors, event-handler, lock, mnemonic, queue, random, rw-guard, serialization, sleep) under one `./utils` subpath — verified real, but the package ships source-to-source (no build step) with named ESM exports; consumers cherry-pick named symbols and standard bundler tree-shaking applies. No evidence of forced coupling (no circular imports, no side-effecting top-level code found). Below the "measurable duplication/coupling" bar.
- **`mnemonic.ts`'s `getMnemonic`/`getEntropy` bit-packing** — initially suspected duplication; verified NOT duplicate code. The 11-bit index pack/unpack loops are inverse encode/decode operations (not repeated logic), and the one truly reusable piece (`bytesToBits`) is already correctly factored out and shared by both functions.
- **`Migrator.ts` method length/complexity** (`applyOne` ~57 lines, `resumeIfInterrupted` ~60 lines) — verified: already decomposed into single-purpose private methods (`guardCommit`, `restore`, `bumpAttempts`, `footprintKeysFor`, `snapshot`); the remaining length is inherent crash-recovery domain complexity that the module map itself flags as the correctness audit's target, not a quality-refactor target — restructuring here for its own sake would risk the exact data-preserving invariants the class exists to protect.