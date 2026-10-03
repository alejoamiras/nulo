---
plan: harden-dedupe / visual-shells-b (arc 4 of 25)
tier: light
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/04-visual-shells-b, stacked on hd/05-error-registry
---

# visual-shells-b: detail-page shell and token sweep

This batch covers findings Q-22 (d, f, i) and the Q-23 (b) sweep, from `audit/quality/2026-09-30-dedup-high/`. Two of the three Q-22 items are deferred (see Deferred), so the work that ships is Q-22 (d) and the sweep.

visual-shells-a owns Q-22 (a, b, c) and the hairline literals in `ContactRow.vue`, `connected-apps/index.vue`, `SettingItem.vue` and `SettingField.vue`. This arc never edits those files. The hairline in `AccountSelectRow.vue` moved here from that arc.

## Outcome & Quality Bar

- **For whom:** the next person who restyles a detail page, a hairline or a scrim. Today that means editing the same rule in two or three detail pages and grepping 13 hairline and 6 scrim literals.
- **Excellent:**
  - The three detail pages take every rule they share from `detail-page.module.css`, and each page keeps only its own rules.
  - No `rgba(74, 70, 63, 0.2|0.3)` and no scrim `rgba(10, 9, 8, α)` literal is left outside `base.css`, apart from the sites listed under Deferred.
  - Every touched screen renders pixel-identical on Chrome and Firefox, in dark and light, proven by the zero-diff harness. That holds for every chunk load order the harness drives.
- **Good enough:** a site whose state the offline harness cannot stage keeps its literal and is listed under Deferred. Nothing ships on proxy evidence; source identity never counts as evidence.

## Architecture & Implementation

Paths are under `apps/extension/src/` unless they start with `packages/`.

### Cascade rule for every shared rule

A composed CSS module is copied into the CSS of every lazily-loaded chunk that composes it. Visiting a second page re-injects the shared copy after the first page's local rules, so source order across chunks is not stable. The built CSS confirms that the shared rules are duplicated into all three detail chunks, each copy ahead of that chunk's local rules.

On each element, shared and local declarations stay disjoint, or the local declaration wins by strictly higher specificity. The one exception is the existing overlap on tx's hash link (Fact 3), which this arc keeps as drift.

Template classes, `data-testid`s and DOM order do not change.

### Q-22 (d): detail pages

Sites, with rule line numbers read today:

| rule | `tx/[id].vue` | `received/[id].vue` | `journal/[id].vue` |
|---|---|---|---|
| `.wrapper` | 358 | 341 | 314 (+ `padding-bottom`) |
| `.content` | 365 | 348 | 322 (different padding) |
| `.meta_sep` | 381 | 360 | — |
| `.hero_link` | 387 | 366 | — |
| `.detail_link` | 418 (+ `color`) | 478 | — |
| caption (10px headline, uppercase, secondary) | `.amount_caption` 437, `.address_label` 477 | `.address_label` 445 | `.origin_label` 369 (dead) |
| type chip | `.transfer_type_chip` 446 | `.transfer_type_chip` 406 | `.category_chip` 349 |
| `.address_card` | 461 | 421, `.card_static` override 437 | — |
| `.detail_value_aux` | 508 | 472 | — |
| `details_box` values | — | — | `.dev_box` 405 |

**Shared part.** `popup/pages/detail-page.module.css` gains these rules at today's exact values:

- `wrapper` and `content`;
- `meta_sep`;
- `hero_link`, with its `svg` and `:hover` children;
- `detail_link`: decoration, cursor, transition and the `:hover` colour, but no base colour;
- `caption` and `type_chip`;
- `address_card`, with its `:hover`;
- `detail_value_aux`.

Each page's local class becomes `composes: <name> from "../detail-page.module.css"`, the pattern the file already uses. `journal/.dev_box` composes the existing `details_box`.

**Local deltas, kept:**

- **journal's spacing.** `journal/.wrapper` keeps `padding-bottom: var(--nav-clearance)` beside its compose; the shared rule never sets that property. `journal/.content` stays local.
- **The link colours.** `tx/.detail_link` keeps `color: var(--txt-secondary)`, and `received/.detail_link` has none. The shared `:hover` colour is (0,2,0), so it beats either base colour in any load order.
- **The static card.**
  - `received/.card_static` becomes `.address_card.card_static` (0,2,0) and `.address_card.card_static:hover` (0,3,0), against the shared (0,1,0) and (0,2,0).
  - Today it wins only by source order inside one file. After the move, a received → tx → received visit would give a static card the pointer cursor and the hover fill.
  - The new selector carries one comment: `/* Outranks shared card rules reintroduced by later-loaded detail chunks. */`.
