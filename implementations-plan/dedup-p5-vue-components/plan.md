---
plan: dedup-p5-vue-components
tier: mid
driver: claude-code
code_review: off
eli5_mode: readme-row
worktree: .claude/worktrees/dedup-p5-vue-components (branch worktree-dedup-p5-vue-components, on top of worktree-dedup-p4-vue-shells / PR #569)
ledger: implementations-plan/dedup-ledger (phase P5)
status: drafted 2026-09-07 with outline-b.md; awaiting the dual audit
---

# P5 — shared field, list-sync and card pieces for popups and windows

Fifteen ledger findings (N1 N2 N3 N4 N5 N7 N8 L2 L5 K3 K8 M1 M5 M6 I5) in the popup dialogs, the activity and tx
modules, the execute/verify windows and the capability/import composites. Each is either a duplicated Vue piece (a
row, a note, a form pair, a list) or a duplicated script shape (event sync, an error classifier, a decision handler,
two identical template branches). This plan gives each one home, keeps every `data-testid` and every rendered
node identical, and skips the three ids whose copies are not actually the same thing (N5, M6, N3's sender site).
`outline-b.md` is the safest-first alternative for the audit to weigh. Net ≈ −420 lines (Plan A).

## Architecture & Implementation

### Popups (N1, N2, N3, N4, N7, N8)

- **`useEntityCollectionSync(list, events, opts)`** (N1, `src/composables/`, C1: receives already-constructed
  event emitters, never connects): subscribes `added`/`updated`/`deleted`, returns `dispose`. Options encode the
  nine sites' semantics without changing any: `identity` (default `.id`), `accept` (balances: `tb.account ===
  appStore.account.address` on add), `decorate` (Select FPC: `prepareFpc` on add and update), `upsertMissing`
  (contacts: an unknown update is pushed; FPC/balance sites: ignored). Delete always filters by identity (the balance
  sites' `splice` is the same result). The four contact sites, three FPC sites and two balance sites each become one
  call; the popups' own fetch and dispose stay where they are (`dispose` joins the existing `onBeforeUnmount`).
- **`FieldWarning`** (N2, `src/components/ui/`, L2): the `Flex > Icon warning 12 red + Text 12/600/primary` row with a
  default slot for the copy. Callers keep `v-if` on the element and their `<Transition name="fade">`, so the fade
  still toggles a direct child; fourteen sites lose four lines each.
- **`ProcessingErrorNote`** (N3): moves to `src/components/composite/` (its test follows), gains `color`
  (default `primary`). `NewFpcPopup` and `EditFpcPopup` adopt it with `color="red"` — the dead `type` ternary goes
  with the copy it lived in. `NewSenderPopup` keeps its own note (different box: `gap=6`, no `wide`/`:disabled`,
  no `paddingLeft`), logged.
- **`classifyEndpointError(err, network, duplicateCopy)`** (N4, pure, `popup/utils/endpoint-errors.ts`) with each
  popup passing its own duplicate-URL sentence; **`EndpointFormFields`** (`modules/settings/networks/`, L4) with
  `labelLabel`/`labelPlaceholder` props for the two inputs that differ. Both popups keep their submit paths.
- **`decide(action, successLabel, successIcon)`** (N7, inside `IncomingTrustPopup.vue`): the latch, the generation
  token, the pre-await capture and the payload-key re-check move into the one helper with their comments;
  `handleAllow`/`handleReject` become one-line calls. The existing suite pins the latch and the key guard.
- **N8**: `TokenMetadataPopup`'s six rows become a `capabilitySections` table and one `v-for` per section (two
  sections: private, public); the address markup (`slice(0,6) + ••• + slice(-4)`) is unchanged.

### Modules and windows (L2, L5, K3, K8)

- **L2**: one `<Flex v-if="executingTask || showJournalAwaiting || showFallbackAwaiting || recentActivityRows.length">`
  block with `showFallbackAwaiting = computed(() => token ? isTokenAwaitingTx.value : awaitingAccountTxs.value.length > 0)`
  driving the fallback `TransactionAwaitingCard`; the two comments the first block carries are kept once.
- **L5**: `modules/tx/tx-shared.module.css` `disclosure_toggle`; `.fee_row_toggle`/`.debug_toggle` compose it; the
  two chevrons (different sizes and guards) stay.
- **K3**: `v-else-if="op.kind === 'aztec_simulateTx' || op.kind === 'aztec_profileTx'"`; nothing else in
  `OperationCard` moves (the action-row extraction would change what `simulate_transaction` renders).
- **K8**: `verify/index.vue` renders `<DappIdentityBlock :dapp :hostname="dappHostname" :hostnameSuspicious="hostnameHasNonAscii" :actionLabel="isReconnect ? 'Reconnected' : 'Connection established'" />`;
  its inline block, its seven CSS classes and `sanitizedDappName` go; the hostname computeds stay (the composite
  takes them as props, as the other three windows do).

### Composites and design (M1, M5, I5)

- **`ScopePatternList`** (M1, `components/composite/capabilities/`): props `scope` (the raw scope; the component calls
  `formatScope`), and the label helpers imported from a colocated `scope-format.ts` where `formatScope`/`fnLabel`
  move; if `getMethodLabel` closes over the panel's state it is passed as a `methodLabel` function prop. Three
  blocks become three tags.
- **M5**: `components/composite/import/import-shared.module.css` (`section`, `section_last`, `section_label`) composed
  by the three forms; **`PasswordVisibilityToggle`** (`components/ui/`, L2): `hidden` + `noun` props, emits
  `toggle`, renders the `tabindex="-1"` button with the same `aria-label` pattern and icon; four sites adopt it.
- **I5**: `design/story-meta.ts` `tokenStoryMeta(title)`; four stories import it.

## Phases

Each phase: implement → `bun run lint` → `bun run --cwd apps/extension typecheck` → the touched suites → commit.

### Phase 1 — provable moves (L2, K3, K8, N8, L5, M5's partial, I5)

Merges, the composite adoption, the table-driven rows, two partials, the story helper. Gate: `general`, `tx`,
`execute`, `verify`-adjacent, `import` and `popups` suites green; build + emitted-CSS check for the two partials.

### Phase 2 — popup pieces (N2, N3, N4, N7)

`FieldWarning` (+5-case test: row shape, slot copy, no attrs leak), `ProcessingErrorNote` move + `color` (+2 cases),
`classifyEndpointError` (+ table test over the four branches × the two copies) and `EndpointFormFields` (+3 cases),
`decide()` in the trust popup (existing suite green; +1 case that reject and allow share the latch). Adoption in
the nine popups; their existing suites green. Build + `components.d.ts`.

### Phase 3 — event sync and the scope list (N1, M1)

`useEntityCollectionSync` (+ table test: push / upsert-vs-ignore / accept / decorate / delete / dispose), nine
sites adopt it; `ScopePatternList` (+3 cases: wildcard, patterns, method label); `CapabilityDetailPanel` suite
green. Build + `components.d.ts`.

### Phase 4 — full local gate

`bun run lint && bun run typecheck:all && bun run test`, `build:chrome` + `git diff --exit-code --stat --
apps/extension/src/types/`, the `nulo:e2e:` marker grep.

## Security & Adversarial Considerations

- **`IncomingTrustPopup`** (N7) is audit-hardened: the submit latch, the owner generation and the payload-key re-check
  exist to stop a decision from closing or unlocking a prompt the user never saw. `decide()` keeps all three in the
  same order; the suite's latch and key cases must stay green, and one case asserts the two actions share the latch.
- **`DappIdentityBlock`** (K8) is the anti-phishing surface of the verify window: the composite renders the same
  hostname, the same punycode warning and the same sanitized name (`sanitizeWireString`, 64) the inline block did.
- **`classifyEndpointError`** (N4) turns service errors into user copy; it keeps the same four branches in the same
  order and never echoes the raw message except through the existing fallback.
- **Event sync** (N1) keeps the balance sites' account filter on add — without it a foreign account's balance row
  would splice into the list, which is why `accept` is an explicit option, not a default.
- **Supply chain**: no dependency added or bumped.

## Assumptions

**Facts (verified in the worktree)** — the reuse map in `recon.md` (line refs, md5 matches for K8's CSS, the N1
variants, the N2 Transition count 12/14, N3's three shapes, N4's two strings, M5's four toggles, M6's sizes).

**Inferences (the audits should attack these)**
- `getMethodLabel` in `CapabilityDetailPanel` is a module-level function like `formatScope`/`fnLabel`.
- The nine N1 sites' `dispose` can join each file's existing `onBeforeUnmount` without reordering the service
  `disconnect()` calls.
- `IncomingTrustPopup.test.ts` exercises both the latch and the payload-key guard (so `decide()` is pinned).
- The two N2 rows outside a `Transition` (`NewSenderPopup:115`, `EditProfilePopup:158`) render identically with the
  component.

**Asks** — none open; the ledger README's owner decisions pre-answer tier, review setting, delivery and approval.

## Decision ledger

- **N5 skipped**: ≈ −5 net; the ledger ties its worth to X5, which is Tier-4.
- **M6 skipped**: the design grid is a different size (56 vs 48 px cells, 16 vs 8 px padding, 28 vs 24 px glyphs).
- **N3 at `NewSenderPopup` skipped**: different box (`gap`, no `wide`/`:disabled`/`paddingLeft`).
- **K3 (b) skipped**: changes what `simulate_transaction` renders.
- **N8's `trimAddress` skipped**: the address is three nodes with a `•••` separator, not one string.
- **Plan A vs Outline B**: open for the audit.

## Post-implementation

1. `code_review` is `off`: `/code-review` is NOT run.
2. **Codex audit** (`/codex high`, GPT-6 Astra): send the net diff `git diff worktree-dedup-p4-vue-shells...HEAD -- . ':!implementations-plan' ':!apps/extension/src/types'`,
   this plan, `recon.md`, the ledger rows, an adversarial ask, and — verbatim — the two rules:
   *"Report bugs and small, targeted improvements only. Do not propose speculative abstractions, extra
   configuration surface, new layers, or rewrites — the smallest change that fixes each real problem. If
   code works and is clear, leave it alone."* and *"Audit the comments for value per character. Flag any
   comment that narrates what the code visibly does, restates its line, references implementation plans /
   phases / reviews, or spends a paragraph where a sentence works — and flag places where a non-obvious
   invariant or constraint deserves a comment it doesn't have. Comments are permanent context every future
   reader, human or LLM, pays to re-read: they must be few, dense, and exact."* Tell codex not to run the
   vitest e2e configs.
3. **Fix loop**: verify each claim against the tree, apply accepted fixes, commit, log the round in
   `lessons/phase-1.md`, RESUME the same codex session with the fix diff. Repeat until a round reports no
   new material findings (quote it). Still material after 3 rounds → surface and hold.
4. **Delivery** (below) — the first and only time a PR is opened for this phase.

## Delivery

Single arc = this branch, one PR, stacked on P4: `gh stack submit --auto --open` from this worktree, then
`gh pr edit <n>` with the ledger title `refactor(popup): shared field, list-sync and card pieces for popups and windows`
and a body listing ids addressed, ids skipped with reasons, net LOC, the Phase 4 gate output and the codex rounds.
Then `gh pr checks <n>` watched; red = flake → re-run once, red again → fix or hold. Green → README row P5 =
`open #<n> · green`, `agent-worktree status`, print `LESSONS_FILE=implementations-plan/dedup-p5-vue-components/lessons/phase-1.md`.
**Never merge**; the owner lands the stack bottom-up.

## Audit log

(pending — dual audit, then the fresh-context codex pass)

## Seeds

The session-level `/goal` in `implementations-plan/dedup-ledger/README.md` is already driving this phase and
supersedes a plan-local seed. For a fresh session picking up only this phase:

```
/goal All four phases marked ✓ in implementations-plan/dedup-p5-vue-components/plan.md, each ✓ backed by its validation gate quoted passing; `LESSONS_FILE=implementations-plan/dedup-p5-vue-components/lessons/phase-1.md` printed; `/code-review` NOT run; the codex fix loop converged with a resumed pass reporting no new material findings, quoted; the PR opened via `gh stack submit` on worktree-dedup-p5-vue-components with base worktree-dedup-p4-vue-shells only after the loop converged, `gh pr checks` all green, no merge command run.
```
