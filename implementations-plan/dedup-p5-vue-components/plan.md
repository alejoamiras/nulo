---
plan: dedup-p5-vue-components
tier: mid
driver: claude-code
code_review: off
eli5_mode: readme-row
worktree: .claude/worktrees/dedup-p5-vue-components (branch worktree-dedup-p5-vue-components, on top of worktree-dedup-p4-vue-shells / PR #569)
ledger: implementations-plan/dedup-ledger (phase P5)
status: final fresh-context codex pass conditional-approve 2026-09-07, all four conditions adopted; approved under the ledger README's pre-approval rule; implementing
---

# P5 — shared field, list-sync and card pieces for popups and windows

Fifteen ledger findings (N1 N2 N3 N4 N5 N7 N8 L2 L5 K3 K8 M1 M5 M6 I5) in the popup dialogs, the activity and tx
modules, the execute/verify windows and the capability/import composites. Each is either a duplicated Vue piece (a
row, a note, a form pair, a list) or a duplicated script shape (event sync, an error classifier, a decision handler,
two identical template branches). After the dual audit this is a hybrid of Plan A and `outline-b.md`: ten ids land (N2 N3 N7 N8 L2 L5 K3 K8 M1 M5's
partial) and five are skipped as not-the-same-thing or not worth an abstraction (N1 N4 N5 M6 I5, plus M5's toggle,
N3's sender site, K3's action-row extraction). Every `data-testid` and every rendered node stays identical.
Net ≈ −280 lines.

## Architecture & Implementation

### Popups (N2, N3, N7, N8)

- **`FieldWarning`** (N2, `@nulo/design/ui/FieldWarning.vue` — L2 primitives live in the design package, the
  extension's `components/ui/` holds only the three host-coupled wrappers; exported from the package index and imported
  explicitly by the nine popups — `scripts/design-resolver.test.ts` pins the resolver set to names whose local SFC was
  deleted, which a new primitive never had; tested in the package): the `Flex align=center gap=6 > Icon warning 12 red +
  Text 12/600/primary` row with a default slot for the copy. Every one of the fourteen rows sits inside a
  `<Transition name="fade">` (twelve elements; `EditProfilePopup` and `NewNetworkPopup` hold a `v-if`/`v-else-if`
  pair each): each row becomes `<FieldWarning v-if|v-else-if="…">copy</FieldWarning>` in the same position with the
  same branch structure, so the Transition still sees the same toggled children; nothing is collapsed into changing
  slot text.
- **`ProcessingErrorNote`** (N3): moves to `src/components/composite/` (its test and the two explicit imports in
  `NewContactPopup`/`EditContactPopup` follow), gains `color` (default `primary`). `NewFpcPopup` and `EditFpcPopup`
  adopt it with `color="red"` — the dead `type` ternary goes with the copy it lived in. `NewSenderPopup` keeps its own
  note (different box), logged.
- **`decide(action, successLabel, successIcon)`** (N7, inside `IncomingTrustPopup.vue`): the latch, the generation
  token, the pre-await capture of symbol and key, the action call inside `try`, the generation-conditional unlock in
  `finally` and the key re-check before `emit("onClose")` move into the one helper in that order, with the invariant
  comments (not the review narration); the callers build the label at call time
  (`decide(cacheStore.incomingTrust.allow, \`Now showing receives for ${tokenSymbol.value}\`, "check")`), so the
  label is evaluated synchronously at call time, the symbol capture inside the helper keeps its position after the
  latch as today. The reject path is untested today; the phase adds the cases that pin the shared helper (below).
- **N8**: `TokenMetadataPopup`'s six rows become a `capabilitySections` table and one `v-for` per section (private,
  public), same order, same wrappers; the address markup (`slice(0,6) + ••• + slice(-4)`) is unchanged.

### Modules and windows (L2, L5, K3, K8)

- **L2**: one `<Flex v-if="executingTask || showJournalAwaiting || showFallbackAwaiting || recentActivityRows.length">`
  block with `showFallbackAwaiting = computed(() => (props.token ? isTokenAwaitingTx.value : awaitingAccountTxs.value.length > 0))`
  (`token` is a prop, not a script binding) driving the fallback `TransactionAwaitingCard`; the merged root carries
  `:key="props.token ? 'token' : 'account'"` so a token-presence flip still remounts the list as the two roots did; the
  two comments the first block carries are kept once; the trailing `v-else-if="token"` empty state is untouched.
