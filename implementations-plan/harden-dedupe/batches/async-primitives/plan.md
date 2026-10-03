---
plan: harden-dedupe / async-primitives (arc 15 of 25)
tier: mid
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/15-async-primitives, stacked on harden-dedupe
---

# async-primitives: one serial queue, one run fence, one record guard, one sleep

Finding Q-16 and the record-guard half of Q-15 (part e), from `audit/quality/2026-09-30-dedup-high/`. The wallet hand-rolls the same async idioms (deadline race, `sleep`, promise-chain queue, latest-wins counter) and two meanings of "is a record", in about forty places. This batch gives the queue, the fence, the guards and `sleep` one definition each, and moves only the sites whose promise graph and cleanup order stay exactly as they are. The deadline races all stay inline (see Deferred). The program's pre-cleared LogsViewer timer clear is a route-2 fix, so it ships in its own arc, logsviewer-timer (arc 15b); this arc changes no behaviour.

## Outcome & Quality Bar

- **For whom:** the next person who writes a write queue, a stale-result check or a record guard. Today each copy picks its own rejection policy and its own meaning, and those choices already disagree.
- **Excellent:**
  - Every migrated site awaits the same promise graph as today. Two permanent reference graphs, one per queue policy, fail on an added or removed promise hop under a bounded microtask spinner. During the arc, a seven-shape matrix (each site's inline shape copied verbatim) proves each migration and is logged before it collapses.
  - Each site keeps its guard set (below), and Phase 1 tests turn red on every listed mutant that is not equivalent.
  - No error object, message, timer delay, clear point, cleanup order, rejection policy, write order or emit changes, on any engine.
  - The staged `@alejoamiras/nulo-wallet-crypto` package is byte-identical: the same file inventory, every file's sha256 equal.
- **Good enough:** the sites whose shapes differ keep their own code (§ What stays inline). This is a dedup arc: aligning them is behaviour change.

## Architecture & Implementation

Read on `harden-dedupe` at `1c0c67ad`. "Hop" means one microtask job, as counted by the spinner. The probe evidence is in Assumptions.

### The helpers (Phase 2, no consumer edits)

The queue and the guards go in `packages/wallet-core/src/utils/`, exported from `index.ts`, each with a row in `packages/wallet-core/README.md`. The fence stays in `apps/extension/src/composables/runFence.ts`: it is auto-imported and has no consumer outside the extension.

1. **`createSerialQueue(policy?)`**, in `serial.ts`. It returns `{ run(op), get tail() }` and passes `op` straight to `then`, as the sites do.
   - No policy (*propagate*): `link = tail.then(op); tail = link.then(noop, noop); return link`. `run` returns `Promise<T>`: the caller sees `op`'s outcome, and the chain continues past a rejection.
   - `{ onError }` (*report*): `link = tail.then(op).catch(onError); tail = link; return link`. `run` returns `Promise<T | void>`, and `run(op) === queue.tail` holds right after it. The link never rejects unless `onError` throws; then the tail rejects, the next `op` is skipped and `onError` sees the rethrow, exactly as `scan-episodes` and `price` behave today.
   - `tail` is a live getter. A plain property would freeze at the initial promise and break `hydrate`'s contract that its write-back lands before it resolves (`scan-episodes.ts:89`, `:160`).
   - Overloads give each policy its precise return type. It takes a policy object, not a flag, per the program's complexity rule. Its TSDoc says when to use it rather than `Lock`: the queue costs no hop of its own, while `withLock` is `async`.
2. **`isRecord`** (non-null, non-array object) and **`isObjectLike`** (non-null object, arrays and boxed primitives included), in `guards.ts`, both typed `value is Record<string, unknown>`. Both are total: the only input that throws is a revoked `Proxy` reaching `Array.isArray`, and neither storage nor a port can carry one, so moving the expression changes no native error text.
3. **`sleep`** (`sleep.ts:1`): the runtime is unchanged; the return type narrows to `Promise<void>` so `SystemClock` can return it as its port requires.
4. **`RunFence.invalidate()`**: `generation++`, for the sites that bump a counter without starting a run.

### Q-16 (a): `sleep` copies (Phase 3a)

Each one is `new Promise((r) => setTimeout(r, ms))` and becomes `sleep(ms)` from `@nulo/wallet-core/utils`: the same expression returned by a non-async arrow, so the awaited promise and the timer are identical. `sleep` reads the global `setTimeout` at call time, so vitest fake timers patch it exactly as they patch the inline copy.

- `apps/extension/src/popup/auth-guard.ts:66`
- `apps/extension/src/stores/app.store.ts:648`
- `apps/extension/src/wallet/services/execution/gas-balance-reader.ts:227` (the `??` operand is evaluated in place)
- `apps/extension/src/core/adapters/system-clock.ts:13-15` (`return sleep(ms)`)
- `apps/extension/src/composables/importPreflight.ts:31` `realSleep` (used at `:46`, `:61`; imported by `importChainSync.ts:26` for `:115`). It is deleted, both files import `sleep`, and its lines leave `src/types/auto-imports.d.ts` and `.eslintrc-auto-import.json`.

### Q-16 (a): the LogsViewer timer

Moved to arc 15b, logsviewer-timer: a route-2 fix ships in its own arc.

### Q-16 (b): serial queues (Phase 3c)

Probe 2 and both audit legs ran all seven inline shapes against the helper on Bun and V8: the event logs match.

| site | today | policy | guard set kept |
|---|---|---|---|
| `apps/extension/src/popup/components/modules/send/fee-send-selection.ts:75-82` | `link = chain.then(step, step); chain = link.catch(() => undefined)` | propagate | one module-scoped chain; read-modify-write never interleaves; a rejected write reaches its caller; later writes still run; `clearSendSelections` rides the same chain |
| `apps/extension/src/utils/guarded-network-activation.ts:18,44-51` | `run = tail.then(() => runActivation(…)); tail = run.then(u, u)` | propagate | `enqueuedProfileId` is captured synchronously before enqueue; activations run to completion one at a time |
| `apps/extension/src/wallet/services/token/seeder.ts:168,312-318` `withMarkerLock` | `run = markerLock.then(fn); markerLock = run.then(u, u)` | propagate | every marker read-modify-write is serialized; the epoch check stays inside `fn` |
| `apps/extension/src/wallet/logger/store.ts:20,128-131` `enqueueStorageOp` | `next = storageOps.then(op, op).catch(() => {})` | report, `onError: () => {}` | total order of `set`/`remove`; the purge at `:160` still returns the swallowed link |
| `apps/extension/src/wallet/utils/offscreen.ts:128-138` `trackedClose` | `link = closeTail.then(() => closeOffscreen()).catch(() => {})` | report, `onError: () => {}` | `pendingClose = link` and the identity-guarded `finally` are unchanged; `:300` still awaits it |
| `apps/extension/src/wallet/services/incoming-transfer/scan-episodes.ts:60,89,160,176` | `writeChain = writeChain.then(write).catch((e) => this.onPersistError(e))` | report, `onError: (e) => this.onPersistError(e)` | `hydrate` awaits and `settled()` returns the live `tail`, the same promise object; the snapshot is still taken at mutation time |
| `apps/extension/src/wallet/services/price/service.ts:104,231-248` `configTransition` | `.then(async () => {…}).catch((err) => this.log(LogLevel.Warn, "config-change handling failed", err))` | report, the same `log` call | the synchronous abort and generation bump stay outside the chain; the async body moves verbatim |

**Value differences no step reads:**

- The propagate tails differ only in value (`link.catch(() => undefined)` against `run.then(u, u)`); both cost one hop and neither is read.
- Fee's next step today receives the previous link's value; after the change it receives `undefined`. Both fee steps take no argument.
- Logger's `then(op, op)` becomes `then(op)`. Its tail never rejects, because `() => {}` cannot throw.

### Q-16 (c): latest-wins counters (Phase 3d)

The fence names one latest-wins idiom. Every edit is synchronous: no await is added or moved. Each `disposed` flag stays separate, because `begin()` after a dispose would revive what a permanent flag refuses.

| site | today | after |
|---|---|---|
| `apps/extension/src/composables/useEntityCrud.ts:77-100` | `mySeq = ++seq`; `disposed \|\| mySeq !== seq` at `:92`, `:96`; `!disposed && mySeq === seq` at `:100` | `isCurrent = fence.begin()`; the same three checks, with `disposed` kept; the comment at `:83` is rewritten for the fence |
| `apps/extension/src/composables/useIncomingTransfers.ts:74-79,104` | `readRows(s, ++refreshSeq, scopeKey(s), deleted)`; `isStale(seq, key)` | `readRows(s, fence.begin(), scopeKey(s), deleted)` (argument order kept); `isStale(isCurrent, key)` keeps `disposed \|\| … \|\| scopeKey(scope()) !== key` in today's order; the `:74-75` comment is rewritten |
| `apps/extension/src/composables/useLegalAcceptance.ts:16-52` | `seq++` in `onChanged` and `dispose`; `mine = ++seq` in `refresh` | `invalidate()`, `invalidate()`, and `const mine = fence.begin()`. The closure is named `mine` because `isCurrent` is already a `computed` at `:14` |
| `apps/extension/src/composables/useSeedStatus.ts:56,89-90,133` | `current = ++generation`; `isLatest = () => !disposed && current === generation`; `generation += 1` on dispose | `begin()`; `!disposed && isCurrent()`; `invalidate()` |
| `apps/extension/src/composables/useIncomingSyncHealth.ts:50-51,70,94,99,116,124,134` | `generation` (refresh, dispose) and `retryGeneration` (`enterScope` bump, `retry` begin) | two fences with the same mapping; `enterScope` still runs before the retry's `begin()` |
| `apps/extension/src/composables/usePrestoStatus.ts:16,20,30` | `mine = ++generation`; `disposed \|\| mine !== generation` | `begin()`; `disposed \|\| !isCurrent()` |
| `apps/extension/src/composables/usePinnedTokens.ts:169,194,202` | `generation = ++refreshGeneration`; `disposed \|\| generation !== refreshGeneration \|\| …profileId !== …` | `begin()`; the same three-clause check, in order |

### Q-15 (e): record guards (Phase 3e)

Each site keeps its meaning:

- **Strict sites, which move to `isRecord`:**
  - `packages/wallet-bridge/src/capability-negotiation.ts:134-136`, the strict copy recon found at `dispatcher.ts:313`, which #766 moved here. It is tested through `dispatcher.test.ts`.
  - `packages/wallet-bridge/src/method-scope-checkers.ts:385-387`.
  - `packages/wallet-bridge/src/method-descriptors.ts:118` (`isPlainRecord`).
  - `apps/extension/src/composables/usePinnedTokens.ts:24`.
  - `apps/extension/src/wallet/services/incoming-transfer/scan-episodes.ts:32`.
  - `apps/extension/src/popup/components/modules/send/fee-send-selection.ts:14-15`. `asObject` stays as a wrapper.
- **Permissive sites, which move to `isObjectLike`:**
  - `packages/wallet-bridge/src/dispatcher.ts:210` (`isObj` in `assertAuthRelevantArgShape`, dApp-facing).
  - `apps/extension/src/popup/windows/capabilities/details-table.ts:88-90` and `permission-rows.ts:253-255`. Both are named `isRecord` today, but they accept arrays.
- **Kept local:**
  - `dapp-session/spec.ts:69` `tolerantRecord` and `transaction/spec.ts:168` `tolerantObject`. Both are documented as deliberately tolerant, and both return a boolean into `z.custom`.
  - `packages/legal/src/status.ts:66-70` `isPlainObject`. It is stricter (a prototype check), and `@nulo/legal` does not depend on wallet-core.

### What stays inline, and why

| site | why |
|---|---|
| `packages/extension-messaging/src/core/base-client.ts:284-301`, `packages/aztec-runtime/src/pxe/opfs-store.ts:124-170` | a shared race helper would move each site's clear into a separate reaction ahead of the caller. At OPFS that reorders cleanup from quarantine-or-release, then clear, then the outer catch, to clear first (see Deferred) |
| `stores/balances.store.ts:124-139` `withTimeout` | it rejects from inside the timer, so its timeout path resumes one hop sooner than a race |
| `popup/auth-guard.ts:83-90` `withinDeadline`, `components/Header.vue:34-44` `readForLock` | `.finally(clear)` costs extra, engine-dependent hops (+1 on Bun, +3 on V8); Header also resolves a sentinel. `auth-guard.ts:66`'s `sleep` still moves |
| `composables/importPreflight.ts:41-47`, `importChainSync.ts:115` | they race a `sleep` that is never cleared; clearing it is not pre-cleared |
| `wallet/utils/offscreen.ts:333` | it races two gate promises, and its timer lives elsewhere |
| `composables/usePinnedTokens.ts:88-100` | a per-key queue map whose tail adds a `.then` hop for idle eviction |
| `popup/pages/settings/security/export/account.vue:59-213`, `export/full.vue:72-416`, `settings/accounts/import.vue:44-168`, and the download twins `account.vue:182-198` / `full.vue:370-392` | kept by the panel (Ask 1) |

**Alternatives rejected:**

- `withTimeout`'s shape as a shared helper: it would move the timeout path at every other site.
- `useDownloadAction`: the twins differ in five places.
- Moving `createRunFence` into wallet-core: it has no consumer outside the extension.
- `Lock`/`KeyedLock` for the queues: `withLock` is `async` and costs extra hops.

### The seam with byte-primitives (arc 16)

- **This arc defines** `isRecord` and `isObjectLike` and migrates every Q-15 (e) site.
- **byte-primitives defines** the lenient base64 decoder and the hex decoder, beside their consumers. It migrates every Q-15 (a to d) site except the two `wallet-crypto` secret boxes; that includes `export/full.vue:348`. Row 15 of the program table says so (Ask 2).
- **No new helper is needed for (a), (c) or (d).**
- **Shared files:** `packages/wallet-core/src/utils/index.ts` and its README, one line each.

### Complexity

Every touched function gets shorter or stays the same length. None is in the complexity manifest.

### Coupling with neighbouring arcs

- `wip/hd-09-network-endpoints` adds `rpc-url` to `utils/index.ts` and to the wallet-core README. Restack conflict: keep both sides.
- No other built-ahead arc (3, 4, 8 to 10, 12 to 14) touches these files.
- balance-snapshot (arc 21) edits `balances.store.ts`, which this arc leaves alone.

## Security & Adversarial Considerations

- **dApp input** (`dispatcher.ts:210`, `capability-negotiation.ts`, `method-scope-checkers.ts`, `method-descriptors.ts`). A compromised page controls the arguments and the capability manifests. Swapping strict and permissive changes which malformed request is refused, and with what message. Phase 1 pins exactly `Malformed sendTx request: exec.calls must be an array` for `exec: []`, which the strict guard would turn into `exec payload must be an object`. Where no input distinguishes the two guards, the mutant is recorded as equivalent.
- **Storage reads** (`usePinnedTokens`, `scan-episodes`, `fee-send-selection`). Storage is writable by anything that reaches the profile directory, and a backup import writes it too. These sites keep the strict guard, so an array blob still reads as absent.
- **Write queues guard against resurrection.** A tombstone, a cleared Send pick or a purged log overtaken by an older write would bring data back. Each site's serialization, continuation past a rejection and policy are pinned. Propagate swapped for report would tell `mutateSendSelections`' caller that a failed write succeeded. Report swapped for propagate would surface failures to callers that never handle them.
- **Fences guard scope privacy.** A stale read landing late would show one profile's incoming transfers, pins or seed status under another. Every check stays at its line, after the same await, with `disposed` and the scope comparison intact.
- **Deadlines** are untouched.
- **Logging:** no new log line. The `onError` callbacks are today's calls.
- **npm surface:** `wallet-crypto/src/public.ts` is unchanged. Its bundle inlines `@nulo/wallet-core/utils` (`encryption-key.ts:2`), so the staged package is compared parent against head: the same inventory and every file's sha256.
- **Secret pages:** untouched.

## Assumptions

**Facts** (read 2026-10-03 on `harden-dedupe` at `1c0c67ad`):

1. Every site and line above, as read today. `runFence.ts` has only `begin()`. No `guards.ts` or `serial.ts` exists, and no workspace exports these names.
2. **Probe 1** (scratch, Bun 1.4.2 and Node 24.21.0) timed the caller's resume:
   - An inline `await Promise.race` and a race-returning helper both resume at the same hop.
   - `.finally(clear)` costs +1 hop on Bun and +3 on V8.
   - A direct reject from the timer resumes one hop before a race.
   - The audit's extended probe found that the helper's clear runs before the caller's cleanup, which is why the deadline helper is deferred.
3. **Probe 2** (same engines) ran the seven queue shapes against the helper over resolve, reject, synchronous throw, a rethrowing reporter and the ops after it: the event logs are identical. Both audit legs reproduced this; Opus's run interleaved two noise chains.
4. `ScanEpisodeStore`'s reporter is an arrow (`incoming-transfer/service.ts:258`).
5. `scripts/publish/approved-digests.json` binds the `0.1.0` wallet-crypto tarball by sha256.
6. Every migrated composable and service has a colocated test file, except `system-clock.ts`. No test names `realSleep`.

**Inferences:**

- SpiderMonkey was not probed. The queue relies only on `then` and `catch`, whose job counts the spec fixes (moderate-high confidence).

**Asks:** all three were answered by the panel (Plan audit, below).

## Phases

### Phase 1: pin today's behaviour (test only, consumers unchanged)

Every test passes on unchanged code. Each mutant is applied to a scratch copy of the file, the run must turn red, the original is copied back (never `git checkout`), and the result is logged in this arc's file under the program's `lessons/`.

- **Sleeps:** each delay is pinned under fake timers: the 250/500/750 backoff, `50 * 2 ** attempt`, the failed-leg retry delay, the preflight backoff, and `SystemClock.sleep` (new `system-clock.test.ts`).
  - Mutants: a delay off by 1 ms.
- **Queues, per site:**
  - op 2 starts only after op 1 settles: an ordered call log;
  - a rejecting op does not wedge the next;
  - the caller sees the rejection (propagate) or a resolution (report);
  - the reporter is called once, with the error;
  - `settled()` resolves after the last write, and `hydrate`'s write-back lands before it resolves;
  - an older `trackedClose` link does not null a newer `pendingClose`.
  - Mutants: `tail = link` in a propagate site; `.catch` dropped in a report site; no chaining.
- **Fences, per composable:** a superseded read resolving late writes nothing; a read after `dispose` writes nothing.
  - `useLegalAcceptance`: an event during a read wins, and a read after `dispose` writes nothing (it has no `disposed` flag, so its dispose bump is a real guard).
  - `useIncomingSyncHealth`: a scope change mid-retry leaves `retrying` to the new scope.
  - `useEntityCrud`: only the latest run clears `isLoading`.
  - Mutants: each check deleted; each bump removed. The dispose bumps at `useSeedStatus.ts:133` and `useIncomingSyncHealth.ts:134` are **equivalent mutants**: `disposed` guards the same reads. Both safeguards stay, and `invalidate()` gets its own test.
- **Guards, per site:** an observable array refusal at strict sites and an observable acceptance at permissive sites (the exact `exec: []` message; `capability-negotiation` through `dispatcher.test.ts`). Any other site is recorded as equivalent.
- **Temporary site fingerprints:** a capped spinner stamps four queue sites: `ScanEpisodeStore.hydrate`, `trackedClose` to `pendingClose` being nulled, the logger purge, and a guarded activation. It fails explicitly on exhaustion and stops in `finally`, and the counts are logged.

### Phase 2: the helpers (additions only)

- `serial.ts`, `guards.ts`, the `sleep` type, `runFence.invalidate()`, the `index.ts` exports and the README rows.
- `serial.test.ts`:
  - **Permanent:**
    - one reference graph per policy against the helper, including awaiting `tail`;
    - `run(op) === queue.tail` in report mode;
    - `tail` identity stable between enqueues and live across them;
    - a throwing `onError` skips the next op;
    - spinners that fail on exhaustion and stop in `finally`.
  - **Temporary:** the seven-shape matrix, logged and then collapsed in 3g.
- `guards.test.ts` covers plain, null-prototype and class objects, boxed primitives (`Object(1)`, `new String("")`; accepted by both guards), arrays, `null`, `undefined`, functions and primitives.
- Mutants: `then(op, op)` in report mode; a propagate tail without `noop`; `tail` as a plain property.

### Phase 3: migrate (Phase 1 and 2 test files frozen)

- **3a:** the `sleep` copies.
- **3c:** the queues, trimming the narration the helper now owns (`guarded-network-activation.ts:45-46`, the `fee-send-selection.ts:77` doc), with each site's why kept.
- **3d:** the fences, with the stale comments rewritten.
- **3e:** the guards.
- **3f:** moved to arc 15b, logsviewer-timer.
- **3g (test only):** remove the temporary fingerprints and collapse the seven-shape matrix, after logging their green results.

**Validation gate (after each phase):**

- **Commands:**
  - each touched workspace's tests;
  - `bun run lint`, `typecheck:all`, `test:all`, `test:ci-gating` and `audit:vue`;
  - `bun run build`, then `git diff` on the auto-import files, which may lose only `realSleep`;
  - `bun scripts/publish/stage.ts wallet-crypto --version 0.1.0 --out <scratch>` at the parent and at the head, with the same toolchain: identical relative file inventories and an identical sha256 for every file, the manifest and declarations included.
- **Screenshots:** § UI impact.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, with the adversarial, assumption-attack and implementation-critique asks, the hop and cleanup-order question per site, and the no-over-engineering and comment-quality rules verbatim (the error-registry plan's wording). An Opus panelist reviews in parallel.
2. **Fix loop:** at most 5 rounds, each logged in this arc's lessons file.
3. **Delivery:** push, open a ready PR against `harden-dedupe` at the bottom of the gh stack, add both e2e labels, and squash-merge once the gates are green on suites that actually ran.
4. **Close-out:** with the program plan.

## Delivery

One arc, `hd/15-async-primitives`, stacked on `harden-dedupe`. Code review: off.

## UI impact

**Logic only.** No `.vue` file changes. The logger store's queue moves, so the zero-diff gate still covers the logger window (`popup/windows/logger/`), with a fixed log set so the parent and the head render identical lines. The build stubs the viewer's two ports (`log-viewer.getLogs`, `config.getValue`) rather than seeding `nulo:logs`: the window has no testids to click, so each state is reached by its data.

- three states: loaded, with Debug Mode on, and empty (what Clear logs leaves);
- Chrome and Firefox, dark and light;
- a `--stability` run as well;
- new surface files only.

Nothing else a user sees changes.

## Drift kept as today (routed to follow-ups)

Nothing here is user-visible, so these items go to follow-ups, not the alignment arc:

- `importPreflight.ts:41-47` and `importChainSync.ts:115` leave their race's timer running.
- `balances.store.ts:124` `withTimeout` lives in a store and settles a timeout one hop before a race.
- `auth-guard.ts:83-90` and `Header.vue:34-44` clear through `.finally`.
- `full.vue:385` reads `err.message`, where `account.vue:192` reads `err?.message`. The `null` rejection that would hit it is unrealistic, so it gets one ledger line.
- Test-infrastructure `sleep` copies: `apps/extension/src/e2e/migration-fixture.ts:41` and `wallet/services/wallet-sdk/test-ports.ts:17`.

## Deferred

- **`raceDeadline`, the shared deadline race.**
  - Codex: the helper's `race.then(clear, clear)` reaction reorders cleanup on both engines. At OPFS the order goes from quarantine-or-release, clear, outer catch to clear, quarantine-or-release, outer catch, and at base-client the clear moves into its own reaction. Under the program's cleanup-order rule, that is a blocker.
  - Opus: no macrotask can run between the two reactions, so clearing earlier cannot be observed.
  - Call: Codex. Its only other consumer would be LogsViewer, so the helper does not pay for itself. All three sites stay inline, and LogsViewer gets its clear inline, in arc 15b. A follow-up when the program closes.

## Decisions (delegated)

### Plan audit: Codex (GPT-6 Astra, xhigh), REVISE, high confidence

1. **Blocker: `raceDeadline` reorders cleanup** (extended probe, Bun and V8). **Adopted:** dropped, see Deferred.
2. **The queue's `tail` must be a live getter**, with `run(op) === tail` asserted in report mode. **Adopted:** a plain property breaks `hydrate`.
3. **Precise return types per policy.** **Adopted:** overloads.
4. **Equivalent mutants** for the two dispose bumps guarded by `disposed`. **Adopted:** classified as equivalent; `invalidate()` tested on its own.
5. **Exact `exec: []` message pin.** **Adopted:** today's tests match only broader text.
6. **npm gate compares inventories and every file**, not only the bundle. **Adopted.**
7. **Nit: Ask 1 wording.** **Adopted.**
8. **Nit: test homes** (`capability-negotiation` via `dispatcher.test.ts`, a new `system-clock.test.ts`). **Adopted.**
9. **Asks:** 1 keep; 2 decoders to byte-primitives; 3 as Opus.

### Plan audit: Opus panelist, REVISE, no blocker

1. **The `raceDeadline` reorder is unobservable** (no macrotask runs between reactions). **Rejected** in favour of the conservative rule; recorded under Deferred.
2. **Two interleaved noise chains** reproduce the seven queue traces on both engines. **Adopted** as evidence (Fact 3).
3. **Name clash:** `useLegalAcceptance.ts:14` already declares `isCurrent`. **Adopted:** the closure is `mine`.
4. **A Decisions entry for route 2** (program plan, the Behaviour rule). **Adopted**, in arc 15b's plan.
5. **Deterministic logger screenshots** via seeded `nulo:logs`. **Adopted.**
6. **Guards:** boxed-primitive rows; `isObjectLike` typed `value is Record<string, unknown>`. **Adopted.**
7. **Comments:** rewrite the stale ones at `useEntityCrud.ts:83` and `useIncomingTransfers.ts:74-75`; trim the narration the queue now owns; TSDoc for both policies and the throwing `onError`; say "promise hop", not "tick"; one line on `Lock`; README rows. **Adopted.**
8. **Ask 1:** keep. The fence migration is justified as one named latest-wins idiom in synchronous edits, not by line count. **Adopted.**
9. **Ask 2:** the decoders go to byte-primitives; amend program row 15. **Adopted.**
10. **Ask 3:** two permanent reference graphs plus the behavioural pins; the seven-shape matrix is migration evidence, logged and collapsed. **Adopted.**

### Route 2: the LogsViewer timer clear

Split into arc 15b, logsviewer-timer, whose Decisions carry the route-2 entry: the program plan puts a route-2 fix in its own arc.
