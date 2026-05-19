# A11 — Vue popup-window decomposition

> **Status**: in-flight on branch `a11/vue-decomposition` (forked from master `b1c293b` post-M4).
>
> **Plan version**: v1 (post-codex-xhigh-audit, 2026-04-26).
> See `audit-codex.md` for the audit findings absorbed into this revision.
>
> Addresses audit finding **A11** (`AUDIT.md`) — oversized Vue popup files
> that grew to 1000+ lines despite the brutalist redesign retiring the
> old worst offenders (`ImportPopup.vue`, `SendPopup.vue`).

## Targets

| File | Current | Goal | Audit (2026-04-06) |
|---|---|---|---|
| `popup/windows/execute/index.vue` | **1064 lines** (post A11.1 pilot; was 1072) | ≤ 400 | 995 |
| `popup/windows/capabilities/index.vue` | **954 lines** | ≤ 400 | 812 |

Both files GREW since the audit. They're the dApp-window popups (transaction
approval + capability/permission grant).

## What this arc explicitly is + isn't

✅ **Pure structural refactor.** Every extracted component is a verbatim
copy of its old place. CSS class names, data-testid attributes, event
emit shapes, prop names, **CLEANUP ORDER**: all preserved.

✅ **Type-safe.** Each extract has explicit prop types (no `any` leak).
Composables that take state explicitly type as `Ref<T>` not `T`.

❌ **NO logic changes.** No new features. No bug fixes. No state-model
adjustments. The pre-existing `humanizeOperationKind` single-underscore-
replace quirk is preserved verbatim (documented in `humanize.ts`).

❌ **NO new tests** beyond the unit-test for the pure helper. Popup
windows aren't e2e-tested today (`connect-dapp.test.ts` skipped). A
"popup loads" smoke test wouldn't meaningfully verify real request
payload rendering — defer to user manual smoke at PR time.

## Hard rules (absorbed from codex audit)

1. **Auto-import does NOT cover `popup/components/`.** Vite's
   `Components({ dirs: [...] })` only scans `src/components`. Every
   new SFC under `popup/components/modules/...` MUST be explicitly
   imported by its parent. (This is consistent with existing patterns —
   see how `BalanceView`, `FeeSettingsCard`, `NetworkBadge`, and
   `CapabilityDetailPanel` are imported in their callers.)

