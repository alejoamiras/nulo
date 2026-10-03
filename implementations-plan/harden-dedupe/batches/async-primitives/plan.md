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

# async-primitives: one deadline race, one serial queue, one run fence, one record guard

Finding Q-16 and the record-guard half of Q-15 (part e), from `audit/quality/2026-09-30-dedup-high/`. The wallet hand-rolls the same four async idioms (deadline race, `sleep`, promise-chain queue, latest-wins counter) and two meanings of "is a record", in about forty places. This batch gives each idiom one definition and moves only the sites whose promise graph the helper reproduces exactly. A site whose awaits, ticks, timers or rejection policy differ stays inline and is listed. The one intended behaviour change is the program's pre-cleared LogsViewer timer clear, in its own commit with a red-then-green test.

## Outcome & Quality Bar

- **For whom:** the next person who writes a timeout, a write queue or a stale-result check. Today each copy chooses its own timer cleanup, loser handling and rejection policy, and those choices already disagree.
- **Excellent:**
  - Every migrated site awaits the same promise graph as today. Permanent helper tests run each site's inline shape, copied verbatim, against the helper under a bounded microtask spinner, on the resolve, reject, synchronous-throw, timeout and throwing-reporter paths. A single added or removed tick fails them.
  - Each site keeps its guard set (below), and Phase 1 tests turn red on every listed mutant.
  - No error object, message, timer delay, clear point, rejection policy, write order or emit changes, on any engine.
  - The published `@alejoamiras/nulo-wallet-crypto` bundle is byte-identical.
- **Good enough:** the sites whose shapes differ keep their own code (§ What stays inline). This is a dedup arc: aligning them is behaviour change.

## Architecture & Implementation

Read on `harden-dedupe` at `1c0c67ad`. "Tick" means one microtask job, as counted by the spinner. Probe evidence is in Assumptions.

### The helpers (Phase 2, no consumer edits)

All of them go in `packages/wallet-core/src/utils/`, exported from `index.ts`, except the fence, which stays in `apps/extension/src/composables/runFence.ts`. The fence is auto-imported and has no consumer outside the extension.

1. **`raceDeadline(work, ms, reason)`**, in `deadline.ts`. It builds `expiry = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(reason()), ms) })` and `race = Promise.race([work, expiry])`, attaches `race.then(clear, clear)`, and **returns `race` itself**: it is a plain function, never `async`. Awaiting it is therefore awaiting `Promise.race` inline. The clear reaction is registered before the caller's, so both jobs are enqueued by the same settlement, back to back, and the caller resumes at the same spinner count (probe 1). `reason` runs only inside the timer callback, as each site's expression does today. `work` is not cancelled.
2. **`createSerialQueue(policy?)`**, in `serial.ts`. It returns `{ run(op), tail }`, and passes `op` straight to `then` as the sites do.
   - No policy (*propagate*): `link = tail.then(op); tail = link.then(noop, noop); return link`. The caller sees `op`'s outcome, and the chain continues past a rejection.
   - `{ onError }` (*report*): `link = tail.then(op).catch(onError); tail = link; return link`. The link never rejects unless `onError` throws, and in that case the next `op` is skipped and `onError` sees the rethrow, exactly as `scan-episodes` and `price` behave today.
   - A policy object, not a flag, per the program's complexity rule.
3. **`isRecord`** (non-null, non-array object) and **`isObjectLike`** (non-null object, arrays included), in `guards.ts`. Both are total: the only input that throws is a revoked `Proxy` reaching `Array.isArray`, and neither storage nor a port can carry one. Moving the expression therefore changes no native error text.
4. **`sleep`** (`sleep.ts:1`): the runtime is unchanged; the return type narrows to `Promise<void>`, so `SystemClock` can return it as its port requires. `new Promise<void>((resolve) => setTimeout(resolve, ms))`.
5. **`RunFence.invalidate()`**: `generation++`, for the sites that bump a counter without starting a run. `current()` is added only if the panel adopts Ask 1.

### Q-16 (a): deadline races

