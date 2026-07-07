# Phase B — Approval-display truthfulness (F-02 display, F-07, F-01 UI) — LIGHT→MID

Branch: `fix/hf-b-approval-display` off `fix/harden-findings`. Depends on A (merged, PR #261).

## Scope (grounded in code)
1. **F-07 — sanitize dApp-authored method labels + args in `OperationCard.vue`.** `sanitizeWireString`/`safe()` is imported (`:27,29`) and applied to dApp name (`:232`) + token metadata (`:299,307`), but NOT to method names / args, which render via bare `humanizeMethodName(...)` at `:118,133,149,183,342` and args at `:138`. Fix: route those through `safe(...)` (bidi/zero-width/control strip + length clamp) — the security-decision text gets the same sanitizer the dApp name already gets.
2. **F-01 UI — surface `canCreateAuthWit`.** `build-items.ts:36` `if (cap.type === "accounts") continue` skips the accounts cap entirely, so its `canCreateAuthWit` sub-permission is invisible at grant time (the bundling that made F-01 Critical). Surface it in the capabilities/account approval UI so the user sees "this dApp can create auth-witnesses" before granting.
3. **F-02 display — NOT pre-popup PXE resolution.** Per the chosen approach (plan decision ledger), display relies on Unit A's execution-layer name↔selector reject: a spoofed `name:"transfer"`/`selector:approve` is rejected at execution, so the shown name is truthful-or-rejected. `parseTransferIntent` stays name-based (selector-verification would need PXE at popup-build — the heavier option B rejected). Residual: a spoofed "verified transfer" badge would display then the tx rejects (UX, not security). Documented.

## Invariants
- No dApp-authored string reaches the confirmation UI without `sanitizeWireString` (bidi/control strip + length clamp).
- `canCreateAuthWit`, when granted, is visible in the approval flow before the user consents.
- No behavior/security regression (relies on A's execution-reject, already merged + gated).

## Negative tests (component)
- OperationCard renders an RLO/zero-width/overlong method name → displayed text is stripped/clamped (not raw).
- OperationCard renders overlong args → clamped.
- Capabilities UI with an `accounts` grant that has `canCreateAuthWit` → the create-authwit permission is visible.

## Gate (plan.md Unit B): components + `bun run test` + lint + `bun run test:e2e` (smoke).
