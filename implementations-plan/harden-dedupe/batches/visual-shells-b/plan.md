---
plan: harden-dedupe / visual-shells-b (arc 4 of 25)
tier: light
driver: claude-code
claude_model: opus
codex_model: astra
code_review: off
eli5_mode: none (the program Artifact replaces per-batch ELI5 pages; see the program plan's Decisions)
branch: hd/04-visual-shells-b, stacked on hd/03-visual-shells-a
---

# visual-shells-b: detail-page shell, snack card, token sweep

Findings Q-22 (d, f, i) and the Q-23 (b) sweep, from `audit/quality/2026-09-30-dedup-high/`. visual-shells-a owns Q-22 (a, b, c) and the hairline literals in `ContactRow.vue`, `connected-apps/index.vue`, `SettingItem.vue` and `SettingField.vue`; this arc never edits those files. `AccountSelectRow.vue`'s hairline moved here from that arc.

## Outcome & Quality Bar

- **For whom:** the next person who restyles a detail page, the snack, or a hairline or scrim. Today that means editing the same rule in two or three detail pages, two copies of the snack card, and grepping 13 hairline and 6 scrim literals.
- **Excellent:**
  - The three detail pages take every rule they share from `detail-page.module.css`; each page keeps only what is its own.
  - The snack card is written once.
  - No `rgba(74, 70, 63, 0.2|0.3)` or scrim `rgba(10, 9, 8, α)` literal is left outside `base.css`, except sites deferred below with a reason.
  - Chrome and Firefox, dark and light, are pixel-identical, proven by the zero-diff harness, including after every sibling chunk has loaded.
- **Good enough:** a site whose state the offline harness cannot stage keeps its literal or its copy, and is listed under Deferred. Nothing ships on proxy evidence.

## Architecture & Implementation

Paths are under `apps/extension/src/` unless they start with `packages/`.

### Cascade rule for every shared rule

A composed CSS module is copied into the CSS of every lazily-loaded chunk that composes it. Visiting a second page re-injects the shared copy after the first page's local rules, so source order across chunks is not stable. On each element, shared and local declarations stay disjoint, or the local one wins by strictly higher specificity. Template classes, `data-testid`s and DOM order do not change in (d) or the sweep.

### Q-22 (d): detail pages

Sites (rule line numbers read today):

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

**Shared part**, added to `popup/pages/detail-page.module.css` at today's exact values: `wrapper`, `content`, `meta_sep`, `hero_link` (with its `svg` and `:hover` children), `detail_link` (decoration, cursor, transition, `:hover` colour; no base colour), `caption`, `type_chip`, `address_card` (with `:hover`), `detail_value_aux`. Each page's local class becomes `composes: <name> from "../detail-page.module.css"`, the pattern the file already uses. `journal/.dev_box` composes the existing `details_box`.

**Local deltas, kept:**

- `journal/.wrapper` keeps `padding-bottom: var(--nav-clearance)` beside its compose (a property the shared rule never sets). `journal/.content` stays local.
- `tx/.detail_link` keeps `color: var(--txt-secondary)`; `received/.detail_link` has none. The shared `:hover` colour is (0,2,0), so it beats either base colour whatever the order.
- `received/.card_static` becomes `.address_card.card_static` and `.address_card.card_static:hover`, (0,2,0) and (0,3,0) against the shared (0,1,0) and (0,2,0). Today it wins by source order inside one file; after the move that order is gone, and a received → tx → received visit would give a static card the pointer cursor and hover fill.
- `received/.fee_shimmer`, `.detail_key_note`, tx's call box and `.detail_value` stay local: no twin.
- `journal/.origin_row`, `.origin_label` and `.origin_value` are dead (no template reference) and are deleted, not shared.

**Script:** the format `"MMM dd, yyyy 'at' HH:mm"` appears five times (`tx:91`, `received:121-122`, `journal:145, 150`). It becomes one exported constant in a new `popup/pages/detail-page.ts`; each call keeps its own `DateTime.fromMillis` or `fromSeconds`. The fee valuation and dev-flag reads have two copies each and stay.

### Q-22 (f): shimmer, deferred in full

The copies are `packages/design/src/ui/Skeleton.vue:24-52`, `components/composite/send/AmountCard.vue:558-574`, `popup/components/modules/send/fee-shared.module.css:30-46` and `received/[id].vue:488-516`. Nothing ships here, for three reasons:

1. **Adopting `Skeleton` is not identity.** It adds `prefers-reduced-motion` handling and `flex-shrink: 0`. For a reduced-motion user the shimmer stops moving, a visible change, which is owner call 5 in the program plan.
2. **No identical intermediate step is worth shipping.** `AmountCard` and `fee-shared` differ only in size, so they could share one motion-unsafe module. But call 5 would replace that module straight away, and `received`'s shimmer differs in gradient, duration and easing, so it can never join it.
3. **The harness cannot hold `AmountCard`'s state.** Its skeleton shows only inside a 250 ms conversion debounce (`AmountCard.vue:164, 240-255`).

Call 5 takes it: both copies move to `<Skeleton>` in one commit, with the before and after shots.

### Q-22 (i): snack card

Today `packages/design/src/ui/ToastManagerBase.vue:131-150` (success) and `:162-184` (error) repeat the card. They differ in four things: the region (`role="status"` with `aria-live="polite"`, or `role="alert"`), the icon (`check-circle` green, or `close-circle` red), the `error` class, and the close button, which only the error card has.

The change renders both regions from a `v-for` over a two-entry constant holding those four differences. Each region keeps its own `Transition`, and the card body is written once. `aria-live` is bound to `undefined` on the alert region, so Vue omits it. The CSS is untouched.

The DOM is identical: same elements, attributes, classes and testids in the same order. The only addition is the `v-for` fragment's empty text anchors, which make no grid item and match no element selector. `ToastManagerBase.test.ts` stays as it is and gains one assertion: the alert region has no `aria-live`.

**Gate:** (i) ships only if all four snack states are shot (Phase 0). Otherwise it is deferred.

### Q-23 (b): token sweep (exact value matches only)

- `var(--hairline-soft)` (0.2):
  - `components/composite/activity/TransactionAwaitingCard.vue:150`, `TransactionTerminalCard.vue:103`, `TransactionIncomingCard.vue:93`
  - `popup/components/modules/activity/TransactionCard.vue:213`
  - `components/composite/capabilities/PermissionRow.vue:81`
  - `popup/components/Navigation.vue:61`
  - `popup/components/modules/general/GasBalanceCard.vue:188`, `RecentActivityView.vue:883`
  - `popup/components/modules/send/fee-shared.module.css:4`
  - `popup/pages/settings/glossary.vue:60`
- `var(--hairline-strong)` (0.3): `components/composite/activity/TransactionCardLayout.vue:198` and `popup/windows/capabilities/AccountSelectRow.vue:140`.
- **`DetailsTable.vue`.** It declares its own `--hairline-soft` on `.table` (`:137`), which shadows the global token, and a light twin at `:143-145`, `rgba(124, 116, 104, 0.2)`.
  - The dark line equals the global value, so it is deleted and `.table` inherits the token.
  - The light twin stays as written. It matches at (0,2,0) on a light root exactly as today, so light renders `124, 116, 104` as before.
  - The `PermissionRow` (`:84`) and `glossary` (`:63`) light overrides are (0,3,0) and (0,2,0) `border-*-color` rules and stay untouched.
- Scrims, mapped to the role tokens:
  - `components/Popup/Popup.vue:148` and `components/composite/DappCancelledOverlay.vue:33` → `--scrim-popup`;
  - `components/LegalAcceptanceSheet.vue:136` → `--scrim-sheet`;
  - `components/GlobalLoader.vue:33` and `components/passkey/PasskeyCeremonyDialog.vue:107` → `--scrim-loader`;
  - `components/composite/BarrierOverlay.vue:31` → `--scrim-barrier`.
- **Out of scope:**
  - the shadow alphas (`NotificationManager.vue:111`, `JsonViewer/LogsViewer.vue:308`, `packages/design/src/ui/Tooltip.vue:250`, `ToastManagerBase.vue:216`), which have no token;
  - `rgba(35, 31, 28, 1)`, which equals `--nulo-border` only in dark (`base.css:86` against light `:158`), so no token carries that exact value in both themes.

### Not taken

- **A `type_chip` shared with the activity cards' `.chip`.** Those rows have no Q-22 finding, and their chips differ (`TransactionCard` has no `flex-shrink` or `white-space`, and the incoming chip is green).
- **Widening `Skeleton` with custom properties** so `received` could adopt it. That is a design-package API for one consumer, and it would freeze a look call 5 may change.

## Security & Adversarial Considerations

- **No data, input, crypto or dependency change.** The change is CSS custom properties, `composes`, one constant and one template restructure.
- **Approval surfaces.** The capabilities window, an approval surface, gets only a token swap (`AccountSelectRow`, `PermissionRow`, `DetailsTable`). The 2026-09 approval-card regression came from an unreviewed visual change, so those surfaces are shot in both themes on both browsers, and the stub payload is wire-shaped: `0x` plus 64-hex addresses.
- **Snack semantics.** Errors are announced through `role="alert"` and successes through a polite status. A region swap would silently change what a screen reader announces. The existing role, `aria-live` and `aria-atomic` assertions, plus the new no-`aria-live` assertion, pin it.
- **A cascade slip that hides copy.** For example, a static receipt card that looks clickable, or a scrim that stops dimming behind the legal sheet. The cascade rule, the revisit surfaces and the computed-style probes cover it.

## Assumptions

**Facts** (read 2026-10-03 on `origin/harden-dedupe` 0abf63a3):

1. `detail-page.module.css` already holds 10 shared rules, composed by all three pages (`tx:369-552`, `received:352-523`, `journal:326-428`).
2. `received/.card_static` (`:437-443`) overrides `.address_card` (`:421-435`) by source order only, on `received-from-card` when `fromClickable` is false (`received:237`).
3. `tx`'s hash link carries both `detail_value_mono` (shared, `color: txt-primary`) and local `detail_link` (`color: txt-secondary`) at equal specificity (`tx:268`, `tx:418-427`).
4. `journal/.origin_*` (`:365-383`) are referenced nowhere in the template (`journal:218-309`).
5. The new tokens exist at the literals' exact values in `:root, [theme="dark"]` (`packages/design/src/base.css:107-113`), and `[theme="light"]` does not redeclare them.
6. `popup/index.ts` and `onboarding/index.ts` import `@nulo/design/base.css`, so every swapped site, teleported ones included, inherits the tokens.
7. The `theme-vars` guard rejects an undeclared `--hairline-*` or `--scrim-*` reference (`packages/design/src/theme-vars.ts:15`).
8. Activity rows are raw-seedable and none is MAC-signed:
   - `nulo:core:txs@<hash>` and `nulo:core:incoming-transfers@<id>` (`tests/e2e/helpers/activity-seeds.ts`);
   - `nulo:journal@<id>`, parsed by `OperationRecordSchema` (`wallet/services/operation-journal/service.ts:108`, `spec.ts:228-249`);
   - the boot sweep fails non-terminal records only at SW start, and the periodic sweep waits 35 min on `proving` (`reaper.ts:72-81`). GC never evicts failed records (`gc.ts` header).
9. The harness treats any visible `[class*="skeleton"]`, `[class*="spinner"]`, `global-loader` or `snackbar` as unsettled and fails the run (`spec/_hd-shots.test.ts:79`).
10. The only producer of an error snack with `sub` and `action` is a failed send (`popup/pages/send-submit.ts:98`). A success snack with both comes from a send or an arrival (`composables/useArrivals.ts:361-366`).

**Inferences:**

- A local class whose rule holds only `composes` is still exported, so `.address_card.card_static` matches. The harness probe confirms it.
- The `v-for` fragment's empty text anchors change no layout in the `display: grid` wrap.
- Onboarding's toast differs only by the wrap's `in_column` class, which this change does not touch, so popup shots cover the card template.

**Asks** (for the panel):

1. **Harness, busy allowance.** Add a per-surface allowance (selectors exempt from the unsettled check; animations stay frozen). Without it, the awaiting card, the passkey dialog, `GlobalLoader` and the four snack states cannot be shot, so those sites defer.
2. **Harness, port stub.** Generalise visual-shells-a's `note` stub to any port name, installable before page scripts (`evaluateOnNewDocument`) on a new extension page.
3. **Snack state 4.** If state 4 (error with sub and action) cannot be staged, (i) is deferred whole, which is the default, or it is accepted on the source identity of the two copies' sub and action markup (`:143-149` ≡ `:174-180`). The plan's default is to defer.

## Phases

### Phase 0: surfaces and stability (no product code)

Write the harness's `surfaces/visual-shells-b.ts` once visual-shells-a's harness changes land.

**Rules for every data surface:**

- It asserts its element count before the shot.
- It refuses the price feed with `interceptRpc` and asserts no fiat line (`tx-detail-fiat`, `journal-detail-fiat`), so live prices cannot flip a shot.
- Every seed uses a fixed timestamp, except the in-flight journal row, which needs `updatedAt` close to now to survive the reaper.
- It has a computed-style `probe` at rest and hovered for every element whose class moved, with keyframe names left out.

**Surfaces:**

| surface | route / state | reach | count asserted |
|---|---|---|---|
| home-activity | `#/popup/general`, scrolled to end | seeds: token row, one transfer tx, one note receipt (block 1), one failed journal row (`from: "simulating"`, with error, `transferType`), one `proving` journal row; leave and re-enter Home | `activity-icon` = 4; one each of `tx-awaiting-subtitle`, `tx-terminal-subtitle`, `tx-incoming-kind-chip` (needs Ask 1) |
| activity-page | `#/popup/activity` | same seeds | `activity-icon` = 3 |
| token-detail | `#/popup/tokens/<id>`, no activity | `seedTokenRow` | `activity-feed-root` = 1 |
| glossary | Settings → Glossary | none | `glossary-entry-*` ≥ 2 |
| connected-app | `#/popup/settings/connected-apps/<id>` | visual-shells-a's `dapp-session` seeding with two capability grants | `PermissionRow` titles ≥ 2 |
| capabilities | new page, `#/popup/windows/capabilities?requestId=hd-cap`; disclosure open, one details row expanded, then scrolled to end | `dapp-interaction` stub: `getInteractionPayload` returns a wire-shaped `CapabilityPayload` (two `availableAccounts`, accounts plus contract capabilities, `knownContracts`); `isInteractionCancelled` returns false (Ask 2) | `cap-account-item` = 2, `cap-details-row` ≥ 2, `cap-details-fns` = 1 |
| capabilities-cancelled | same | same stub, `isInteractionCancelled` returns true | DappCancelledOverlay = 1 |
| receive-popup | Home → receive | none | popup = 1 |
| legal-sheet | Home | `reloadWithLegalState`, then `waitForSheet(page, "review")`; leave by restoring the record | sheet = 1 |
| migration-blocked | Home | write `nulo:schema:blocked = { terminal: true }`; leave by removing it | `migration-blocked` = 1 |
| global-loader | new page | every `chrome.runtime.connect` answered by a port that disconnects at once, installed before scripts (Asks 1 and 2) | `global-loader` = 1 |
| passkey-dialog | `#/popup/profile/new`, passkey method, name typed, create pressed | `navigator.credentials.create` stubbed to never settle (Ask 1) | dialog = 1 |
| send-fee | `#/popup/send` | Testnet RPC refused, as in `send-fee-privacy.test.ts` | `fee-init-degraded` = 1 |
| received-detail | `#/popup/received/<id>`, loaded first | note-receipt seed | `received-detail-page`, `received-from-card`, `tx-explorer-link` = 1 each; probe the from card (static) and the To card, at rest and hovered |
| tx-detail, tx-mint | `#/popup/tx/<hash>` | transfer seed with a dApp origin, and a second seed whose call is `mint_to_private` | `tx-hash-link` = 1 (the not-found state has none) |
| journal-detail, journal-dev | `#/popup/journal/<id>`; then Developer Mode on (Settings → Advanced), turned off on leave | failed-row seed | `journal-detail-state` = 1, `journal-detail-transfer-type` = 1; `journal-detail-error-message` = 1 |
| received-revisit, tx-revisit | as above, after every detail chunk has loaded (received → tx → journal → received → tx) | as above | as above, plus the same probes |
| snack-success, snack-error | Home, card held by two pointer moves | clipboard stub resolving or rejecting, then `account-address-copy` (as in `snackbar.test.ts`) (Ask 1) | `snackbar` = 1 with `data-kind`; `snackbar-close` present only on the error card |
| snack-success-rich | Home | `incoming-transfer` stub (`getIncomingTransfers`, `getArrivalState`, `claimArrivals`, an `onIncomingTransferAdded` emit) plus `token.getToken` | `snackbar-sub` = 1, `snackbar-action` = 1 |
| snack-error-rich | Send flow | `execution.executeTransfer` rejecting with a journal-linked error, plus that journal row; the spike decides feasibility | `snackbar-sub`, `snackbar-action`, `snackbar-close` = 1 each |

**Validation gate:**

- `bun ~/.cache/hd-shots/run.ts --batch visual-shells-b --base <parent> --stability` reports ALL IDENTICAL on both browsers.
- A forced-diff check (`--head dist:<throwaway>`, built with one hairline and one scrim alpha nudged, and `card_static` dropped) reports a diff on exactly the surfaces that show them.
- Every surface that cannot be staged is recorded here, and its site moves to Deferred before Phase 1 starts.

### Phase 1: Q-23 (b) token sweep

Swap every staged site listed above. Commit `refactor: adopt hairline and scrim tokens in the remaining sites`.

**Validation gate:**

- **Commands:** `bun run lint`, `bun run typecheck:all`, `bun run test:all` (includes the `theme-vars` guard).
- **Screenshots:** `run.ts --batch visual-shells-b --base <parent> --head <head>` reports ALL IDENTICAL, shots and probes.

### Phase 2: Q-22 (d) detail pages

Add the shared rules, rewrite the three style blocks as described, add `detail-page.ts` with its constant, and delete the dead journal rules. Commit `refactor(popup): share the detail-page shell rules`.

**Validation gate:**

- **Commands:** the same, plus `bun run audit:vue`.
- **Screenshots:** ALL IDENTICAL, revisit surfaces included. The received-detail and received-revisit probes show `cursor: default` and an unchanged background on the static card when hovered.

### Phase 3: Q-22 (i) snack card (only if all four snack states are staged)

Restructure `ToastManagerBase.vue` and add the one test assertion. Commit `refactor(design): render the snack card once`.

**Validation gate:**

- **Commands:** `bun run --cwd packages/design test`, `bun run --cwd apps/extension build-storybook` (its stories render the component), `bun run test:all`, `bun run audit:vue`.
- **Screenshots:** the four snack surfaces are identical.

**Layers:** lint, typecheck, unit, visual. Before the PR, the program's local gates run on the head.

## Post-implementation

1. **Codex audit** (GPT-6 Astra, xhigh) of the arc diff, with the adversarial, assumption-attack and implementation-critique asks. Include the no-over-engineering rule verbatim ("Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If code works and is clear, leave it alone.") and the comment-quality rule verbatim ("Audit the comments for value per character. Flag any comment that narrates what the code visibly does, restates its line, references implementation plans / phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future reader, human or LLM, pays to re-read: they must be few, dense, and exact."). Ask it specifically for any element where a shared and a local declaration still compete at equal specificity.
2. **Fix loop:** triage each finding, fix, commit, log the round in this arc's file under the program's `lessons/`, and resume the same session. Stop when a round has no material finding; at 5 rounds, park the arc.
3. **Delivery:** push, open a ready PR against `hd/03-visual-shells-a` (gh stack on base `harden-dedupe`), then add both e2e labels. When the program gates are green, squash-merge into `harden-dedupe`.
4. **Close-out** is the program's job: this plan closes with the program plan, and every deferred item below becomes a follow-up.

## Delivery

One arc, `hd/04-visual-shells-b`, stacked on `hd/03-visual-shells-a`. Code review: off.

## UI impact

None by design. Every touched surface must be pixel-identical on Chrome and Firefox, in dark and light, proven by the zero-diff harness.

## Drift left for the alignment arc

1. **Shimmers** (all of Q-22 (f)).
   - `AmountCard` and `fee-shared` have no reduced-motion rule and no `flex-shrink: 0`.
   - `received`'s shimmer uses `surface-low/high`, 1.4 s and `--bezier`, where `Skeleton` uses `surface-high/surface`, 1.5 s and `ease`.
   - Owner call 5.
2. **The tx hash link's colour.**
   - `tx` sets `txt-secondary` and `received` sets nothing (it gets `txt-primary`).
   - On `tx` itself the colour also depends on chunk load order (Fact 3): secondary on a fresh visit, primary once a later-loaded received or journal chunk has re-injected the shared rule. Fixing it changes pixels on one navigation path, so it is left as it is.
3. **Bottom spacing.** The journal page pads the wrapper and uses 24px under its content; `tx` and `received` pad the content with the nav clearance.
4. **The light-theme hairline.** `DetailsTable`, `PermissionRow` and `glossary` use `124, 116, 104` in light; the other sites keep the dark hue in light. Kept as today by the program.

## Deferred

- **Q-22 (f) in full** (see above).
- **Any Phase 0 site that cannot be staged.** Such a site keeps its literal or its copy and is named here when Phase 0 ends. Candidates: `GlobalLoader`, `PasskeyCeremonyDialog`, the awaiting card, and Q-22 (i).

## Decisions (delegated)