| site | today | after | timers, ticks, errors |
|---|---|---|---|
| `packages/extension-messaging/src/core/base-client.ts:284-301` `awaitReadyWithinDeadline` | the `remainingMs <= 0` precheck; `new Promise<never>` timer; `await Promise.race([ready, timeout])`; `finally` clear | the precheck stays; `await raceDeadline(ready, remainingMs, () => this.makeTimeoutError({ requestId, methodName, timeoutMs }))`; `try/finally` removed | same awaited promise; the clear moves from the caller's resume job to the job just before it; the same lazily built timeout error |
| `packages/aztec-runtime/src/pxe/opfs-store.ts:124-135`, clear at `:168-170` | `store = await Promise.race([openPromise, expiry])` inside `try/catch/finally` | `store = await raceDeadline(openPromise, OPEN_TIMEOUT_MS, () => new ChainStoreOpenTimeoutError(…same text…))`; the `finally` (clear only) and `let timer` are removed; `catch` is unchanged | the timer is armed at the same point (after `inFlightOpens.set`); the quarantine `instanceof` sees the same class; cleared on resolve and on reject |
| `apps/extension/src/components/JsonViewer/LogsViewer.vue:189-200` `fetchLogs` | an uncleared 500 ms timer that rejects with the string `"Logs fetch timeout"` | `await raceDeadline(fetch, 500, () => "Logs fetch timeout")`; `return await fetch` stays | **the pre-cleared fix:** the timer is now cleared on settle. Same ticks and same caught reason. Commit 3f, red-then-green |

### Q-16 (a): `sleep` copies (Phase 3a)

Each one is `new Promise((r) => setTimeout(r, ms))`, and each becomes `sleep(ms)` from `@nulo/wallet-core/utils`. That is the same expression returned by a non-async arrow, so the awaited promise and the timer are identical. `sleep` reads the global `setTimeout` at call time, so vitest fake timers patch it exactly as they patch the inline copy.

- `apps/extension/src/popup/auth-guard.ts:66`
- `apps/extension/src/stores/app.store.ts:648`
- `apps/extension/src/wallet/services/execution/gas-balance-reader.ts:227` (the `?? GAS_BALANCE_FAILED_LEG_RETRY_DELAY_MS` operand is evaluated in place)
- `apps/extension/src/core/adapters/system-clock.ts:13-15` (`return sleep(ms)`)
- `apps/extension/src/composables/importPreflight.ts:31` `realSleep`, used at `:46` and `:61`, and imported by `importChainSync.ts:26` for its use at `:115`. `realSleep` is deleted, both files import `sleep`, and its auto-import lines leave `src/types/auto-imports.d.ts` and `.eslintrc-auto-import.json` (rebuilt under Vite; a stale line is deleted by hand, per lessons). No test names `realSleep`.

### Q-16 (b): serial queues (Phase 3c)

The probe ran all seven inline shapes and the helper over resolve, reject, synchronous throw and throwing-reporter scripts: the event logs match, on Bun and V8 (probe 2).

| site | today | policy | guard set kept |
|---|---|---|---|
| `apps/extension/src/popup/components/modules/send/fee-send-selection.ts:75-82` | `link = chain.then(step, step); chain = link.catch(() => undefined)` | propagate | one module-scoped chain; read-modify-write never interleaves; a rejected write reaches its caller; later writes still run; `clearSendSelections` rides the same chain |
| `apps/extension/src/utils/guarded-network-activation.ts:18,44-51` | `run = tail.then(() => runActivation(…)); tail = run.then(u, u)` | propagate | `enqueuedProfileId` still captured synchronously before enqueue; activations run to completion one at a time |
| `apps/extension/src/wallet/services/token/seeder.ts:168,312-318` `withMarkerLock` | `run = markerLock.then(fn); markerLock = run.then(u, u)` | propagate | every marker read-modify-write is serialized; the epoch check stays inside `fn` |
| `apps/extension/src/wallet/logger/store.ts:20,128-131` `enqueueStorageOp` | `next = storageOps.then(op, op).catch(() => {})` | report, `onError: () => {}` | total order of `set`/`remove`; the purge at `:160` still returns the swallowed link |
| `apps/extension/src/wallet/utils/offscreen.ts:128-138` `trackedClose` | `link = closeTail.then(() => closeOffscreen()).catch(() => {})` | report, `onError: () => {}` | `pendingClose = link` and the identity-guarded `finally` that nulls it are unchanged; `:300` still awaits it |
| `apps/extension/src/wallet/services/incoming-transfer/scan-episodes.ts:60,89,160,176` | `writeChain = writeChain.then(write).catch((e) => this.onPersistError(e))` | report, `onError: (e) => this.onPersistError(e)` | `hydrate` awaits and `settled()` returns `tail`, the same promise object; the snapshot is still taken at mutation time |
| `apps/extension/src/wallet/services/price/service.ts:104,231-248` `configTransition` | `.then(async () => {…}).catch((err) => this.log(LogLevel.Warn, "config-change handling failed", err))` | report, the same `log` call | the synchronous abort and generation bump stay outside the chain; the async body moves verbatim |

