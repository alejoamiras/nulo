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

Findings Q-12 and the token-row half of Q-27 (f), from `audit/quality/2026-09-30-dedup-high/`. Home's hero (`BalanceView`) and Home's list (`TokensView`) each carry the same snapshot state machine: the latest-wins fence, the dirty refetch, one timed retry, first-connect suppression and the update reducer. The Send picker carries a third copy of the scope predicate. Three token utilities restate "this row's numbers cannot be trusted". This arc states each once. No fence is loosened, no watcher changes, and nothing a user sees changes.

## Outcome & Quality Bar

- **For whom:** the next person who changes how a token-balance snapshot retries, reconnects or fences. Today that edit is made twice, and if the copies diverge, the hero and the list disagree for the same account.
- **Excellent:**
  - One composable owns the snapshot run. Each view keeps everything that differs: its add and delete reducers, its scope watcher, its mount sequence and its extra fence.
  - The cross-account guards are pinned before the move, at component level, by tests that go red when a guard is removed. That includes the watcher dependency sets, which decide when a scope reset fires.
  - One scope predicate, with a unit test that compares its result and its reactive reads against today's inline expression.
- **Good enough:** the Send picker (`SelectTokenPopup`) shares only the predicate. Its show/hide loader differs from the views in six ways (§ What stays).

## Architecture & Implementation

Read on `harden-dedupe` at `2adab99d`. Paths are under `apps/extension/src/`.

### Sites today

- **`popup/components/modules/general/TokensView.vue`** (Home list):
  - refs `tokenBalances` `:78` and `balancesState` `:80`;
  - client and listeners `:190-193`, `fetchDirty` `:196`, `inActiveScope` `:198`;
  - `onBalanceAdded` `:199-209`, whose inline task flags at `:204-208` are `withTaskFlags` (`:282-286`) written out again;
  - `onBalanceUpdated` `:210-216`, `onBalanceDeleted` `:217-223`, the reconnect counter `:226-231`;
  - `scopeGen` `:266`, `BALANCES_RETRY_MS`, the timer and `fetchGeneration` `:279-281`, `fetchTokenBalances` `:291-316`;
  - the scope watcher `:357-375`, `onMounted` `:376-389`, `onBeforeUnmount` `:390-402`.
- **`popup/components/modules/general/BalanceView.vue`** (Home hero; also mounted by `popup/pages/tokens/[id].vue:271` for the token hero, where the aggregate snapshot still runs unseen):
  - `tokenBalances` `:59`, `inActiveScope` `:179`, `balancesState` `:183`, `fetchDirty` and `markDirty` `:185-188`;
  - client and listeners `:231-234`, add `:235-239`, update `:240-246`, delete `:247-250`, the reconnect counter `:254-259`;
  - retry and generation `:262-267`, `fetchTokenBalances` `:268-292`, `enterScope` `:295-301`;
  - the watcher `:304-309`, `onMounted` `:326-333`, `onBeforeUnmount` `:334-346`, with `fetchGeneration++` at `:337`.
- **`popup/components/popups/SelectTokenPopup.vue`** (Send picker): `activeScope` `:65-69`, `inActiveScope` `:70`, the handlers `:77-89`, the reconnect counter `:93-97`, `load` `:111-128`, `close` `:130-137`, the watchers `:139-148`.
- **Q-27 (f), the token-row half:**
  - `utils/token-order.ts:40-43`: `isUnknownRow(tb)` = `parseRawBalance(tb) === undefined || !isValidDecimals(tb.token.decimals)`.
  - `utils/token-amount.ts:50`, inside `safeFiatOf`: the same expression with `tb.token?.decimals`.
  - `utils/token-aggregate.ts:19-20`: `raw === undefined || !isValidDecimals(tb.token?.decimals)` over the `raw` parsed one line above.
  - `token-order.ts` imports `token-amount.ts`, so the shared predicate lives in `token-amount.ts`.

### Guard set per site (identical after the change)

