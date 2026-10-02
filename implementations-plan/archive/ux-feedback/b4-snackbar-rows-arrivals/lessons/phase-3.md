# Phase 3 · One interactive row

Recovered vs written. The first build agent stopped (usage limit) with P3 uncommitted. Its 51
changed files, this log's draft included, were copied as-is from its worktree onto the P2 tip and
reviewed against the plan and the mocks. The draft below is its work except where the review
changed it. Everything after "Failing first" from "test:all, first run" on, the review fixes, and
the gate table were written in the recovery. The recovery's changes to the copied code:

- **The awaiting card keeps its hover title.** The copy had dropped `title="Show the approval
  window"` together with the card's old wrapper, the first draft's decision 4. A `title` only
  shows over its own element and its descendants. The stretched target is a descendant of the
  layout root, so the title goes on a `display: contents` wrapper around the layout. It shows over
  the whole row and adds no box. It is set only while the row is focusable (queued). The test pins
  that the titled element contains `[data-row-target]` and that other stages have no `title`.
- **The authwit intent separator.** The copy had turned `join(", ")`'s no-break space into a
  plain space, which changes where a long intent list wraps. The no-break space is back.
- **`RowAction`'s colours.** The copy had a dead `color` rule, since the icon paints with `fill`.
  Its hover fill `&:hover svg` outweighed a caller's own hover fill, such as the delete action's
  red. Now the fill sits under `:where(...)` at two classes' weight, and a disabled action gets
  no hover fill.
- **Stale or misplaced comments.** `RecentActivityView.vue` had two "Phase 2 follow-up" docblocks
  and a "Shared verbatim with activity.vue" note. `send.vue`'s identity-refetch comment had
  drifted off its watcher when `applyQueryContact` was inserted. A Cancel paragraph in
  `TransactionAwaitingCard.vue`'s docblock described the `#actions` slot it sits beside.
- **`TokenCard.vue`'s indentation** inside `RouterLink custom` was one level short.

Built:

- `components/ui/RowTarget.vue` (L2, extension-local because it renders `RouterLink`): the row's
  one control, stretched under the row (`position: absolute; inset: 0`), an `<a>` with `to` or a
  `<button>` without, named by `aria-labelledby`, marked `data-row-target`; `activate()` clicks it.
  A link's Space is `@keydown.space="navigate"` with no `.prevent`: `navigate` runs vue-router's
  `guardEvent`, which refuses a modified key or click, prevents the default and pushes once.
  `RowTarget.test.ts`: 6 cases on a real memory router (a click and Space each push once with the
  default prevented; Shift+Space and Ctrl-click push nothing; `activate()`; button mode reaches the
  root listener on Enter and Space; `aria-labelledby`).
- `@nulo/design` `RowAction.vue` + test (5): a 24×24 `<button>` or new-tab `<a>` with a required
  `label`, `@click.stop`, raised (`z-index: 1`) above a row's target; exported and listed in the
  resolver.
- `TransactionCardLayout.vue`: owns the row's interactivity (`to` → link target, `opens` → button
  target emitting `activate`, neither → inert), the `actionCount` reservation (36px for one 24px
  action, 60px for two), the raised `activity-fiat` span (`title="At today's price"`,
  `@click.stop="target?.activate()"`), the mock's `.n-tx` box (`margin: 0 -8px; padding: 6px 8px`),
  hover `--nulo-surface-low`, the ring via `:has(> [data-row-target]:focus-visible)`, active
  `--nulo-surface-high`, and the arrival keyframes for P4. Test: the target's kind per prop, the
  root's testid and data attributes kept, no `tabindex`, the fiat span outside the target opening
  the row once, `arriving` stamping the root.
- The four cards, `TransactionsList`, `RecentActivityView`: rows carry `to`
  (`/popup/tx/<hash>`, `/popup/received/<id>`, `/popup/journal/<id>`); the awaiting card's queued
  row is a button (`opens`), other stages inert; the `.row` wrapper, `handleSelect*` handlers and
  the `useRouter` mocks are gone. `TransactionsList.test.ts` (new) pins the three routes;
  `RecentActivityView.test.ts` asserts `href`s on the real layout.
