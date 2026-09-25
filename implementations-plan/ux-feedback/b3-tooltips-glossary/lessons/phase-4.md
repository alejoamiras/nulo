# Phase 4 · Parity and arc gate (in progress)

Done here: step 4 (the flake bar) and step 1's captures. Not done yet: step 1's Artifact, step 2
(the local-gate row), step 3 (the network suite) and the reap that closes them.

## Flake bar (step 4)

`tooltips-glossary.test.ts` ran three times in a row on each browser. The runs used a scratch
config that spreads `vitest.e2e.config.ts` with `retry: 0` and was never committed. They ran on
the smoke build.

- Chrome: runs 1, 2 and 3 each exit 0, 3/3 tests.
- Firefox: runs 1, 2 and 3 each exit 0, 3/3 tests.
- `bun run e2e:reap` after each chain found nothing to reap.

## Captures (step 1)

- Mocks: `python3 implementations-plan/ux-feedback/design/mocks/build.py`, then
  `node implementations-plan/ux-feedback/design/shots.mjs`, rendered all 40 shots.
- Extra mock renders:
  - `targets.mjs` has no target for round 2's Settings panel (`#i9-f2 [data-opt="S"]`).
  - A scratch script rendered that panel, plus each shot's bare stage without its caption, in
    the same way.
  - It also measured every mock element this batch draws in the mock DOM: rects relative to the
    stage, type and colour.
- Throwaway specs, deleted after their runs:
  - A smoke spec covered Settings → App, the top of the Glossary and the import page.
  - A network spec covered two wallets:
    - on the `feeJuiceImported` wallet, Home with Private Fee Juice focused, and the token
      page;
    - on `dappConnectedExtension`, the Alias tooltip and the look-alike discover window.
- How each capture ran:
  - on Chrome and on Firefox;
  - at the popup's 360 × 600, or at the dApp window's own size;
  - in the app's dark theme, set through Settings → Appearance;
  - recording the rects and computed styles of what it shows.
- The suspicious host is the real discover window. The playground was served at
  `http://xn--tls-seda.localhost:<port>`: both browsers resolve `*.localhost` to loopback, and
  Vite allows the host. So no Storybook exception was needed.
- Decision: the padlock capture comes from the network suite's token page. The split renders
  only with a token balance (U-1). The token-seed flags only swap the default-token list for one
  the sandbox writes at run time, so a smoke wallet lists no token. The `feeJuiceImported`
  wallet holds the minted test token.
- Decision: the Glossary is captured from its top, as the shot renders it. The mock marks the
  panel to be drawn scrolled to Fees: it has `data-scroll-to` and the caption "Scrolled to Fees
  and Apps". That scroll never happens in the render:
  - `presetScroll` skips a panel with no height;
  - the panel's fold `#i9-f3` is `hidden` at load;
  - opening a fold re-runs layout but not the preset scroll.
  The page scrolled to Fees was not captured.
- Observation: Fact 14 overstates the smoke Home. Its gas card does leave the skeletons, showing
  `0 FJ` within 5s on Firefox and within 5–15s on Chrome. Zero is not the shot's amount, though,
  so the network capture stands.

## Parity differences

Values are Chrome's. Firefox's geometry is identical unless a difference is noted.

### Home, Private Fee Juice focused (`09-home-dotted`)

- The bubble is 272 wide at x 80–352; the mock's is 270 at 82–352. This is the cap difference
  the plan predicts. Its text box is 250 against 248.
- Identical to the mock:
  - The bubble's right edge sits 8px inside the window.
  - It sits 6px below the term (term bottom 183 → 189; the mock's 205 → 211).
  - It is 42.8 tall and wraps after "address".
  - Its background, border, shadow and 6px 10px padding match.
  - Its text is 600 12px/14.4px `--nulo-secondary`, left-aligned.
- Focus styles: because the capture focuses the term, it shows a 1px `--txt-primary` outline at
  2px and a `--txt-primary` underline. The mock pins the bubble open without focus, but these
  are the mock's own `.n-term:focus-visible` values. The unfocused Public term is drawn as the
  mock draws it: a dotted `--nulo-outline` underline, 3px under.
- The real card shows a private amount, and the open bubble covers it. The mock draws no private
  amount.
- Pre-existing:
  - The labels are 10px mono against the mock's 9px.
  - The labels span x 40–320 against the mock's 24–336.
  - The hero is the aggregate `$999.81`, with no symbol line and no split. The mock draws
    `1,514.10`, `USDC · $1,514.10` and the padlock/globe split (U-1). This moves the gas card to
    y 170 instead of 193.
- Data:
  - The public amount reads `1,000 FJ` with a fiat line; the mock's reads `1.20 FJ`.
  - The network pill reads `LOCAL NETWO…`; the mock's reads `TESTNET`.
- The mock crops at 300px. Below that, the capture also shows Send/Receive, Holdings, Recent
  transactions and the nav.

### Token page, padlock hovered (`tips-icon-labels`)

- The surface differs by U-1, because the split exists only on a token's page. The capture shows
  a `TST` sub-page header with refresh and menu, then a `1,000 TST` hero, `≈ $999.81` and the
  split `0 | 1,000`. The mock shows Home.
- The bubble is identical: 226.6 × 28.4, one line, 600 12px/14.4px `--nulo-secondary`,
  left-aligned, 6px below the split.
- The bubble's x is 26.6 against the mock's 32, because the two layouts place the split
  differently.
- Pre-existing: a vertical divider separates the padlock and globe groups; the mock draws none.
- On Firefox, the split's values are 15 tall against 14 and sit 2px lower, so the bubble sits 3px
  lower (255.5).

### Settings → App (round 2's i9 Settings panel)

- The Glossary row is as drawn: `menu_book`, "Glossary", "What Nulo's words mean" and a chevron,
  between Proving and Advanced.
- The mock's accent bar marks the new row. It is an annotation, and was not built.
- Pre-existing:
  - Every row is 72 tall against the mock's 68.
  - The first group has no "SECURITY" section title; the page's "SETTINGS" title sits above it.
  - Security & Backup uses a lock icon (the mock, a shield), and Connected Apps a puzzle piece
    (the mock, a link).
  - Descriptions:
    - Security & Backup: "Auto-lock, recovery phrase" against "Password, auto-lock, backup";
    - Connected Apps: "Apps with granted permissions" against "2 apps";
    - Proving: "In browser · Presto not set up" (its live state) against "In this browser".
- Capture framing:
  - The mock shows the page scrolled. The capture keeps the app header and the page title.
  - The capture lined up Advanced's bottom with the window's bottom, which puts the row under
    the nav.
  - Whether the page can scroll Advanced clear of the nav was not captured.

### Glossary, top (`09-glossary`)

- Everything this batch draws matches the mock exactly:
  - Each entry is 81.1 tall, with its term, definition and where-line at +12, +33 and +55.1.
  - The term is 600 14px. The definition is 12.5px/18.125px `--nulo-secondary`. The where-line
    is 9.5px mono, 0.06em, uppercase, `--nulo-outline`.
  - Section titles are 700 10px Space Grotesk with 0.2em tracking, and a later title's box is 33
    tall.
  - The first title's text sits 22px below the sub-page header (120 → 142; the mock's 48 → 70).
  - Entries are separated by `rgba(74, 70, 63, 0.2)`.
