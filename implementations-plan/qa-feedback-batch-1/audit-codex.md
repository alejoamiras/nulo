# Codex review — QA feedback batch #1 plan

**Date:** 2026-05-22
**Effort:** xhigh, read-only
**Session:** 019e501b-b18a-7a50-a08e-4045fd153af4

---

## Verdict

**Needs-work.** No security blocker on E3. Plan is missing one real implementation fallout (e2e helper churn) and one residual stale-state path (toast).

---

## Findings

### 1. E3 — trust boundary safe, but e2e fallout missing

`availableAccounts` is wallet-derived, not dApp-supplied:
- `packages/wallet-bridge/src/dispatcher.ts:462` — bridge loads via `AccountService.getAccounts(ctx.profileId, network.chainId)`
- Forwarded into the popup at `packages/extension/src/popup/windows/capabilities/index.vue:90`

So a malicious dApp cannot inject a phantom account. **The actual gap is e2e fallout:**

- `packages/extension/tests/e2e/fixtures/popups.ts:177` — helper blindly clicks requested account rows
- `packages/extension/tests/e2e/network/cap-request-accounts.test.ts:35` — passes first account explicitly
- `packages/extension/tests/e2e/network/meta-getAccounts.test.ts:34` — same

With single-account auto-select, the helper click becomes a *de-select*. Update the helper to be idempotent.

### 2. F2 bug A — closes inline row but not toast

Guarding the status row fixes the inline stale link in `packages/faucet/src/components/TokenCard.vue:120`. But:
- `packages/faucet/src/composables/useToast.ts:19` — 6000ms TTL
- `TokenCard.vue:102` — pushes view-tx link on success

If the user re-drips quickly, the prior toast is still clickable during the new inflight state. **Residual risk if scope was broadly "no stale tx affordance during inflight"**, not just the inline row.

### 3. F2 tests won't catch the bug as written

Current `TokenCard.test.ts:22` harness:
- Mocks `useFaucetDrip`; `inflight` ref exists
- `dripFn` resolves immediately, never mutates `inflight.value`

So "click, await, assert" only verifies terminal states. To prove bug A is closed:
- Use a deferred promise
- Set `inflight.value` before resolution
- Assert no terminal tx affordance is visible mid-flight

Also: explicitly cover `success -> error` and `error -> success` transitions. The state logic in `TokenCard.vue:52` should handle them, but tests don't pin it.

### 4. E1 — no hidden enforcement, but freeze contract self-contradictory

Only hard guard: `packages/extension/src/wallet/config/config.test.ts:1`. Searched:
- No CI / pre-commit / docs separately pin `theme = dark`
- `packages/extension/tests/e2e/appearance.test.ts:5` checks mode switching, not factory default

So no hidden enforcement. **But** the prose at `config.test.ts:4-8` says "do not fix this without an explicit SECURITY.md entry." For a UX-only default, do not add fake security docs. Narrow the comment or add a short note about this approved UX flip; otherwise future reviewers learn to ignore the freeze.

---

## Direct answers

**E3:** safe from malicious-dApp account injection. The dApp can request `accounts`; it cannot choose what appears in `availableAccounts`. User still sees the row and must hit Approve. Reduced friction, not broken trust boundary.

**F2:** error/ok override logic is fine. `statusKind` prioritizes `dripping`, then derives terminal state from latest `lastDrip.kind`. `error -> drip-again -> success` does not leave red styling stuck. Bigger remaining stale surface is the toast (above).

**E6:** prefer a real `<button type="button">` styled as link over `<a href="#">`. This is an action, not navigation. Codebase has link-styled button concept at `packages/extension/src/components/ui/Button.vue:10`, and inline ghost action via real button at `packages/extension/src/components/composite/SecretCountdownClose.vue:40`. Convention is mixed but a11y answer is button.

**E2:** be more thorough than written scope. No obvious other miss found, but stated audit scope is narrower than user request. Make it repo-wide over `packages/extension/src/**/*.vue`. Include `role="button"` plus non-button `@click` targets, not just `popup/components/modules` and `components/composite`.

---

## What to verify in tests

- Single-account cap flow approves without clicking the row; manual de-select still re-triggers "Select at least one account" warning
- Multi-account cap flow is unchanged
- During a deferred drip, status is `dripping` and there is no terminal tx affordance in the row; then `success -> error` and `error -> success` both fully replace text/link/color
- Fresh install default resolves to `system` on both popup and onboarding bootstrap, while persisted user themes still win on subsequent loads