2. **CSS isolation is mandatory.** Move local `identity_*`, `dapp_*`,
   `op_*`, `prop` style blocks wholesale into the extracted SFC. DO NOT
   pass parent CSS-module classes to children — `<Component :class="$style.foo" />`
   only reaches the child root and breaks nested rules
   (`.prop :last-child` style selectors won't match across the boundary).

3. **Long-lived service-client lifecycle stays in the parent.** Composables
   that need a service should accept a connected client OR a raw
   "do-the-thing" function from the parent. They MUST NOT create their
   own `XServiceClient` and call `connect()`/`disconnect()`. The parent
   owns `onMounted` connect and `onUnmounted` disconnect.

4. **Preserve the actual onUnmounted cleanup order**:
   ```
   profileService.disconnect()
   interactionService.disconnect()
   executionService.disconnect()        ← BEFORE timer clear (today's order)
   for (const t of Object.values(estimateTimers)) clearTimeout(t)
   window.removeEventListener("beforeunload", reject)
   ```
   `useFeeEstimation` must NOT own its own `onUnmounted`. It exposes a
   `dispose()` method that the parent calls AFTER `executionService.disconnect()`,
   in the same slot the timer-clear loop lives today.

5. **No `OpCard.vue` dispatcher wrapper.** The parent's template-level
   `v-if`/`v-else-if`/`v-else` switch on `op.kind` stays in `index.vue`.
   The 3 specialized cards (`OpCardSendTransaction.vue`,
   `OpCardAztecSendTx.vue`, `OpCardSimple.vue`) are imported directly
   into the parent. Avoids a wrapper that just relocates the switch +
   makes `UIOperation` typing harder.

## Verification gates (per sub-PR)

Smoke e2e doesn't cover these popups. Gates are weaker than M4's:

1. `bun run typecheck:all` → 8/8 packages clean.
2. `bun run --filter '@nulo/extension' test` → existing tests pass.
3. `bun run --filter '@nulo/extension' build` → clean.
4. **Visual fidelity (eyeball, post-handoff)**: extracted component is
   verbatim copy of the removed lines from the parent. User opens the
   dApp playground, triggers sendTx + requestCapabilities, verifies
   layout identical to pre-refactor.
5. **No data-testid changes** (e2e relies on them across navigation /
   wallet-lock / register tests).

**Stop rule** (per memory `feedback_autonomous_e2e_stop_rule`): 2
consecutive failures → hold the arc on its branch, do not auto-merge,
report for next-session review.

## Sub-PRs (sequential — REVISED ORDER)

### A11.1 — execute: extract `humanizeOperationKind` ✅ DONE (pilot, 3849ffd)

- `popup/windows/execute/humanize.ts` — pure function (29 lines)
- `humanize.test.ts` — 7 tests including pre-existing-bug pin
- `index.vue`: 1072 → 1064 lines (-8)

Pilot-grade extraction. Validated the workflow: typecheck clean, 482
extension tests pass + 7 new, build clean. Bug preserved verbatim.

### A11.2 — execute: extract identity strip + dApp identity block (~70 lines)

**Why before composables**: visual extracts are template/style islands
with zero state coupling. Safer pilot than touching the `init()` flow.

Move OUT of template + style:
- **Identity strip** (`execute/index.vue:410-436`, ~25 template lines + ~30 CSS lines):
  → new `popup/components/modules/execute/IdentityStrip.vue`
  Props (typed): `signerAccounts: Account[]`, `signerNetworks: Network[]`,
  `status: "ready" | "loading" | "cancelled"`. No emits.
- **dApp identity block** (`execute/index.vue:439-462`, ~25 template lines + ~30 CSS lines):
  → new `popup/components/modules/execute/DappIdentityBlock.vue`
  Props (typed): `dapp: UIDappMetadata | undefined`, `dappHostname: string`,
  `hostnameHasNonAscii: boolean`. No emits.

Both: explicit `import` in `execute/index.vue` (per Hard Rule 1). Local
CSS blocks move with each component (per Hard Rule 2).

Expected line reduction: ~110 lines (template 50 + style 60).

### A11.3 — execute: extract `useFeeEstimation` composable (~50 script lines)

Move OUT of script:
- `feeEstimates`, `estimatingOps`, `estimateTimers`, `estimateCounters`,
  `startEstimation()` → new `popup/windows/execute/useFeeEstimation.ts`

Composable signature (explicit ref-vs-raw types per audit):
```ts
import type { ExecutionServiceClient, FeeSettings, Operation } from "..."

export interface FeeEstimationApi {
  feeEstimates: Readonly<Ref<Record<number, unknown>>>
  estimatingOps: Readonly<Ref<Record<number, boolean>>>
  startEstimation: (opIndex: number, op: Operation, feeSettings: FeeSettings) => void
  /** Parent calls this from onUnmounted, AFTER executionService.disconnect(). */
  dispose: () => void
}

export function useFeeEstimation(executionService: ExecutionServiceClient): FeeEstimationApi
```

Parent's `onUnmounted` becomes:
```ts
profileService.disconnect()
interactionService.disconnect()
executionService.disconnect()
feeEstimation.dispose()              // ← replaces the timer-clear loop
window.removeEventListener("beforeunload", reject)
```

Expected line reduction: ~30 script lines.

### A11.4 — execute: extract pure derivation helpers (~30 script lines)

Move OUT of script:
- `dappHostname` + `hostnameHasNonAscii` computeds →
  `popup/windows/execute/dapp-identity.ts` exporting pure functions
  `getHostname(url: string): string` + `hasNonAscii(hostname: string): boolean`.
  Parent inlines `computed(() => getHostname(dapp.value?.url ?? ""))`.
- `signerAccounts` + `signerNetworks` computeds →
  `popup/windows/execute/signer-derivation.ts` exporting pure functions
  `deriveSignerAccounts(operations)` + `deriveSignerNetworks(operations)`.
  Parent inlines `computed(() => deriveSignerAccounts(operations.value))`.

NOT composables (which would take refs and own their own computed).
Pure functions are simpler + unit-testable + don't require ref imports.

Tests: `dapp-identity.test.ts` + `signer-derivation.test.ts` —
straightforward fixture-driven cases.

Expected line reduction: ~25 script lines.

### A11.5 — execute: extract one-shot `loadExecutionPayload` async helper (~120 script lines)

The big win on the script side. Replaces the original A11.1 plan's
`useExecutionPayload` composable (which was too wide per audit).

Move OUT of script:
- `init()` body (the giant operation-kind switch) →
  `popup/windows/execute/loadExecutionPayload.ts`

Signature:
```ts
import type { ExecutionPayload } from "@/wallet/services/dapp-interaction/client"
import type { Network, NetworkServiceClient } from "@/wallet/services/network/client"
import type { Account, AccountServiceClient } from "@/wallet/services/account/client"
import type { Operation } from "@/wallet/services/execution/client"

export type UIOperation = Operation & { network: Network; account?: Account }

export interface LoadExecutionPayloadResult {
  session: ExecutionPayload["session"]
  dapp: ExecutionPayload["session"]["dappMetadata"]
  operations: UIOperation[]
  accounts: Account[]
}

/**
 * One-shot async function. Caller passes connected service clients;
 * function does NOT call connect/disconnect. Caller is responsible for
 * lifecycle (this is intentional — A11 audit ruled out service-client
 * lifecycle ownership in helpers).
 *
 * Throws on validation failure (invalid request id, profile mismatch,
 * unknown operation kind). Caller wraps in try/catch + setError().
 */
export async function loadExecutionPayload(
  requestId: string,
  profileId: string,
  payload: ExecutionPayload,
  networkService: NetworkServiceClient,
  accountService: AccountServiceClient,
): Promise<LoadExecutionPayloadResult>
```

Parent `init()` shrinks to:
```ts
const init = async () => {
  try {
    profile.value = await profileService.getActiveProfile()
    requestId.value = router.currentRoute.value.query.requestId?.toString()
    if (!requestId.value) throw new Error("Invalid interaction request id")
    payload.value = (await interactionService.getInteractionPayload(requestId.value)) as ExecutionPayload
    dapp.value = payload.value.session.dappMetadata

    if (dapp.value.logo) {
      dapp.value.loadingLogo = true
      try { dapp.value.logoBlobUrl = await loadExternalImage(dapp.value.logo) }
      finally { dapp.value.loadingLogo = false }
    }

    if (profile.value?.id !== payload.value.session.profileId) {
      isWrongProfile.value = true
      throw new Error("Sign in with another profile")
    }
    const networkService = new NetworkServiceClient()
    const accountService = new AccountServiceClient()
    networkService.connect(); accountService.connect()
    try {
      const result = await loadExecutionPayload(
        requestId.value, profile.value.id, payload.value,
        networkService, accountService,
      )
      session.value = result.session
      operations.value = result.operations
      accounts.value = result.accounts
    } finally {
      networkService.disconnect(); accountService.disconnect()
    }
  } catch (error) {
    console.error(getErrorData(error))
    setError("Something went wrong")
  }
}
```

Expected line reduction: ~120 script lines.

### A11.6 — execute: extract op-card components (~250 lines)

3 specialized cards (NO dispatcher wrapper per Hard Rule 5):
- `popup/components/modules/execute/OpCardSendTransaction.vue` — old `send_transaction` branch
- `popup/components/modules/execute/OpCardAztecSendTx.vue` — old `aztec_sendTx` branch
- `popup/components/modules/execute/OpCardSimple.vue` — old catch-all `v-else` branch

Each card takes typed props:
- `op: UIOperation` (with kind narrowed via type guards in send-tx variants)
- `feeEstimate?: unknown` (only meaningful for send-tx kinds)
- `isEstimating?: boolean`
- `index: number` (for `feeEstimates[opIndex]` correlation)

Each emits:
- `update-fee-settings` `(settings: FeeSettings)` → parent forwards to startEstimation

Parent template's switch stays in `execute/index.vue`:
```vue
<template v-for="(op, i) in operations" :key="i">
  <OpCardSendTransaction
    v-if="op.kind === 'send_transaction'"
    :op="op" :feeEstimate="feeEstimation.feeEstimates.value[i]"
    :isEstimating="feeEstimation.estimatingOps.value[i]"
    :index="i"
    @update-fee-settings="(s) => feeEstimation.startEstimation(i, op, s)"
  />
  <OpCardAztecSendTx v-else-if="op.kind === 'aztec_sendTx'" ... />
  <OpCardSimple v-else :op="op" />
</template>
```

CSS: each card's local styles (`op_card`, `op_body`, `prop`, etc.) move
WHOLESALE into its `<style module>` block. Parent retains only
section-level styles (`sections`, `scroll_area`, etc.).

Expected line reduction: ~250 lines (template 200 + style 50).

### A11.7 — execute: final pass + verification

After A11.1-A11.6, `execute/index.vue` should be ≤ 400 lines:
- script ~150 lines (orchestration glue + composable wiring)
- template ~80 lines (composition root + the 3-way card switch)
- style ~60 lines (root-window styles only)

Final cleanup pass. Run all gates. Verify line target hit.

### A11.8 — capabilities: extract identity strip + dApp identity block

Mirror of A11.2 against `capabilities/index.vue`. Concrete extracts
(per audit):
- **IdentityStrip** (`capabilities/index.vue:358`) — same shape as
  execute's IdentityStrip; CONSIDER reusing the execute one if props
  match. Verify before duplicating.
- **DappIdentityBlock** (`capabilities/index.vue:370`) — same
  consideration.

If both can be reused from `popup/components/modules/execute/...`,
RENAME to `popup/components/modules/dapp-window/...` (shared) and
import from both `execute/index.vue` + `capabilities/index.vue`.

Expected line reduction: ~80 lines.

### A11.9 — capabilities: extract account-selection + capability-request lists

Concrete extracts (per audit):
- **AccountSelectionList** (`capabilities/index.vue:397`) →
  `popup/components/modules/capabilities/AccountSelectionList.vue`
- **CapabilityRequestList** (`capabilities/index.vue:461` and `:512`,
  the new + existing capability cards) →
  `popup/components/modules/capabilities/CapabilityRequestList.vue`

Note: `CapabilityDetailPanel.vue` already exists; CapabilityRequestList
likely uses it for the per-capability render. Verify the existing
component's surface before extracting.

Expected line reduction: ~250 lines (template + CSS).

### A11.10 — capabilities: extract `useCapabilityRequestState` (optional)

Audit suggested an optional composable around the label map (`:82`)
and init flow (`:136`). Same constraints as A11.5 — service-client
lifecycle stays in parent. Make the helper a one-shot async function
(`loadCapabilityRequest`) rather than a stateful composable.

Expected line reduction: ~80 script lines.

### A11.11 — final verification

- `wc -l` on both files confirms targets met
- typecheck:all clean
- test:all clean
- build clean
- AUDIT.md A11 status: `[x] Fixed`
- Visual fidelity comment in PR description: "every extracted
  component is verbatim copy of its old place; data-testid + class
  names + cleanup-order preserved"

## Risks tracked

1. **No automated visual regression**. `connect-dapp.test.ts` is
   skipped (`tests/e2e/connect-dapp.test.ts:5`). Mitigation: keep
   extractions structurally identical. Reviewer eyeballs at PR time.
2. **Reactive prop semantics**: composables explicitly take `Ref<T>`
   for state inputs (per Hard Rule + audit). Pure helpers take raw
   values; caller wraps in `computed()`.
3. **Service-client lifecycle ordering**: Hard Rule 4 documents the
   exact onUnmounted order. Tests can't catch this; reviewer eyeballs.
4. **Don't add dummy indirection to hit ≤400**: NIT from audit.
   Target is a guardrail, not a goal in itself. If we hit ~450 with
   clean splits, that's fine — better than a 399 with a tiny extra
   wrapper.

## Done-when

- `wc -l execute/index.vue capabilities/index.vue` shows ≤ 400 each
  (or close — see Risk #4)
- `bun run typecheck:all` clean
- `bun run test:all` clean
- `bun run --filter '@nulo/extension' build` clean
- AUDIT.md A11 marked `[x] Fixed`
- Master can fast-forward `a11/vue-decomposition` cleanly
- Manual smoke (user-driven post-handoff): execute popup +
  capabilities popup render identically

## When user is back

- Sign-off on the PRs (1Password unlock + amend)
- Manual smoke: dApp connect → sendTx → execute popup renders OK; dApp
  requestCapabilities → capabilities popup renders OK.
- Decide: continue execution from A11.2 autonomously, or pick up driver
  yourself.
- Squash-merge the arc to master.
