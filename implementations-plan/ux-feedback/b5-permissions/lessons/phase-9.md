# Phase 9 · e2e for the window

Built on `f34aff90`, P8's tip. The e2e suite now reads the rows the grouped window draws, and
`cap-window.test.ts` drives what jsdom cannot show. The fit case found that every dApp window
lays out in the popup's 360px column while its drawing is 400px wide. "main" routed that to
option (b): the permission window fills its window, and the other windows stay as they are.

## What was built, per commit

| Commit | Step | What |
|---|---|---|
| `a8d311d5` | P9.1 | `PermissionGroup.vue` marks a flagged row with `data-cap-flagged`, and `CapabilityDisclosure.vue` names its chevron `cap-disclosure-chevron`. In `index.test.ts`, every real-rows read asserts that the attribute matches the flagged class. |
| `dac3cceb` | P9.1, P9.2 | `fixtures/popups.ts`: `approveCapabilities({ aliases })` presses "Rename for this app" while the field is closed, and `getCapItems` also returns `row` and `flagged`. Updated specs: `cap-request-basic`, `cap-request-rerequest`, `cap-request-accounts` (its header only). |
| `e8820e85` | width (b) | `popup/root-flags.ts` sets `data-has-nav` and `data-fills-window` on `<html>` from the route meta, and `app.vue`'s watch calls it. `popup/index.scss` adds `:root[data-fills-window="true"] body { width: 100% }`. The permission window's route declares `"fillsWindow": true`. `root-flags.test.ts` has 2 cases. |
| `da48c2b4` | the Firefox strip | `IdentityStrip.vue`: the separator's `line-height: 14px`. |
| `7e05a2a5` | P9.3 | `tests/e2e/network/cap-window.test.ts`, 4 cases. |
| `93229087` | fix | The fresh-window keyboard flow moves to its own case, on its own connect (below, red run 2). `cap-window` has 5 cases. |
| `b7c8462d` | fix | That case presses `" "`, not `"Space"` (red run 3). `tests/e2e/FIREFOX.md` lists the difference among the others. |
| `65f070ad` | docs | plan.md: P9 ✓, P10.3 lists `window-placement` on both browsers, two sign-off pending lines and a visible consequence. This file. |
| `83ac87ee` | fix | The fit case says in one line that S2's fit bounds S1's; the Decisions bullet below names the S1-like measurement P10.1 records. |

## Tests

- `cap-window.test.ts` has 5 cases on `dappConnectedExtensionPerTest`, one connect each.
  - **Keyboard and Details.** Tab runs account target, rename link, the "authorizations" term,
    its switch, then Details. The focused switch's computed `outline-style` is `solid`.
    - The rename link and the copy button are each at least 24px in both dimensions.
    - Enter opens Details and its first row. Tab skips the copy button. A real click on the copy
      button writes the token's address and leaves the row open.
    - Enter on the rename link opens the focused field.
  - **Space and Enter on a fresh window.** Space deselects the account target, Enter selects it
    again, and `aria-pressed` follows each press. Space on the rename link opens the field. This is
    the proof owed from P8.2 (lessons/phase-8.md, "Plan text", item 1). It has its own connect
    because the window after a rejection is a re-request (red run 2).
  - **Reduced motion**, Chrome only. The reason line sits above it: the chevron's
    `transition-duration` goes from `0.2s` to `0s`.
  - **Fits and the inline term.** It checks that the rows are exactly S2's, with the note and
    Details closed. No scroller overflows, and the document fits the viewport. The dotted term's
    boxes lie inside its line, with a baseline within 1px of the sentence's.
  - **A-5.** Connect `transaction-listed` with the switch On. Then `transaction` shows the
    authorizations row Off and flagged. After Allow, the next call intent opens the window
    titled "Authorization".
- `root-flags.test.ts`:
  - a route that fills its window marks `<html>`, and the next route clears it;
  - the nav flag follows `showBottomNav` and nothing else.
- `cap-request-basic` keys its rows by row and reads their types: `{ contracts: "contracts",
  simulation: "simulation" }`.