| guard | TokensView | BalanceView | SelectTokenPopup |
|---|---|---|---|
| event scope gate | add: `inActiveScope` returns first; update and delete: mark dirty only if in scope | same | add: `props.show && inActiveScope`; update: `inActiveScope` before replacing; delete: no gate |
| add reducer | mark dirty, then id-dedupe, then push with task flags | push, then mark dirty; no dedupe | id-dedupe, then push |
| update reducer | replace the first id match, whatever its scope | same | replace the first id match, only in scope |
| delete reducer | `splice` the first id match | `filter` reassign, every id match | `splice` the first id match |
| snapshot fence | `scopeGen` captured before `++fetchGeneration`; both checked on the reject and the resolve path | `fetchGeneration` only | `loadGeneration` plus `props.show` |
| dirty refetch | yes | yes | none |
| on reject | `unavailable` unless already `loaded`; one timed retry at 2 s; any new run clears the timer | same | `loadError` if shown and current; no retry |
| scope read | address and chain id read once at run start; rows filtered by that chain id | same | `{ account, chainId }` captured before the request |
| reconnect | the first connect is the mount's; later ones refetch; never reset | same | counter reset on hide; refetch only while shown |
| watch key | `[profile.id, account.address, network.id]` | `[profile.id, account.address, network.chainId]` | `[account.address, network.chainId]`, plus `show` |
| on scope change | sync `scopeGen++`, clear rows, `loading`, clear `retriedDefaults`, refresh pins; await tasks; re-check `scopeGen`; fetch | sync `enterScope`: clear rows, `loading`, reset count, restart cap, fetch (which bumps the generation synchronously) | `load()` clears rows and refetches |
| unmount | `isUnmounted`, `scopeGen++`, clear timers, remove the connect listener before `disconnect()` | `fetchGeneration++`, clear timers, remove the listener before `disconnect()` | the hide path disconnects |

**Why TokensView needs `scopeGen` and BalanceView does not.** TokensView's watcher awaits the task snapshot before it fetches, so without `scopeGen` its generation would bump only after that await. Account A's request, still in flight, could then land A's rows under account B while B's tasks load. BalanceView fetches synchronously inside `enterScope`, so the generation bump itself fences the old request. Each view keeps exactly the fence it has.

### What changes

1. **`isUnknownRow` moves down to `utils/token-amount.ts`** with today's TSDoc and the body `parseRawBalance(tb) === undefined || !isValidDecimals(tb.token?.decimals)`, typed over `BalanceLike & TokenLike`.
   - `safeFiatOf` (`:50`) calls it. The expression is the same, as is the parameter name `tb`.
   - `aggregateFiat` sets `malformed = isUnknownRow(tb)` and keeps `raw` for its zero test. `parseRawBalance` is pure, so parsing twice gives the same value and, inside a computed, the same reactive reads.
   - `token-order.ts` imports it and deletes its own copy.
   - **The one textual difference is unreachable.** `token-order` read `tb.token.decimals`, not `?.`. Every call there runs after `classifyRow` has dereferenced `tb.token.contract` (`:46`) for that row, so a row without a token has already thrown on an unchanged line. Nothing outside `token-order.ts` imports `isUnknownRow`.
2. **`isActiveScopeRow(live, tb)`** goes in `utils/token-order.ts`, beside `forChain`, its fetch-side twin. Its body is today's expression with `appStore` renamed `live`: `tb.account === live.account?.address && tb.token?.chainId === live.network?.chainId`.
   - The read order and the short-circuit are the same, so the network is never read when the account mismatches.
   - The parameter stays `tb`. `live` is always the Pinia store, never nullish, so the rename cannot change an engine's error text.