The propagate tails differ only in value (`link.catch(() => undefined)` against `run.then(u, u)`); both cost one job and neither is read.

### Q-16 (c): latest-wins counters (Phase 3d)

Every edit here is synchronous: a counter becomes a fence with no await added or moved. Each `disposed` flag stays separate, because `begin()` after a dispose would revive what a permanent flag refuses.

| site | today | after |
|---|---|---|
| `apps/extension/src/composables/useEntityCrud.ts:77-100` | `mySeq = ++seq`; `disposed \|\| mySeq !== seq` at `:92`, `:96`; `!disposed && mySeq === seq` at `:100` | `isCurrent = fence.begin()`; the same three checks, with `disposed` kept and `isCurrent()` in place of the comparison |
| `apps/extension/src/composables/useIncomingTransfers.ts:76-79,104` | `readRows(s, ++refreshSeq, scopeKey(s), deleted)`; `isStale(seq, key)` | `readRows(s, fence.begin(), scopeKey(s), deleted)` (argument order kept); `isStale(isCurrent, key)` keeps `disposed \|\| … \|\| scopeKey(scope()) !== key` in today's order |
| `apps/extension/src/composables/useLegalAcceptance.ts:16-52` | `seq++` in `onChanged` and `dispose`; `mine = ++seq` in `refresh` | `invalidate()`, `invalidate()`, `begin()` |
| `apps/extension/src/composables/useSeedStatus.ts:56,89-90,133` | `current = ++generation`; `isLatest = () => !disposed && current === generation`; `generation += 1` on dispose | `begin()`; `!disposed && isCurrent()`; `invalidate()` |
| `apps/extension/src/composables/useIncomingSyncHealth.ts:50-51,70,94,99,116,124,134` | two counters: `generation` (refresh, dispose) and `retryGeneration` (`enterScope` bump, `retry` begin) | two fences, the same mapping; `enterScope` still runs before the retry's `begin()` |
| `apps/extension/src/composables/usePrestoStatus.ts:16,20,30` | `mine = ++generation`; `disposed \|\| mine !== generation` | `begin()`; `disposed \|\| !isCurrent()` |
| `apps/extension/src/composables/usePinnedTokens.ts:169,194,202` | `generation = ++refreshGeneration`; `disposed \|\| generation !== refreshGeneration \|\| …profileId !== …` | `begin()`; the same three-clause check in order |

### Q-15 (e): record guards (Phase 3e)

The guard set per site is its meaning, and each keeps its own meaning:

- **Strict sites, which move to `isRecord`:**
  - `packages/wallet-bridge/src/capability-negotiation.ts:134-136`. This is the strict copy recon found at `dispatcher.ts:313`; #766 moved it here.
  - `packages/wallet-bridge/src/method-scope-checkers.ts:385-387`.
  - `packages/wallet-bridge/src/method-descriptors.ts:118` (`isPlainRecord`).
  - `apps/extension/src/composables/usePinnedTokens.ts:24`.
  - `apps/extension/src/wallet/services/incoming-transfer/scan-episodes.ts:32`.
  - `apps/extension/src/popup/components/modules/send/fee-send-selection.ts:14-15`. `asObject` stays as a wrapper: `isRecord(value) ? (value as Blob) : undefined`.
- **Permissive sites, which move to `isObjectLike`:**
  - `packages/wallet-bridge/src/dispatcher.ts:210` (`isObj` in `assertAuthRelevantArgShape`, dApp-facing).
  - `apps/extension/src/popup/windows/capabilities/details-table.ts:88-90` and `permission-rows.ts:253-255`. Both are named `isRecord` today but accept arrays.
