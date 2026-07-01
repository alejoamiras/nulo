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

## codex deep-audit (`gH2bjztQ`) — PLAN-NEEDS-REVISION → **RE-SCOPED (finding shrunk)**

codex confirmed "one composable for 29 popups" is **too broad**. The behavior-preserving, valuable scope is a **NARROW helper**, not a broad CRUD/service-lifecycle owner. Revised plan:

### `usePopupEntity` = NARROW helper (show-watcher + Enter-listener + reset/error state ONLY)
NOT a service-lifecycle owner. It unifies the mechanical duplication the fitting popups share: the `watch(show)` connect/disconnect timing hook, the document Enter-key listener add/remove, and the reset/error state. The parent keeps owning `.connect()/.disconnect()` (per C1); the helper just fires callbacks at the right lifecycle points.

### Popups that FIT (the P16 migration set — plain `FormPopup` create/edit forms)
`NewNetworkPopup`, `EditNetworkPopup`, `NewEndpointPopup`, `EditEndpointPopup`, `NewAccountPopup`, `EditAccountPopup` (+ maybe `NewFpcPopup` with hooks). **~6–7 popups**, not 29.

### Popups that RESIST — LEAVE THEM (codex-enumerated; forcing them in is the danger)
- `NewTokenPopup` (balance wait + event subs + explicit `taskService.connect()` in submit + abort/reset/disconnect ordering, `:177-188,264-276`)
- `EditContactPopup` (dual services, sync sender-state latch, import branch, migration truth table; only keydown/error common, `:290-337`)
- `ChangeAuthwitsRegistryPopup` / `RevokeAuthwitsPopup` (fee settings, cancellable-tx classification, chunked sequential revoke, non-`FormPopup`, different Enter semantics, `:91-115` / `:139-168`)
- `ImportContactsPopup` (close rejects `cacheStore.importPromise`; not form CRUD, `:73-80,126-135`)
- `IncomingTrustPopup` (trust-boundary focus on contract expand, no Enter-submit, `:115-129`)
- list/detail: `SelectFpcPopup`, `SelectBalanceTypePopup`, `SelectProfilePopup`, `SelectTokenPopup`, `TokenMetadataPopup`
- `EditProfilePopup`, `NewSenderPopup` (form-like but non-`FormPopup`; global Enter, not input-only, `:84-112` / `:77-97`)

### Window shell = SEPARATE effort (NOT this PR; NOT the same abstraction)
The 3 dApp windows (execute/capabilities/discover) are a DIFFERENT phase (P16b, own PR). **Load-bearing semantics the shell MUST preserve verbatim** (codex, file:line):
- services connect BEFORE session-wait/auth-redirect (execute `411-438`, capabilities `241-267`, discover `136-162`)
- `beforeunload` added ONLY after `await init()` — closing during session-wait/auth-redirect/pre-listener does NOT reject today; moving it earlier is a behavior change
- completed approve/reject removes `beforeunload` BEFORE `chrome.windows.remove` (execute `370-380`, …)
- unmount disconnects services BEFORE removing `beforeunload` (execute `441-447`, …); a shell calling `dispose()` must follow CLAUDE.md `163-178`: service disconnect → dispose/timers → remove listener
- **execute wrong-profile is SUBTLE** (`execute/index.vue:157-160,532-535,376-378`): overlay dismiss calls `closeWindow()` without `true`, so the still-installed `beforeunload` REJECTS the pending request; removing the listener there would silently strand/reclassify the dApp request — DO NOT touch without a pin.

### Deferred asks (codex) — resolved autonomously (behavior-preserving = leave as-is)
- `SelectFpcPopup` has NO hide-disconnect (`:88-95`) — **BUG-PIN as pre-existing, DEFER** (don't "fix" it; a fix = behavior change out of dedup scope).
- `useDappInteractionPayload` auto-disposes via `onScopeDispose` (`:109-115`) vs the stricter C1 rule — **DEFER** (touching it is out of Q-14's dedup scope; a separate finding if pursued).

## Revised phasing
- **P16.0** characterize 2 fitting popups (`NewNetworkPopup` simple + `EditAccountPopup`) — current connect/disconnect/Enter/error behavior as the equivalence reference.
- **P16.1** build the NARROW `usePopupEntity` + migrate those 2; component tests + testid/focus-order verbatim + smoke. One gated PR.
- **P16.2** migrate the rest of the fitting set (the other network/endpoint/account popups) in one batch; gated.
- **P16b (separate PR, deferred/optional)** the dApp-window shell — characterize the 3 windows FIRST, preserve the load-bearing semantics above; FULL network gate. Higher-risk; may be time-boxed/deferred past the arc.

> **Status:** codex audit incorporated; finding **SHRUNK** to a narrow helper for ~7 popups (window shell = separate P16b). Next: P16.0 characterize → P16.1 narrow `usePopupEntity` + migrate 2, first gated PR.