3. **`composables/useTokenBalanceSnapshot.ts`** (C1). It receives the parent-owned client, never connects or disconnects it, and exposes `dispose()`.
   - **Input:** `{ client, live, rows, state, scopeFence?, mapRow? }`. `rows` and `state` are the parent's own refs, so no declaration moves past a computed that reads them.
   - **Returns:** `{ fetchTokenBalances, markDirty, inActiveScope, onBalanceUpdated, dispose }`. The names match today's identifiers, so call sites and comments stay put.
   - **`fetchTokenBalances(isTimedRetry = false)`** is today's body in order, with no added `await`:
     - `const inScope = scopeFence?.()`, then `const isCurrent = fence.begin()` (`createRunFence`);
     - `clearTimeout`, then `dirty = false`;
     - read `live.account?.address` and `live.network?.chainId` once;
     - the `!address` branch;
     - the one `await client.getTokenBalances(undefined, address)`;
     - on both paths, `(inScope && !inScope()) || !isCurrent()` returns first;
     - then the `loaded`-survives rule and the single timed retry (`RETRY_MS = 2_000`), or `if (dirty) return fetchTokenBalances()`;
     - then `rows.value = mapRow ? landed.map(mapRow) : landed`, where `landed = forChain(fetched, chainId)`, then `state.value = "loaded"`.
   - **`onBalanceUpdated(tb)`:** mark dirty if in scope, then replace the first id match, unscoped. Both views run exactly this today.
   - **The connect listener** is added when the composable is called. `onReconnected` counts connects and refetches from the second one on.
   - **`dispose()`:** `fence.invalidate()`, `clearTimeout`, then remove the connect listener. `invalidate()` comes from arc 15; built before arc 15 lands, the composable calls `void fence.begin()` there, which bumps the same counter, and the restack swaps it in.
4. **`TokensView`:**
   - `let scopeGen = 0` (with its comment) and `withTaskFlags` move above the client, since `mapRow: withTaskFlags` is read when the composable is called.
   - The composable is called right after `new TokenBalanceServiceClient()`, with `scopeFence: () => { const atStart = scopeGen; return () => scopeGen === atStart }`.
   - The listeners register the view's `onBalanceAdded`, the composable's `onBalanceUpdated` and the view's `onBalanceDeleted`, each on its own event, so registration order per event is unchanged.
   - `fetchDirty = true` becomes `markDirty()` at its two sites. The add reducer's inline flags become `withTaskFlags(tb)`: the same spread, keys and reads, in the same order.
   - `onBeforeUnmount` calls `dispose()` where `onConnected.remove` sits today, immediately before `tokenBalanceService.disconnect()`. The retry clear moves from before `taskService.disconnect()` to that point.
   - Deleted: `fetchDirty`, `inActiveScope`, `onBalanceUpdated`, the reconnect counter, the retry constant and timer, `fetchGeneration` and the fetch body. The watcher, `fetchTasks`, `onTaskReconnected` and `onMounted` are untouched.
5. **`BalanceView`:**
   - The composable is called after the client, with no strategy.
   - `markDirty` and `inActiveScope` come from it; the add and delete reducers stay.
   - `enterScope` returns `fetchTokenBalances()` as today.
   - `onBeforeUnmount` calls `dispose()` where `onConnected.remove` sits, before `disconnect()`. The generation bump moves from before `balanceCount.stop()` to that point.
   - The watcher and `onMounted` are untouched.
6. **`SelectTokenPopup`:** `inActiveScope` (`:70`) becomes `(tb) => isActiveScopeRow(appStore, tb)`. Nothing else in the file changes.

**Each moved unmount step is unobservable.** The hook is synchronous. `taskService.disconnect()`, `balanceCount.stop()` and `clearTimeout(capTimer)` reject pending requests or cancel frames, and those land as later microtasks. No timer callback or fetch continuation can run inside the hook. TokensView gains a generation bump at unmount. It is redundant with its `scopeGen++`: every run started before unmount already fails `scopeFence`, and no run can start after it (Phase 1, T9).

### What stays, and why