- `SettingItem.vue`: four modes — link (`<a>` root with `href`, `@click=navigate`, Space), external
  (`<a target="_blank" rel="noopener noreferrer">`, Space presses it), click (`<div>` root keeping
  the caller's `@click`, a `RowTarget` button inside) and inert (`raw`, `disabled`, or no handler:
  a plain `<div>` with no target and no `tabindex`; a disabled row drops its `onClick` and its
  `href`). No root has a `tabindex`. `Settings.test.ts`: every mode on a real router, the nested
  `RowAction` case (the `AccountsPopup` shape), the disabled `to` and `@click` rows.
- `TokenCard` (`RouterLink custom` → an `<a>` root with Space), `ContactRow` (a link to
  `/popup/send?contact=<id>`; copy/edit/delete `RowAction`s; the S chip raised with
  `@click.stop="target?.activate()"`), connected apps (link rows, disconnect `RowAction`),
  `AuthwitCard` (button target; revoke `RowAction` shown on hover and `:focus-within`), notes
  (button targets), `FpcRow`, accounts, tokens, senders, endpoints (actions → `RowAction`),
  contracts (inert card: cursor and hover removed).
- `send.vue` reads `route.query.contact` in `applyQueryContact()`, run after every contacts load
  (a cold tab's identity settles after mount, so the mount-time load finds no contacts) and
  consumed once it matches; `cacheStore.preselectedContactToSend` is gone; `contacts/index.vue` no
  longer routes. `send.test.ts`: the id preselects, an unknown or another profile's id selects
  nothing, no store write, and the cold-tab case (the triple set after mount) still preselects.
- `components/Popup/Popup.vue`: the `show` watch is `immediate`, so a `Popup` created already
  shown (its caller renders it behind a `v-if` on its data — `EditEndpointPopup.vue:92`) gets its
  trap, its Escape and its return focus like every other popup. `Popup.test.ts`: created already
  shown → one trap after the tick on the wrapper, returning focus to what was focused at creation
  even if a child focuses its own input first; created shown and unmounted before the tick → none.
- `settings/profile/index.vue`: the two click rows that only navigated ("Change password", "Reset
  profile") are `to` links. `settings/accounts/import.vue`: the pick-file row loses its duplicate
  `@keydown.enter/space` handlers (a click row's button gives both natively).
- `tests/e2e/rows.test.ts` (new, 4 cases, real key presses and pointer, both browsers):
  1. Home's first activity row (seeded, decision 7): the Tab walk lands on an `<a>` with the
     row's href and the row's computed `outline-width` is 2px; Enter → `#/popup/tx/<hash>` with
     exactly one `history.pushState` and `history.length + 1`; back, Tab, Space → the same, the
     keydown handled (`defaultPrevented`), no scroll event before the push; back, the fiat span
     is what `elementFromPoint` finds at its centre, keeps its `title`, and a real press on it
     opens the row with one push.
  2. A contact row: its target's href is `#/popup/send?contact=<id>`; the edit action's box is
     ≥ 24×24 and a real press on it opens the edit popup with no push and the hash unchanged;
     a Ctrl-click opens a new tab: the click lands on the row's link with the modifier and the
     page leaves its default to the browser (a click probe read after every handler), while the
     original tab stays on Contacts (what the boot does with the tab next is logged, not
     asserted — decision 9).
  3. Settings → Networks → the chain: Tab to the rename row (a click row), Enter opens the
     rename popup, Escape closes it and focus returns to the row, Space does the same; the next
     two Tab stops are the endpoint row's target and its edit action (the disabled active row
     and the raw Chain ID row between them are not stops); on the action, Enter and Space each
     open the edit-endpoint popup with exactly one click landing in the action and zero reaching
     the row root, the hash unchanged, the tooltip gone before the one Escape, which is handled
     and returns focus to the action.
  4. History with the seeded row: no clipping ancestor and no document gains width, and the
     row's box stays inside the viewport.
- `CLAUDE.md`: `RowAction` in the L2 list; `RowTarget` as the fourth host-coupled local component.

Inventory (before → after):

| list | file | before | after |
|---|---|---|---|
| Home / History activity rows | `popup/components/modules/activity/TransactionCard.vue`, `components/composite/activity/TransactionIncomingCard.vue`, `TransactionTerminalCard.vue`, via `TransactionsList.vue:24-40` and `general/RecentActivityView.vue` | a `.row` div with `cursor: pointer`; the click lived in the list's `handleSelect*` → `router.push` | link (`to` → `RowTarget` `<a>`) |
| Awaiting row | `components/composite/activity/TransactionAwaitingCard.vue:74` | a div with `@click="onCardClick"`, `title="Show the approval window"`, no role | button while queued (`opens` → `RowTarget` `<button>`, emits `focus`); inert otherwise |
| Settings rows | `components/ui/Settings/SettingItem.vue:44-50` | `<component :is>` root with `:tabindex="disabled ? -1 : 0"`, `@click` | link `<a>` / external `<a>` / click `<div>` + button target / inert `<div>` |
| Holdings token rows | `popup/components/modules/general/TokenCard.vue:70` | a `RouterLink` root | link (`RouterLink custom` → `<a>` root, Space) |
| Contacts | `popup/components/modules/settings/contacts/ContactRow.vue:20-23` | `role="button" tabindex="0" @click="emit('select')" @keydown.enter` → `router.push("/popup/send")` after a store write | link to `/popup/send?contact=<id>`; copy / edit / delete `RowAction` buttons |
| Connected apps | `popup/pages/settings/connected-apps/index.vue:130-133` | `role="button" tabindex="0" @click="handleOpenSession" @keydown.enter` | link to `/popup/settings/connected-apps/<id>`; disconnect `RowAction` |
| Authwits | `popup/components/modules/settings/authwits/AuthwitCard.vue:19` | a div `@click="emit('open')"`, a revoke `Icon @click` | button target; revoke `RowAction` (hover and `:focus-within`) |
| Notes | `popup/pages/settings/advanced/account-state/notes/index.vue:221` | a div `@click="handleOpenNote"` | button target |
| FPCs | `popup/components/modules/settings/fpcs/FpcRow.vue` | raw row; copy / edit / delete `Icon @click` | inert row; three `RowAction`s |
| Accounts (settings, popup) | `popup/pages/settings/accounts/index.vue:110-139`, `popup/components/popups/AccountsPopup.vue` | click rows; `Icon @click` actions (`.icon_btn`) | click rows (button target); copy / export / edit / hide `RowAction`s (hide `:disabled` on one account) |
| Tokens (settings) | `popup/pages/settings/tokens/index.vue:82-93` | raw row; delete `Icon @click` | inert row; delete `RowAction` |
| Senders | `popup/pages/settings/advanced/account-state/senders/index.vue` | a hover-tinted card; copy / delete `Icon @click` | inert card; copy / delete `RowAction`s (the copied tick in the same 24px box) |
| Endpoints | `popup/pages/settings/networks/[id].vue:196-225` | click rows (set primary); edit / delete `Icon @click` in `Tooltip`s | click rows; edit / delete `RowAction`s in the same `Tooltip`s |
| Contracts | `popup/pages/settings/advanced/account-state/contracts/index.vue` | a card with `cursor: pointer` and a hover tint, no handler | inert card |

Click-mode `SettingItem`s whose handler only navigates (both converted to `to`):
`popup/pages/settings/profile/index.vue:37-41` (change password) and `:48-51` (reset profile). The
click rows that navigate *and* close their popup stay click rows: `AccountsPopup` "Manage accounts",
`SelectTokenPopup` "Manage tokens", `ForgotPasswordPopup` "Delete profile". Of the 68 `<SettingItem`
tags, the other modes are: `to` links (settings index, account-state index, export, security,
about's mail rows, proving's "Get Presto" external), `raw` (FPC / token rows, network chain id,
edit-popup summaries, proving details, export profile rows), and click rows whose handler opens a
popup or selects (import options, account / profile / token pickers, about's legal rows, network
rename / set-active / set-primary).

e2e programmatic clicks on rows (every one hits a click-mode row, a link root or a button):

| site | target | what it is now | works |
|---|---|---|---|
| `tests/e2e/contacts.test.ts:82` | `contact-edit` `.click()` | `RowAction` `<button>` | yes |
| `tests/e2e/contacts.test.ts:144`, `fixtures/helpers.ts:885` (`deleteContact`), `network/senders-advanced.test.ts:158` | `contact-delete` `.click()` | `RowAction` `<button>` | yes |
| `network/senders-advanced.test.ts:106` | `MouseEvent` on `sender-delete` | `RowAction` `<button>` | yes |
| `network/fiat-send.test.ts:49` | `clickByTestId("tokens-card")` | the `<a>` root, `@click=navigate` | yes |
| `fixtures/helpers.ts:620` (`switchToNetwork`), `:1985` (`openNetworkDetail`), `settings-crud.test.ts:42` | `MouseEvent` / `page.click` on `network-row` | link `SettingItem`, `<a>` root; `guardEvent` passes (button 0, unmodified, not prevented) | yes |
| `fixtures/helpers.ts:1042`, `network/send-picker.test.ts:43` | `select-token-row` `.click()` | click-mode row: the caller's `onClick` stays on the `<div>` root | yes |
| `accounts.test.ts:154` | `manage-accounts-hidden-row` `.click()` | click-mode row | yes |
| `fixtures/helpers.ts:630`, `scripts/check-derivation-parity.ts:180` | `network-set-active` | click-mode row when not active; inert (no `onClick`) when active, and the helper never clicks it then | yes |
| `snackbar.test.ts:272` | `pointerClick("account-item-copy")` | `RowAction` `<button>` | yes |

No e2e clicks a `tx-card` or `contact-row` root programmatically.

Decisions the plan left open:

1. **`RowTarget` is a value import in every SFC that uses it.** The extension's unit vitest config
   has no `unplugin-vue-components` (only the auto-import plugin), so a bare `<RowTarget>` /
   `<RowAction>` tag resolves in the build and not under test. Every SFC imports `RowTarget`
   explicitly; tests register `RowAction` through `global.components` (the design package's SFC).
2. **The ref to the target is typed structurally** (`ref<{ activate: () => void } | null>`), not
   `InstanceType<typeof RowTarget>`: Biome's `useImportType` turns an import that only appears in a
   type position into `import type`, which removes the template binding.
3. **The row's ring and tint live on the row**, through `:has(> [data-row-target]:focus-visible)`,
   so the stretched target needs no visible box of its own (`outline: none` on it).
4. **The awaiting card's hover `title` is kept** on a `display: contents` wrapper, an ancestor of
   the row's target, while the row is queued. The first draft dropped it; the recovery restored it,
   as described at the top. The queued row's target is named by the row's title, and its focus
   button keeps its `aria-label`.
5. **The contact travels in the URL** (`/popup/send?contact=<id>`), so a Ctrl-click's new tab
   preselects it too; the cache-store field is deleted rather than kept as a fallback.
6. **Rows outside the plan's list are untouched**: the Logs row in
   `popup/pages/settings/advanced/index.vue:175-181` (`role="button" tabindex="0"`, opens a window)
   and the expand `Icon @click` in `popup/components/popups/RevokeAuthwitsPopup.vue:204` (a window,
   not a list). Listed for the owner.
7. **The smoke's titled span is the priced activity row**, not the contact S chip: the chip needs a
   PXE sender list, which the smoke has none of. The spec seeds a finalized 1.5 USDC transfer under
   `nulo:core:txs@<hash>` for the active scope (profile, network, chain, account read from storage;
   the contract is the chain's seeded USDC, which the price map prices) and a fresh `usd-coin`
   quote through `seedUsdQuoteAndReload`, so Home renders `tx-card` with `activity-fiat`.
8. **"One new history entry"** is `history.length + 1` and one `history.pushState` call, counted by
   a wrapper installed on the page before the key press; "does not scroll" is the Space keydown's
   `defaultPrevented` (a handled keydown has no default action) plus a scroll-event count until
   the row's push.
9. **A cold tab drops its deep link — held for the owner.** The Ctrl-click's new tab opens at
   `#/popup/send?contact=<id>` and the wallet's boot then lands it on Home: the first navigation
   runs before the session check, `route-guard.ts:43` → `auth-guard.ts` returns `auth` while
   `isSessionChecked` is false, and once the session is confirmed `app.vue:321`
   (`shouldAdvanceToGeneral`) pushes `/popup/general` from the auth route. `send.vue:60-62`'s own
   comment names "cold-open / deep-link" as a known case. Read from the code and observed in the
   browser (the tab showed Home with the general testids after boot); not bisected, and none of
   it is in the plan's file list. Restoring a deep link after a cold boot changes which screen a
   user sees for every deep link, so it is not decided here: the spec asserts the tab opened at
   the link and the original tab stayed put, logs where the boot leaves the tab, and the
   "with that contact selected" half waits on the owner. `applyQueryContact` stays: it is what
   makes the preselect hold once the boot keeps the link.
10. **A `Popup` created already shown had no trap (codex consult).** Question: the edit-endpoint
    popup (`EditEndpointPopup.vue:92`, `<FormPopup v-if="endpoint" :show>`) is created with
    `show` already true, so `Popup.vue`'s non-immediate `show` watch never activates the trap —
    a real Escape reached nobody, the popup stayed, focus never returned; fix `Popup.vue`
    (`immediate: true` + tests), work around it in the e2e (close via ×, re-Tab), or restructure
    `EditEndpointPopup` so its `FormPopup` is always mounted? Verdict (codex, `high`, session
    `01a0d725-efae-75e1-9c92-3418876f9254`): fix `Popup.vue` with `immediate: true` — a latent
    bug of the component plus a `v-if`-gated caller, not something the row change caused (the
    button only exposed it); `immediate` runs at watcher creation (before children's mounted
    hooks can focus their inputs), the `await nextTick()` supplies the DOM wait, and a popup
    created hidden merely gets one harmless `deactivate()`; prefer it over `onMounted`, which
    would capture an autofocused child as the opener; cover created-shown and created-shown-then-
    gone in the unit test; the restructure hides the shared gap and changes what renders when the
    endpoint data disappears; the workaround weakens the requested keyboard scenario. Codex also
    asked for stronger e2e evidence that the row never activates (a click-event count at window
    capture cannot tell handler execution) and for the tooltip's own Escape to be ruled out:
    the spec now counts clicks bubbling to the row root (zero) and waits for the bubble to be gone
    before the one Escape, which it asserts was handled. Taken as advised.

Failing first:

- `typecheck:all` red on the first pass, three groups: `RowTarget.vue`'s `@keydown.space="navigate"`
  hands a `KeyboardEvent` to a `MouseEvent` handler (now `pressSpace(navigate, $event)` with the
  cast and its reason); `RowAction.test.ts`'s `h(RowAction, {...Record<string, unknown>})` lost
  the required `label` (the helper's props are typed now); `send.test.ts`'s `getContacts` mock
  was typed as returning `never[]` (`Promise<unknown[]>`).
- `bun run typecheck` at the repo root exits 127 (`vue-tsc: command not found` under the isolated
  linker); the gate's `typecheck:all` runs each workspace's own script and is what counts.
- `rows.test.ts` on Chrome, first run: 1 passed, 3 failed.
  - Contact row: the new tab never showed the recipient card. First cause: `send.vue` applied the
    URL contact only at mount, when a cold tab has no contacts yet (fixed, `applyQueryContact`);
    second cause, still there: the boot bounces the deep link to Home (decision 9). Retries also
    failed in `addContact` because `contacts-new-btn` renders only in the empty state — the spec
    now reuses the contact a previous attempt left.
  - Click row: Escape left the edit-endpoint popup open, unhandled, focus in its first input
    (decision 10).
  - History: two `<div>`s reported `scrollWidth > clientWidth` — the list containers, whose rows
    bleed 8px into the page padding by design (`overflow: visible` boxes count that bleed). The
    check now looks only at clipping ancestors and the document, plus the row's rect in the
    viewport.
- `Popup.test.ts`, first version of the "created shown then hidden before the tick" case: a trap
  IS created and released (the activation's continuation runs before the hide's post-flush
  watcher), so the deterministic case is created-shown-then-unmounted, which the token guard
  makes trapless.
- `test:all`, first run (recovery), exit 1: `TokenList.test.ts`, `TokensView.test.ts` and
  `holdings.test.ts` failed. Root cause: `TokenCard` now renders its row inside `RouterLink`'s
  `custom` slot and binds that slot's `navigate`.
  - The holdings and token-list `RouterLink` stubs had no `custom` prop and passed no `navigate`,
    so the Space handler threw.
  - `TokensView`'s shallow mount stubbed `RouterLink` to an empty element, so `tokens-card` never
    rendered.
  - The stubs now declare `custom` as a Boolean prop and render the slot with `href` and
    `navigate`, as the real link does. Committed separately.
- Smoke on Firefox, first run, exit 1: three of `rows.test.ts`'s four cases failed. The rest of the
  suite passed.
  - `Unknown key: "Space"`. Puppeteer's BiDi keyboard (Firefox) knows the space bar only by its
    key value, `" "`. CDP (Chrome) accepts both names. The spec now presses `" "`, so both
    browsers take the same key path.
  - The Ctrl-click witness read `"document"`. Firefox's `PerformanceNavigationTiming.name` is the
    literal `"document"`, not the URL.
    - `navigation.activation.entry.url` was tried next. Firefox has no Navigation API, so the read
      was still `"document"`.
    - The new tab's own URL cannot serve either: the cold boot routes it on at once (decision 9).
    - The witness is now the click itself. A capture-phase listener reads, after every handler has
      run, that the click carried the modifier, landed on the row's `href`, and was not
      `defaultPrevented`. That default is exactly what opens the new tab.
  - `rows.test.ts` alone after the fix: Chrome exit 0 (13 s), Firefox exit 0 (29 s). Then the full
    Firefox suite passed (below).

Held for the owner (not decided here): the Logs row and the `RevokeAuthwitsPopup` expand icon
(decision 6); a cold tab's deep link (decision 9). P1's two items stand.

Gate (recovery):

| command | exit | duration |
|---|---|---|
| `bun run lint` | 0 | 1 s |
| `bun run typecheck:all` | 0 | 41 s |
| `bun run test:all` (first run: the three stub failures above) | 1 | 117 s |
| `bun run test:all` (after the stub fix) | 0 | 103 s |
| Chrome build: `VITE_NULO_E2E_MIGRATION_FIXTURE=1 VITE_NULO_E2E_DEFAULT_NET=testnet VITE_NULO_E2E_TOKEN_SEEDS=1 VITE_NULO_E2E_TOKEN_SEEDS_CONFIRM=1 bun run --cwd apps/extension build:chrome` | 0 | 28 s |
| Firefox build: the same flags, `build:firefox` | 0 | 28 s |
| `cd apps/extension && NULO_E2E_BROWSER=chrome NULO_E2E_MIGRATION_FIXTURE=1 bun run test:e2e` (38 files passed, 3 skipped; 152 tests) | 0 | 968 s |
| the same with `NULO_E2E_BROWSER=firefox`, first run (the `rows.test.ts` faults above) | 1 | 1155 s |
| `rows.test.ts` alone after the fix, Chrome | 0 | 13 s |
| `rows.test.ts` alone after the fix, Firefox | 0 | 29 s |
| the full Firefox suite after the fix (39 files passed, 2 skipped; 148 tests) | 0 | 1052 s |

The full Chrome suite ran before the `rows.test.ts` fix. That fix touches only the spec, so the
Chrome evidence for the final spec is its own run above. The spec is linted and is not in any
`typecheck` project. `test:all` excludes `tests/e2e`.
