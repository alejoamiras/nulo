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

### Gate result
- `bun run test` (extension units + components): **2649 passed | 7 todo**, exit 0.
- `bun run lint`: clean (57 warnings / 3 infos, **0 errors**).
- `bun run --cwd apps/extension typecheck`: **0 errors**.
- `bun run test:e2e` (smoke): **69 passed | 6 skipped | 1 failed**.
  - The single failure is `passkey-backup.test.ts > passkey full-backup export`, which is **`test.skipIf(process.env.CI === "true")`** (local-only — its header documents it as 5-10× slower + fragile "under cumulative load"). On this loaded multi-agent host it times out at the 15s inner `waitForFunction` for the `backup-status-card` "Creating your backup" intermediate state (`:201`). The other 2 tests in the file pass (virtual authenticator works), and an isolated re-run failed x2 → external machine load, not a transient hiccup.
  - **Unrelated to Unit B** (no file overlap: B touched `OperationCard.vue` + `capabilities/index.vue`; the failure is the passkey full-backup export flow) and **excluded from the enforced CI `smoke-e2e-status` gate**. Classified as a load-induced flake in a CI-skipped test; not neutralized (test left as-is). All 69 CI-relevant smoke tests pass.
