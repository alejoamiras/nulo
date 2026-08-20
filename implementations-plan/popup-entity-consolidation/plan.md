# popup-entity-consolidation [blueprint light]

Finish the popup Enter-lifecycle unification: `usePopupEntity` becomes the self-cleaning canonical mechanism for the STANDARD popup lifecycle, and the four remaining standard hand-rolled watch blocks migrate onto it. Owner-decided direction (conversation, 2026-08-20). Evidence: [recon.md](recon.md). The plan audit REJECTED the first draft and reshaped the design — ledger below; its central catch: **the #430 latches prevent re-entry, not premature first entry**, so migration must preserve each popup's initialization timing, not lean on the latches.

## Success criterion

One place owns the standard popup Enter-listener lifecycle (named exceptions: NewToken's phase-machine teardown, the authwits pair's deliberate any-Enter); a plain `unmount()` cleans the listener up; the four hand-rolled copies are deleted; ZERO behavior change — including initialization-window timing, preserved per popup.

## Assumptions

**Facts (audit-corrected):**
1. `usePopupEntity` (13 pins) has no unmount/scope cleanup; its `onShow` is invoked from a SYNC watcher with the returned promise discarded — migrating the async watch bodies naively would drop their rejections.
2. Production popup shells never unmount popups TODAY (`PopupManager` renders them unconditionally) — the leak is test-only under the current shells; that is an observation about today, not a guarantee.
3. SIX test files hand-roll hide-before-unmount `dispose()` helpers (EditProfile, NewSender, NewEndpoint, NewAccount, EditAccount, NewNetwork); most EditContact/NewContact tests never unmount at all and document their leaks inline.
4. Per-popup initialization timing today: EditFpc, NewFpc, EditContact install their listener AFTER their population awaits; **NewContact already installs BEFORE its await** (verified — its migration is timing-equivalent with no gate).
5. All four submit handlers are re-entrancy-latched (#430) — protecting against DOUBLE submission only; the FPC popups have no fresh re-check defense, so a premature FIRST submit during population would run with an incomplete duplicate list, and EditContact's import mode could submit before `contactToEdit` is set.
6. NewToken hand-rolls the same watch shape PLUS specialized teardown (in-flight balance-wait abort, phase reset, 3-client disconnect) and carries the largest popup oracle suite — a named exception, not a migration target.
7. Vue runs `onBeforeUnmount` BEFORE scope cleanup — a future parent disconnect hook would execute while the listener is still installed; "no ordering coupling" is therefore direction-dependent, not absolute (safe today: no adopter has such a hook).
8. Base `2fb8a4d3` = #430 (direct parent) + CI-only #428.

**Inferences:** the C1 rule's RATIONALE is service-disconnect ordering (inference from its text + the repo's existing mixed practice — some composables already use `onScopeDispose` alongside exposed disposal); remove-first-on-hide is strictly safer (audit confirmed: no interleaving window, EditContact's cache clear has no listener dependency).

**Asks (approval gate):**
1. **C1 convention ruling**: (a) RECOMMENDED — add a one-sentence carve-out to CLAUDE.md's composable rules: scope-tied cleanup of non-service resources (DOM listeners, timers) via `onScopeDispose` is allowed; service clients stay parent-disposed. Matches existing practice the audit found. (b) Alternative: `usePopupEntity` returns an idempotent `dispose()` and every parent wires it — explicit but reintroduces the 12-site forget-one failure mode.

## Architecture & Implementation (compact)

1. **`usePopupEntity.ts`** gains three things:
   - `onScopeDispose` listener removal (+ the C1 reconciliation comment, stated direction-dependently per Fact 7);
   - **promise-aware handlers**: `onShow`/`onHide` typed `() => void | Promise<void>`; the composable tracks `onShow`'s promise and re-dispatches its rejection (`queueMicrotask(() => { throw err })`) so migrated async bodies lose no error surface;
   - **opt-in `submitWaitsForShow`**: while `onShow`'s promise is pending, `submit` is inert — reproducing install-after-await timing exactly. Set for EditFpc, NewFpc, EditContact; NOT set for NewContact (Fact 4) nor any existing adopter (their live-during-await behavior is pinned by #424 and stays).
2. **Migrate 4 popups**, bodies verbatim (NewContact's reset-before-await comment survives; EditFpc's missing-row `emit("onClose"); return` stays).
3. **Pins-first** for the untested EditFpc + NewFpc, INCLUDING the initialization window: Enter during the pending population await → inert (the flag's pin), plus the standard focused-Enter/body-Enter/post-hide/latch set. Composable pins: scope-stop removal; `submitWaitsForShow` gating incl. rejection unblock; rejection re-dispatch.
4. **Test cleanup, guaranteed not manual**: the touched suites move to wrapper-tracking `afterEach` unmount (works even when an assertion throws); the six `dispose()` helpers reduce accordingly; ONE component-level canary (shown → `unmount()` → Enter inert) proves the scope hook through test-utils, not just `effectScope`. Documented limitation: plain unmount does NOT run `onHide` — cleanup of the listener is the scope hook's job; service-disconnect side effects in tests that need them still hide first.
5. **Untouched, named**: NewToken (specialized teardown + oracle suite), authwits pair, B-09/B-26, capabilities frozen oracle, all submit-handler logic, all existing adopters' timing.

## Security & Adversarial Considerations

The audit's initialization-window finding IS the security story: without the gate, migration would have opened a first-entry window where FPC duplicates and import-mode contact writes bypass their population-dependent checks. `submitWaitsForShow` closes it by construction and is pinned per popup. No trust boundary moves otherwise; the change deletes duplicate lifecycle code and narrows when dead components can receive events.

## Validation

`bun run audit:vue` → composable + popup suites (new pins + untouched oracles) → armed smoke locally + `e2e:smoke` label on the PR → single codex xhigh end-diff pass → babysit → squash-merge.

## Audit ledger

- **Codex xhigh plan audit: `reject` — ALL SIX findings adopted, design reshaped.** (1) C1 "no ordering coupling" was too absolute (`onBeforeUnmount` precedes scope cleanup) — restated direction-dependently + surfaced as an owner Ask with the CLAUDE.md carve-out recommended; (2) the central catch — latches ≠ premature-first-entry protection; per-popup analysis confirmed (NewFpc duplicate-list bypass, EditFpc post-`getFpc` window, EditContact import mode; NewContact timing-equivalent) → the opt-in `submitWaitsForShow` gate preserves timing exactly; (3) async watcher rejections would be silently discarded → promise-aware handlers with rejection re-dispatch; (4) remove-first-on-hide confirmed strictly safe; (5) cleanup plan was incomplete (SIX helpers, not five; contact tests never unmount; manual simplification insufficient) → guaranteed afterEach unmount tracking + the component-level canary + the unmount-skips-onHide limitation documented; (6) NewToken was silently missing from the exclusions → named exception, "one place" claim narrowed.