- **Every scope watcher, verbatim.** A watcher whose getter returns a fresh array fires on every trigger of a dependency it read, equal values included (`@vue/reactivity` 3.5.41 calls `hasChanged` on the array itself, because a getter is not a multi-source). Renaming the active account replaces `account` with an equal-address object (`stores/app.store.ts:415`), and today both views reset on it. A shared key function would add or drop dependencies, and a string key would stop that reset.
- **The add and delete reducers.** They disagree (§ Drift).
- **`SelectTokenPopup`'s loader.** It differs from the snapshot in six ways: it clears rows on every load; it gates on `props.show` after the await; it has no retry and no `loaded` state; it resets the connect counter on hide; its watch key has no profile; and its update is scope-gated. Six strategies would cost more than the duplicate.
- **`popup/pages/holdings.vue:54`'s `accept`.** It reads `tb.token.chainId` without `?.` inside `useEntityCrud`. Moving it to the predicate would turn a throw, which the console sniffer would log, into a silent `false`.
- **`popup/pages/send.vue:139-146` with `send-balance-events.ts`.** That page keeps every chain's rows and finds one by token id. Its add filter checks the account only, by design.
- **`TokenCard.vue:27-33` `isMalformed`.** It has an extra `!props.tokenBalance` arm and reads `decimals` through the `token` computed, so a shared call would change its reactive dependencies.
- **Arc 10's `liveFeeScope` / `feeScopeKey` / `isLiveFeeScope` and arc 12's `AccountScope` / `accountScopeKey`: not reused.**
  - The fee scope captures four fields (profile, network id, chain id, account) and compares the captured tuple against the live props. These sites compare a row's own `account` and `token.chainId`, two fields, against the live store. The fee helper reads fields a row does not have.
  - `accountScopeKey` builds a set key for a background purge. Comparing keys instead of `===` would coerce a non-string address and change the result on malformed input.
- **`stores/balances.store.ts`.** It holds the Fee Juice balances for the fee card, not token rows, and Q-12 does not name it. Arc 15's plan expects this arc to edit it; this arc does not.

### Complexity

`fetchTokenBalances` scores well under 15 and runs about 25 lines. Every touched function gets shorter. None is in the complexity manifest.

### Coupling with neighbouring arcs

- **arc 15 (async-primitives):** adds `RunFence.invalidate()` (see What changes 3). It touches no file here besides `runFence.ts`.
- **popup-plumbing (arc 20):** edits `SelectTokenPopup.vue:40-42` (`displaceIdx`), far from `:70`.
- **activity-feed (arc 22):** edits `TokensView.vue:59-76` (the import predicates), outside this arc's hunks.

All three rebases are mechanical. `src/types/auto-imports.d.ts` and `.eslintrc-auto-import.json` gain the composable and `isActiveScopeRow`, and `isUnknownRow`'s line moves to `token-amount`. They are regenerated by `bun run build`, never merged by hand.

## Security & Adversarial Considerations

- **What the fences protect.** A profile's private balances. Two profiles can share an address: one phrase imported twice, or two people sharing one browser profile who switch between their wallets. A wrong fence renders one profile's or account's rows under another. No dApp reaches these views. The adversary is timing: port replies and broadcast events that arrive after a scope change.
- **What a consolidation could widen, and the pin for each:**
  - **TokensView's `scopeGen` dropped as "redundant with the generation":** A's rows land under B during B's task wait. Pinned by T1 and T2.
  - **Watchers merged or keyed by a string:** profile switches or the rename reset stop firing, or extra resets start. Pinned by T8 and B5.
  - **The chain id read at landing instead of at start:** the moved-read lesson. Pinned by T8 and the composable test.
  - **An eager predicate:** it reads the network even when the account already mismatches. Pinned by the reference-expression tracking test.
  - **`===` loosened:** `"1" == 1` would match. Pinned by the predicate table.
  - **A stricter shared update reducer:** that is a behaviour change. Pinned by T7.
  - **A post-unmount retry or reconnect reopening a port** after the view is gone. Pinned by T9 and B6.
- **The row data** comes from the background, which joins every row to its token and drops a mismatched one (`wallet/services/token-balance/service.ts:191-205`). A token-less row is not a realistic input. The moved predicates still keep the same `?.`, the same short-circuits and the same parameter names, so even that input behaves and reads identically.
- **Logging:** no log line is added or changed.
- **npm surface:** none. These files are in `apps/extension`, outside every staged package.

## Assumptions

**Facts** (read 2026-10-03 on `harden-dedupe` at `2adab99d`):

