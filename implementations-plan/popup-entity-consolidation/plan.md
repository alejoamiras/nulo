# popup-entity-consolidation [blueprint light]

Finish the popup Enter-lifecycle unification: `usePopupEntity` becomes the ONE self-cleaning mechanism, and the four remaining hand-rolled watch blocks migrate onto it. Owner-decided direction (conversation, 2026-08-20) after the re-entrancy arc paid the leaked-listener attention-tax three times. Evidence: [recon.md](recon.md).

## Success criterion

One place owns the popup Enter-listener lifecycle; a plain `unmount()` cleans it up in tests (no hand-rolled hide-before-unmount helpers); the four hand-rolled watch copies are deleted; ZERO behavior change beyond the two pre-characterized ordering improvements (recon divergences a+b).

## Assumptions

**Facts:** recon.md §Facts 1–8 (composable shape + no scope cleanup today; production never unmounts — the leak is test-only; the four popups' keydown bodies already use `isPopupSubmitKey` verbatim; all four handlers latch-guarded since #430, making the listener-before-await order safe family-wide; `onScopeDispose` fires on test-utils `unmount()`; the C1 rule's rationale is service-disconnect ORDER, which listener removal does not touch; no other popups have document listeners; clean base).

**Inferences (audit should challenge):**
- `onScopeDispose` inside the composable is C1-COMPLIANT in spirit: the ban protects parent-controlled disconnect ordering; a DOM-listener removal has no ordering relationship (it already runs FIRST on the hide path). Fallback if the audit disagrees: an exposed `dispose()` — strictly worse (12 call-site burden, the forget-one-site failure mode this arc family exists to kill) but still better than today.
- The two ordering divergences are safe: (a) is arc C's pinned precedent now backed by family-wide latches; (b) is strictly safer (remove-first on hide).

**Asks:** none — scope, mechanism, boundaries, and risk posture were owner-settled in conversation (migration half INCLUDED as the architecturally correct call; authwits excluded; frozen oracles untouchable).

## Architecture & Implementation (compact)

1. **`usePopupEntity.ts`**: add `onScopeDispose(() => document.removeEventListener("keydown", onKeydown))` — with a comment carrying the C1 reconciliation (why this is not the banned `onUnmounted` pattern: no service teardown, no ordering coupling; it exists so tests and any future unmounting shell cannot leak the listener). +1 pin in `usePopupEntity.test.ts`: scope stop removes the listener (Enter after `scope.stop()` is inert even while shown).
2. **Migrate 4 popups** (EditFpc, NewFpc, EditContact, NewContact): watch block → `usePopupEntity(() => props.show, { submit, onShow, onHide })`, bodies preserved verbatim (NewContact's reset-before-await comment survives inside `onShow`; EditFpc's missing-row `emit("onClose"); return` stays). The `onKeydown` consts + explicit `usePopupEntity` imports adjust accordingly.
3. **Pins first where coverage is thin**: EditFpc + NewFpc have NO test files → minimal Enter-wiring harnesses BEFORE migration (arc-C recipe: focused-Enter submits / body-Enter doesn't / post-hide inert / re-entrancy latch holds — ~4 pins each, mirroring the existing harness idiom). EditContact + NewContact are already covered (incl. #430's re-entrancy pins) — those suites must pass UNCHANGED across the migration (they are the migration's regression oracle).
4. **Test-cleanup simplification**: the five hand-rolled `dispose()` helpers (EditProfile, NewSender, NewEndpoint, NewAccount, EditAccount test files) reduce to plain `unmount()`; the contact pins' explicit hide+reset lines simplify likewise. The ChangeAuthwits dispose hygiene STAYS (hand-rolled popup, deliberately unmigrated).
5. **Untouched**: the authwits pair (any-Enter is deliberate; test hygiene done), B-09/B-26 popups, the capabilities frozen oracle (byte-identical), all submit-handler logic.

## Security & Adversarial Considerations

No trust boundary moves: the change narrows WHEN a dead component can receive keydown events (never, after scope death) and deletes duplicate lifecycle code. The main adversarial concern is regression-by-migration in the four popups — countered by pins-first on the untested two and the existing suites as oracles on the tested two. The listener-before-await window (divergence a) is the one behavior-adjacent edge; it is safe only BECAUSE of #430's latches — the plan makes that dependency explicit so a future latch removal knows what it breaks.

## Validation

`bun run audit:vue` → popup + composable suites (incl. the new pins) → armed smoke locally + `e2e:smoke` label on the PR (popup src changes) → single codex xhigh pass (plan+diff, light tier) → babysit → squash-merge.

## Audit ledger

(appended as legs complete)