- **Kept local:**
  - `dapp-session/spec.ts:69` `tolerantRecord` and `transaction/spec.ts:168` `tolerantObject`. Both are documented as deliberately tolerant, and they return a boolean into `z.custom`.
  - `packages/legal/src/status.ts:66-70` `isPlainObject`. It is stricter (a prototype check), and `@nulo/legal` does not depend on wallet-core.

### What stays inline, and why

| site | why |
|---|---|
| `stores/balances.store.ts:124-139` `withTimeout` (callers `:495`, `:506`, `:546`) | it rejects from inside the timer, so its timeout path resumes the caller one tick sooner than a race (probe 1). The race helper would add a tick before `commitEntry`; a second, near-identical helper would duplicate the very idiom this batch removes |
| `popup/auth-guard.ts:83-90` `withinDeadline`; `components/Header.vue:34-44` `readForLock` | `.finally(clear)` costs extra ticks, and engine-dependent ones (+1 on Bun, +3 on V8; probe 1). Header also resolves a sentinel instead of rejecting. The `sleep` at `auth-guard.ts:66` still moves |
| `composables/importPreflight.ts:41-47`, `importChainSync.ts:115` | they race a `sleep` that is never cleared; clearing it is not pre-cleared (drift) |
| `wallet/utils/offscreen.ts:333` | it races two gate promises, and its timer lives elsewhere; not a deadline helper's shape |
| `composables/usePinnedTokens.ts:88-100` | a per-key queue map whose tail adds a `.then` hop for idle eviction |
| `popup/pages/settings/security/export/account.vue:59-213`, `export/full.vue:72-416`, `settings/accounts/import.vue:44-168` (counters), and the download twins `account.vue:182-198` / `full.vue:370-392` | Ask 1 |

**Alternatives rejected:**

- An `async` `raceDeadline` with `try/finally`, the audit's sketch: it costs +1 tick at every caller (probe 1).
- `withTimeout`'s shape as the shared helper: it would move three sites' timeout path by a tick.
- `useDownloadAction`: the twins differ in five places (filename, gzip, labels, `err?.message` against `err.message`, the console text).
- Moving `createRunFence` into wallet-core: it has no consumer outside the extension.

### The seam with byte-primitives (arc 16)

- **This arc defines** `isRecord` and `isObjectLike` and migrates every Q-15 (e) site. It touches no Q-15 (a to d) file.
- **No new helper is needed for (a), (c) or (d):** `toBase64`, `bytesToHex`, `getRandomHex` and `array_equals` already exist.
- **The two lenient decoders** (a lenient base64 decoder for the `Buffer.from(x, "base64")` sites, and a hex decoder for `passkey-ceremony.ts:41`) are defined in byte-primitives, beside their consumers (Ask 2).
- **byte-primitives migrates** every Q-15 (a to d) site, except the two `wallet-crypto` secret boxes, which are deferred. That includes `export/full.vue:348`.
- **The only shared file** is `packages/wallet-core/src/utils/index.ts`: one export line each, so a restack conflict at most.

### Complexity

Every touched function gets shorter or stays the same length. None is in the complexity manifest, and the helpers are a few flat lines each.

### Coupling with neighbouring arcs

- `wip/hd-09-network-endpoints` adds `rpc-url` to `utils/index.ts`: a one-line restack conflict.
- No other built-ahead arc (3, 4, 8 to 10, 12 to 14) touches a file here.
- estimate-reuse (arc 11) may edit `gas-balance-reader.ts`, and balance-snapshot (arc 21) edits `balances.store.ts`, which this arc leaves alone.

## Security & Adversarial Considerations

