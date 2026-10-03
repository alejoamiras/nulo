---
plan: harden-dedupe / balance-snapshot (arc 21 of 25)
tier: mid
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/21-balance-snapshot, stacked on harden-dedupe
---

# balance-snapshot: one token-balance snapshot, one scope predicate, one malformed-row test

Findings Q-12 and the token-row half of Q-27 (f), from `audit/quality/2026-09-30-dedup-high/`.

- Home's hero (`BalanceView`) and Home's list (`TokensView`) each carry the same snapshot state machine: the latest-wins fence, the dirty refetch, one timed retry, first-connect suppression, and the update reducer.
- The Send picker carries a third copy of the scope predicate.
- Three token utilities restate "this row's numbers cannot be trusted".

This arc states each once. No fence is loosened, no watcher changes, and nothing a user sees changes.

## Outcome & Quality Bar

- **For whom:** the next person who changes how a token-balance snapshot retries, reconnects or fences. Today that edit is made twice, and if the copies diverge, the hero and the list disagree for the same account.
- **Excellent:**
  - One composable owns the snapshot run. Each view keeps everything that differs: its add and delete reducers, its scope watcher, its mount sequence and its extra fence.
  - The cross-account guards are pinned at component level before the move, by tests that go red when a guard is removed. That includes the watcher dependency sets, which decide when a scope reset fires, and the read and dependency behaviour of each view's real predicate closure.
  - One scope predicate.
- **Good enough:** the Send picker (`SelectTokenPopup`) shares only the predicate. Its show/hide loader differs from the views' in six ways (§ What stays).

## Architecture & Implementation

Read on `harden-dedupe` at `eb06c37d`; none of these files changed since `2adab99d`. Paths are under `apps/extension/src/`.

### Sites today

- **`popup/components/modules/general/TokensView.vue`** (Home list):
  - refs `tokenBalances` `:78` and `balancesState` `:80`; client and listeners `:190-193`, `fetchDirty` `:196`, `inActiveScope` `:198`;
  - `onBalanceAdded` `:199-209`, whose inline task flags at `:204-208` repeat `withTaskFlags` (`:282-286`);
  - `onBalanceUpdated` `:210-216`, `onBalanceDeleted` `:217-223`, the reconnect counter `:226-231`;
  - `scopeGen` `:266`, `BALANCES_RETRY_MS`, the timer and `fetchGeneration` `:279-281`, and `fetchTokenBalances` `:291-316`;
  - the scope watcher `:357-375`, `onMounted` `:376-389`, `onBeforeUnmount` `:390-402`.
- **`popup/components/modules/general/BalanceView.vue`** (Home hero; `popup/pages/tokens/[id].vue:271` also mounts it for the token hero, where the aggregate snapshot still runs unseen):
  - `tokenBalances` `:59`, `inActiveScope` `:179`, `balancesState` `:183`, `fetchDirty` and `markDirty` `:185-188`;
  - client and listeners `:231-234`, add `:235-239`, update `:240-246`, delete `:247-250`, the reconnect counter `:254-259`;
  - retry and generation `:262-267`, `fetchTokenBalances` `:268-292`, `enterScope` `:295-301`;
  - the watcher `:304-309`, `onMounted` `:326-333`, and `onBeforeUnmount` `:334-346`, with `fetchGeneration++` at `:337`.
- **`popup/components/popups/SelectTokenPopup.vue`** (Send picker): `activeScope` `:65-69`, `inActiveScope` `:70`, handlers `:77-89`, reconnect `:93-97`, `load` `:111-128`, `close` `:130-137`, watchers `:139-148`.
- **Q-27 (f), token half:**
  - `utils/token-order.ts:40-43`: `isUnknownRow(tb)` = `parseRawBalance(tb) === undefined || !isValidDecimals(tb.token.decimals)`.
  - `utils/token-amount.ts:50`, inside `safeFiatOf`: the same expression, with `tb.token?.decimals`.
  - `utils/token-aggregate.ts:19-20`: `raw === undefined || !isValidDecimals(tb.token?.decimals)`, over the `raw` parsed one line above.

