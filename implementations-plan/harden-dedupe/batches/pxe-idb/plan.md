---
plan: harden-dedupe / pxe-idb (arc 17 of 25)
tier: mid
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/17-pxe-idb, stacked on harden-dedupe
---

# pxe-idb: one IndexedDB delete wrapper, one "no PXE DB left" rule, one catalog key list

Findings Q-21 and Q-27 (k), from `audit/quality/2026-09-30-dedup-high/`. `PxeService` wraps `indexedDB.deleteDatabase` three times, each with its own blocked policy, and writes the "delete the shared `keyval-store` only when no PXE DB is left" rule twice. `artifact-catalog.ts` lists its twelve keys three times. This batch writes each once. The set of deleted databases, the order of deletion, every blocked, error and timeout outcome, every log line and every await stay as they are today.

## Outcome & Quality Bar

- **For whom:** the next person who changes how a legacy database is deleted, or who adds a profile-scoped database family the shared-store rule must respect. Today that means three hand-rolled promise wrappers and two copies of the `pxe/` emptiness check, and a missed copy deletes a surviving profile's data (the finding's own risk).
- **Excellent:**
  - One private `deleteDb(name, policy)`. Each site's blocked behaviour is a named policy constant, not an unnamed inline handler.
  - One predicate says what a legacy PXE database is, and one says what the shared store is. Both erasure paths and the boot sweep use them.
  - The keyval lookup source stays a visible argument at each site: the boot snapshot in the sweep, a fresh listing in profile erasure (the program's Behaviour rule excludes unifying them).
  - The catalog's key union and resolution order are derived from the accessor table.
  - Phase 1 tests pin, per site, the policy, the rejection reason, the warn arguments, the deletion order, the number of `databases()` calls and the microtask distance to the next observable step. Each test turns red on a listed mutant.
- **Good enough:** the two keyval-guard blocks stay as two short blocks of three statements each, sharing the predicates. The shape that removes them, an async helper, would add a microtask before the barrier release (see below).

## Architecture & Implementation

Code in `packages/aztec-runtime/src/pxe/service.ts` (1020 lines) and `packages/aztec-runtime/src/pxe/artifact-catalog.ts` (108 lines). Tests are added only. No other source file changes.

### A. The delete wrapper (Q-21, blocked policy)

**Today, three wrappers**:

| site | file:line | called from | on `blocked` | on `error` | resolves |
|---|---|---|---|---|---|
| S1 sweep, legacy PXE DB | `service.ts:285-294` | `sweepLegacyIndexedDbs` loop `:284-298` | `logWarn("deleteDatabase blocked (DB still in use):", name)` (2 args), then `resolve(false)`. No timer. | `reject(req.error)`, raw (null stays null) | `true` |
| S2 sweep, keyval-store | `service.ts:309-317` | `sweepLegacyIndexedDbs` tail | `logWarn("deleteDatabase blocked (DB still in use): keyval-store")` (**1 arg**), then `resolve()`. No timer. | `reject(req.error)`, raw | `undefined` |
| S3 `deleteDb` | `service.ts:867-882` | `clearChainState` `:737`; `clearProfileState` prefix loop `:779-781` and keyval `:788` | `logWarn("deleteDatabase blocked (waiting for close):", name)` (2 args), then a `setTimeout(5_000)` that rejects `Error("deleteDatabase blocked past timeout: <name>")` | `reject(req.error ?? Error("deleteDatabase failed: <name>"))`; `finish` clears the timer | `undefined` (after `finish` clears the timer) |

Each wrapper calls `indexedDB.deleteDatabase` synchronously inside its executor and assigns `onsuccess`, then `onerror`, then `onblocked`. None sets `onupgradeneeded`: a delete request never fires it. A repeated `blocked` warns again in every copy (in S3 it also arms a second timer). A `success` after a skip's `resolve(false)` is a no-op on the settled promise.

**What changes.** `deleteDb` becomes `deleteDb(name: string, policy: BlockedDeletePolicy): Promise<boolean>`. It stays a private, **non-async** method that returns the `new Promise` directly, so `await this.deleteDb(...)` has the same await shape as today's inline `await new Promise(...)`. The module-private policy type and its three constants:

```ts
type BlockedDeletePolicy =
	/** Best-effort sweep: a blocked delete is skipped (resolves false), so the sweep never hangs. */
	| { onBlocked: "skip"; warnArgs: (name: string) => unknown[] }
	/** Verified erasure: wait for the blocker to close, then reject — never a false "deleted". */
	| { onBlocked: "wait"; timeoutMs: number; warnArgs: (name: string) => unknown[] }

const LEGACY_SWEEP = { onBlocked: "skip", warnArgs: (name) => ["deleteDatabase blocked (DB still in use):", name] }
const LEGACY_SWEEP_KEYVAL = { onBlocked: "skip", warnArgs: () => ["deleteDatabase blocked (DB still in use): keyval-store"] }
const VERIFIED_ERASE = { onBlocked: "wait", timeoutMs: 5_000, warnArgs: (name) => ["deleteDatabase blocked (waiting for close):", name] }
```

- **Body:** today's S3 body with one branch. `onblocked` runs `this.logWarn(...policy.warnArgs(name))`, then either `resolve(false)` (skip) or arms the timer (wait). `onerror` rejects `req.error` for skip, or `req.error ?? new Error(...)` for wait. `onsuccess` is `finish(() => resolve(true))`. A skip policy never sets the timer, so `finish` is a no-op there, as the absent `finish` is today.
- **Call sites:**
  - S1 becomes `await this.deleteDb(pxes[i].name!, LEGACY_SWEEP)`. Today the onblocked closure re-reads `pxes[i].name` at event time; no splice can run between the call and that event, so the value is identical.
  - S2 becomes `await this.deleteDb(keyval.name!, LEGACY_SWEEP_KEYVAL)`.
  - The three S3 callers pass `VERIFIED_ERASE`. Their resolved value is discarded, as it is today.
- **Kept per site as policy data:** the warn text and arity (S2's single string is kept, not normalised), skip versus wait, the 5 s deadline, and the null-reason fallback (wait only).
- **Comments.** The `deleteDb` doc (`:860-866`) says "never false-success" of every call, which is wrong once the skip policy is in. It shrinks to "deletes `name`; the policy decides what `blocked` does", and the per-arm docs carry the semantics. One line records that the wrapper must stay non-async. The splice comment (`:294-296`) keeps its reason and drops "(review finding — …)".

### B. The shared-store rule (Q-21, keyval guard)

**Today, two copies**:

| | sweep `service.ts:299-317` | profile erasure `service.ts:782-789` |
|---|---|---|
| precondition | the sweep's own `pxes` list is empty after the loop (`:299`) | the per-profile prefix loop finished without throwing (`:779-781`) |
| emptiness check | one fresh `indexedDB.databases()`, `.some(x => x.name?.startsWith(PXE_DATA_DIR_ROOT))` (`:305`) | the same expression (`:785`) |
| keyval lookup | the **boot snapshot** `dbs.find(x => x.name === "keyval-store")` (`:307`), with no second listing | a **second fresh listing** `(await indexedDB.databases()).find(...)` (`:787`) |
| delete | S2, skip policy | S3, verified policy |
| `databases()` calls | 2 in total (boot `:236` + `:305`) | 3 (prefix `:779`, `:785`, `:787`) when nothing remains; 2 otherwise |

The legacy-DB predicate also appears a third time, as the boot filter at `:237`.

**What changes.** Two module-private sync helpers, with the parameter names kept as `x` so an engine-generated `TypeError` would name the same variable:

- `isLegacyPxeDb = (x: IDBDatabaseInfo) => x.name?.startsWith(PXE_DATA_DIR_ROOT)`, used at `:237`, `:305` and `:785`.
- `findKeyvalStore = (dbs: IDBDatabaseInfo[]) => dbs.find((x) => x.name === KEYVAL_STORE)`, with `KEYVAL_STORE = "keyval-store"`. The **lookup source is the argument**:
  - the sweep passes its boot snapshot `dbs`;
  - erasure passes `await indexedDB.databases()`, only inside its `if (!remaining)` branch, exactly where the second listing happens today.

Each guard stays inline as a few statements, so every `await`, listing and branch sits where it does today. One line at the sweep's `findKeyvalStore(dbs)` says the boot snapshot is deliberate: a store created after boot is never the sweep's to delete.

**Engine text, reviewed.** In erasure, `(await indexedDB.databases()).find(...)` becomes `findKeyvalStore(...)`, so a non-array listing's `TypeError` would name `dbs`. `databases()` returns a browser-built sequence and no input reaches it, so no malformed value can arrive there. The change is recorded, not pinned.

**Alternative rejected: one async `deleteSharedKeyvalIfNoPxeDbs({ lookup })` helper.** It adds exactly one microtask between the guard and the next statement on both branches. In `clearProfileState` that next statement is the success-only `profileBarriers.delete` (`:794`), `profileLifecycles.set(deleted)` (`:800`) and `leaveWrite()` (`:804`). A synthetic probe of the inline shape against the helper shape counted 2→3 ticks (something remains) and 4→5 ticks (nothing remains), the same on Bun/JSC and Node/V8. It measures guard completion only, not the service-level endpoints T1–T5, which Phase 1 measures itself. This is the lesson in `implementations-plan/lessons.md` ("Moving a span into an awaited helper…", evidence `approval-scope-follow`), so the guard stays inline.

### C. Catalog keys (Q-27 k)

**Today** the twelve keys are written three times in `artifact-catalog.ts`:

- the `CatalogKey` union at `:35-47`;
- the `rawArtifact` record at `:58-71`, which the type checks as exhaustive;
- `ALL_CATALOG_KEYS` at `:74-87`, which nothing checks against the union. It sets the order in which `loadProductionKnownArtifacts` (`known-artifacts.ts:27-30`) fills its map.

**What changes**, following the pattern `descriptors.ts:76-78` already uses:

- `rawArtifact` becomes the one table: `{ … } satisfies Record<string, () => ContractArtifact>`, with entries in today's order. It keeps the name `rawArtifact`, so the `TypeError` an unknown key raises at `rawArtifact[key]()` (`:93`) keeps its text.
- `export type CatalogKey = keyof typeof rawArtifact`.
- `export const ALL_CATALOG_KEYS = Object.keys(rawArtifact) as readonly CatalogKey[]`. For non-integer string keys, `Object.keys` returns them in insertion order, so the order equals today's literal. It is a fresh plain array, as the literal is.
- The "single source of truth" doc and the resolution-order note move onto the table, and the "Before this, …" history paragraph goes.

`CatalogKey` keeps the same twelve literal members, and its consumers (`known-artifacts.ts:4`, `note-schemas.ts:2`) are untouched.

### What stays

- Every name-selection decision stays at its call site:
  - the sweep's whole-`pxe/` filter and reverse loop (`:284`);
  - the success-only splice (`:297`);
  - erasure's `chainDataDirPrefix(profileId)` filter, with its trailing slash (`chain-coordinates.ts:35-37`);
  - `clearChainState`'s exact `chainDataDir` name (`:737`).
- The ordering in all three paths is unchanged:
  - `clearChainState` (`:734-738`): bump, dispose, OPFS remove, IDB delete, bump.
  - `clearProfileState` (`:769-804`): dispose, guard purge, key drop, OPFS remove, prefix deletes in listing order, emptiness check, keyval, success bookkeeping, `finally` release.
  - Sweep: the OPFS arm, then the IDB arm tail-returned at `:278` (no hop before the first delete).
- No new export or RPC method. `rpcMethods` (`:78-104`) is an allowlist (`packages/extension-messaging/src/core/base-service.ts:90-94`), so `deleteDb` stays unreachable by message.
- **Complexity:** none of these functions is in the complexity manifest. `deleteDb` gains one two-way branch per handler, and `sweepLegacyIndexedDbs` loses two executors.

## Security & Adversarial Considerations

- **Who can trigger a delete:**
  - **The boot sweep.** Only the offscreen document's own `init` (`service.ts:213`, deferred, fire-and-forget) runs it. It takes no input, and it runs only when legacy `pxe/*` databases existed at boot (`:277-278`).
  - **`clearChainState`.** It is reached only from `NetworkService.purgeChain` (`apps/extension/src/wallet/services/network/service.ts:897`, after a user removes a network). It deletes exactly `pxe/<profileId>/<chainId>`.
  - **`clearProfileState`.** It is reached only from the profile-deletion coordinator (`apps/extension/src/wallet/services/profile-deletion/coordinator.ts:136`), behind the generation fence (`service.ts:751-762`).
  - **dApps.** Both clear methods are `ipxe: false` (`descriptors.ts:67-68`), so they are not in the dApp-facing in-process surface. A dApp or a page has no path to any of them, and this arc adds none.
- **Never another profile's, chain's or tab's database.** `deleteDb` deletes only the name its caller passes, and the policy never chooses a name. Name selection stays at each site, unchanged:
  - The sweep deletes every legacy `pxe/*` database by design. Those are rc.2-era databases that 5.0.0+ cannot read and that no live runtime opens: the OPFS backend creates none, which `apps/extension/tests/e2e/network/opfs-storage.test.ts:101-105` asserts on a real build.
  - Erasure's prefix ends in `/`, so profile `p1` never matches `p10`. Phase 1 adds a `pxe/p10/1` fixture to pin it.
  - The shared store goes only when the fresh listing shows no `pxe/*` database for any profile, at both sites. The sweep's boot-snapshot lookup is the stricter one: a store created after boot is never deleted by the sweep. It is kept, per the program's Behaviour rule.
  - A database held open in another extension context (tab, popup, worker) produces `blocked`, never a forced close. The site's policy decides what follows, as today.
- **Blocked and success semantics are identical per site** (table A). The verified policy can never report a blocked or failed erasure as success, and the skip policy can never hang the boot. The skip's `false` keeps the database in `pxes`, so the keyval guard sees it (`:294-297`; its comment stays, minus the review tag).
- **Ordering is preserved, including microtasks.** The wrapper stays non-async, and the guards stay inline. Phase 1 pins the tick distance from each awaited IDB event to the next observable step, so a later "tidy" into an async helper turns red.
- **Logging:** the same arguments at the same level. Database names are wallet-chosen identifiers (`pxe/<profileId>/<chainId>`), already logged today; no new field is added.
- **Pre-existing, out of scope (a follow-up, not fixed):** `keyval-store` is also bb.js's CRS cache, through `idb-keyval`'s default store (`node_modules/.bun/@aztec-foundation+bb.js@6.0.0-rc.1/.../crs/browser/cached_net_crs.js:1`). idb-keyval 6.3.0 caches its connection and has no `versionchange` handler, and bb.js loads the CRS in its caller's context. So a `clearProfileState` deletes the CRS cache whenever the store exists and no legacy PXE database remains. If a same-origin context also holds the store open, the delete is blocked, waits 5 s and rejects, and the coordinator records a retryable erasure failure. The overlap is high confidence from source; the live block is likely once a WASM prove has run. It is a medium reliability issue with no data loss and no crypto exposure. `opfs-storage.test.ts` seeds no `keyval-store`, so it neither shows nor rules this out. This arc keeps today's behaviour exactly, and Phase 1's ordered-log pin freezes it, so the follow-up must edit that pin deliberately.
- **npm surface:** none. `@nulo/aztec-runtime` is private and unstaged (`scripts/publish/packages.ts`).

## Assumptions

**Facts** (read 2026-10-03 on `harden-dedupe` at `169bed04`):

1. The wrapper, guard and catalog sites sit at the lines above. Recon's `:285-297 / 309-320 / 866-884` and `:780-792` have since shifted by a few lines.
2. There is no `fake-indexeddb` anywhere in the repo. Every IDB test uses hand-rolled request stubs (`service.test.ts:243-253`, `service-sweep.test.ts:29-33`, `incarnation-fence.test.ts:63-68`). None of them fires `onblocked`, so no blocked path is tested today.
3. Existing pins:
   - erasure keeps a sibling's database and the shared store (`service.test.ts:262-279`);
   - the sweep keeps the store when a new PXE database appears after boot (`service-sweep.test.ts:116-144`);
   - `clearChainState` rejects on error (`service.test.ts:255-260`).
4. **Real-browser coverage today:**
   - `opfs-storage.test.ts:107-155` runs `clearProfileState` on a seeded legacy database for the deleted profile, on the Chrome and Firefox network lanes. It is not in `CHROME_ONLY`.
   - `settings-crud.test.ts:103` reaches `clearChainState`. `purgeChain` collects its rejection and throws (`network/service.ts:896-904`), but the spec seeds and checks no IndexedDB erasure, so it proves nothing about this path.
   - `opfs-storage` covers no blocked handling, no boot sweep and no CRS behaviour, and seeds no `keyval-store`. Nothing reaches the boot sweep. Nothing produces `blocked` in a browser.
5. `ALL_CATALOG_KEYS` order is not pinned anywhere. The aztec-runtime vitest run cannot import `artifact-catalog.ts`, because its JSON aliases resolve only in the extension (`note-schema-reset.test.ts:1-8`).
6. No in-flight arc touches these files. Arc 16 (byte-primitives) will edit `service.ts:817` and `:848` inside `provisionChainStoreKey`, in a hunk separate from this arc's three.

**Inferences:**

- A stub that fires `blocked`, `success` or `error` on demand is a faithful test of the wrapper. Per spec, Chrome and Firefox fire `blocked` on a delete request while a connection stays open after `versionchange`, then `success` once it closes. The refactor changes only how the wrapper reacts, not what the browser fires.
- `req.error` is non-null in a real `error` event, so the per-policy null fallback is unreachable in browsers. It is kept anyway, at no cost.
- "A late `success` changes nothing" refers to the wrapper's bookkeeping only. A browser never cancels a delete after its timeout, so a blocked delete still completes when its blocker closes, today and after.

**Asks:** both answered by the plan audit; see Decisions.

## Phases

### Phase 1: pin each site (test only)

**New file `packages/aztec-runtime/src/pxe/service-idb-delete.test.ts`.** It mocks `./known-artifacts`, `./note-schemas` and `./opfs-store` (the OPFS calls record into an ordered log, and `listChainStoreDirs` returns `[]`). Its scripted `indexedDB` stub logs `databases` and `delete:<name>` into the same ordered log. Each request does what its test scripts: `success`, `blocked`, `blocked` then `success`, `error`, or `error` with no `req.error`. The logger records `[level, ...data]`. Expected strings are literals in the test. The cases:

- **Sweep (S1, S2, boot lookup):**
  - Two legacy databases are deleted in reverse order.
  - A blocked one warns `(Warn, "deleteDatabase blocked (DB still in use):", "pxe/p1/1")`, asserted before the sweep is awaited so a wait-policy mutant reds instead of hanging. It stays in the list, and causes no re-list (`databases` called once) and no keyval delete. A `success` arriving after the `blocked` changes nothing.
  - A new `pxe/*` database appears after the boot-snapshot deletions: the ordered log ends at the re-list, with no keyval delete. Removing `if (remaining) return` reds this file.
  - When all succeed and the store is in the boot snapshot: exactly two `databases` calls, then `delete:keyval-store`.
  - A blocked keyval delete warns the single string and the sweep resolves.
  - A keyval error rejects with the same error object. An S1 error with no `req.error` rejects with `undefined`.
  - A store absent at boot but present at re-list is kept.
- **Erasure (S3 via `clearProfileState`):**
  - The full ordered log for a profile with two databases and no other profile's: `disposeProfile`, `removeProfileStoreDirs`, `databases`, the two deletes in listing order, `databases`, `databases`, `delete:keyval-store`.
  - Beside siblings `pxe/p2/1` and `pxe/p10/1`: the same log up to the second `databases` call, then nothing. Neither sibling and not the store is deleted.
  - A store present only in the third listing is deleted; a store present earlier but absent from the third listing is not.
  - A `blocked` delete, run against **both** targets (a prefix database and the keyval-store), under fake timers. The `blocked` event is delayed, and no deletion timer exists before it. The test anchors on the recorded warn `(Warn, "deleteDatabase blocked (waiting for close):", name)`, attaches a rejection observer, then advances with `advanceTimersByTimeAsync`. Measured from the blocked event, it is still pending at 4,999 ms and rejects at 5,000 ms with the exact message. The barrier entry is retained, the lifecycle stays `deleting`, and the write lock is released (a later `barrier.read` runs). After a blocked prefix delete, no keyval delete is attempted.
  - `blocked` then `success` resolves, with zero deletion timers left.
  - `blocked` then `error` rejects with the same error object, with zero deletion timers left.
  - An error rejects with the given object, or with `Error("deleteDatabase failed: <name>")` when `req.error` is unset.
- **`clearChainState`:** the ordered log reads dispose, `removeChainStoreDir`, `delete:pxe/p1/1`. Blocked past 5 s rejects with the exact message.
- **Await shape**, counted with a self-requeuing microtask counter, with literals measured on the unchanged code:
  - (T1) from the boot listing's resolution to the first `deleteDatabase`;
  - (T2) from the re-list's resolution to `delete:keyval-store`;
  - (T3) from the keyval request's `onsuccess` to the lifecycle reading `deleted`, and to a queued `barrier.read` callback running;
  - (T4) the same from the remaining-listing's resolution, when a sibling survives;
  - (T5) from `clearChainState`'s delete `onsuccess` to its promise settling.

**New file `apps/extension/src/wallet/services/pxe/known-artifacts-order.test.ts`** (Q-27 k; the extension resolves the aliases). It mocks only `@aztec-labs/stdlib/contract`, spreading `importOriginal`: the hasher records each artifact and returns a unique id, and `getContractInstanceFromInstantiationParams` returns a stub address. It resets through `_resetNoteSchemasForTests`. It asserts:

- `loadProductionKnownArtifacts` hashes, in order, the ten imported artifacts by identity, then the Wonderland token and the private FPC, each `toEqual` its `loadContractArtifact(json)`;
- the returned map's values are in the same order;
- the SponsoredFPC instance is built from `SponsoredFPCContractArtifact`.

Phase 1 is green on unchanged code, in its own commit. The two test files are then frozen.

### Phase 2: the wrapper, the predicates, the derived keys

Make the § A to C edits with every test file untouched.

**Mutation check.** A scratch script applies each mutant to `service.ts` or `artifact-catalog.ts` and requires its Phase 1 file to go red, as arcs 14 and 15 did. The mutants:

- **Policy:**
  - (M1) S1 to verified;
  - (M2) S2 to verified;
  - (M3a–c) each S3 caller to skip;
  - (M4) the timeout to 4,999 or 5,001.
- **Guard:**
  - (M5) the sweep's lookup to a fresh listing;
  - (M6) erasure's lookup reusing the `remaining` listing;
  - (M7a, b) each emptiness guard dropped;
  - (M8) an unconditional splice;
  - (M9) a forward loop.
- **Messages:**
  - (M10) S2 warn with two arguments;
  - (M11) the null fallback added to skip, or dropped from wait.
- **Await shape:**
  - (M12) the keyval guard as an async helper;
  - (M13) `deleteDb` declared `async`;
  - (M14) `finish` not clearing the timer.
- **Ordering:** (M15) success bookkeeping moved above the keyval delete.
- **Data loss:** (M19a) erasure's filter uses `isLegacyPxeDb`; (M19b) its prefix loses the trailing slash (`pxe/${profileId}`). This is the mutant that maps to the arc's stated risk.
- **Catalog:**
  - (M16) two table entries swapped;
  - (M17) one accessor rebound;
  - (M18) `ALL_CATALOG_KEYS` reversed.

The mutant list and results go in the arc's lessons file.

**Validation gate (after each phase):**

- **Commands:**
  - `bun run --cwd packages/aztec-runtime test`
  - `bun run --cwd apps/extension test -- known-artifacts-order`
  - `bun run lint`
  - `bun run typecheck:all`
  - `bun run test:all`
  - `bun run test:ci-gating`
  - `bun run audit:vue`
- **Pass criteria:** every command exits 0. Phase 2's `git diff --stat` shows only `service.ts` and `artifact-catalog.ts`, with the two Phase 1 files byte-identical. Every mutant is red.
- **Screenshots:** none; no `.vue` or CSS file changes.
- **Layers:** lint, typecheck, unit. In CI, `opfs-storage.test.ts` on the Chrome and Firefox network lanes is the real-browser proof of the erasure path. The lessons log records which shards actually ran it.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, with the adversarial, assumption-attack and implementation-critique asks:
   - Point it at tables A and B. Ask it to diff each site's blocked, error and success behaviour, warn arguments, `databases()` count and await shape, before and after, and to confirm that no path can delete a name its caller did not choose.
   - Include the no-over-engineering rule verbatim ("Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone.").
   - Include the comment-quality rule verbatim ("Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact.").
2. **Fix loop:** triage each finding, fix, commit, log the round in this arc's file under the program's `lessons/`, and resume the same session. Stop when a round has no material finding; at 5 rounds, park the arc.
3. **Delivery:** push, open a ready PR against its parent in the stack, then add both e2e labels. When the program gates are green, with the shards that actually ran recorded (`opfs-storage` on both browsers), squash-merge.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/17-pxe-idb`, drafted on `harden-dedupe`. It has no file overlap with any built-ahead arc. It shares `service.ts` with arc 16 in a separate hunk, so it can land in either order. Code review: off.

## UI impact

None. No popup, window or copy changes, and the warn lines keep their text and arity.

## Drift left for the alignment arc

None. The per-site differences (skip against wait, the 5 s deadline, the warn text and arity, the null-reason fallback, the boot-snapshot against fresh keyval lookup, the extra listing in erasure) are intentional. They are kept as named policies or as visible arguments.

**Follow-ups for the program's final report, unchanged here:**

- **The bb.js CRS cache shares `keyval-store`** (§ Security). Profile erasure can wipe it, or reject after 5 s while bb.js holds it open.
- **Retiring the rc.2-era sweep** stays deferred (the program's Deferred table).

## Decisions (delegated)

### Plan audit: Codex (GPT-6 Astra, xhigh) REVISE, no design defect; Opus APPROVE

Both legs confirmed the design: the non-async `deleteDb` keeps every site's await shape (Opus probed S2 at 3 ticks in both shapes, 4 for an async mutant), the policies match per site and never choose a name, the predicates are identical and keep the trailing slash, the boot-snapshot and fresh-listing rules are intact, and the catalog change is sound.

**Adopted, all of them:**

1. **M3c would survive** (Codex): only a blocked prefix delete was exercised. The blocked-erasure case now runs against both targets and asserts pending, rejection, the retained barrier entry, the `deleting` lifecycle and the released write lock.
2. **The sweep's fresh-listing guard** (Codex): the new file gets its own case, so removing `if (remaining) return` reds it, not only the older sweep file.
3. **Timer arming and error cleanup** (Codex; Opus nit 6): `blocked` is delayed with no timer before it; 4,999/5,000 ms are measured from the event; `blocked → error` checks identity and zero timers; tests anchor on the warn, observe the rejection and use `advanceTimersByTimeAsync`; the skip test asserts the warn before awaiting; the hasher mock spreads `importOriginal`.
4. **M19, the data-loss mutant** (Opus): added.
5. **The stale `deleteDb` doc** (both legs): reduced; the per-arm docs carry the semantics.
6. **Comments** (both legs): the splice comment drops its review tag; the `CatalogKey` history goes; one line keeps the wrapper non-async; one line explains the sweep's boot snapshot.
7. **Evidence corrections:** `purgeChain` throws collected failures (`network/service.ts:899-904`), and `opfs-storage` stays the only relevant proof, with its gaps stated; the probe is synthetic, and T1–T5 are Phase 1's; a late `success` changes wrapper bookkeeping only; the erasure `dbs.find` engine text is recorded as reviewed (Opus nit 5); the awaited-helper lesson's evidence is `approval-scope-follow` (`implementations-plan/lessons.md:36`).

**Rejected:** none.

### Ask 1: the keyval guard's shape

Both legs approve the sync `findKeyvalStore(dbs)` with both guards inline as meeting "keyval lookup as a named parameter". Codex reproduced 2→3 and 4→5 ticks for the async alternative on Bun and Node.

### Ask 2: bb.js and `keyval-store`

Real, and a follow-up, unchanged here. Opus: a high-confidence block once a WASM prove has run, medium severity. Codex: the overlap is high confidence, the live failure moderate; a medium reliability follow-up with no data loss and no crypto exposure. The Security section states the real conditions.
