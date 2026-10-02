# Lessons — dedup-p5-vue-components

Base: `worktree-dedup-p4-vue-shells` (PR #569). Scope: ledger ids N1 N2 N3 N4 N5 N7 N8 L2 L5 K3 K8 M1 M5 M6 I5.

## Phase 0 — blueprint mid under the ledger README's pre-answers

- Recon per the pre-answer: the ledger + `reports/` re-checked by hand on this tree, no sweep agent. Drift found:
  `OperationCard`'s twin branches sit at 390-409 / 422-441 now; the N3 inline copies are three different shapes,
  not one; `passwordHint` already uses P2's helper, so M5 is the section chrome and the toggle button only.
- Skipped on contact (reasons in `plan.md` § Decision ledger): N5, M6, N3's sender site, K3's action-row extraction,
  N8's `trimAddress` swap.

## Dual audit

Codex (`audit-codex.md`) and Fable (`audit-fable.md`) both landed on conditional-approve and both asked for a hybrid.
Agreed: skip N1 (three sites carry side effects, six tear down on hide or never) and M5's toggle (a 4-of-7 adoption);
keep N2 with the `v-if`/`v-else-if` branches intact inside their Transitions; L2 reads `props.token`; M1 imports
`getMethodLabel` directly and keeps `formatScope`/`fnLabel` in the component. Split: N4 (codex skip, fable keep) →
skipped; N7 (codex skip, fable keep) → kept with the reject/latch cases; I5 (codex: CSF indexing breaks on a factory)
→ skipped. Full ledger in `plan.md`.

## Skipped ids

- **N1**, **N4**, **N5**, **M6**, **I5**, **M5's toggle**, **N3's sender site**, **K3's action-row extraction**,
  **N8's `trimAddress`** — reasons in `plan.md` § Decision ledger.

## Final codex pass

`/codex high`, fresh session `01a07cf7-270d-7041-ae3d-f177d02bd136` (`audit-codex-final.md`): *conditional approve*, agrees
with both disputed calls; four conditions adopted — K3's merged branch keyed by `op.kind` (AddressDisplay resolves on
mount), rendered L2 parity cases, tighter N3/M1/N7/N8 test contracts (the FPC harnesses could not see a missing
error note), and `FieldWarning` homed in `@nulo/design/ui` per the L0–L6 table. Fable's "drop the panel's sanitizer
import" was wrong (`:314` still uses it) — kept.

## Phase 1 — provable moves (L2, K3, K8, N8, L5, M5's partial, M1) ✓

- L2: one feed block keyed on token presence, `showFallbackAwaiting` shared by the rows computed and the fallback
  card; the block-pair diff was asserted identical (modulo the two known lines and the comments) before deleting the
  second. K3: one branch, `:key="op.kind"` on its root `Flex`. K8: `DappIdentityBlock` in verify (the seven CSS classes
  were md5-identical), the unused sanitizer import gone. N8: a two-section table drives the six rows. L5/M5: two
  `composes:` partials. M1: `ScopePatternList` owns `formatScope`/`fnLabel`; the panel keeps `sanitizeWireString`
  for its unknown-type branch; `capability-shared.module.css` serves both.
- Script gotcha: the brace matcher took `formatScope`'s return-type literal as its body and split the function
  across the two files; repaired by hand. Test gotchas: a template-level auto-imported util (`humanizeMethodName`)
  is reached through `global.mocks`, not `vi.stubGlobal` (the instance proxy does not consult window globals);
  `TokenMetadataPopup` reads `token.contract` on the render before its first fetch resolves — a pre-existing
  swallowed render error, pinned as `(BUG PIN)` with an `errorHandler` rather than changed.
- Tests: `ScopePatternList` (11 parity cases), `OperationCard` (same rows for both kinds; a kind switch with a new
  destination remounts the payload subtree), `TokenMetadataPopup` (one mixed-boolean fixture: order, labels, keys,
  icons), `RecentActivityView` (+5 rendered cases on the shallow harness: token vs account fallback, orphan suppresses
  the fallback, both empty states, the token-presence flip remounts the root); the panel suite registers the real
  list.
- Gate: lint 0 · extension typecheck 0 · 50 files / 480 tests across `general tx windows capabilities import popups`
  · `build:chrome` 0; emitted CSS: `disclosure_toggle`, `detail_list`/`bullet`/`mono` once each, `section*` at their
  three files, two-token mappings at every consumer, `.fee_row_static`'s hover override intact; `components.d.ts`
  gained `ScopePatternList`.

## Phase 2 — popup pieces (N2, N3, N7) ✓