- **dApp input (`dispatcher.ts:210`, `capability-negotiation.ts`, `method-scope-checkers.ts`, `method-descriptors.ts`).** A compromised page controls the arguments and the capability manifests. Swapping strict and permissive would change which malformed request is refused, and with what message. For `exec: []`, the permissive guard yields `Malformed … request: exec.calls must be an array`, and the strict one would yield `exec payload must be an object`. Phase 1 pins each distinguishing input; where no input distinguishes the two guards at a site, the plan says so and the mutant is equivalent.
- **Storage reads (`usePinnedTokens`, `scan-episodes`, `fee-send-selection`).** Storage is writable by anything that reaches the profile directory, and a backup import writes it too. These sites keep the strict guard, so an array blob still reads as absent.
- **Write queues guard against resurrection.** If a seeder tombstone, a cleared Send pick or a purged log could be overtaken by an older write, deleted data would come back. Serialization, continuation past a rejection, and each site's policy are pinned per site. Propagate swapped for report would tell `mutateSendSelections`' caller that a failed write succeeded. Report swapped for propagate would surface the logger's and the offscreen closer's failures to callers that never handle them.
- **Fences guard scope privacy.** A stale read landing late would show one profile's incoming transfers, pins or seed status under another. Every check stays at its line, after the same await, with `disposed` and the scope comparison intact.
- **Deadlines guard availability.** A wedged transport or worker must still fail at the same deadline, with the same error: the base-client timeout code, and the `ChainStoreOpenTimeoutError` that drives the quarantine. The added `race.then(clear, clear)` also marks the race as handled, but every caller awaits it, so no rejection that is reported today goes unreported.
- **Logging:** no new log line. The `onError` callbacks are today's calls, so `log-payload-ban.test.ts` sees the same text.
- **npm surface:** `wallet-crypto/src/public.ts` is unchanged. Its bundle inlines `@nulo/wallet-core/utils` (`encryption-key.ts:2`), so the staged bundle is byte-compared, parent against head (gate).
- **Secret pages:** untouched unless Ask 1 is adopted. If it is, no `return` inside a scrubbing `try` loses its `await`, and the scrub order in `onBeforeUnmount` is kept.

## Assumptions

**Facts** (read 2026-10-03 on `harden-dedupe` at `1c0c67ad`):

1. Every site and line above, as read today. `packages/wallet-core/src/utils/sleep.ts:1` exists. `runFence.ts` has only `begin()` (`:12-20`). No `guards.ts`, `deadline.ts` or `serial.ts` exists, and no workspace exports a name these helpers would take.
2. **Probe 1** (scratch, Bun 1.4.2 and Node 24.21.0) measured the caller's resume tick under a bounded spinner:
   - With work settling after 1 or 3 jobs, the inline `await Promise.race` and `await raceDeadline(...)` both resumed at 4 and 6, on both engines and on both resolve and reject.
   - `.finally(clear)` resumed at 5 and 7 on Bun, and at 7 and 9 on V8.
   - On the timeout path, race and helper both resumed 3 jobs after the timer fired; a direct reject from the timer, as `withTimeout` does, resumed after 2.
3. **Probe 2** (same engines) ran the seven queue shapes and `createSerialQueue` over six ops: resolve, reject, synchronous throw, a reporter that rethrows, and the ops after it. The stamped event logs were identical.
4. `ScanEpisodeStore`'s reporter is an arrow (`incoming-transfer/service.ts:258`), and `price`'s is `this.log(...)` in an arrow.
5. `scripts/publish/approved-digests.json` binds the `0.1.0` wallet-crypto tarball by sha256.
6. Every migrated composable and service already has a colocated test file. `LogsViewer.vue` has none, and no test names `realSleep`.

**Inferences:**

- SpiderMonkey was not probed. The helper relies only on `Promise.race`, `then` and `await` of a native promise, whose job counts the spec fixes; the V8/JSC split appears only on `.finally`, which the helper avoids. Phase 2 reruns probe 1 in a Firefox page (moderate-high confidence).
- No in-tree code reads a stack frame of these errors. A moved `reason()` changes only stack text.

**Asks** (to the panel):

1. **The secret pages' counters and the download twins: keep or migrate?** Recommendation: keep.
   - Migrating means `fence.current()` plus `invalidate()`, script-only across three `.vue` files. It removes no line and no defect: `const gen = generation` becomes `const isCurrent = fence.current()`. It adds those pages to the screenshot gate in all their states.
   - The twins differ in five places, and `full.vue`'s `err.message` throws on a `null` rejection.
2. **The lenient decoders: defined in byte-primitives, not here?** Recommendation: yes.
   - Their exactness proof is the core of that arc.
   - Vitest runs on Bun's native `Buffer`, while the bundle ships the `buffer` polyfill (`vite-plugin-node-polyfills`). Which one is the oracle is a byte-primitives decision.
   - A helper with no consumer here could only be tested against a guess.