- **Rules with no twin stay local:** `received/.fee_shimmer`, `.detail_key_note`, tx's call box and `.detail_value`.
- **Dead rules go.** `journal/.origin_row`, `.origin_label` and `.origin_value` have no template reference, so they are deleted, not shared.
- **Comments.** The three-line colour history at `tx/[id].vue:397-399` goes, along with journal's narrations at `:347-348` and `:404`. They describe their rules rather than a constraint.

**Script.** The format string `"MMM dd, yyyy 'at' HH:mm"` appears five times: `tx:91`, `received:121-122`, and `journal:145` and `:150`. It becomes one exported constant in a new `popup/pages/detail-page.ts`.

- Each call keeps its own `DateTime.fromMillis` or `fromSeconds`, so milliseconds stay milliseconds and seconds stay seconds.
- The fee valuation and the dev-flag reads have only two copies each, so they stay as they are.

### Q-23 (b): token sweep (exact value matches only)

**Hairlines.**

- `var(--hairline-soft)` (0.2):
  - `components/composite/activity/TransactionAwaitingCard.vue:150`, `TransactionTerminalCard.vue:103` and `TransactionIncomingCard.vue:93`;
  - `popup/components/modules/activity/TransactionCard.vue:213`;
  - `components/composite/capabilities/PermissionRow.vue:81`;
  - `popup/components/Navigation.vue:61`;
  - `popup/components/modules/general/GasBalanceCard.vue:188` and `RecentActivityView.vue:883`;
  - `popup/components/modules/send/fee-shared.module.css:4`;
  - `popup/pages/settings/glossary.vue:60`.
- `var(--hairline-strong)` (0.3): `components/composite/activity/TransactionCardLayout.vue:198` and `popup/windows/capabilities/AccountSelectRow.vue:140`.

**`DetailsTable.vue`.** It declares its own `--hairline-soft` on `.table` (`:137`), which shadows the global token, and a light twin at `:143-145`, `rgba(124, 116, 104, 0.2)`.

- The dark line equals the global value, so it is deleted and `.table` inherits the token.
- The light twin is declared on `.table` itself, so it overrides the inherited value whatever the root selector's specificity. Light renders as today.
- The light overrides in `PermissionRow` (`:84`) and `glossary` (`:63`) are stronger `border-*-color` rules and stay untouched.

**Scrims**, mapped to their role tokens:

- `components/Popup/Popup.vue:148` and `components/composite/DappCancelledOverlay.vue:33` → `--scrim-popup`;
- `components/LegalAcceptanceSheet.vue:136` → `--scrim-sheet`;
- `components/GlobalLoader.vue:33` keeps its literal: its spike failed on Firefox (Phase 0, see Deferred);
- `components/passkey/PasskeyCeremonyDialog.vue:107` → `--scrim-loader`;
- `components/composite/BarrierOverlay.vue:31` → `--scrim-barrier`.

**Out of scope:**

- the shadow alphas (`NotificationManager.vue:111`, `JsonViewer/LogsViewer.vue:308`, `packages/design/src/ui/Tooltip.vue:250`, `ToastManagerBase.vue:216`), which have no token;
- `rgba(35, 31, 28, 1)`, which equals `--nulo-border` only in dark (`base.css:86`, against `:158` in light), so no token carries that exact value in both themes.

### Not taken

- **A `type_chip` shared with the activity cards' `.chip`.** Those rows have no Q-22 finding, and their chips differ: `TransactionCard` has no `flex-shrink` or `white-space`, and the incoming chip is green.
- **Widening `Skeleton` with custom properties so `received` could adopt it.** That would add a design-package API for one consumer and freeze a look that owner call 5 may change.

## Security & Adversarial Considerations

- **No change to data, input, crypto or dependencies.** The arc touches CSS custom properties, `composes` and one constant.
- **Approval surfaces.** The capabilities window gets only a token swap, in `AccountSelectRow`, `PermissionRow` and `DetailsTable`. The 2026-09 approval-card regression came from an unreviewed visual change. So those surfaces are shot in both themes on both browsers, and the stub payload is wire-shaped (`0x` + 64-hex addresses).
- **Cascade slips that hide or fake copy.** Two examples: a static receipt card that looks clickable, or a scrim that stops dimming behind the legal sheet. The cascade rule, the load-order matrix and the computed-style probes cover them.