- N2: `FieldWarning` lives in `@nulo/design/ui` (exported, resolver-listed, 5-case package test incl. the real fade
  Transition for hidden→shown→hidden and the `v-if`/`v-else-if` pair); the fourteen rows became one tag each in the
  same branch positions, so every Transition still toggles the same children.
- N3: `ProcessingErrorNote` moved to `components/composite/` with a `color` prop (default primary); the two FPC popups
  pass `color="red"`; the contact popups' explicit imports follow. The FPC harnesses' `FormPopup` stub now renders
  `aboveSubmit` and registers the real note, and each suite has a failed-submit case that sees it.
- N7: `decide(action, label, icon)` holds the latch, the generation token, the key capture and re-check; the callers
  build the label in the same tick. Eight new cases pin the reject path (true / false / undefined / throw with toast,
  close count and latch release), the shared latch, the reopen-then-old-settlement sequence, the changed-identity
  guard and the captured symbol.
- Test gotchas: `findComponent(Transition)` does not resolve Vue's functional Transition — the fade is asserted through
  the `fade-enter-active` class on the entering element; a bare boolean attr reaches an untyped stub prop as `""`.
- Gate: lint 0 · extension typecheck 0 · popups + composite suites green · design package 38 files / 319 tests ·
  `build:chrome` 0 (`components.d.ts` gained `FieldWarning` and moved `ProcessingErrorNote`).
- Full-gate catch: `scripts/design-resolver.test.ts` pins `NULO_DESIGN_COMPONENTS` to the names whose extension SFC was
  deleted and migrated; a brand-new primitive has no such history, so `FieldWarning` left the resolver and the nine
  popups import it explicitly from `@nulo/design` (`components.d.ts` no longer lists it). Resolver + popups suites,
  lint, typecheck and the build green again.

## Phase 3 — full local gate and the codex fix loop

- First full run on 959bb7b8: 457/460 files green, one red — `scripts/design-resolver.test.ts` (the resolver pin);
  fixed in 7f4bd275 by importing `FieldWarning` explicitly.

### Codex fix loop (`/codex high`, GPT-6 Astra, session `01a07d0a-849e-7093-8fad-06b8a8fa91eb`, resumed each round)

- **Round 1** (on 959bb7b8): *"no new material findings"* — `decide()`, the feed condition and key, the keyed branch,
  the verify block, the fourteen warning conditions and the note sites all judged parity-preserving; four low items
  adopted: the eleven static warning rows keep the spaces the old spans carried (asserted via `textContent` from a
  compiled host template — VTU's string slots trim), the sanitizer case strips a control character inside the kept
  prefix instead of trailing markup, the fade cases assert `fade-enter-active`/`fade-leave-active` and the branch
  swap's element replacement, both FPC suites assert the note's red glyph, the note suite reaches ten cases (object
  tooltip, reactive colour), and the `decide()`/`fnLabel`/note/feed/verify comments lost their narration.
- **Round 2** (on 0871fccd): *"no new material findings"* — the nine explicit imports, the export and the resolver
  removal verified; the sharpened tests accepted. One comment nit adopted after the verdict (`decide()`'s doc names
  the invariant). One known, invisible text-node difference stays: `TokenMetadataPopup`'s table labels render without
  the single spaces the old spans carried inside them (Vue trims around a standalone interpolation; inline
  whitespace inside a span has no layout effect). Loop converged in two rounds.

## Phase 3 — full local gate ✓ (0871fccd, clean index; the later commit touches one comment and this file)

`bun run lint` exit 0 · `bun run typecheck:all` exit 0 · `bun run test` exit 0 (458 files, 5,626 tests) ·
`bun run --cwd apps/extension build:chrome` exit 0 with `git diff --exit-code --stat -- apps/extension/src/types/` exit 0 ·
no `nulo:e2e:` marker in `dist/chrome`.

## Stack rebase onto dev (2026-09-07, after #558 #560 #562 #563 #564 landed)

- Rebased bottom-up in the five worktrees (P1: `index.md` and `TokensView.vue`, where dev renamed the list and
  P1 removed the mint branch; P2: two import blocks; P3 clean; P4: dev's deletion of `SelectBalanceTypePopup` taken;
  P5: the generated `components.d.ts` entry order). Each branch re-ran lint, typecheck, its touched suites and the
  build green; the tip's full gate on 1464e73a: lint 0 · typecheck:all 0 · test 0 (469 files / 5,731 tests) · build 0 ·
  generated types unchanged · no e2e marker. All five branches pushed atomically with `--force-with-lease`; the
  push's concurrency guard cancelled the first duplicate runs (their aggregators read as failed until the queued
  reruns supersede them).