3. **Fingerprint permanence.** Recommendation:
   - The helper-against-inline-shape tests stay permanently. They compare relative stamps, not counts, and they are what stops a later `async` rewrite of `raceDeadline`.
   - The four site fingerprints of Phase 1 are temporary, as in arc 14: logged, then removed.

## Phases

### Phase 1: pin today's behaviour (test only, consumers unchanged)

The tests extend each site's colocated test file, and every one passes on unchanged code. Each mutant is applied to a scratch copy of the file, never undone with `git checkout`; the run must turn red, and the result is logged in this arc's file under the program's `lessons/`.

- **Deadlines:**
  - `base-client`: a request with a pending `ready` rejects at the deadline with the timeout error's literal code and message; `ready` resolving first sends, and `vi.getTimerCount()` returns to its baseline; a `ready` rejection reaches the caller by identity; an expired budget rejects before any timer.
    - Mutants: precheck removed; clear removed; the error built eagerly; the factory swapped.
  - `opfs-store-open`: the existing quarantine tests, plus the timer count back at baseline after a normal open and after a rejected one.
    - Mutant: clear removed.
- **Sleeps:** the existing fake-timer tests must pin each delay (the 250/500/750 backoff, `50 * 2 ** attempt`, the failed-leg retry delay, the preflight backoff). A delay without a pin gets one.
  - Mutants: the delay off by 1 ms; the `await` dropped.
- **Queues (per site):**
  - op 2 starts only after op 1 settles: an ordered call log, not flags;
  - a rejecting op does not wedge the next;
  - the caller sees the rejection (fee, guarded, seeder) or a resolution (logger, offscreen, scan, price);
  - the reporter is called once, with the error (scan, price);
  - `settled()` resolves after the last write;
  - an older `trackedClose` link settling does not null a newer `pendingClose`.
  - Mutants: `tail = link` in a propagate site; `.catch` dropped from a report site; `run` not chained (`tail` unassigned).
- **Fences (per composable):**
  - a superseded read resolving late writes nothing;
  - a read resolving after `dispose` writes nothing;
  - `useLegalAcceptance`: an `onAcceptanceChanged` during a read wins;
  - `useIncomingSyncHealth`: a scope change mid-retry leaves `retrying` to the new scope;
  - `useEntityCrud`: only the latest run clears `isLoading`.
  - Mutants: each check deleted in turn; a counter bump removed from `dispose`, `onChanged` or `enterScope`.
