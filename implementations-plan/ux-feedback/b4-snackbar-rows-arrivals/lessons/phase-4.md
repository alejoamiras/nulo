# Phase 4 · Arrivals and the elsewhere-snackbar

Recovered vs written. The first build agent's worktree held no P4 file: every line of this phase,
code, tests, spec and this log, was written in the recovery.

Built:

- `wallet/services/incoming-transfer/arrival-state.ts` + test: `isArrivalEligible` (played,
  `sinceBlock: null`, a pending floor, a block equal to the account floor, equal to the token
  floor, one above both), `claimPlayed` (501 receipts in blocks 1..501: 500 kept, `sinceBlock`
  rises to the evicted block, none of the 501 eligible afterwards, an unplayed receipt under the
  raised floor not eligible), and `ArrivalRowSchema` (a string, `NaN`, a negative, a fraction, an
  oversized `played`, a 201-character id: each reads as missing; a valid row parses).
- The service owns the arrival state, since it already serializes every write under its lock and
  runs every purge that must delete it:
  - a fifth table, `nulo:core:incoming-arrivals@<profile>|<network>|<account>`
    (`{sinceBlock, played: [[id, block]]}`); the trust row gains an optional `arrivalFloor` and an
    `arrivalFloorPending` mark, both kept by `repo.setTrust`;
  - `getLatestBlockNumber` on the PXE (`packages/aztec-runtime`, SW-only, 26 descriptors), read
    before the lock and written inside it; every floor write takes the max with the stored number,
    a failed tip read marks the floor pending and keeps its number, and the next
    `getArrivalState` that reads a tip resolves it;
  - floors are written before the history they cover is committed: the account's `sinceBlock` in
    `onAccountAdded` before its cursor reset (and before the handler's own epoch bump), the token's
    floor in `onTokenAdded` before `hydrateSchedulers`, every contract's floor on Allow;
  - `getArrivalState` baselines a missing row to the tip only while the profile, network and
    account exist; `claimArrivals` claims only eligible ids of its own scope; both write only while
    the service epoch is unchanged and the lock is still theirs;
  - `clearProfile`, `clearChain` and the account purge delete the arrival rows of their scope.
  - `service.scenarios.test.ts`, `repository.test.ts`, `pxe/service.test.ts`,
    `descriptors.test.ts`: every case P4.3 lists.
- `useIncomingTransfers.ts`: an Added now reads the list back (coalesced by `utils/coalesce.ts`:
  three Added in a tick make one read, a steady stream still reads within 1 s), and an optional
  `afterRead(scope)` resolves before the rows are assigned; a scope change during it drops the
  rows, a rejection still assigns them.
- `composables/useArrivals.ts` + test (37 cases, every P4.5 case): the shell's one coordinator,
  provided under `ARRIVALS_KEY`. A `ScopeRun` per epoch and scope holds the loaded state, the ids
  every read returned (`known`), the claims and the pending snacks; a lock or a scope change
  replaces it whole. Home and History judge a row when it renders (`isArriving`), claim what
  rendered after the render (`present`), and Home's chip names the newest claimed one (`latest`).
  Off Home and History, the first read after an unlock or a mount seeds (`data-arrivals-seeded`),
  and a receipt a later read returns for the first time, after an Added, opens one snack once its
  claim returns and the newest read still shows it.
- `app.vue` builds the coordinator with its own incoming, token and price clients and the shell's
  `configService`; `general.vue` hands `latest` to the hero; `RecentActivityView` and
  `activity.vue` pass `afterRead: arrivals.load` (the token page's list passes none) and present
  their rendered incoming rows in a `flush: "post"` watch; `TransactionsList` and the recent list
  pass `arriving` to `TransactionIncomingCard`. `TransactionCardLayout` runs the glow alone, in
  place, under reduced motion and under `.noanimations`. Tests: `TransactionIncomingCard`,
  `TransactionsList`, `RecentActivityView` (3 arrival cases), `pages/activity.test.ts` (new).
- `general/balance-count.ts` + test (9): the hero's count, framework-free (`now`, `frame`,
  `cancelFrame`, `show` injected). `BalanceView.vue`: one `balance-arrival-status` node, the
  arrival's `balance-arrival-chip` keyed per arrival inside it, the chip cut at 312px with an
  ellipsis; the count runs only for the aggregate with fiat on and motion allowed. Test: 38 cases,
  10 mutations of the count and the chip all killed.
- `tests/e2e/network/incoming-arrival.test.ts` (new, `@requires-proverless`): the tip probe, Home,
  Settings before and after a lock, a receipt found with no popup page open, calm, hostile bounds,
  and an imported history.

Tip probe (P4.1). The account's baseline, the token's floor (the tip read at import), and the block
of a receipt sent right after the import:

| browser | account `sinceBlock` | token floor | receipt block |
|---|---|---|---|
| Chrome | 5 | 9 | 10 |
| Firefox | 5 | 9 | 10 |

The receipt's block is above the floor on both, so the phase went on without codex.

Decisions the plan left open:

1. **Fiat off shows no hero, so no chip — held for the owner.** Home's hero is the fiat aggregate;
   with "Show fiat values" off it is not drawn, and the chip lives in it. Built: nothing for that
   state (the row still plays). A chip without a hero is a layout the drawings do not have.
2. **A receipt whose token is unknown or has unusable `decimals` opens no snack and shows no
   chip**, as P4.5's last case asks; its row still renders and can play (P4.6).
3. **`latest` is cleared the moment the route leaves Home**, so the chip never reappears for an
   old arrival on a return.
4. **The coordinator uses the shell's `configService`** (the one `app.vue` already connects for
   settings) and its own incoming, token and price clients, which `app.vue` connects before the
   coordinator attaches its listeners: only a reconnect then reads through `onConnected`.