- **L5**: `modules/tx/tx-shared.module.css` `disclosure_toggle`; `.fee_row_toggle`/`.debug_toggle` compose it; the
  two chevrons (different sizes and guards) stay.
- **K3**: `v-else-if="op.kind === 'aztec_simulateTx' || op.kind === 'aztec_profileTx'"` with `:key="op.kind"` on
  the branch's root `Flex`, so a kind change still remounts the subtree the way two compiler-keyed branches did
  (`AddressDisplay` resolves its contact name only on mount); nothing else in `OperationCard` moves (the action-row
  extraction would change what `simulate_transaction` renders).
- **K8**: `verify/index.vue` renders `<DappIdentityBlock :dapp :hostname="dappHostname" :hostnameSuspicious="hostnameHasNonAscii" :actionLabel="isReconnect ? 'Reconnected' : 'Connection established'" />`;
  its inline block, its seven CSS classes (md5-identical to the composite's), `sanitizedDappName` and the now-unused
  `sanitizeWireString` import go; the hostname computeds stay (the composite takes them as props, as the other three
  windows do).

### Composites (M1, M5)

- **`ScopePatternList`** (M1, `components/composite/capabilities/`): prop `scope` (raw); `formatScope` and
  `fnLabel` move into the component (their only callers were the three lists), `getMethodLabel` is imported from
  `@/utils/tx-enrichment` and called with both arguments (the FeeJuice contract guard depends on the second),
  `ScopeAddress` renders the contract; index keys and the two branch roots are kept. `detail_list`/`bullet`/`mono`
  are also used by the panel's other sections, so they move to `capability-shared.module.css` and both files compose
  them. Three blocks become three tags; the panel keeps its `sanitizeWireString` import (the unknown-type branch
  uses it).
- **M5**: `components/composite/import/import-shared.module.css` (`section`, `section_last`, `section_label`)
  composed by the three forms (`.section` ≡ `.section_last`; both names kept). The visibility toggle is skipped
  (decision ledger).

## Phases

Each phase: implement → `bun run lint` → `bun run --cwd apps/extension typecheck` → the touched suites → commit.

### Phase 1 — provable moves (L2, K3, K8, N8, L5, M5, M1)

Merges, the composite adoption, the table-driven rows, three partials, `ScopePatternList`. Parity cases — L2
(rendered, on the existing shallow harness with a `token` prop): the token fallback card vs the account fallback
card, journal + orphan cards coexisting with the fallback suppressed, both empty states, a token-presence flip
remounts the root, cancel/click forwarding through the fixtures; K3: a new `OperationCard` case switches
`aztec_simulateTx` → `aztec_profileTx` with a changed destination and sees the payload subtree remount; N8: one
mixed-boolean fixture checks the six labels, property names and icons in order; M1: wildcard scope, a non-array
scope falls back to wildcard, empty patterns, a wildcard contract, an address pattern renders `ScopeAddress`, a
wildcard function, a raw sanitized function name, a known method label with the contract argument and an unknown one,
the panel still renders all three lists (real `ScopeAddress` registered). Gate: `general`, `tx`, `execute`,
`capabilities`, `import` and `popups` suites green; `build:chrome` 0, the three partials inspected in the emitted CSS
(including the fee row's static-hover override), `components.d.ts` committed.

### Phase 2 — popup pieces (N2, N3, N7)

`FieldWarning` in the design package (parity: exact row and attrs, slot copy, hidden→shown→hidden inside a real
`Transition`, warning-A→warning-B across a `v-if`/`v-else-if` pair inside a real `Transition`, no attribute leak);
`ProcessingErrorNote` move + `color` (the moved suite plus: default primary, red, the fade transition wraps the
tooltip, the tooltip geometry props (`side`/`position`/`wide`/`:disabled`/margin) and an adoption check in each FPC
popup suite, whose `FormPopup` stub gains the `aboveSubmit` slot so a missing note is detectable); `decide()` in the
trust popup with the reject path pinned (each outcome asserts the toast, the close count and the latch release:
reject explicit-true toasts "Hiding receives", false and undefined do not toast, a throwing reject toasts the failure
copy; allow and reject share the latch; a reopen starts a new pending decision before the old one settles and the
old settlement does not unlock it; a changed identity does not close; the symbol is captured before the await).
Adoption in the nine warning popups and the two FPC popups; their existing suites green. Build + `components.d.ts`.

### Phase 3 — full local gate

`bun run lint && bun run typecheck:all && bun run test`, `build:chrome` + `git diff --exit-code --stat --
apps/extension/src/types/`, the `nulo:e2e:` marker grep.

## Security & Adversarial Considerations

- **`IncomingTrustPopup`** (N7) is audit-hardened: the submit latch, the owner generation and the payload-key re-check
  exist to stop a decision from closing or unlocking a prompt the user never saw. `decide()` keeps all three in the
  same order; the suite's allow cases must stay green and the reject path gains the cases listed in Phase 2.
- **`DappIdentityBlock`** (K8) is the anti-phishing surface of the verify window: the composite renders the same
  hostname, the same punycode warning and the same sanitized name (`sanitizeWireString`, 64) the inline block did.
- **Supply chain**: no dependency added or bumped.

## Assumptions

**Facts (verified in the worktree)** — the reuse map in `recon.md` (line refs, md5 matches for K8's CSS, the N1
variants, the N2 Transition count 12/14, N3's three shapes, N4's two strings, M5's four toggles, M6's sizes).

**Inferences (all resolved in the dual audit)**
- `getMethodLabel` is a module-level export of `@/utils/tx-enrichment` (imported at `CapabilityDetailPanel.vue:13`).
- `IncomingTrustPopup.test.ts` pins the allow latch and the payload-key guard (:242, :259) and nothing on reject.
- All fourteen N2 rows are inside a `Transition` (two elements hold a `v-if`/`v-else-if` pair).
- The N1 sites are not one shape: three carry side effects and six tear down on hide or never — N1 is skipped.

**Asks** — none open; the ledger README's owner decisions pre-answer tier, review setting, delivery and approval.

## Decision ledger

- **Plan A vs Outline B → hybrid** (both auditors): B's skips for N1 and M5's toggle; A's N2, N3, N7, N8, L2, L5, K3,
  K8, M1, M5's partial. Disputed and decided: **N4 skipped** (codex: model/event plumbing for a 15-line classifier and
  two inputs; fable: keep with an error-clearing emit — the plumbing equals the duplication, so B); **N7 kept**
  (codex: the deletion does not justify the verification burden; fable: the extraction is what puts the untested
  reject path behind the tested code — kept, with the reject and latch cases mandated); **I5 skipped** (codex: the
  Storybook CSF indexer requires an object-literal default export, so a factory breaks indexing; fable: a
  `build-storybook` gate would be needed — not worth −16 dev-tooling lines).
- **N1 skipped**: `EditContactPopup` refreshes the edit draft on update, `EditFpcPopup` refreshes `fpcToEdit` and
  closes with a toast on delete, `BalanceView` captures the displayed token before filtering; three sites build their
  client per show and dispose on hide, one never disconnects; add-with-existing-id pushes a duplicate everywhere while
  `useEntityCrud` dedupes. A composable with enough hooks to preserve all of that is a new abstraction for ≈ −30 lines.
- **M5 toggle skipped**: byte-equivalent toggles also sit in `NewProfileCredentials`, `auth.vue` and
  `change-password.vue` (out of scope); a primitive adopted at four of seven sites is worse than the copies.
- **N5 skipped**: ≈ −5 net; the ledger ties its worth to X5, which is Tier-4.
- **M6 skipped**: the design grid is a different size (56 vs 48 px cells, 16 vs 8 px padding, 28 vs 24 px glyphs).
- **N3 at `NewSenderPopup` skipped**: different box (`gap`, no `:disabled`/`paddingLeft`).
- **K3 (b) skipped**: changes what `simulate_transaction` renders.
- **N8's `trimAddress` skipped**: the address is three nodes with a `•••` separator, not one string.
- **M1's `scope-format.ts` dropped**: the helpers have no other caller; they live in the component.
- **L2's merged root keyed** on token presence so the flip still remounts as the two roots did.

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
and a body listing ids addressed, ids skipped with reasons, net LOC, the Phase 3 gate output and the codex rounds.
Then `gh pr checks <n>` watched; red = flake → re-run once, red again → fix or hold. Green → README row P5 =
`open #<n> · green`, `agent-worktree status`, print `LESSONS_FILE=implementations-plan/dedup-p5-vue-components/lessons/phase-1.md`.
**Never merge**; the owner lands the stack bottom-up.

## Audit log

**Codex plan audit** (`/codex high`, GPT-6 Astra, session `01a07ced-5947-7e00-9b39-657c9c07e6f9`; transcript `audit-codex.md`): *conditional approve, hybrid* — N1's options cannot preserve the nine sites and the cleanup recon was wrong; I5's factory breaks CSF indexing; N7 under-pinned; N2's transition inventory corrected (branches must stay branches); L2 must read `props.token` and key the merged root; M1 imports `getMethodLabel` directly and keeps both arguments, `EndpointFormFields` would need explicit imports; M5's toggle and N4 to be skipped. Every condition adopted (N1, N4, I5, the toggle skipped; N7 kept with the mandated cases).

**Fable audit** (`Agent` Plan leg, Fable 5.1; transcript `audit-fable.md`): *conditional approve, hybrid* — N1 false for three sites and wrong on lifecycle for six; the toggle is a 4-of-7 adoption; `getMethodLabel` is a util import, `formatScope`/`fnLabel` belong in the component, the list needs its own CSS; N4 needs the error-clearing emit; N7's reject path is untested and the +1 case is mandatory; all fourteen N2 rows are inside Transitions; K8 must drop the unused `sanitizeWireString` import; L2 parity is e2e-only. Every condition adopted (N4 skipped rather than plumbed).

**Final fresh-context codex pass** (`/codex high`, new session `01a07cf7-270d-7041-ae3d-f177d02bd136`; transcript `audit-codex-final.md`): *conditional approve* — agrees with N4 skipped and N7 kept. Conditions, all verified and adopted:

| Finding | Verified | Decision |
|---|---|---|
| K3: merging the two branches loses the compiler-keyed remount; `AddressDisplay` resolves its contact name on mount only | yes (`AddressDisplay.vue:67`) | `:key="op.kind"` on the merged branch root; a switching case with a changed destination |
| L2: the existing suite mounts shallow without `token`, so the merge is unpinned | yes (`RecentActivityView.test.ts:219`) | rendered parity cases listed in Phase 1 |
| Tests: N3's L3 minimum and the FPC harnesses' missing `aboveSubmit`; M1's non-array fallback; N7's outcome cases must assert close count and latch release, the reopen case must start a new decision first; N8 one mixed fixture; keep the panel's sanitizer import | yes (`NewFpcPopup.test.ts:42`, `CapabilityDetailPanel.vue:21,314`) | written into Phases 1–2 |
| N2: an L2 primitive belongs to `@nulo/design/ui` per CLAUDE.md, not the extension's `components/ui/` | yes (CLAUDE.md § L0–L6) | `FieldWarning` lives in the design package, exported and added to the resolver |
| Low: "Phase 4"/"four phases" wording; N7's symbol capture follows the latch | yes | corrected |

Approval follows from the ledger README's pre-approval rule (final verdict conditional-approve, every condition adopted, scope ⊆ the phase's ids, no Tier-4 id, no user-visible change).

## Seeds

The session-level `/goal` in `implementations-plan/dedup-ledger/README.md` is already driving this phase and
supersedes a plan-local seed. For a fresh session picking up only this phase:

```
/goal All three phases marked ✓ in implementations-plan/dedup-p5-vue-components/plan.md, each ✓ backed by its validation gate quoted passing; `LESSONS_FILE=implementations-plan/dedup-p5-vue-components/lessons/phase-1.md` printed; `/code-review` NOT run; the codex fix loop converged with a resumed pass reporting no new material findings, quoted; the PR opened via `gh stack submit` on worktree-dedup-p5-vue-components with base worktree-dedup-p4-vue-shells only after the loop converged, `gh pr checks` all green, no merge command run.
```