- Pre-existing:
  - The app header (account, network, lock) sits above the sub-page header.
  - The sub-page header is 56 tall, with a 22px arrow in a 40px button at x 24. The mock's is 48
    tall, with a 20px arrow at x 12.
  - As a result, the list starts 72px lower and the capture ends at "Private Fee Juice", where
    the mock reaches "Sponsored".
- Pre-existing, not visible in dark: in the light theme the separator keeps the dark literal.
  The mock's light value is `rgba(124, 116, 104, 0.2)`.
- On Firefox the definition's line height computes to 18.1333px; the box is still 18.1.

### Import, recovery phrase (`tips-phrase-U9`)

- Identical: the label sits 8px above the note and the note 8px above the field. The note is
  500 12px/16.2px `--txt-tertiary`.
- The note wraps to three lines in both. The breaks differ: the popup's column is 312 wide and
  the mock's crop is 368. That is the crop's width, not a layout difference.
- Pre-existing: the field is the app's `Input`, 51 tall with an eye toggle. The mock draws a
  44px field with 15px text and no toggle.
- Outside the mock's crop: the back arrow, the IMPORT PROFILE hero, the New Password field and
  the two buttons.
- The Firefox capture is light. BiDi cannot emulate `prefers-color-scheme`, and a fresh
  extension has no Settings screen to set the theme from.

### Capabilities window, Alias tooltip (`02-tooltip`)

- As drawn (U-6): the bubble is centred on the ⓘ and clamped to x 8. It sits 6px below the ⓘ
  (240 → 246), and is 272 wide against the mock's 270 (the cap).
- **Pre-existing, still unlike the drawing:**
  - The text is centred where the mock left-aligns it: the tooltip passes no `textAlign`, and
    the primitive defaults to `center`.
  - The bubble is 44.8 tall (44 on Firefox) against the mock's 42.8. Its content is an inline
    `<Text size="12" color="secondary">` with `line-height: 1.2`. The bubble's text box keeps
    `line-height: normal`, which makes each line 15.4 tall against 14.4.
  - This batch changes only the tooltip's position, and batch 5 removes this ⓘ.
- The row is inset. The card starts at x 37 and the ⓘ at x 115; in the mock they are at about
  16 and 100.
- Data: `Account 1` and `SANDBOX`, where the mock has `Account` and `TESTNET`; the address
  differs.
- Outside the mock's crop:
  - the status strip;
  - the identity block;
  - the permissions list;
  - Reject and Approve.
- The Firefox window is 400 × 767 against Chrome's 400 × 600, and its content sits 2px lower.

### Discover window, suspicious host (`tips-host-U8`)

- Identical to the mock:
  - The icon comes first. It is 12px and sits 1px down, with 6px to the text.
  - The text is 500 12px/15.6px `--orange`, rgb(255, 85, 0).
  - The line sits 4px under the host, and the name 4px under the line.
  - The logo's top lines up with the host's.
- The sentence wraps to three lines, with different breaks. The window's block is 360 wide at
  x 20, so the line is 276 wide and its text 258. The mock's block spans 400, so its line is 316
  and its text 298. That width is the window's existing layout.
- Pre-existing: the logo is the fallback dApp glyph, a puzzle piece; the mock draws a globe.
- Data:
  - The host is `xn--tls-seda.localhost`, the look-alike the local playground can serve; the
    mock's is `xn--tls-seda.nulo.sh`.
  - The name is `nulo-playground` against `nulo-tools`.
  - The action line reads "wants to connect to your wallet", the window's own label, against
    "wants to connect on Testnet".
- Outside the mock's crop:
  - the status strip (ACCOUNT 1 and Local Network, with NULO on the right, under a white top
    rule);
  - the trust note;
  - Deny and Allow.
- The Firefox window is 400 × 767, and its content sits 1px lower.