5. **The first read is deferred a microtask after a scope change**, because a lock moves the
   epoch before it clears the session; reading at once would seed the dying scope.
6. **Comments.** The plan's `helpers.ts:1895` comment was already rewritten in P1. The "Phase 2
   follow-up" docblocks outside the plan's list stay; `activity.vue`'s, which this phase touches,
   lost its tag.

The e2e spec's design, where P4.8 left the mechanism open:

- **The lock case uses a public transfer.** The incoming-poll gate matches notes only and
  releases itself after 15 s (`SAFETY_TIMEOUT_MS`), too soon to hold a note across a lock and an
  unlock. After the unlock and the move to Settings, the spec waits for
  `data-arrivals-seeded="true"` and only then sends; the scheduler finds a public transfer within
  its 30 s cadence with no other trigger.
- **"No popup page open" is watched from the setup page** (`/src/setup/index.html#/install`),
  which has `chrome.*` and no popup shell, so the receipt is seen landing in storage while no
  coordinator exists.
- **"Opened straight on Settings" is logged, not asserted.** The boot bounces a cold deep link to
  Home (P3 decision 9); the spec logs where the page lands (`#/popup/general` on Chrome) and, if
  it were Settings, waits 3 s for a snack that must not come before going Home.
- **The tip probe reads the floor a token import writes** (the tip at import) and sends a receipt
  right after it.
- **Hostile bounds use two 10^38 receipts**: one for the Settings snack, one for Home's chip.
- **The imported-history case runs last**, in a second profile that imports both tokens first, so
  no trust prompt interrupts its first Home.
- **Rows are keyed by the receipt id their link opens.** `tx-incoming-card` carries no
  `data-tx-hash` (`TransactionIncomingCard` does not pass `txHash` to the layout), so the
  recorder reads the id out of the row target's `href` and the spec maps a tx hash to its id
  through storage.

Codex consult (`high`, session `01a0d744-5059-7223-9a63-1768fbee92c5`). Question: when the
service epoch moved between reading the tip and writing a floor (a sibling hydrate, or a delete),
should the write be skipped (a), marked pending (b), or written with the stale tip (c)? What
should a displaced operation (`isCurrent()` false) write, and is skipping an account baseline when
a row already exists safe? Verdict:

- (b), high confidence: an epoch move does not prove the history harmless, and pending is the
  conservative answer at the cost of suppressing genuine arrivals until the next tip read.
- A displaced operation writes nothing, pending included, and stops its dependent trust writes.
- Skipping the baseline is conditionally correct; the handler's own epoch bump must not reject
  its own baseline.
- Two findings acted on. `setArrivalFloor` read the trust row itself before writing, a window a
  watchdog handoff could reopen: it now writes from the caller's read, inside the caller's
  section, and reads nothing itself. `onAccountAdded` baselines before its own
  `bumpServiceEpoch`, so its fence compares against the epoch it read.