- `cap-request-rerequest`: both requested types were declined, so each of the three rows carries
  the badge: `contracts`, and `address-book` and `private-events` (both drawn by the `data` type).
- `cap-widening` needed no edit. It reads no rows, and the fixture's rename press covers its
  alias.
- No test was deleted.

## Decisions

- **The rows are keyed by `data-cap-row`, not the type.** One `data` type draws two rows, and the
  unknown row has no `data-cap-id`.
- **The fixture presses the rename link only while the field is closed.** A row whose rename was
  pressed keeps its field open (P8), and pressing the link a second time would find no link.
- **`cap-window.test.ts` keeps its helpers local.** `callIntentAsks` is `authwit-variants`'s
  `signThroughWindow` with the call-intent button and a reject. `openWindow` is the first half of
  that file's `connect`. That makes two copies, under the three-copy threshold.
- **Firefox makes a scroll area a Tab stop while it overflows.** The first Firefox run met the
  scroll area as the first stop, before the account target, because the 360px window
  overflowed. Once the window fits, the area has nothing to scroll and no stop remains. The
  sequence assertion is unchanged.
- **A rejection makes the next window a re-request.** It records every type in the request as
  rejected, so the same bundle asked again badges each row "previously denied". Five badged
  rows run the window 27px over (scroll height 717 against 690), and Firefox's scroll-area stop
  comes back. A flow that needs a first request after a rejection gets its own connect.
- **Keys are pressed as characters.** Puppeteer's BiDi keyboard has no `"Space"`; `" "` works
  on both browsers.
- **S1's fit is bounded by S2's**, as P9.3 states: S1 is S2 without the note, so S2 fitting
  means S1 fits. The fit case says so in one line. The playground has no bundle that names a
  contract the wallet knows, so no committed flow draws S1. P10.1 records the S1-like window's
  scroll area in both browsers at 400×800 (scroll height against client height, 0 overflow
  expected), beside the story's exact 12 rows.

## The window width (P9.3's fit)

The first Chrome run failed the fit with `[722, 690]` (scroll height, client height), and the
first Firefox run with `[723, 689]`.

- `popup/index.scss` gives `body` `var(--base-width)`, 360px, centred in the 400×800 window.
  Every drawing of a dApp window (`.n-win`) is 400px wide. Arc 5a's parity captures show the
  same 20px bands, and nothing recorded them.
- At 360px the authorizations title (246px natural) and its on-line (239px) wrap in a 234px
  column; the drawing's column is 274px. The row is 87px against the drawing's 54px, which puts
  S2 32px over.
- A probe with `body` at 100% gave Chrome 690/690, with the row at 53.64px and every block equal
  to the drawing's. Firefox gave 690/689, which is also what the drawing measures in Firefox: its
  strip is 36px there.
- "main" chose option (b). A root attribute, driven by route meta, lets the permission window
  fill its window. Extending it to another window is one line in that window's route block.
- **The Firefox strip.** The "·" separator (JetBrains Mono, 11px) has a normal line box of 15px
  in Firefox and 14px in Chrome. `line-height: 14px` pins it to Chrome's box, "main" approved
  the pin on condition that Chrome stays pixel-identical, and it does:
  - Chrome strip crops (400×39) before and after: 0 differing pixels in discover, verify,
    capabilities and execute. Whole windows: discover is identical, and the other three differ
    only below row 187, in the emoji codes, addresses and hashes each run draws anew.
  - Firefox strip heights: discover 36 → 35, capabilities 36 → 35, execute 36 → 35, verify
    35 → 35. On a first connect, verify shows no network, so it has no separator.
- **Restack step, for arc 4's snack change.** Add `"windows-capabilities"` to `ToastManager`'s
  `FULL_WIDTH_WINDOWS`, beside `windows-json` and `windows-logger`. The test it needs goes in
  `ToastManager.test.ts`: on `windows-capabilities` the base gets `inColumn: false`, so the
  snack takes the popup's rule (`calc(100% - 32px)`, capped at 368px). The set is not on this
  base, so it cannot land here.

## Held and asked