## Assumptions

**Facts** (read 2026-10-03 on `origin/harden-dedupe` 0abf63a3, plus Codex's audit):

1. **The shared module exists.** `detail-page.module.css` already holds 10 shared rules, and all three pages compose them (`tx:369-552`, `received:352-523`, `journal:326-428`).
2. **The static card wins only by source order.** `received/.card_static` (`:437-443`) overrides `.address_card` (`:421-435`) on `received-from-card` when `fromClickable` is false (`received:237`).
3. **tx's hash link already depends on load order.** It carries both `detail_value_mono` (shared, `color: txt-primary`) and the local `detail_link` (`color: txt-secondary`) at equal specificity (`tx:268`, `tx:418-427`).
   - When tx's chunk is the last one loaded, the link is secondary.
   - After a later received or journal chunk loads, it is primary.
   - Hover stays accent either way.
4. **Journal's `.origin_*` rules are dead.** `journal:365-383` are referenced nowhere: no template use, class binding or dynamic lookup.
5. **The tokens match the literals.** They exist at the literals' exact values in `:root, [theme="dark"]` (`packages/design/src/base.css:107-113`), and light does not redeclare them.
6. **Every site inherits the tokens.** `popup/index.ts` and `onboarding/index.ts` both import `@nulo/design/base.css`, which covers teleported sites too.
7. **Undeclared tokens are caught.** The `theme-vars` guard rejects any undeclared `--hairline-*` or `--scrim-*` reference (`packages/design/src/theme-vars.ts:15`).
8. **Seeding and reloading.**
   - Rows can be seeded raw without MACs: `nulo:core:txs@<hash>`, `nulo:core:incoming-transfers@<id>`, `nulo:core:tokens@<id>`, and `nulo:journal@<id>`, which `OperationRecordSchema` parses (`operation-journal/service.ts:108`, `spec.ts:228-249`).
   - Transactions reach Home only through `appStore.transactions`, whose snapshot refreshes at bootstrap and on account or network changes (`app.store.ts:630`, `popup/app.vue:135`). So a seed needs a page reload (`tests/e2e/rows.test.ts:85`).
   - The reaper sweeps non-terminal rows at SW start, and every minute after the per-stage grace period: 35 min for `proving` (`reaper.ts:72-81`). GC never evicts failed rows.
9. **What the harness does today.**
   - One document serves every surface and both themes (`_hd-shots.test.ts:202`).
   - `unsettled()` fails on a visible `[class*="spinner"]`, `global-loader` or `snackbar` (`:79`).
   - The awaiting card's `Spinner` builds to `._wrapper_…`, so it does not trip that check.
10. **Rich snack states.** The only producer of an error snack with `sub` and `action` is a failed send (`popup/pages/send-submit.ts:98`).
11. **ToastManagerBase layouts.** Its consumers render `inColumn=false` in onboarding and `true` in the dApp windows (`components/ui/ToastManager.vue:16`). Popup shots cover neither.
12. **The received fee row.** `received` fetches a fee only for `public-event` receipts (`received/[id].vue:167-176`). A note receipt never shows `received-fee-loading`.
13. **GlobalLoader reconnects.** The client reconnects immediately after a disconnect (`background/client.ts:94`). A synchronous failure to open the profile port is the one outcome it does not retry.
14. **PermissionRow on the connected-app page.** That page renders at most one `PermissionRow` (`connected-apps/[id].vue:324`); its grants render through other components.

**Inferences:**

- A local class whose rule holds only `composes` is still exported, so `.address_card.card_static` matches. The probes confirm it.

**Asks:** none open; the panel answered all three (see Decisions).

## Phases

### Phase 0: harness surfaces and stability (no product code)

Phase 0 starts once visual-shells-a frees the harness. It makes the two harness changes under Decisions, then writes `surfaces/visual-shells-b.ts`.

**Every surface:**

- asserts its counts before the shot and again after settling;
- makes every changed element visible in some capture, by scrolling to it or by taking a second shot;
- leaves the price feed live: no surface intercepts it, and the fiat lines (USDC at today's price) are in the shots. A price move turns a shot into a diff, never into a false match;
- uses a fixed timestamp for every seed, except the proving row (below);
- asserts its stub's served-call count;
- carries a computed-style `probe` of every element whose class moved, leaving out keyframe names. Of the 18 probed surfaces, 8 walk rest, hover, pressed and focus (the tx and received detail pages); the other 10 are rest-only. A watched selector that matches nothing fails the probe. Links, cards and the hero links also get a real hover capture.

**Seeding.**

- Write the rows, then reload the extension page while keeping the worker running.
- Refresh the proving row's `updatedAt` after any restart, so the reaper never sweeps it.
- Remove the extra fixtures (the mint and second tx rows) between theme passes so the counts stay valid.

**Detail-page load order.** Each theme's detail sequence starts in a fresh document. The two sequences, with the expected tx hash-link colour after each step:

- **received-first:** received (from card static) → tx (secondary) → journal → received (static card still `cursor: default` with no hover fill) → tx (primary).
- **tx-first:** tx (secondary) → received → tx (primary).

**Surfaces:**

| surface | route / state | reach | asserted |
|---|---|---|---|
| home-activity | `#/popup/general`, plus a scroll-end shot | seeds: a token row; a transfer tx; a note receipt (block 1); a failed journal row (`from: "simulating"`, error with `normalizedRaw`, `transferType`); a `proving` journal row (`enteredProveAt`). Then reload. | `activity-icon` = 4; one each of `tx-awaiting-subtitle`, `tx-terminal-subtitle` and `tx-incoming-kind-chip` |
| activity-page | `#/popup/activity` | same seeds | `activity-icon` = 3 |
| token-detail | `#/popup/tokens/<id>`, no activity | `seedTokenRow` | `activity-feed-root` = 1 |
| glossary | Settings → Glossary, plus a scroll-end shot | none | `glossary-entry-*` ≥ 2 |
| capabilities | `#/windows/capabilities?requestId=hd-cap`: top, the account list, disclosure open with one row expanded, scroll end | port stub `dapp-interaction`: `getInteractionPayload` returns a wire-shaped `CapabilityPayload`, with two `availableAccounts` and one group holding two adjacent capabilities; `isInteractionCancelled` returns false | `cap-account-item` = 2; two adjacent `cap-item` in one group; `cap-details-row` ≥ 2; `cap-details-fns` = 1 |
| capabilities-cancelled | same route | same stub, but `isInteractionCancelled` returns true | DappCancelledOverlay = 1 |
| receive-popup | Home → receive | none | popup = 1 |
| legal-sheet | Home | `reloadWithLegalState`, then `waitForSheet(page, "review")`; on leave, restore the record | sheet = 1 |
| migration-blocked | Home | write `nulo:schema:blocked = { terminal: true }`; on leave, remove it | `migration-blocked` = 1 |
| passkey-dialog | `#/popup/profile/new`: passkey method, name typed, create pressed | `navigator.credentials.create` stubbed to never settle; `busy` covers the dialog spinner | dialog = 1 |
| global-loader (spike, ≤ 30 min): **failed, dropped** | new page | preload via `evaluateOnNewDocument` that fails the profile port's open synchronously | passed on Chrome; on Firefox the preload never ran in the moz-extension document, by driver or page-initiated navigation |
| send-fee | `#/popup/send`, the fee card scrolled to the middle | none: the live testnet read. A refused RPC (as in `send-fee-privacy.test.ts`) degraded the card in some captures and not in others within 5 min, so it could not be held | the card settles on sponsored with no notice, pinned as an exact fingerprint that must still hold after the shot; its two `detail_row` rows, the cost readout and the priority row, are fully on screen and probed |
| received-detail | `#/popup/received/<id>` | note-receipt seed; it never fetches a fee and renders no fee row (Fact 12) | `received-detail-page`, `received-from-card` and `tx-explorer-link` = 1 each; `received-fee-loading` = 0; probe the from card (static) and the To card |
| received-public | `#/popup/received/<pub id>` | public-event seed from another account; its fee lookup asks the live node for an unknown tx and settles on the dash | `received-fee-loading` = 0, then `detail_value_aux` = 2 (the fee dash and the block hash), probed |
| tx-detail | `#/popup/tx/<hash>` | transfer seed with a dApp origin and a `block` (number and hash), so the block-hash aux line renders | `tx-hash-link` = 1; the aux line visible |
| tx-mint | `#/popup/tx/<hash>` | a call to `mint_to_private` with its two arguments and a registered token with known decimals (`utils/tx-amount.ts:39`) | `tx-hash-link` = 1; the "Mint amount" caption visible |
| journal-detail, journal-dev | `#/popup/journal/<id>`; then the same page with Developer Mode on (Settings → Advanced), turned off on leave | failed-row seed | `journal-detail-state` = 1, `journal-detail-transfer-type` = 1; then `journal-detail-error-message` = 1 |

**Validation gate:**

- The local screenshot harness (outside the repo), run as `--batch visual-shells-b --base <parent> --stability`, reports ALL IDENTICAL on both browsers.
- A forced-diff check (`--head dist:<throwaway>` built with one hairline and one scrim alpha nudged and `card_static` dropped) reports a diff on exactly the surfaces that show them.
- Any surface that cannot be staged is recorded here, and its site moves to Deferred before Phase 1.

### Phase 1: Q-23 (b) token sweep

Swap every staged site, then commit `refactor: adopt hairline and scrim tokens in the remaining sites`.

**Validation gate:**

- **Commands:** `bun run lint`, `bun run typecheck:all`, and `bun run test:all` (which includes the `theme-vars` guard).
- **Screenshots:** `run.ts --batch visual-shells-b --base <parent> --head <head>` reports ALL IDENTICAL, for shots and probes alike.

### Phase 2: Q-22 (d) detail pages

Add the shared rules and rewrite the three style blocks as described. Add `detail-page.ts` with its constant, delete the dead journal rules and trim the three comments. Commit `refactor(popup): share the detail-page shell rules`.

**Validation gate:**

- **Commands:** the same as Phase 1, plus `bun run audit:vue`.
- **Screenshots:** ALL IDENTICAL across both load-order sequences. At each step, the tx hash link has the colour recorded above. The static card reads `cursor: default` and keeps its background when hovered.

**Layers:** lint, typecheck, unit and visual. Before the PR, the program's local gates run on the head.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, with the adversarial, assumption-attack and implementation-critique asks.
   - Include the no-over-engineering rule verbatim: "Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone."
   - Include the comment-quality rule verbatim: "Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."
   - Ask specifically for any element where a shared and a local declaration still compete at equal specificity, apart from the tx hash-link exemption.
2. **Fix loop.** Triage each finding, fix it, commit, and log the round in this arc's file under the program's `lessons/`, then resume the same session. Stop when a round has no material finding; at 5 rounds, park the arc.
3. **Delivery.** Push, open a ready PR against `hd/05-error-registry` (gh stack on base `harden-dedupe`), then add both e2e labels. Once the program gates are green, squash-merge into `harden-dedupe`.
4. **Close-out** is the program's job: this plan closes with the program plan, and every deferred item below becomes a follow-up.

## Delivery

One arc, `hd/04-visual-shells-b`, stacked on `hd/05-error-registry`. Code review: off.

## UI impact

None by design. Every touched surface must be pixel-identical on Chrome and Firefox, in dark and light, proven by the zero-diff harness.

## Drift left for the alignment arc

1. **Shimmers** (Q-22 (f) as a whole).
   - `AmountCard` and `fee-shared` have no reduced-motion rule and no `flex-shrink: 0`.
   - `received`'s shimmer uses `surface-low/high`, 1.4 s and `--bezier`, where `Skeleton` uses `surface-high/surface`, 1.5 s and `ease`.
   - This falls under owner call 5.
2. **The tx hash link's colour.**
   - `tx` sets `txt-secondary`, while `received` sets nothing and renders `txt-primary`.
   - On `tx` itself the colour also depends on load order (Fact 3). Fixing that changes pixels on one navigation path, so this arc keeps it and exempts it from the cascade rule.
3. **Bottom spacing.** Journal pads the wrapper and uses 24px under its content; `tx` and `received` pad the content with the nav clearance.
4. **The light-theme hairline.** `DetailsTable`, `PermissionRow` and `glossary` use `124, 116, 104` in light, while the other sites keep the dark hue in light. The program keeps this as today.

## Deferred

- **Q-22 (f), the shimmers, in full.**
  - Adopting `Skeleton` adds reduced-motion handling and `flex-shrink: 0`. For a reduced-motion user the shimmer stops moving, which is a visible change and is owner call 5.
  - `AmountCard`'s skeleton exists only inside a 250 ms conversion debounce (`AmountCard.vue:164, 240-255`), which the harness cannot hold.
  - A pixel-identical module shared by `AmountCard` and `fee-shared` would be replaced straight away by call 5.
  - Call 5 moves both to `<Skeleton>` in one commit, with before and after shots.
- **Q-22 (i), the snack card in `packages/design/src/ui/ToastManagerBase.vue:131-150` against `:162-184`.**
  - The error snack with `sub` and `action` can only be staged through a failed send (Fact 10).
  - The onboarding and dApp-window layouts are ones popup shots do not cover (Fact 11).
  - The gain is about 20 template lines. `ToastManagerBase` stays untouched.
- **`GlobalLoader`'s scrim literal** (`components/GlobalLoader.vue:33`). Its spike failed on Firefox: an `evaluateOnNewDocument` preload never ran in the moz-extension document, whether the driver navigated or the page did, so no capture can hold the loader there. Chrome held it and was stable. It moves with whichever arc gives the harness a Firefox preload.
- No other Phase 0 site failed to stage.

## Decisions (delegated)

### Plan audit, Codex round 1 (GPT-6 Astra, xhigh): REVISE

Adopted:

1. **Raw transaction seeds need a page reload** (Fact 8). The fix: seed, reload the page while keeping the worker running, refresh the proving row after any restart, and clean up fixtures between theme passes.
2. **The navigation matrix missed outcomes.** One document serves both themes, and no tx-first visit was planned. Each theme's detail sequence now starts in a fresh document, runs received-first and tx-first, and records the expected link colours. The tx hash-link overlap is exempted explicitly.
3. **The connected-app page cannot prove `PermissionRow`'s hairline** (Fact 14). The proof moved to two adjacent `cap-item` rows in one capabilities group, and the connected-app surface was dropped.
4. **A port that disconnects immediately does not hold `GlobalLoader` open** (Fact 13). It is now a spike: a synchronous failed profile-port open, or deferral.
5. **The counts left visual coverage unproven.** The fixes:
   - the mint fixture gets its arguments and a token with known decimals, and the caption is asserted;
   - the tx fixture gets a `block`;
   - every changed element is visible in some capture;
   - links get focused, pressed and real hover probes;
   - positive assertions repeat after settling.
6. **Source identity is not screenshot evidence, and the toast's consumer layouts are not popup layouts.** All of (i) is deferred.
7. **Comments.** The three narrations are trimmed, and the static-card selector carries the specificity sentence.

Codex confirmed the static-card specificity, the hash-link claim, the dead rules, all 19 token values, the seed paths and the date constant.

**Opus panelist:**

- The awaiting card needs no busy exemption (Fact 9).
- `received`'s fee state must be pinned: a note receipt never loads one, and `received-fee-loading` = 0 is asserted.
- On Ask c, Opus would have staged state 4 through an execution stub. The coordinator took Codex's call to defer.

### Asks, ruled by the panel (both panelists unless noted)

- **a. Busy allowance: adopted, narrowly.**
  - `Surface` gains `busy?: string[]`. `unsettled(busy)` ignores a hit only when `el.closest(busy.join(","))` matches.
  - It throws if a busy selector matches no visible element, and it asserts that the busy elements are still present at capture.
  - The `moving` check stays, and after the freeze it asserts `getAnimations().every(a => a.playState !== "running")`.
  - Only the passkey dialog's spinner and `global-loader` use it now that (i) is deferred.
  - *Why:* the exemption is limited to the expected busy elements, and the animations stay frozen and checked.
- **b. Port stub: generalized.**
  - `installPortStub(page, { [portName]: { [method]: {result} | {error} } })` passes every other port through, and counts the calls it served for each surface to assert.
  - It is installed in-page before `navigateByHash`, which covers the capabilities window and DappCancelledOverlay, since they build their clients in setup.
  - A stubbed port that receives no handled call stays silent: it never messages and never disconnects, so it cannot start a reconnect loop.
  - Only `GlobalLoader` needs a preload, timeboxed as above.
  - *Why:* the shots still exercise the built extension, and the served-call count proves the stub answered.
- **c. Snack state 4: deferred, with all of (i).**
  - The coordinator took Codex's call over Opus's execution-stub proposal.
  - *Why:* the uncovered consumer layouts and the send-gated state cost more than a small dedup is worth, and source identity is never evidence.
