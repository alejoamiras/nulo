# P16 · Q-14 — dApp-window shell + `usePopupEntity` composable · tier: **deep** (broad UI)

## STEP 1 re-verify (vs `dev-quality` HEAD `46061e2`) — VALID
Duplication persists: `NewNetworkPopup.vue` has the keydown add/remove lifecycle (`document.addEventListener("keydown", onKeydown)` in mount, removeEventListener in unmount); `NewContactPopup.vue` has 5 connect/disconnect/keydown/onBeforeUnmount refs. The 29 popups + 3 dApp windows (execute/capabilities/discover) each repeat: connect-on-show / disconnect-on-hide, Enter-key submit handlers, error-tooltip blocks (popups); session wait, auth redirect, beforeunload rejection, completion cleanup, processing-error UI (windows).

## Existing infra (build ON these — do NOT reinvent)
- `composables/useEntityCrud.ts` (+ test) — entity CRUD (C1 service hook).
- `composables/useFormState.ts` (+ test) — form state.
- `components/composite/FormPopup.vue` (L3) — the form-popup composite.
- MISSING: `usePopupEntity` (to create) + a dApp-window shell.

## Design direction (codex leg to attack; opus leg likely glitches)
- **`usePopupEntity` (C1 composable)** unifies the POPUP lifecycle: connect-on-show / disconnect-on-hide (parent owns the connected client per the C1 rule — the composable receives it, exposes `dispose()` the parent calls in `onBeforeUnmount`), the Enter-key submit handler (keydown add/remove), and the error-tooltip state. Compose with `useEntityCrud`/`useFormState` + render through `FormPopup`. Migrate the 29 popups to it in batches.
- **dApp-window shell** (a composable or a shell component wrapping the 3 windows): session-wait + auth-redirect + beforeunload rejection + completion cleanup + processing-error UI. **Cancellation / beforeunload / disconnect-ordering semantics are LOAD-BEARING — preserve verbatim** (the CLAUDE.md `onBeforeUnmount` cleanup-order rule + the beforeunload reject are behaviorally load-bearing; a reorder is a real bug). BUG-PIN any surprising current behavior.

## Constraints (from CLAUDE.md + the finding)
- **Composables MUST NOT own their own `onUnmounted`** — expose `dispose()`, parent calls it in the existing slot (the documented cleanup-order rule). The `usePopupEntity`/shell must follow this.
- **testid preservation** — every `data-testid` verbatim across the migration (e2e selectors depend on exact stability).
- **Keyboard/focus order** — the Enter-submit + tab-order rules (no positive tabindex; secondary controls `tabindex=-1`) must survive the extraction.
- L3/composite layer bans (no service clients in the composite; the composable receives the connected client from the parent).

## Phasing (deep — codex leg refines)
- **P16.0** characterize: pick 2-3 representative popups (a simple one like NewNetworkPopup + a complex one like EditContactPopup/NewFpcPopup) + capture their current lifecycle behavior (connect/disconnect ordering, keydown, error) as the equivalence reference.
- **P16.1** build `usePopupEntity` + migrate the 2-3 representative popups; per-popup component tests (≥10 for composables per CLAUDE.md) + e2e smoke.
- **P16.2..N** migrate the remaining popups in batches (grouped by shape), each batch gated (component units + smoke). Preserve testids + focus order verbatim.
- **P16.last** the dApp-window shell for execute/capabilities/discover — the highest-risk (cancellation/beforeunload). Gate: component units + smoke + FULL network (the windows are the dApp path).
- Per-arc tail per batch: `/code-review max --fix` → codex post-impl.

## Assumptions
- **Facts:** the duplication + the existing infra (file paths above, verified).
- **Inferences (codex to attack):** the 29 popups share ENOUGH shape for ONE `usePopupEntity` (some may be too bespoke — the migration may leave a few unmigrated, which is fine); the window shell can unify cancellation without changing the beforeunload/disconnect ordering.
- **Asks:** none expected (behavior-preserving); a genuine cancellation/beforeunload behavior change would be surfaced, not folded in.

> **Status:** STEP 1 ✓ VALID; infra scoped; design direction drafted. Next: codex `xhigh` deep-audit leg on this plan (attack the "one composable fits 29 popups" assumption + the load-bearing cancellation/beforeunload preservation), then P16.0 characterization → P16.1 `usePopupEntity` + representative migration.