- **The owner question on the width**, which "main" reports to the owner:
  - (a) every dApp window fills its window, so every drawing matches and the snack follows the
    popup rule in all of them;
  - (b) as built;
  - (c) keep 360px everywhere and accept S2's 32px scroll.

## Sign-off pending, added in this phase (plan.md § Delivery)

- The permission window fills its 400px window, as drawn, while the other dApp windows keep the
  360px column.
- Its snack follows the popup's rule, 368px, where 11a's 328px was set for the 360px column (from
  the restack above).

Visible consequence, listed in plan.md § Delivery: "Firefox: every dApp window's identity strip
that shows its network is 1px shorter, now the drawings' height; one without a network was
already 35px."

## Plan text that proved wrong or ambiguous

1. **P9.3's fit** assumes the window lays out at 400px. Every dApp window lays out in the popup's
   360px column, where S2 does not fit.
2. **P9.2** lists `cap-widening` among the specs to update where they read cards. It reads none.
3. **The fit in Firefox.** The drawings themselves overflow by 1px there, so parity alone could
   not reach a zero overflow without the strip pin.

## Gate

Every row ran at `b7c8462d`; the unit rows also ran, with the same counts, on the tree before it
was split into commits. The e2e rows cover the five changed or new files: `cap-window`,
`cap-request-basic`, `cap-request-rerequest`, `cap-request-accounts`, `cap-widening`.

| Command | Exit | Evidence |
|---|---|---|
| `bun run lint` | 0 | 29 warnings and 3 infos, none in a file this phase touched; `complexity-baseline check OK` |
| `bun run typecheck:all` | 0 | 15 workspaces |
| `bun run test:all` | 0 | extension 7,700 passed, 4 skipped, 8 todo (593 files, 3 skipped); wallet-bridge 423; design 393; aztec-runtime 250, 2 skipped; wallet-core 247; extension-messaging 229; wallet-crypto 120; third-party-notices 66; legal 54; landing 40; resolve-asset 14; wallet-sdk-schema-patch 11; passkey-rp 5, 6 skipped |
| Chrome, prover on: `NULO_E2E_BROWSER=chrome NULO_E2E_RETRY=0 NODE_OPTIONS=--dns-result-order=ipv4first bun run e2e:agent <the five files>` | 0 | 5 files, 9 passed, 155 s (`p9-chrome-3`, at `93229087`) and 9 passed, 157 s (`p9-chrome-4`, at `b7c8462d`) |
| Firefox, proverless: the same with `NULO_E2E_BROWSER=firefox NULO_E2E_PROVERLESS=1` | 0 | 5 files, 8 passed and 1 skipped (reduced motion, Chrome only by name), 208 s (`p9-firefox-4`) |
| `bun run e2e:reap` | 0 | after every run: nothing to reap |

## Red runs

- `p9-chrome-1`, before the width. 7 of 8 passed, and the fit failed with
  `expected [ [ 722, 690 ] ] to deeply equal []`.
- `p9-firefox-1`, before the width. 5 passed and 1 skipped; 2 failed:
  - the keyboard case met a leading `{ tag: "DIV", testid: "none" }` stop (the scroll area,
    above);
  - the fit failed with `[ [ 723, 689 ] ]`.
- `p9-firefox-2`, with the width and the strip. The fit passed. The keyboard case failed where it
  opened a second window after rejecting the first: the first stop was
  `{ testid: "none", tag: "DIV" }` again. A probe of that window found the re-request (above): 5
  badges and a 717/690 scroll area. Fixed in `93229087`.
- `p9-firefox-3`, at `93229087`. The split case threw `Error: Unknown key: "Space"` from
  puppeteer-core 25.8.0's `BidiKeyboard.press` before its first key. That library's
  `getBidiKeyValue` passes a single character through and knows no `"Space"`; Chrome's CDP layout
  does. This was the third red Firefox run of this gate, so it was reported to "main" before the
  fix, with the root cause of each (the width, the re-request, the key name). "main" approved the
  fix and asked for the `FIREFOX.md` row. Fixed in `b7c8462d`.
