# Phase 3 · U6 title, `PermissionRow`, U7 Settings row

Built on `614c10a8` (P2 done). This phase changes the confirmation window's title (U6) and the
connected app's Settings page (U7).

Picks for U6, U7, A-15, A-19, A-28 and A-29 not re-read (the proposal artifact is unreadable from the current account); built as drawn, sign-off pending.

## What was built, per commit

| Commit | Step | What |
|---|---|---|
| `1df816dd` | P3.1 | `OperationCard.vue`: a local `opTitle` names `aztec_createAuthWit` "Authorization"; `humanize.ts` is untouched. The title's `Text` gets `execute-op-title`. The unused `humanizeOperationKind` import in `execute/index.vue` is removed. `OperationCard.createAuthwit.test.ts`: the addresses move below the modulus, and a title case with a wire-shaped call intent is added (`name`, `to`, `selector`, `type`, `isStatic`, `hideMsgSender`, `args`, `returnTypes`). |
| `0cd8eb6e` | P3.2 | `components/composite/capabilities/PermissionRow.vue` (L3), `PermissionRow.test.ts` (14 cases) and `PermissionRow.stories.ts` (switch on, off, broad, no switch, chip). |
| `5b46ce4b` | P3.3 | `connected-apps/[id].vue`: "If you allow, it can" above "Granted permissions", with the authorizations row and the dotted term, bound to `setAuthorizationsWithoutAsking`. A new `[id].test.ts` has 5 cases. `connected-app-row` goes on the list's `RowTarget`, and a `RowTarget.test.ts` case proves the testid lands on the anchor. |

## Red first

| Commit | Red run | Then |
|---|---|---|
| `1df816dd` | The title case against `HEAD`'s card: 1 failed of 4. The WIP card was copied to the scratchpad, `HEAD`'s file written in its place, the run made, and the WIP copied back. `cmp` confirmed it was identical | 153 passed (`execute/`) |

`PermissionRow` is new, and neither the Settings row nor `connected-app-row` existed before this
phase, so those tests have no separate red run. They look for testids and strings that were
absent until these commits.

## Failed attempts and why

- **`$style` is not on a `<script setup>` instance.** In the tests, `w.vm.$style` was
  `undefined`. The compiled module lives on the component as `__cssModules.$style`, and the
  tests read the class names from there.
- **The Settings page test failed on `chrome.storage.local.get`.** The stores read storage
  through the migration-aware facade on setup. The test stubs `chrome.storage` as the networks
  page test does.
- **The worktree guard refused a `sed` over a `find` result.** The file paths were found first,
  then read with literal paths.

## Decisions

- **`--hairline-soft` is not an extension token.** It exists only in the mock's stylesheet: rgba(74, 70, 63, 0.2) dark and rgba(124, 116, 104, 0.2) light (`nulo.css:30,71`).
  `PermissionRow` uses those two values, with a `[theme="light"]` override. The extension's
  existing rows use the dark literal in both themes (`GasBalanceCard.vue:188`). In 5a Settings
  shows one row, so the separator first renders in 5b.
- **The icon's colour is `--nulo-secondary`, as drawn.** `MaterialIcon`'s `secondary` maps to `--txt-secondary`, so the
  row's stylesheet sets the colour with a two-class selector that outranks the utility. A
  flagged row sets `--orange` the same way.
- **`PermissionRow` gains a `switchTestid` prop.** It is not in the plan's prop list
  (`plan.md:677-681`). The testid table gives the Settings switch its own testid,
  `connected-app-authorizations-toggle` (`plan.md:829`), so the row cannot hard-code
  `cap-toggle`. The prop defaults to `cap-toggle`.
- **The chip's warning icon is the extension's `Icon name="warning"`,** the glyph
  `DappIdentityBlock.vue:41` uses. The mock draws its own sprite (`#i-warning`).
- **The Settings write is optimistic and single-flight.** The switch shows the requested value
  while the write runs, and further taps are ignored until it settles. On success the returned
  session goes through the same handler as `onDappSessionUpdated`, which keeps the logo blob.
  On failure the switch reverts and the error snackbar "Couldn't save this setting" opens. An
  error snackbar stays until it is closed (`toast.ts`), as A-28's drawing says.
- **The dotted term in Settings carries `cap-auth-term`** (testid table, `plan.md:825`). This
  screen has one dotted term, within the two-per-screen limit.
- **Settings imports `permission-rows.ts` from the window's folder,** as the plan says
  (`plan.md:680-681`). Biome's layer rules allow a page to import it.
- **A-15's switchless row stays under "If you allow, it can",** as drawn
  (`gen_r5.py:988-993`). The drawing's note offers "Always asks you first" as the alternative.
- **The glossary's `where` for "authorization" is unchanged** ("Permission window · approval
  window"). Nothing renders it (`glossary.vue` has only the style), so Settings is not added to it.

## Plan text that proved wrong or ambiguous

- **`plan.md:1511` asks for "the focus-ring class".** The test pins that the switch carries the row's
  `.switch` class. Whether that rule wins the cascade over `Toggle.vue:61-63` is P9's
  computed-style check, as the plan says.
- **`plan.md:1513-1516` lists five `[id].test.ts` cases.** The fifth, "shows the effective state after a widening",
  is proved through `onDappSessionUpdated`, which is the path a widening takes while the page is
  open. The case then switches the broad row On, which records the broad consent.

## Gate

All four were run from the worktree root on `5b46ce4b`.

| Command | Exit | Notes |
|---|---|---|
| `bun run lint` | 0 | 29 warnings and 3 infos, all pre-existing (unchanged since P1). `complexity-baseline check OK` |
| `bun run typecheck:all` | 0 | 15 workspaces exited 0 |
| `bun run test:all` | 0 | First run, with no reruns. extension: 7641 passed, 4 skipped, 7 todo. wallet-bridge: 406 passed. Every other workspace green |
| `bun run --cwd apps/extension build-storybook` | 0 | Built `PermissionRow.stories` and its CSS; "Storybook build completed successfully" |