### Guard set per site (identical after the change)

| guard | TokensView | BalanceView | SelectTokenPopup |
|---|---|---|---|
| event scope gate | add: `inActiveScope` returns first; update and delete: dirty only if in scope | same | add: `props.show && inActiveScope`; update: `inActiveScope` before replacing; delete: no gate |
| add reducer | mark dirty, then id-dedupe return, then push with task flags | push, then mark dirty; no dedupe | id-dedupe, then push |
| update reducer | replace the first id match, unscoped | same | replace the first id match, in scope only |
| delete reducer | `splice` the first id match when found; dirty first | `filter` reassign, every match, even when none matches; dirty after | `splice` the first match |
| snapshot fence | `scopeGen` captured before `++fetchGeneration`, both checked on reject and resolve | `fetchGeneration` only | `loadGeneration` + `props.show` |
| dirty refetch | yes; checked after the fences, before any write | same | none |
| on reject | `unavailable` unless `loaded`; one timed retry at 2 s; any new run clears the timer | same | `loadError` if shown and current; no retry |
| scope read | address and chain id read once at run start; rows filtered by that chain id, after the fences | same | `{ account, chainId }` captured before the request |
| reconnect | first connect is the mount's; later ones refetch; never reset | same | reset on hide; only while shown |
| watch key | `[profile.id, account.address, network.id]` | `[profile.id, account.address, network.chainId]` | `[account.address, network.chainId]` + `show` |
| on scope change | sync `scopeGen++`, clear rows, `loading`, clear `retriedDefaults`, refresh pins; await tasks; re-check `scopeGen`; fetch | sync `enterScope`: clear rows, `loading`, reset count, restart cap, fetch (generation bumps synchronously) | `load()` clears and refetches |
| unmount | `isUnmounted`, `scopeGen++`, clear timers, remove the connect listener before `disconnect()` | `fetchGeneration++`, clear timers, remove listener before `disconnect()` | hide disconnects |

**Why TokensView needs `scopeGen`.** Its watcher awaits the task snapshot before fetching, so its generation would bump only after that await. Without `scopeGen`, A's in-flight request could land A's rows under B while B's tasks load. BalanceView fetches synchronously inside `enterScope`, so the generation bump fences the old request. Each view keeps exactly the fence it has.

**`fetchDirty` order.** BalanceView clears the flag after reading the address and the chain id; TokensView, and so the common body, clears it before. The two orders are equivalent only because `appStore.account` and `appStore.network` are plain refs (`stores/app.store.ts:38`, `:53`), never getters that could run code that marks the snapshot dirty. A reentrant getter would tell them apart; the store has none.

### What changes

1. **The malformed-row predicate moves to `utils/token-amount.ts` without any added read.**
   - `isUnknownParsedRow(raw, tb)` is `raw === undefined || !isValidDecimals(tb.token?.decimals)`.
   - `isUnknownRow(tb)` is `isUnknownParsedRow(parseRawBalance(tb), tb)` and keeps today's TSDoc.
   - `safeFiatOf` (`:50`) calls `isUnknownRow(tb)`.
   - `aggregateFiat` sets `malformed = isUnknownParsedRow(raw, tb)` over the `raw` it already parsed. Each row's balance properties are read exactly as often as today, and `decimals` is still read only once `raw` parses. That matters because `parseRawBalance` reads properties: a getter row answering `"1"` then `"bad"` would otherwise change the result.
   - `token-order.ts` imports `isUnknownRow` and deletes its copy. Its `tb.token.decimals` (no `?.`) is unreachable: every call there follows `classifyRow`'s dereference of `tb.token.contract` (`:46`) for that row. Nothing else imports `isUnknownRow`.