- **Guards (per site):** for each strict site, an array input that today's code refuses, where one is observable; for each permissive site, one that today's code accepts (the dispatcher's `exec: []` message, verbatim). A site where no input distinguishes the two guards is recorded as an equivalent mutant.
  - Mutant: strict and permissive swapped at each site.
- **Temporary site fingerprints** (Ask 3): a spinner stamps the caller's resumption around four sites:
  - `awaitReadyWithinDeadline` to the transport send;
  - `openChainStore`, from the open resolving to the return, and from the timeout to `entry.state = "abandoned"`;
  - `ScanEpisodeStore.hydrate`'s write to its resume;
  - `trackedClose` to `pendingClose` being nulled.

  Each spinner has a cap, fails explicitly on exhaustion, and is stopped in `finally`. The counts are logged.

### Phase 2: the helpers (additions only)

- The five helpers above, with the `index.ts` exports and the `runFence.ts` method.
- New `deadline.test.ts`, `serial.test.ts` and `guards.test.ts`, plus `invalidate` cases in `runFence.test.ts`:
  - `raceDeadline` against the verbatim inline shape: equal caller stamps on resolve, reject and timeout; the timer count back at baseline after settling; `reason` called once and only on timeout; the rejection object by identity; a late `work` rejection after the timeout raises no unhandled rejection.
  - `createSerialQueue` against all seven inline shapes, copied verbatim from the table, over probe 2's script.
  - `isRecord` and `isObjectLike` against plain, null-prototype and class objects, arrays, `null`, `undefined`, functions, and primitives.
  - Mutants: `raceDeadline` made `async`; the clear moved to `.finally`; the clear dropped; the reason built eagerly; `then(op, op)` in report mode; a missing `noop` tail in propagate mode.
- Probe 1 rerun in a Chrome and a Firefox page, with the results logged.

### Phase 3: migrate (Phase 1 and 2 test files frozen)

One commit each, each green on the frozen tests:

- **3a:** the `sleep` copies, with `realSleep` deleted and the auto-imports rebuilt.
- **3b:** `raceDeadline` in `base-client` and `opfs-store`.
- **3c:** the seven queues.
- **3d:** the seven fences.
- **3e:** the record guards.
- **3f:** LogsViewer, the pre-cleared fix.
  - Its new `LogsViewer.test.ts` mounts the component with the two service clients mocked (and `codemirror`'s `EditorView` stubbed if jsdom cannot host it), lets `getLogs` resolve, and asserts the 500 ms timer was cleared.
  - It is proven red against the parent's `LogsViewer.vue`, a copy taken from the base SHA, and green after.
  - The commit body and the PR body record it under the Behaviour rule's second route.
- **3g (test only):** remove the temporary site fingerprints after logging their green counts.

**Validation gate (after each phase):**

- **Commands:**
  - `bun run --cwd packages/wallet-core test`, `bun run --cwd packages/extension-messaging test`, `bun run --cwd packages/aztec-runtime test src/pxe` and `bun run --cwd packages/wallet-bridge test`;
  - the extension's touched test files three times in a row;
  - `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`, `bun run audit:vue`;
  - `bun run build`, then `git diff` on the two auto-import files, which may lose only the `realSleep` lines;
  - `bun scripts/publish/stage.ts wallet-crypto --version 0.1.0 --out <scratch>` at the parent and at the head: identical sha256 for every staged file.
- **Pass criteria:** all exit 0. Phase 3 leaves every Phase 1 and 2 test file byte-identical, apart from 3g's removals. Phase 3f adds one test file.
- **Screenshots:** § UI impact.
- **Layers:** unit, composition and component tests, plus the e2e lanes in CI per the program gates.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, with the adversarial, assumption-attack and implementation-critique asks, and the tick-shape question asked explicitly per site. Include the no-over-engineering rule verbatim ("Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone.") and the comment-quality rule verbatim ("Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."). An Opus panelist reviews in parallel (MID).
2. **Fix loop:** triage each finding, fix, commit, log the round in this arc's lessons file, and resume the same session. Stop when a round has no material finding; at 5 rounds, park the arc.
3. **Delivery:** push, open a ready PR against `harden-dedupe` at the bottom of the gh stack, then add both e2e labels. The PR body records the LogsViewer fix. Once the program gates are green on suites that actually ran, squash-merge into `harden-dedupe`.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/15-async-primitives`, stacked on `harden-dedupe` once the arcs below it land. Code review: off.

## UI impact

**Not logic-only: one `.vue` file changes.** `LogsViewer.vue`'s script changes (`fetchLogs`); its template and styles do not. The zero-diff screenshot gate covers the logger window (`popup/windows/logger/`), reached through Settings → Advanced → Logs with Developer Mode on. It is captured on Chrome and Firefox, in dark and light theme, in three states: logs loaded (timestamps masked), after Clear logs (empty), and after toggling Debug Mode (refetch). Nothing else a user sees changes. If Ask 1 is adopted, the three secret pages join the gate in every stage: export account (picker, agreed, password, ready, protected, wrong password); full backup (idle, progress, finished, encrypting, encrypted); accounts import (each preview state).

## Drift left for the alignment arc

Nothing below is user-visible on a realistic path, so it all goes to follow-ups, not to the alignment arc:

- `importPreflight.ts:41-47` and `importChainSync.ts:115` leave their race's `sleep` timer running, for up to 5 s and up to the registration budget respectively.
- `balances.store.ts:124` `withTimeout` lives in a Pinia store and settles a timeout one tick before a race would.
- `auth-guard.ts:83-90` and `Header.vue:34-44` clear through `.finally`, at engine-dependent tick cost.
- The download twins: `full.vue:385` reads `err.message`, so a `null` rejection throws inside the catch and skips the toast. That rejection is unrealistic, so it gets one ledger line.
- Test-infrastructure `sleep` copies are left alone: `apps/extension/src/e2e/migration-fixture.ts:41` and `wallet/services/wallet-sdk/test-ports.ts:17`.

## Decisions (delegated)