1. Every site above is at the cited line.
2. The three `inActiveScope` copies are byte-identical (`TokensView.vue:198`, `BalanceView.vue:179`, `SelectTokenPopup.vue:70`).
3. Both views' `onBalanceUpdated` mark dirty only in scope and then replace the first id match unscoped (`TokensView.vue:210-216`, `BalanceView.vue:240-246`).
4. Every `fetchTokenBalances` call site in both views sits in a watcher callback, `onMounted`, a timer or an event handler. None is inside a computed or a watch getter, so the store reads at run start are untracked.
5. `isUnknownRow` has no importer outside `token-order.ts`. Its auto-import entry has no user.
6. A balance-added event always carries a fresh row: zero balances, `updatedAt: 0`. It is emitted after `repo.set` and an await (`token-balance/service.ts:297-301`), and `getTokenBalances` reads `repo.getAll()` without the service lock (`:191-205`). A snapshot can therefore already include the row that a later add event pushes again.
7. Vue 3.5.41's watch fires a getter-source callback whenever the getter re-runs and returns a new array (`hasChanged` on the array; `isMultiSource` only for array sources).
8. Neither view, nor `token-order`, `token-amount` or `token-aggregate`, has an acceptance in `scripts/complexity-baseline/manifest.json`.

**Inferences:**

- In BalanceView, a duplicate row from Fact 6 is a zero row that never updates, because the update replaces only the first id match. The aggregate skips it, so the hero figure is not doubled, despite what recon says. Its `updatedAt: 0` holds the hero skeleton until the 12 s cap.
- Arc 15's coupling note about `balances.store.ts` is a mistaken guess (§ What stays).

**Asks:**

1. **The BalanceView add-dedupe**, which the program plan leaves to this arc's panel under the route-2 criteria. Recommendation: **not route 2; send it to the behaviour-alignment arc.** It is strictly safer, but not invisible. On a plausible path, default seeding racing Home's first snapshot (Fact 6), it shortens a held hero skeleton, which is a pixel change. With it goes the delete reducer's `filter`/`splice` difference, which only matters once duplicates exist.
2. **Scope boundary.** This arc shares only the predicate with the picker, and leaves `holdings.vue`, `send.vue` and `TokenCard.vue` as they are, for the reasons in § What stays. Recommendation: confirm.

## Phases

### Phase 1: pin today's behaviour (test only)

Expected values are literals, never derived from production code. Fake timers wherever a retry is counted. Each case below targets a guard and names the mutant it kills (see the validation gate).

**`TokensView.test.ts`:**

- **T1 (cross-account).** A's fetch is held. Switch to account B while B's task snapshot is held. Resolve A's fetch with A's rows: no card renders. Then release B's tasks and fetch: only B's rows render.
- **T2.** The same setup, but A's fetch rejects. After 2 s, still inside the task wait, there is no new `getTokenBalances` call.
- **T3.** Within one scope, run 1 is held and a second connect starts run 2. Resolve run 2 with NEW, then run 1 with OLD: NEW stays.
- **T4.** No account at mount: no request, and the empty state shows once the seed status is ready.
- **T5.** Two rejections make exactly two calls by 4.1 s. A reconnect fetch inside the 2 s window cancels the pending retry: no third call at 2 s.
- **T6.** With a run held, an update for a foreign-chain row and one for a foreign-account row trigger no refetch on resolve. An in-scope update, the control, does.
- **T7.** An update for a known id that now carries another account replaces the row, as today.
- **T8 (dependencies):**
  - (a) A rename-shaped `account` replacement (same address, new object) clears rows and refetches.
  - (b) An in-place `network.chainId` change mid-run, with the same `network.id`, makes no new request. The rows that land are the start chain's.
  - (c) An in-place `network.id` change resets and refetches.
- **T9.** A rejected fetch arms the retry, then the view unmounts. 2 s later there is no call, and two connects after unmount make none either.
- **T10.** A live add for the active chain from another account is ignored.

**`BalanceView.test.ts`:**