- Codex's missed interleaving: a sibling hydrate schedules a re-added, already-trusted token
  before its floor lands. Closed by the delete path: deleting a token resets its trust to
  `unknown` (`wipeContractRecordsLocked`), so a re-added token's scanned history commits hidden
  until its add sets trust and floor together under the lock.

Failing first:

- `BalanceView.test.ts`, the fall case: expected `$…875`, got `$…877`. `ownString` mounted a
  second `BalanceView` to read the aggregate's own string, and every mount replaces the captured
  `onTokenBalanceUpdated` handler, so the view under test stopped receiving updates. The expected
  strings are now computed before the view under test mounts.
- `pages/activity.test.ts`: the row key is `incoming:<id>`, not `inc:<id>`; the page also needed
  `Flex` and `MaterialIcon` stubs under a shallow mount.
- Lint: `noVoidTypeReturn` in `balance-count.ts` (`return stop()` inside a void function) and
  Biome's formatting of `activity.vue`'s watch.
- The spec, as written: the Write tool stored `‮` as a literal bidi override in the source;
  it is an escape now, so the file carries no bidi character. A `MutationObserver` callback scored
  16; the per-record step moved into `onMutation`.
- `bun run e2e:agent` from `apps/extension` is "Script not found": the script exists only in the
  root `package.json`. The gate's command runs from the repo root; file arguments stay relative to
  `apps/extension`, where `agent.sh` changes directory.
- The arrival spec on Chrome, first run, exit 1 (827 s): 2 passed, 5 failed. Three root causes,
  all in the spec. A probe with a temporary debug handle on the coordinator (removed, the
  committed file restored from a copy) showed the product doing what the plan says on a single
  page: the Settings snack opened 20 s after a public receipt, and Home played the next one with
  its chip.
  1. The recorder keyed rows by `data-tx-hash`, which the incoming card does not carry, so no row
     was ever "seen" (Home, no-popup-open) and the imported-history case passed vacuously. Rows are
     keyed by receipt id now (above).
  2. A failed test left its popup page open on Home. That page's coordinator claimed the next
     test's receipt first, so the Settings page's claim lost and, by design, opened no snack (the
     lock case and hostile bounds). Every page the spec opens now closes when its test ends, pass
     or fail (`onTestFinished`).
  3. Right after `seedUsdQuoteAndReload`, a hash navigation to Appearance was bounced to Home by
     the boot, so the toggle never rendered (calm). The spec now reaches Appearance through the nav
     (`navigateToSettings`).
- The arrival spec on Chrome, second run: exit 0 (below).

Held for the owner (not decided here): fiat off (decision 1). P1's and P3's items stand.

Gate (recovery):

| command | exit | duration |
|---|---|---|
| `bun run lint` | 0 | 1 s |
| `bun run typecheck:all` | 0 | 34 s |
| `bun run test:all` | 0 | 110 s |
| `NULO_E2E_BROWSER=chrome NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent tests/e2e/network/incoming-arrival.test.ts`, first run (the spec faults above) | 1 | 827 s |
| the same, after the fix (7 passed) | 0 | 426 s |
| the same with `NULO_E2E_BROWSER=firefox` (7 passed) | 0 | 377 s |
| `NULO_E2E_BROWSER=chrome NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent tests/e2e/network/incoming-transfers.test.ts tests/e2e/network/incoming-public-transfers.test.ts` (prover on; 3 passed) | 0 | 224 s |
| `NULO_E2E_BROWSER=chrome NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent tests/e2e/network/account-switch-isolation.test.ts` (2 passed) | 0 | 185 s |
| `NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent` with the same three files (5 passed) | 0 | 303 s |
| Chrome build: `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension build:chrome` | 0 | 8 s |
| `cd apps/extension && NULO_E2E_BROWSER=chrome NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e` (38 files passed, 3 skipped; 152 tests) | 0 | 802 s |
| Firefox build: the same flags, `build:firefox` | 0 | 10 s |
| the same with `NULO_E2E_BROWSER=firefox` (39 files passed, 2 skipped; 148 tests) | 0 | 1128 s |

The smoke builds ran after the network runs, since `e2e:agent` rebuilds `dist/<browser>` with its
own flags. `test:all` excludes `tests/e2e`; the spec is linted and is in no `typecheck` project.