2. **`isActiveScopeRow(live, tb)`** in `utils/token-order.ts`, beside `forChain`.
   - Its body is today's expression with `appStore` renamed `live`: `tb.account === live.account?.address && tb.token?.chainId === live.network?.chainId`. Same read order, same short-circuit, and the network is never read on an account mismatch.
   - Its TSDoc takes the "the balance service returns a shared address's rows from every chain" comment from the views.
   - The parameter stays `tb`. `live` is the Pinia store, never nullish, so the rename cannot change an engine's error text.
   - Every caller passes `appStore` itself. A built object (`{ account: appStore.account, network: appStore.network }`) would read the network eagerly, and the component tests below fail on that.
3. **`composables/useTokenBalanceSnapshot.ts` (C1).**
   - It receives the parent-owned client, never connects or disconnects it, registers no lifecycle hook (an `onScopeDispose` would run after `onBeforeUnmount`, so after the client's disconnect), and exposes `dispose()`.
   - **Input:** `{ client, live, rows, state, scopeFence?, mapRow? }`. `rows` and `state` are the parent's refs.
   - **Returns:** `{ fetchTokenBalances, markDirty, inActiveScope, onBalanceUpdated, dispose }`, under today's identifiers. The returned `fetchTokenBalances` is the async function itself, not a wrapper.
   - **`fetchTokenBalances(isTimedRetry = false)`** is today's body, in order, with one `await`:
     1. `const inScope = scopeFence?.()`, then `const isCurrent = fence.begin()`;
     2. `clearTimeout`, then `dirty = false`;
     3. read `live.account?.address` and `live.network?.chainId`;
     4. the `!address` branch (synchronous);
     5. `await client.getTokenBalances(undefined, address)`;
     6. on either path, `(inScope && !inScope()) || !isCurrent()` returns first;
     7. on reject: `loaded` survives, and the timed retry (`RETRY_MS = 2_000`) is armed unless this run is the retry;
     8. on resolve: `if (dirty) return fetchTokenBalances()`, and only then `landed = forChain(fetched, chainId)`, `rows.value = mapRow ? landed.map(mapRow) : landed`, `state.value = "loaded"`.

     As built, steps 6 to 8 sit in three synchronous helpers (`superseded`, `settleRejected`, `land`), which keep the function under the complexity budget without changing the order.
   - **`onBalanceUpdated(tb)`:** dirty if in scope, then replace the first id match, unscoped. Both views run this today.
   - **The connect listener** is added when the composable is called. From the second connect on, it refetches.
   - **`dispose()`:** bump the fence (`void fence.begin()`), `clearTimeout`, then remove the connect listener.
4. **`TokensView`:**
   - `let scopeGen = 0` (with its comment) and `withTaskFlags` move above the client, because `mapRow: withTaskFlags` is read at the call.
   - The composable is called right after `new TokenBalanceServiceClient()`, with `scopeFence: () => { const atStart = scopeGen; return () => scopeGen === atStart }`.
   - The listeners register the view's add, the composable's `onBalanceUpdated` and the view's delete, each on its own event.
   - `fetchDirty = true` becomes `markDirty()` at its two sites. The add reducer's inline flags become `withTaskFlags(tb)`: the same spread, keys and reads, in the same order.
   - `onBeforeUnmount` calls `disposeBalances()` where `onConnected.remove` sits today, immediately before `tokenBalanceService.disconnect()`. The retry clear moves from before `taskService.disconnect()` to there.
   - The `forChain` import goes.
5. **`BalanceView`:** the composable is called after the client, with no strategy. `markDirty` and `inActiveScope` come from it. `enterScope` still returns `fetchTokenBalances()`. `disposeBalances()` replaces `onConnected.remove`, before `disconnect()`, and the generation bump moves from before `balanceCount.stop()` to there. The `token-order` import goes.
6. **`SelectTokenPopup`:** `inActiveScope` (`:70`) becomes `(tb) => isActiveScopeRow(appStore, tb)`, with an explicit import. Nothing else changes.
7. **Imports are explicit** (`@/composables/useTokenBalanceSnapshot`, `@/utils/token-order`): component tests get no custom auto-imports. The generated `src/types/auto-imports.d.ts` and `src/types/.eslintrc-auto-import.json` gain the composable, `isActiveScopeRow` and `isUnknownParsedRow`, and move `isUnknownRow` to `token-amount`. They are regenerated by `bun run build`.

**The moved unmount steps are unobservable.**

- The hook is synchronous. `taskService.disconnect()` rejects pending requests and fires `onDisconnected` synchronously, but neither view listens on it. `balanceCount.stop()` calls `show(null)`, a ref write. `clearTimeout(capTimer)` cancels a timer. None of them can reach a fetch continuation, a retry callback or the connect listener inside the hook.
- TokensView gains a generation bump at unmount. It is redundant with its `scopeGen++`: every earlier run already fails `scopeFence`, and no run can start afterwards (T9).

### What stays, and why

- **Every scope watcher, verbatim.** A watcher whose getter returns a fresh array fires on every trigger of a dependency it read, even when the values are equal (`@vue/reactivity` 3.5.41 calls `hasChanged` on the array; a getter is not a multi-source). Renaming the active account replaces `account` with an equal-address object (`stores/app.store.ts:415`), and today both views reset on that. A shared key function would add or drop dependencies, and a string key would stop that reset.
- **The add and delete reducers** disagree (§ Drift).
- **`SelectTokenPopup`'s loader.** It differs in six ways:
  - it clears rows on every load;
  - it gates on `props.show` after the await;
  - it has no retry and no `loaded` state;
  - its counter resets on hide;
  - its key has no profile;
  - its update is scope-gated.
- **`popup/pages/holdings.vue:54`'s `accept`.** It reads `tb.token.chainId` without `?.`. Sharing it would turn a throw the console sniffer logs into a silent `false`.
- **`popup/pages/send.vue:139-146` and `send-balance-events.ts`.** They keep every chain's rows and look one up by token id; the account-only add filter is by design.
- **`TokenCard.vue:27-33` `isMalformed`.** It has an extra `!props.tokenBalance` arm and reads through the `token` computed, which gives it different reactive dependencies.
- **Arc 10's `liveFeeScope`/`feeScopeKey`/`isLiveFeeScope` and arc 12's `AccountScope`/`accountScopeKey`: not reused.**
  - The fee scope compares four captured fields against the live props. These sites compare a row's own `account` and `token.chainId` against the live store, and a row has no profile or network id.
  - `accountScopeKey` compares by string coercion, not `===`.
- **`stores/balances.store.ts`** holds Fee Juice balances, not token rows. Q-12 does not name it, and this arc does not edit it, contrary to arc 15's coupling note.

### Complexity

`fetchTokenBalances` is about 25 lines and scores well under 15. Every touched function gets shorter. None is in the complexity manifest.

### Coupling with neighbouring arcs

- **arc 15 (async-primitives)** adds `RunFence.invalidate()`. At restack, `dispose()` swaps `void fence.begin()` for it.
- **popup-plumbing (arc 20)** edits `SelectTokenPopup.vue:40-42`.
- **activity-feed (arc 22)** edits `TokensView.vue:59-76`.

All three restacks are mechanical.

## Security & Adversarial Considerations

- **What the fences protect.** A profile's private balances. Two profiles can share an address: one phrase imported twice, or two people sharing one browser profile who switch wallets. A wrong fence renders one profile's or account's rows under another. No dApp reaches these views; the adversary is timing (port replies and events that arrive after a scope change).
- **What a consolidation could widen, and its pin:**
  - TokensView's `scopeGen` dropped as "redundant" lets A's rows land under B during B's task wait: T1, T2.
  - Watchers merged or keyed by a string stop or add resets: T8, B5, plus the existing profile-switch tests `TokensView.test.ts:408` and `BalanceView.test.ts:495`.
  - A chain id read at landing: T8b.
  - An eager or built-object predicate: T14, B9, S3, which run each view's real handler inside an effect.
  - `===` loosened: the per-arm coercion rows.
  - A stricter shared update reducer, which would be a behaviour change: T7.
  - A post-unmount retry or reconnect reopening a port: T9, B6.
  - An inserted `await` that lets an event slip ahead of a landing: T13, B10.
- **Row data** comes from the background, which joins every row to its token and drops mismatches (`wallet/services/token-balance/service.ts:191-205`). The moved predicates keep the same `?.`, short-circuits and parameter names anyway.
- **Logging:** none added or changed. **npm surface:** none.

## Assumptions

**Facts** (read 2026-10-03 on `harden-dedupe` at `eb06c37d`):

1. Every site is at the cited line. The three `inActiveScope` copies are byte-identical.
2. Both views' `onBalanceUpdated` mark dirty in scope, then replace the first id match unscoped.
3. Every `fetchTokenBalances` call site runs in a watcher callback, `onMounted`, a timer or an event handler. None runs in a computed or a watch getter.
4. Nothing outside `token-order.ts` imports `isUnknownRow`.
5. A balance-added event always carries a fresh row: zero balances, `updatedAt: 0`. It is emitted after `repo.set` and an await (`token-balance/service.ts:297-301`), and `getTokenBalances` reads `repo.getAll()` without the service lock (`:191-205`).
6. Vue 3.5.41's watch fires a getter source's callback whenever the getter re-runs and returns a new array.
7. `appStore.account` and `appStore.network` are refs (`stores/app.store.ts:38`, `:53`).
8. No touched file has a complexity acceptance.

**Inferences:**

- In BalanceView, a duplicate added by the race in Fact 5 starts as a zero row that the update reducer never reaches, since it replaces only the first match. The duplicate can therefore hold the hero skeleton up to the 12 s cap. It does not double the figure.

**Asks:** resolved by the panel; see Decisions.

## Phases

### Phase 1: pin today's behaviour (test only)

Expected values are literals. Fake timers are used wherever a retry is counted. Request assertions name the account (`toHaveBeenLastCalledWith(undefined, "0x…")`) rather than relying on call order.

**`TokensView.test.ts`:**

- **T1 (cross-account).** A's fetch is held. Switch to B while B's task snapshot is held. Resolve A's fetch with A's rows: no card. Release B's tasks: the next request is `(undefined, B)`, and only B's rows render.
- **T2.** As T1, but A's fetch rejects during B's task wait. The rejection is out of scope, so it arms no retry.
- **T3.** Within one scope, run 1 is held and a second connect starts run 2. Resolve run 2 with NEW, then run 1 with OLD: NEW stays.
- **T4.** No account: no request, and the empty state shows once seeds are ready.
- **T5.** Two rejections give exactly two calls by 4.1 s. A reconnect fetch inside the 2 s window cancels the pending retry.
- **T6.** During a held run, updates for a foreign-chain row and a foreign-account row trigger no refetch. Two controls do: an in-scope update for a displayed id, and one for an id not displayed.
- **T7.** An update for a known id that now carries another account replaces the row, as today.
- **T8 (dependencies):**
  - (a) a rename-shaped `account` replacement (same address, new object) clears and refetches;
  - (b) an in-place `network.chainId` change mid-run makes no request, and the start chain's rows land;
  - (c) an in-place `network.id` change resets and refetches.
- **T9.** A rejection arms the retry, then unmount: no call at 2 s, and two connects after unmount make none.
- **T10.** A live add on the active chain from another account is ignored.
- **T11.** During a held run, an add for an id already displayed still marks the snapshot dirty: resolve, and it refetches. This pins dirty before the dedupe return.
- **T12.** A retry armed by a rejection in A fires at 2 s during B's task wait and asks for `(undefined, B)`. This pins drift 6.
- **T13 (suspension boundary).** A second connect starts a fetch whose request is already resolved. After exactly one microtask an in-scope update arrives. No refetch follows, because the snapshot landed first. An inserted `await` would let the update mark it dirty.
- **T14 (predicate reads).** The view's real update handler runs inside `effect()`. With a foreign account, mutating `network.chainId` does not re-run it. With the active account and an undisplayed id, it does.

**`BalanceView.test.ts`:**

- **B1.** A's fetch is held. Switch to B. A rejects. No extra request at 2 s, and B's figure lands.
- **B2.** After a loaded snapshot, a refetch rejects. The figure stays, with no skeleton, before and after the cap.
- **B3.** No account: `$0.00` and no request.
- **B4.** The same matrix as T6, including the undisplayed in-scope id.
- **B5 (dependencies).** A rename-shaped replacement refetches. An in-place `network.chainId` change refetches. An in-place `network.id` change does not.
- **B6.** Unmount mid-run, then the run rejects: no call at 2 s, and `onConnected.remove` received the function `add` received. Variant: a rejection, then unmount, then no call at 2 s.
- **B7.** A→B→A: A's first run resolves after A's second began and does not land.
- **B8.** Two rejections give exactly two calls.
- **B9.** T14 for the hero.
- **B10.** T13 for the hero.

**`SelectTokenPopup.test.ts`:**

- **S1.** An update for a known id on another chain is not applied.
- **S2.** A profile-only switch while open does not reload the picker.
- **S3.** T14 for the picker.

**Utilities:**

- `token-amount.test.ts`: `safeFiatOf` on a token-less row with a parseable balance returns `undefined` without calling the lookup. It reads each balance property exactly once (counting getters).
- `token-aggregate.test.ts`: a token-less row counts as an unpriced holding. A held row's balance properties are read exactly once per call.
- `token-order.test.ts`: `classifyRow` on a token-less row throws a `TypeError`. `classifyRow` on a held row reads each balance property exactly twice.

The phase is green on the unchanged code and lands in its own commit.

### Phase 2: the malformed-row predicate

What Changes 1, in one commit.

### Phase 3: the predicate, the composable and its adoption

What Changes 2 to 7.

**New `composables/useTokenBalanceSnapshot.test.ts`**, at least 10 cases, using a fake client:

1. The active chain's rows land, after the filter and `mapRow`.
2. No address: no request; `[]` and `loaded`, synchronously.
3. Only the latest run lands.
4. A false `scopeFence` drops the run on both paths.
5. Dirty during the flight refetches.
6. A first rejection gives `unavailable` and one retry; the retry arms none.
7. A rejection after `loaded` keeps the rows and the state.
8. A new run clears the retry.
9. The second connect refetches.
10. `onBalanceUpdated` replaces by id and marks dirty only in scope.
11. `dispose()` drops the run in flight, clears the retry and removes the listener.
12. The chain id is read at start.
13. A resolved request lands after exactly one microtask.

**`token-order.test.ts` additions:**

- `isActiveScopeRow` against a reference copy of today's inline expression: match; account mismatch; chain mismatch; no token; a null network with no token; `"1"` vs `1` on the chain with the account matching; and an address-like non-string on the account with the chain matching.
- A tracking test: the predicate inside a `computed` over a `reactive` live object.

### Validation gate (after each phase)

- **Commands:**
  - `bun run --cwd apps/extension test src/popup/components src/popup/pages src/utils src/composables` (the script is `bun --bun vitest run`);
  - `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`, `bun run audit:vue`;
  - at head, `bun run build`, and review the generated declaration files.
- **Pass criteria:**
  - every command exits 0;
  - between the Phase 1 commit and head, `git diff -- '*.test.ts'` lists only the new composable test and additions to `token-order.test.ts` (as built, also its import line, and the post-mutation strengthening of the three effect tests; see Build log);
  - `.vue` diffs stay inside `<script setup>`, and no watcher getter changes.
- **Mutation check.** Each mutant is applied alone to a scratch copy and restored from that copy, never with git. A kill means a test ran and failed. A survivor counts as equivalent only with a probe.
  - **In the composable:**
    - scope check dropped on resolve (T1) or on reject (T2);
    - generation check dropped on resolve (B7, T3) or on reject (B1);
    - dirty refetch dropped (`BalanceView.test.ts:325`, `TokensView.test.ts:618`);
    - `dirty = false` moved after the await (same tests);
    - `!address` branch dropped (T4, B3);
    - `loaded`-survives dropped (B2);
    - retry re-armed on a timed retry (T5, B8);
    - no clear at run start (T5);
    - chain id read at landing (T8b, unit 12);
    - connect counter `>= 1` (`BalanceView.test.ts:357`);
    - an `await` inserted before the fences or before the landing (T13, B10, unit 13);
    - `onBalanceUpdated` marking dirty unscoped (T6, B4) or scope-gating its replace (T7);
    - `dispose` without the clear (T9, B6 variant), without the listener removal (T9, B6), or without the fence bump (B6; expected to survive at TokensView, where `scopeGen` covers it, and logged with the probe).
  - **At the adoption sites:**
    - TokensView without `scopeFence` (T1, T2) or without `mapRow` (existing dot tests);
    - TokensView with dedupe before `markDirty` (T11);
    - each view's predicate built from an object (T14, B9, S3);
    - `dispose` after `disconnect()` (T9, B6);
    - each view's watcher key edited (T8, B5, `TokensView.test.ts:408`, `BalanceView.test.ts:495`).
  - **In `isActiveScopeRow`:** either arm dropped; `==` on the account arm alone; `==` on the chain arm alone; eager reads.
  - **After Phase 2, in `isUnknownParsedRow`:** `?.` dropped (the token-less utility rows); `&&` for `||` (existing tables); a re-parse in the aggregate (the read-count rows).
- **Screenshots:** § UI impact.

### Build log

Detail in `../../lessons/arc-21-balance-snapshot.md`.

- Phase 1 green on the unchanged code; Phases 2 and 3 left every frozen test green.
- Mutation: 40 mutants, 38 killed on the first run. C20 and A12 (a predicate over a built object) survived because the effect tests only edited `chainId` in place; the tests now also replace the network object, and both are killed. A4 and A5 (`dispose` after `disconnect()`) are equivalent by probe of the messaging client: `disconnect()` never fires `onConnected` or sends a request.
- Gates green at `6a0db7de`.
- Screenshots: not yet captured. The surface file is written, and two staging errors in it were fixed: holdings counts five rows, and the picker shows search past three rows. The final run never won the shared harness lock within its two-hour limit.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, with the adversarial, assumption-attack and implementation-critique asks, naming the cross-account fence. Include verbatim both the no-over-engineering rule ("Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone.") and the comment-quality rule ("Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact.").
2. **Fix loop:** triage each finding, fix it, commit, and log the round in `lessons/arc-21-balance-snapshot.md`. Stop when a round has no material finding. At 5 rounds the arc is parked.
3. **Delivery:** push, open a ready PR against its stack parent, then add both e2e labels. When the program gates are green, with the shards that ran recorded, squash-merge into `harden-dedupe`.
4. **Close-out** is the program's job.

## Delivery

One arc, `hd/21-balance-snapshot`, stacked on `harden-dedupe` in readiness order. Code review: off.

## UI impact

**None intended, but this is not a logic-only arc.** Three `.vue` files change inside `<script setup>` only.

The surfaces go in `~/.cache/hd-shots/surfaces/balance-snapshot.ts`, modelled on `fee-strategies.ts`. A proxy on the `token-balance` port answers `getTokenBalances` with fixed rows, holds it, or rejects it. Each surface asserts its state before and after the shot. Every host is captured directly.

| host | states |
|---|---|
| Home (`popup/pages/general.vue`: BalanceView and TokensView) | loading (hero skeleton, ghost rows after 300 ms); loaded with priced, unpriced and empty rows and the partial caption; a malformed row; overflow with View all; loaded empty (`$0.00` and the empty state); a rejected snapshot before and after the 12 s cap |
| Token page (`popup/pages/tokens/[id].vue`) | a priced token; a malformed token row |
| Holdings (`popup/pages/holdings.vue`) | priced, unpriced, malformed and empty (folded) rows with the partial summary; fiat off |
| Send picker (`SelectTokenPopup` over `popup/pages/send.vue`) | the ordered list with a malformed row; search shown; no results; load error |

Each host is captured on Chrome and Firefox, in dark and light. The parent against head must be a zero diff, and `--stability` must hold. If a host cannot be staged, the part that reaches it is deferred rather than shipped uncaptured.

## Drift left for the alignment arc

1. **BalanceView's add has no id dedupe** (`:235-239`; TokensView dedupes at `:202`). Preserved; see Deferred.
2. **The delete reducers differ.**
   - BalanceView's `filter` removes every id match (`:248`) and reassigns the array even when nothing matches, which invalidates every reader of `tokenBalances`. It marks dirty after.
   - TokensView's `splice` removes the first match only when one exists, and marks dirty first.
   - Only the reassignment and the duplicates from item 1 tell them apart.
3. **Watch keys differ per host.** TokensView keys `network.id` and BalanceView `network.chainId`, so an in-place chain-id change resets only the hero. The picker has no profile (`SelectTokenPopup.vue:144`). Holdings keys `[profile, account, chainId]` (`holdings.vue:103-109`) and Send `[profile, network.id, account]` (`send.vue:613-620`).
4. **Update scoping.** The views replace any id match; the picker only an in-scope one (`:82`).
5. **Holdings' `accept`** reads `tb.token.chainId` without `?.` (`holdings.vue:54`).
6. **TokensView's retry timer crosses a scope change.** A retry armed in A fires during B's task wait, before B's own fetch clears it. It requests B's rows and flags them from A's task list. Today this is invisible: the flags it would get wrong are `isUpdating`, which B's own fetch recomputes once its task snapshot lands, and `isMinting`, which nothing reads. Pinned by T12.

## Deferred (program follow-ups)

- **The BalanceView add-dedupe** (drift 1), with its UX risk for the final report. After a seeding race, the hero skeleton can be held up to the 12 s cap. If the duplicated row has invalid decimals, it counts as one more unpriced holding.

## Decisions (delegated)

### Plan audit, Codex (GPT-6 Astra, xhigh): REVISE (should-fixes only)

All adopted:

1. **Reparsing is not equivalent.** `parseRawBalance` reads properties, and a getter row answering `"1"` then `"bad"` gives `{10n, false}` today but `{0n, true}` with a second parse. Adopted: the two-level `isUnknownParsedRow(raw, tb)` reuses the parsed value, and read counts are pinned in Phase 1.
2. **Component wiring.** Adopted:
   - T1 asserts the requested account;
   - T14, B9 and S3 test each view's real predicate closure for reads and dependencies;
   - adoption-site mutants are listed.
3. **Mutation gate.** Adopted:
   - a suspension-boundary test (T13, B10, unit 13);
   - an undisplayed in-scope id in the T6/B4 controls;
   - per-arm coercion rows, each with the other arm matching;
   - the optional-chain mutant moved onto `isUnknownParsedRow`.
4. **Drift account.** Adopted:
   - the `fetchDirty` order is stated against the store's refs, not claimed identical;
   - the `filter` reassignment and the dirty-marking order are documented in drift 2.

### Plan audit, Opus panelist: APPROVE (small revisions)

All adopted:

5. **Retry crossing a scope change** (drift 6), pinned by T12.
6. **Kill attributions corrected.** The connect counter is killed only by `BalanceView.test.ts:357`. The missing clear is killed by T9, plus the B6 variant.
7. **Dirty before the dedupe return** (T11). The `dirty = false`-after-await mutant is listed.
8. **Stated:** the returned `fetchTokenBalances` is the async function itself; no lifecycle hook; `forChain` runs after the fences and the dirty check.
9. **Imports:** the unused `forChain` and `token-order` imports go; the new imports are explicit; the generated file is `src/types/.eslintrc-auto-import.json`.
10. **Wording:**
    - the synchronous `onDisconnected` and `show(null)` are described as unobservable;
    - the "every chain" comment moves to the predicate;
    - no comment names arc 15 or its fallback;
    - the profile-switch tests are cited for the watcher-key mutant.

### Asks

- **Ask 1, the BalanceView add-dedupe.** Both legs reject route 2. Codex pointed to the alignment arc, Opus to follow-ups. The coordinator's call: preserved drift, recorded in Deferred, and listed as a UX risk in the program's final report. It takes no slot on the owner page.
- **Ask 2, scope boundary.** Confirmed by both legs: only the picker shares the predicate.