- **B1.** A's fetch is held. Switch to B (held). A rejects. After 2 s there is no extra request, and B's figure lands when B resolves.
- **B2.** After a loaded snapshot, a reconnect refetch rejects. The figure stays, with no skeleton, before and after the cap.
- **B3.** No account: `$0.00` and no request.
- **B4.** B4 is T6's matrix for the hero: foreign updates during a run trigger no refetch, while an in-scope update does.
- **B5 (dependencies):** a rename-shaped replacement shows the skeleton and refetches; an in-place `network.chainId` change refetches; an in-place `network.id` change does not.
- **B6.** The view unmounts mid-run and the run then rejects. 2 s later there is no call, and `onConnected.remove` received the function given to `add`.
- **B7.** A→B→A: A's first run, held, resolves after A's second run started, and does not land.
- **B8.** Two rejections make exactly two calls.

**`SelectTokenPopup.test.ts`:**

- **S1.** An update for a known id on another chain is not applied.
- **S2.** A profile-only switch while the picker is open does not reload it. This pins the watch key.

**Utilities:**

- `token-amount.test.ts`: `safeFiatOf` on a row with no `token` and a parseable balance returns `undefined` and never calls the lookup.
- `token-aggregate.test.ts`: the same row counts as a holding with no price.
- `token-order.test.ts`: `classifyRow` on a row with no `token` throws a `TypeError`. That is the unchanged line that makes the `?.` unreachable.

The phase is green on the unchanged code and lands in its own commit.

### Phase 2: the malformed-row predicate

What Changes 1, in one commit.

### Phase 3: the predicate, the composable and its adoption

What Changes 2 to 6. New `composables/useTokenBalanceSnapshot.test.ts`, at least 10 cases per CLAUDE.md, with a fake client:

1. The active chain's rows land, `mapRow` runs after the filter, and the state becomes `loaded`.
2. No address: no request, `[]`, `loaded`.
3. Only the latest run lands.
4. A false `scopeFence` drops the run on both paths.
5. Dirty during the flight refetches instead of landing.
6. The first rejection gives `unavailable` and one timed retry; the retry's own rejection arms none.
7. A rejection after `loaded` keeps the rows and the state.
8. A new run clears a pending retry.
9. The first connect does not refetch; the second does.
10. `onBalanceUpdated` replaces by id and marks dirty only in scope.
11. `dispose()` drops the run in flight, clears the retry and removes the connect listener.
12. The chain id is read at run start.

**`token-order.test.ts` additions** for `isActiveScopeRow`:

- **A table against a reference copy** of today's inline expression, written out in the test. Cases: match; account mismatch; chain mismatch; no token; a null network with no token (`undefined === undefined`, true today); `"1"` against `1`.
- **A tracking test.** Both functions run inside a `computed` over a `reactive` live object. With a mismatched account, mutating `live.network` recomputes neither; with a matching account, it recomputes both.

### Validation gate (after each phase)

- **Commands:**
  - `bun run --cwd apps/extension test src/popup/components src/popup/pages src/utils src/composables` (the script is `bun --bun vitest run`, so the paths filter it);
  - `bun run lint`, `bun run typecheck:all`, `bun run test:all`, `bun run test:ci-gating`, `bun run audit:vue`;
  - at the head, `bun run build`, then review the regenerated declaration files: the only change is the three names above.
- **Pass criteria:**
  - every command exits 0;
  - between the Phase 1 commit and the head, `git diff -- '*.test.ts'` lists only the new composable test and additions to `token-order.test.ts`;
  - the `.vue` diff stays inside `<script setup>`;
  - no watcher getter changes.
- **Mutation check.** Each mutant is applied alone to a scratch copy and restored from that copy, never with git. A kill is a test that ran and failed. A survivor counts as equivalent only with a probe showing the same outcome.
  - In the composable:
    - the scope check dropped on the resolve path (T1) and on the reject path (T2);
    - the generation check dropped on each path (B7 and T3; B1);
    - the dirty refetch dropped (existing `BalanceView.test.ts:325`, `TokensView.test.ts:618`);
    - the `!address` branch dropped (T4, B3);
    - `loaded`-survives dropped (B2);
    - the retry re-armed on a timed retry (T5, B8);
    - no clear at run start (T5);
    - the chain id read at landing (T8b);
    - the connect counter at `>= 1` (existing `BalanceView.test.ts:357`, `TokensView.test.ts:600`);
    - `onBalanceUpdated` marking dirty unscoped (T6, B4);
    - a scope gate added to its replace (T7);
    - `dispose` without the clear (T9, B6) or without the listener removal (T9, B6).
  - `dispose` without `invalidate`: killed by B6. It is expected to survive at TokensView, where `scopeGen` covers it; the log shows the probe.
  - In `isActiveScopeRow`: either arm dropped; `==` on either arm; eager reads (the tracking test).
  - Phase 2: `?.` dropped in `safeFiatOf` or in the aggregate (the new utility rows); `&&` in place of `||` (existing tables).
  - Each view's watcher key edited (T8, B5).
- **Screenshots:** see § UI impact.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, with the adversarial, assumption-attack and implementation-critique asks. It names the cross-account fence explicitly. Include the no-over-engineering rule verbatim ("Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone.") and the comment-quality rule verbatim ("Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact.").
2. **Fix loop:** triage each finding, fix it, commit, log the round in this arc's file under the program's `lessons/`, and resume the same session. Stop when a round has no material finding; at 5 rounds, park the arc.
3. **Delivery:** push, open a ready PR against its stack parent, then add both e2e labels. When the program gates are green, with the shards that ran recorded in the lessons log, squash-merge into `harden-dedupe`.
4. **Close-out** is the program's job: this plan closes with the program plan.

## Delivery

One arc, `hd/21-balance-snapshot`, stacked on `harden-dedupe` in readiness order. It goes after arc 15 if that arc is still open when this one builds. Code review: off.

## UI impact

**None intended, but this is not a logic-only arc.** Three `.vue` files change inside `<script setup>` only. The surfaces go in `~/.cache/hd-shots/surfaces/balance-snapshot.ts`, modelled on `fee-strategies.ts`, with a proxy on the `token-balance` port. The proxy answers `getTokenBalances` with fixed rows, holds it, or rejects it. Each surface asserts its state before and after the shot. Every host is captured directly, never through a proxy screen.

| host | states |
|---|---|
| Home (`popup/pages/general.vue`: BalanceView + TokensView) | loading: hero skeleton, then ghost rows past 300 ms; loaded with priced, unpriced and empty rows plus the partial caption; a malformed row (dash card, partial total); overflow with View all; loaded empty (`$0.00` and the empty state); a rejected snapshot before and after the 12 s cap (skeleton, then `—`) |
| Token page (`popup/pages/tokens/[id].vue`, BalanceView hero) | a priced token; a malformed token row |
| Holdings (`popup/pages/holdings.vue`; Q-27 (f) via `aggregateFiat`, `classifyRow`, `token-fold`) | priced, unpriced, malformed and empty (folded) rows with the partial summary; fiat off |
| Send picker (`SelectTokenPopup` over `popup/pages/send.vue`) | the ordered list with a malformed row; search shown (over three rows); no results; the load-error line |

All of them on Chrome and Firefox, dark and light. Immediate parent against head must be a zero diff, plus `--stability`. If a host cannot be staged, the part of the change that reaches it is deferred, not shipped uncaptured.

## Drift left for the alignment arc

1. **BalanceView's add has no id dedupe** (`:235-239`; TokensView dedupes at `:202`). The visible effect is a held hero skeleton, not a doubled figure (Inferences; Ask 1).
2. **Delete reducers:** `filter` removes every id match in BalanceView (`:248`), while TokensView's `splice` removes the first (`:219-222`). They only differ once item 1 has produced a duplicate.
3. **Watch keys differ per host:**
   - TokensView keys `network.id`, BalanceView keys `network.chainId`, so an in-place chain-id change resets only the hero;
   - the picker has no profile in its key (`SelectTokenPopup.vue:144`), so a profile switch with the same address and chain does not reload an open picker;
   - Holdings keys `[profile, account, chainId]` (`holdings.vue:103-109`) and Send `[profile, network.id, account]` (`send.vue:613-620`).
4. **Update scoping:** the views replace any id match whatever its scope; the picker replaces only an in-scope row (`:82`).
5. **Holdings' `accept` reads `tb.token.chainId`** without `?.` (`holdings.vue:54`).

## Decisions (delegated)
