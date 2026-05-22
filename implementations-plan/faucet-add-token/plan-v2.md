# Faucet "Add USDC / ETH to Wallet" — plan-v2 (consolidated)

Supersedes [`plan.md`](plan.md). Incorporates [`audit-opus.md`](audit-opus.md) + [`audit-codex.md`](audit-codex.md) findings and the user's four answers on open questions:

- **Resolve token name/symbol in popup** before Allow/Deny → IN this PR (was filed as follow-up; promoted to BLOCKER per Codex H5 + Opus H4).
- **No auto-fire on drip** → unchanged.
- **No upstream `wallet_watchAsset` push** → struck from follow-ups.
- **`simulate_views` op-kind deprecation** → separate follow-up plan (`deprecate-simulate-views`); current PR only drops the dApp-facing surface.

## 1. Summary

A one-click "Add to Wallet" button on the faucet's USDC and ETH TokenCards that calls a Nulo-custom `registerToken` RPC over the existing `@aztec/wallet-sdk` encrypted channel. The extension shows a popup carrying the **resolved token name, symbol, decimals, and contract address** (pre-fetched via PXE before the popup renders), gated behind the existing `accounts` capability. On Allow, the token is added to the **profile + chain** watchlist; the wallet's TokenBalanceService fans out per-account balance projections and the wallet popup's token list renders it for the current account.

## 2. State of the world (revised recon)

| Layer | File | Status |
|---|---|---|
| dApp `Wallet` proxy | upstream `@aztec/wallet-sdk` | `ExtensionWallet` is a Proxy that does `schemaHasMethod(WalletSchema, prop)`; unknown methods error. |
| Extension `BackgroundConnectionHandler` | upstream | **Does NOT validate against `WalletSchema`** (corrects v1 plan §2). Just decrypts + fires `onWalletMessage`. The extension schema patch is still needed for SDK proxy parity, NOT for routing. |
| `WalletSchema` mutability | upstream | Plain mutable object; Zod entries can be added at runtime. |
| `register_token` op kind | `packages/wallet-bridge/src/operation.ts:61`, `extension/src/wallet/services/execution/service.ts:895, 1038-1059` | Wired but unreachable on the dApp wire (schema not patched). Internal callers: none. |
| **Popup gate for `register_token`** | `dispatcher.ts:243-252` + `dapp-interaction/service.ts:345-364` | **FICTION as v1 plan asserted.** Dispatcher routes non-`sendTx` ops straight to `executionService.executeOperations()`, bypassing the popup. Even if rerouted, `accessLevel(AppState=1) >= confirmationLevel(Transactions=5)` is false. **Must fix.** |
| Account scoping | `dispatcher.ts:658-660, 764-767, 833-847` + `token/service.ts:149-159, 474-476` + `token-balance/service.ts:170-175` + `TokensView.vue:223-227` | The dApp-supplied account is IGNORED by the dispatcher (uses the first session-authorized account). Storage dedupe is `(profileId, chainId, contract)` — profile+chain, not per-account. `onTokenAdded` fans out a balance projection per account. UI filters by current account at render. **The v1 "per-account" copy was wrong.** |
| `TokenImportRow` durability | `TokenImportRow.vue:4-11`, `TokensView.vue:37-40, 51-62` | Renders only in-flight or recently failed imports — disappears on success. The "Requested by <origin>" audit trail is NOT durable post-success (v1 plan §8 overstated this). |
| Faucet vite dev server | `packages/faucet/vite.config.ts:12-18` | Hard-pinned to `5176` with `strictPort: true`. Not parallel-safe. |
| Network e2e suite root | `packages/extension/vitest.e2e.network.config.ts:10-13` | Only includes `tests/e2e/network/**/*.test.ts`. v1 plan placed the new test at `tests/e2e/faucet-add-token.test.ts` — wrong path. |
| Faucet's own e2e | `packages/faucet/tests/e2e/` | jsdom mock-based, not browser. Not reusable for the extension's network suite. |

## 3. Locked-in decisions (from clarifying)

| # | Decision | Source |
|---|---|---|
| D1 | Inline schema patches in **three places** (extension, faucet, playground), no shared `@nulo/wallet-bridge` export, no new published package. | User clarifying. |
| D2 | Patch scope: **only `registerToken`**. `getCompleteAddress` + `simulateViews` dApp-facing surfaces dropped. `simulate_views` *op kind* preserved (internal callers). `get_complete_address` *op kind* dropped entirely (no internal callers). | User clarifying + recon. |
| D3 | Patch applied via **side-effect import** on each side, BEFORE `WalletManager.configure()` / `BackgroundConnectionHandler` construction reads `WalletSchema`. | User clarifying. |
| D4 | Both USDC + ETH; button always visible once connected. | User clarifying. |
| D5 | **Keep per-call popup confirmation** — must be rerouted properly (this is the v1 BLOCKER). | User clarifying. |
| D6 | E2E test in `tests/e2e/network/` + playground button reinstated. | User clarifying. |
| D7 (NEW) | **Resolve token name + symbol + decimals BEFORE Allow/Deny** — popup pre-fetches via PXE. | User clarifying #2. |
| D8 (NEW) | **Reframe as "profile + chain"** (not per-account). Keep account arg in the API for journal/audit. | Codex B2. |
| D9 (NEW) | `simulate_views` op-kind deprecation → **separate follow-up plan**. | User clarifying #4. |

## 4. Component-level architecture (revised)

```
┌─────────────────────────────────────────────────────────────────┐
│ Faucet (Vue + Vite SPA, packages/faucet)                        │
│                                                                  │
│  TokenCard.vue                                                   │
│    └── NEW "Add to wallet" button (USDC + ETH)                   │
│        └─→ useFaucetAddToken composable                          │
│             └── calls wallet.registerToken(account, tokenAddr)   │
│                  via Wallet & { registerToken }                  │
│                  cast (typed boundary)                           │
│                                                                  │
│  src/lib/nulo-schema-patch.ts (side-effect, idempotent guard)   │
└────────────────────────┬────────────────────────────────────────┘
                         │  encrypted channel
                         ▼
┌─────────────────────────────────────────────────────────────────┐
│ Extension (packages/extension)                                   │
│                                                                  │
│  wallet-sdk/nulo-schema-patch.ts                                 │
│    (side-effect; imported in background.ts and any popup that    │
│     uses ExtensionWallet directly — SDK proxy parity)            │
│                                                                  │
│  WalletSdkDispatcher.dispatch("registerToken", ...)              │
│    └── NEW: route through DappInteractionService.execute()       │
│         like handleSendTx — NOT straight to ExecutionService     │
│                                                                  │
│  DappInteractionService.execute()                                │
│    └── isConfirmationNeeded → ALWAYS true for register_token     │
│        (new explicit case alongside the existing sendTx case)    │
│                                                                  │
│  popup windows/execute/index.vue                                 │
│    └── On payload load, IF any op.kind === "register_token":     │
│        fetch parseTokenInterface for each, render name+symbol    │
│        +decimals+address in OperationCard while user decides     │
│                                                                  │
│  popup windows/execute/OperationCard.vue                         │
│    └── register_token template renders:                          │
│        "<symbol> · <name> · <decimals> decimals"                 │
│        "Contract address: 0x..."                                 │
│        "Requested by <host-only origin>"                         │
│                                                                  │
│  ExecutionService.executeRegisterToken                            │
│    └── Unchanged. Calls parseTokenInterface + tokenService.       │
│        addToken({origin: "dapp", dappOrigin: <host>}).             │
│        Idempotent on (profileId, chainId, contract).             │
└─────────────────────────────────────────────────────────────────┘
```

## 5. File-by-file changes (v2)

The numbering below follows the implementation order I'll execute in.

### 5.1 NEW — `packages/extension/src/wallet/services/wallet-sdk/nulo-schema-patch.ts`

```ts
/**
 * Runtime extension of @aztec/wallet-sdk's WalletSchema with the Nulo-custom
 * `registerToken` method. Mirrored verbatim by:
 *   - packages/faucet/src/lib/nulo-schema-patch.ts
 *   - packages/playground/src/lib/nulo-schema-patch.ts
 *
 * Why inline copies instead of a shared @nulo/wallet-bridge export: wallet-bridge
 * is extension-internal (depends on wallet-core + extension-messaging). Exposing
 * it as a dApp dependency would acquire third-party consumers we don't want yet.
 * The drift surface is one Zod entry; pinned by dispatcher.test.ts.
 *
 * Why side-effect only: WalletSchema is read by @aztec/wallet-sdk's Proxy
 * (ExtensionWallet.create) when the dApp calls wallet.<method>. Mutating it
 * before any such call makes the new method routable.
 *
 * The signature guard verifies the patch hasn't gone stale against upstream:
 * if upstream ever ships a `registerToken` with a different shape, we throw at
 * SW init instead of silently no-op'ing.
 */

import { WalletSchema } from "@aztec/aztec.js/wallet"
import { AztecAddressSchema } from "@aztec/aztec.js/addresses"
import { z } from "zod"

const PATCHED_SCHEMA = z
  .function()
  .args(AztecAddressSchema, AztecAddressSchema)
  .returns(z.void())

if ("registerToken" in WalletSchema) {
  // Already patched (idempotent re-import) OR upstream introduced its own.
  // If upstream introduced its own, the signature MUST match.
  // biome-ignore lint/suspicious/noExplicitAny: WalletSchema entries are zod-typed but the upstream type is internal
  const existing = (WalletSchema as any).registerToken
  if (existing !== PATCHED_SCHEMA) {
    const existingParamCount = existing?.parameters?.()?.items?.length
    if (existingParamCount !== 2) {
      throw new Error(
        `Nulo schema-patch: upstream WalletSchema.registerToken shape changed ` +
          `(expected 2 params, found ${existingParamCount}). Update the patch ` +
          `or remove it if upstream now provides registerToken.`,
      )
    }
    // Upstream shape matches; leave as-is.
  }
} else {
  // biome-ignore lint/suspicious/noExplicitAny: see above
  ;(WalletSchema as any).registerToken = PATCHED_SCHEMA
}
```

- Idempotent on re-import (no-ops if already present).
- Loud failure on signature drift (Codex H4).
- Single `biome-ignore` with rationale (passes the `noExplicitAny`-as-error lint).

### 5.2 NEW — `packages/faucet/src/lib/nulo-schema-patch.ts`

Verbatim copy of 5.1 (imports + body identical). Documented as a deliberate copy with a cross-reference to the extension's file.

### 5.3 NEW — `packages/playground/src/lib/nulo-schema-patch.ts`

Verbatim copy of 5.1. Lives next to `lib/wallet.ts` per Codex M1 — that file's first import becomes `import "./nulo-schema-patch"`.

### 5.4 MODIFIED — `packages/extension/src/wallet/services/wallet-sdk/background.ts`

Add `import "./nulo-schema-patch"` as the **first import** (before all `@aztec/wallet-sdk` imports), so the patch lands before `BackgroundConnectionHandler` is constructed. The patch is technically unnecessary for *routing* (BackgroundConnectionHandler doesn't validate against `WalletSchema`) but is needed for SDK proxy parity if any popup constructs an ExtensionWallet directly.

### 5.5 MODIFIED — `packages/wallet-bridge/src/dispatcher.ts` — **B1 FIX**

Add `registerToken` to the special-case list alongside `sendTx`. New routing in `dispatch()`:

```ts
// Around line 240, before the METHOD_TO_KIND lookup:
if (methodName === "registerToken") {
  return this.handleRegisterToken(args, ctx)
}
```

And a new method modeled on `handleSendTx` (lines 349-392):

```ts
private async handleRegisterToken(args: unknown[], ctx: SessionContext): Promise<unknown> {
  const [network, account] = await this.resolveNetworkAndAccount(ctx)
  const dappSession = await this.dappSessionService.tryGetDappSessionByOriginAndChain(
    ctx.origin,
    String(ctx.chainId),
  )
  if (!dappSession) {
    throw new Error(`No dApp session found for origin ${ctx.origin}`)
  }

  // args[0] is the dApp-supplied account; we pass it through to the op for
  // journal/UI consistency but the dispatcher's resolved session account
  // wins for storage scoping (which is profile+chain anyway).
  const tokenAddress = String(args[1])

  const op: RegisterTokenOperation = {
    kind: "register_token",
    networkId: network.id,
    accountAddress: account.address, // session-authorized; matches existing behavior
    address: tokenAddress,
  }

  const results = await this.dappInteractionService.execute({
    sessionId: dappSession.id,
    operations: [op],
  })
  return this.unwrapResult(results[0])
}
```

ALSO: drop the `case "register_token":` branch from `buildAccountOperation` and remove `"register_token"` from `ACCOUNT_KINDS` — `register_token` is now special-cased like `sendTx`.

Also (D2 deprecation sweep): drop `getCompleteAddress`, `simulateViews` from `METHOD_TO_KIND`; drop `get_complete_address`, `simulate_views` from `ACCOUNT_KINDS`; drop their `buildAccountOperation` switch cases.

### 5.6 MODIFIED — `packages/extension/src/wallet/services/dapp-interaction/service.ts` — **B1 FIX**

In `isConfirmationNeeded` (lines 345-364), add an explicit case:

```ts
// Token registration is always per-call confirmable — neither AccessLevel nor
// fee-presence drive it. The popup carries the resolved token metadata.
if (payload.params.operations.find((op) => op.kind === "register_token")) {
  return true
}
```

In `validateSession` (line 270): keep `case "register_token":` in the account-permission switch (already there). Drop `case "get_complete_address":` from the account-permission switch.

In `getOperationAccessLevel` (line 376): keep `register_token → AppState` (for telemetry; the popup gate is no longer driven by this but by the explicit check above). Drop `case "get_complete_address":`.

**Per Codex M1 / Opus M1+M2**: leave the `simulate_views` branches in `validateSession`, `getOperationAccessLevel`, `materialize.ts`, and `OperationCard.vue` untouched. The op kind is alive for legacy dApp-interaction path consumers AND for internal callers.

### 5.7 MODIFIED — `packages/extension/src/popup/windows/execute/index.vue` — **D7 NEW**

When the payload loads, if any op kind is `register_token`, kick off a metadata pre-fetch via the existing `tokenService` client. The OperationCard renders a loading state while pre-fetch is in-flight, then renders the resolved name/symbol/decimals/address. Approve gates on pre-fetch completion (Allow disabled until metadata resolves).

Pseudocode:

```ts
// In setup():
const tokenMetadata = ref<Map<string, { name: string; symbol: string; decimals: number }>>(new Map())
const metadataLoading = ref(true)

onMounted(async () => {
  const payload = await useDappInteractionPayload(requestId).load()
  const registerOps = payload.operations.filter((op) => op.kind === "register_token")
  if (registerOps.length > 0) {
    const tokenServiceClient = new TokenServiceClient()
    for (const op of registerOps) {
      try {
        const ti = await tokenServiceClient.parseTokenInterface(op.networkId, op.address)
        if (ti.name && ti.symbol && ti.decimals !== undefined) {
          tokenMetadata.value.set(op.address, {
            name: ti.name,
            symbol: ti.symbol,
            decimals: ti.decimals,
          })
        }
      } catch {
        // Leave the map entry blank; OperationCard falls back to address-only.
      }
    }
    metadataLoading.value = false
  } else {
    metadataLoading.value = false
  }
})
```

Drop the `case "get_complete_address":` and `case "simulate_views":` branches (lines 159, 163) — `get_complete_address` is fully dropped; `simulate_views` stays in the operations-list typing but the popup never receives an internal-only op kind from the dApp wire (and the legacy dapp-interaction path doesn't open this popup).

### 5.8 MODIFIED — `packages/extension/src/popup/windows/execute/OperationCard.vue` — **D7 NEW**

Extend the `register_token` template (line 193) to render the resolved metadata when available:

```vue
<template v-else-if="op.kind === 'register_token'">
  <template v-if="tokenMetadata?.get(op.address)">
    <Flex :class="$style.prop">
      <Text size="14" weight="600" color="primary" data-testid="register-token-symbol">
        {{ tokenMetadata.get(op.address)!.symbol }}
      </Text>
      <Text size="12" color="secondary" data-testid="register-token-name">
        {{ tokenMetadata.get(op.address)!.name }}
      </Text>
      <Text size="11" color="tertiary">
        {{ tokenMetadata.get(op.address)!.decimals }} decimals
      </Text>
    </Flex>
  </template>
  <Flex :class="$style.prop">
    <Text size="12" color="secondary">Contract address:</Text>
    <AddressDisplay :address="op.address" />
  </Flex>
  <Flex :class="$style.prop" v-if="dappOriginHost">
    <Text size="11" color="tertiary">
      Requested by <Text weight="600" data-testid="register-token-origin">{{ dappOriginHost }}</Text>
    </Text>
  </Flex>
</template>
```

Where `dappOriginHost` is the host portion of the dApp's `payload.session.dappMetadata.url` — host-only rendering per Opus H3 (no path, no scheme, no port). The host is rendered with `<Text weight="600">` so it visually distinguishes from the surrounding sentence, mitigating the "origin looks like a token name" attack.

**Keep** the `simulate_views` template (line 234) per Opus M2 — it's reachable via the legacy dapp-interaction path.

### 5.9 NEW — `packages/faucet/src/composables/useFaucetAddToken.ts`

```ts
import type { Wallet } from "@aztec/aztec.js/wallet"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { ref } from "vue"
import { type NormalizedError, normalizeError } from "@/lib/errors"

type WalletWithRegisterToken = Wallet & {
  registerToken(account: AztecAddress, token: AztecAddress): Promise<void>
}

export type AddTokenStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "ok" }
  | { kind: "rejected" }
  | { kind: "unsupported" }
  | { kind: "error"; error: NormalizedError }

export function useFaucetAddToken() {
  const status = ref<AddTokenStatus>({ kind: "idle" })

  async function addToken(
    wallet: Wallet,
    accountAddress: string,
    tokenAddress: AztecAddress,
  ): Promise<void> {
    if (status.value.kind === "submitting") return
    status.value = { kind: "submitting" }
    try {
      const w = wallet as WalletWithRegisterToken
      await w.registerToken(AztecAddress.fromString(accountAddress), tokenAddress)
      status.value = { kind: "ok" }
    } catch (err) {
      const normalized = normalizeError(err)
      // normalizeError(...) already parses the wallet-bridge cancel envelope and
      // sets category to "user-rejected" for 4001 (errors.ts:54-60).
      if (normalized.category === "user-rejected") {
        status.value = { kind: "rejected" }
      } else if (normalized.message.includes("Unsupported wallet method")) {
        // The dispatcher rejected the method by string. This means the schema
        // patch on either end wasn't applied at the right time, or the wallet
        // version doesn't have the dispatcher mapping. Surface distinctly so
        // the user gets a clear "your wallet doesn't support this yet" message.
        status.value = { kind: "unsupported" }
      } else {
        status.value = { kind: "error", error: normalized }
      }
    }
  }

  function reset() {
    status.value = { kind: "idle" }
  }

  return { status, addToken, reset }
}
```

Notes:
- Uses `normalized.category === "user-rejected"` (the actual `NormalizedError` shape per `errors.ts:21-25`), NOT the invented `normalized.code === 4001` (Codex H1).
- Adds `"unsupported"` variant for the schema-mismatch case (Opus H5).
- `rejected` is a terminal state of this call; the consumer (`TokenCard.vue`) is responsible for resetting via `reset()` after a delay (e.g. 3s timeout) or on next user interaction — design choice matches the existing toast UX for drip results.

### 5.10 MODIFIED — `packages/faucet/src/components/TokenCard.vue`

Add the "Add to wallet" button to the existing `.actions` flex row. Visible only when `walletConnection.status.value === "connected"`. Status reflected in the existing status row via a new conditional branch.

```vue
<!-- inside .actions, after the drip buttons -->
<button
  v-if="walletConnection.status === 'connected'"
  type="button"
  :disabled="addTokenStatus.kind === 'submitting'"
  :data-testid="`faucet-add-token-${token.symbol}`"
  @click="onAddToWallet"
>
  {{ addTokenStatus.kind === 'submitting' ? 'Adding…' : 'Add to wallet' }}
</button>
```

In `<script setup>`:

```ts
const { status: addTokenStatus, addToken, reset: resetAddToken } = useFaucetAddToken()

async function onAddToWallet() {
  if (!wallet.value || !selectedAccount.value) return
  await addToken(wallet.value, selectedAccount.value, props.tokenAddress)
}

// Auto-reset after success or rejection so the button label returns to
// "Add to wallet" rather than freezing at a terminal state.
watch(addTokenStatus, (s) => {
  if (s.kind === "ok" || s.kind === "rejected" || s.kind === "unsupported" || s.kind === "error") {
    setTimeout(resetAddToken, 3000)
  }
})
```

Status row gets new conditional branches: `ok` → small "Added to wallet ✓", `rejected` → no UI (per cancel recipe), `unsupported` → "Update your wallet to use this feature", `error` → red error text.

### 5.11 MODIFIED — `packages/faucet/src/composables/useWalletConnection.ts`

Add `import "@/lib/nulo-schema-patch"` as the FIRST import. Nothing else changes.

### 5.12 MODIFIED — `packages/playground/src/lib/wallet.ts`

Add `import "./nulo-schema-patch"` as the FIRST import. Nothing else changes (the existing `connect()` flow is unchanged).

### 5.13 MODIFIED — `packages/playground/src/sections/contracts.ts`

Drop the leading "registerToken was dropped" comment. Add a `registerToken` button using a typed cast (per Opus H1):

```ts
type WalletWithRegisterToken = Wallet & {
  registerToken(account: AztecAddress, token: AztecAddress): Promise<void>
}

root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-registerToken"]')?.addEventListener(
  "click",
  safe("registerToken", async () => {
    const wallet = getWallet()! as WalletWithRegisterToken
    const account = AztecAddress.fromString(getInput("accountAddress") || getInput("senderAddress"))
    const token = AztecAddress.fromString(getInput("tokenAddress"))
    return wallet.registerToken(account, token)
  }),
)
```

HTML: add `<button data-testid="pg-btn-registerToken">registerToken</button>` to the existing `.pg-row` of contract buttons. If `accountAddress` input doesn't exist on this section, add it.

### 5.14 MODIFIED — `packages/playground/src/sections/meta.ts`, `simulation.ts`

Drop the leading "Nulo-custom was dropped" comments. The deprecation is now documented in `wallet-bridge/README.md`.

### 5.15 MODIFIED — `packages/wallet-bridge/src/capability-map.ts`

Drop `getCompleteAddress: "accounts"` (line 19), `simulateViews: "simulation"` (line 34). Keep `registerToken: "accounts"` (line 21).

### 5.16 MODIFIED — `packages/wallet-bridge/src/scope-enforcement.ts`

Drop `simulateViews` from `SCOPE_CHECKERS` (line 299). Drop `checkSimulateViews` function (lines 153-171). Keep all other entries.

### 5.17 MODIFIED — `packages/wallet-bridge/src/operation.ts`

Drop `GetCompleteAddressOperation` type (no internal callers per recon). **Keep** `SimulateViewsOperation` — internal callers verified at `balance-projector.ts:121-127` and `execution/service.ts:1509-1521, 1537-1549`. Add a comment on `SimulateViewsOperation` noting its internal-only status per D9.

### 5.18 MODIFIED — `packages/wallet-bridge/src/dapp-interaction-protocol.ts`

Drop `GetCompleteAddressRequest` (lines 42-72) from the request union and exports. **Keep** `SimulateViewsRequest` (lines 124-146) per D9.

### 5.19 MODIFIED — `packages/extension/src/wallet/services/dapp-interaction/spec.ts` and `packages/extension/src/wallet/services/execution/models/index.ts`

Drop `GetCompleteAddressRequest` re-exports. Keep `SimulateViewsRequest` re-exports.

### 5.20 MODIFIED — `packages/extension/src/wallet/services/dapp-interaction/materialize.ts`

Drop `case "get_complete_address":` branch (line 90). Keep `case "simulate_views":` (line 94).

### 5.21 MODIFIED — `packages/extension/src/wallet/services/execution/service.ts`

Drop `case "get_complete_address":` (line 883) and `executeGetCompleteAddress` (lines 986-994). Keep `case "simulate_views":` (line 911) and `executeSimulateViews`.

### 5.22 MODIFIED — `packages/faucet/vite.config.ts` — **H2 FIX**

Allow per-worktree port allocation when running under the e2e harness:

```ts
const FAUCET_DEV_PORT = Number(process.env.FAUCET_DEV_PORT) || 5176

server: {
  port: FAUCET_DEV_PORT,
  // strictPort only in local DX; harness allocates and overrides via env.
  strictPort: !process.env.FAUCET_DEV_PORT,
  headers: COOP_COEP_HEADERS,
},
```

### 5.23 MODIFIED — `packages/extension/tests/e2e/global-setup.ts` and `fixtures/`

Add a faucet dev-server spawner mirroring the existing playground spawn (file:lines TBD — read on implementation). Expose `faucetUrl` in the test fixtures alongside `playgroundUrl`. Use the agent runner's port allocator to pick `FAUCET_DEV_PORT` per worktree.

### 5.24 NEW — `packages/extension/tests/e2e/network/faucet-add-token.test.ts` — **H2 FIX (correct path)**

Network suite (`vitest.e2e.network.config.ts` glob: `tests/e2e/network/**/*.test.ts`). Parallel-safe per the agent runner conventions. Scenario:

1. Boot anvil + aztec + faucet (new) — handled by global-setup.
2. Launch extension + onboard a fresh wallet via existing helpers.
3. Open faucet via the new `faucetUrl` fixture.
4. Connect via the existing discovery → emoji → capabilities sequence.
5. Click `data-testid="faucet-add-token-USDC"`.
6. Switch to the extension popup window opened by `DappInteractionService.execute()`.
7. Wait for `data-testid="register-token-symbol"` to render (metadata pre-fetch complete).
8. Assert it shows "USDC", the name, "6 decimals", contract address, and "Requested by <host>".
9. Click `data-testid="execute-approve"`.
10. Switch back to faucet, assert status row shows ✓.
11. Open wallet popup → tokens view → assert USDC row visible with correct balance (or 0 if no drip yet).
12. Repeat for ETH.
13. Cancel path: same flow but click Deny → assert faucet status row returns to idle (no error UI).

### 5.25 NEW — Tests in `packages/wallet-bridge/src/dispatcher.test.ts`

- **NEW**: Import `packages/extension/src/wallet/services/wallet-sdk/nulo-schema-patch` as a side-effect (workspace import). Assert `WalletSchema.registerToken.parameters().items.length === 2` AND both items pass `AztecAddressSchema.safeParse(<a valid address>).success === true`. This is the *real* reachability test — drift in the extension's patch breaks here.
- **NEW**: `dispatches registerToken via DappInteractionService.execute` (not via executeOperations directly). Mock the injected `dappInteractionService`; assert `execute()` was called with one `register_token` op; assert `executionService.executeOperations` was NOT called by the dispatcher.
- **NEW**: `enforces accounts capability before registerToken`. Asserts `CapabilityNotGrantedError` when accounts cap absent.
- **NEW**: `does not dispatch getCompleteAddress` — asserts `dispatch("getCompleteAddress", ...)` throws "Unsupported wallet method".
- **NEW**: `does not dispatch simulateViews` — same.
- **NEW**: `getRequiredCapability("registerToken") === "accounts"` AND `getOperationAccessLevel("register_token") === AccessLevel.AppState` (Opus M7 — pin both).
- **NEW**: `batch([{name: "registerToken", ...}])` rejects (Opus B3) — `BatchedMethodSchema` is built from `WalletMethodSchemas`, not `WalletSchema`, so the patched method is NOT in `batch`. Pin this so future "batch all the things" attempts fail loudly.

### 5.26 NEW — Tests in `packages/wallet-bridge/src/scope-enforcement.test.ts`

Drop the `simulateViews` test cases (lines 212-224). Add a one-liner: `enforceScope("simulateViews", ...)` is a no-op (no checker). Same for `getCompleteAddress`.

### 5.27 NEW — Tests in `packages/extension/src/popup/windows/execute/humanize.test.ts`

Drop the `get_complete_address` test entries (lines 28-36 per Codex H3). Keep any `simulate_views` entries (the op kind is alive).

### 5.28 NEW — `packages/faucet/src/composables/useFaucetAddToken.test.ts`

```
- happy path → status becomes ok
- user-rejected (NormalizedError with category="user-rejected") → status becomes rejected
- unsupported method ("Unsupported wallet method" substring) → status becomes unsupported
- network/other error → status becomes error
- re-entrancy guard during submitting → second call is ignored
```

### 5.29 NEW — `packages/faucet/src/components/TokenCard.test.ts` updates

Extend existing TokenCard tests: button visibility under each `walletConnection.status`, button click invokes the composable, status-row branches render for `ok` / `error` / `unsupported`, `rejected` produces no status-row UI.

### 5.30 MODIFIED — `packages/wallet-bridge/README.md`

Add a new section after "Versioning" titled "Custom RPC methods (Nulo extensions)". Documents:
- The `registerToken` method, its signature, capability gate, popup gate.
- The inline-copy schema-patch pattern across three packages.
- The `simulate_views` deprecation status (internal-only).
- The dropped `getCompleteAddress` method.
- Cross-reference to `dispatcher.test.ts` as the drift pin.

### 5.31 MODIFIED — `CLAUDE.md`

Add a bullet under "Package boundaries" or "Quality gates":

> **Custom RPC schema patch (`registerToken`)**: Added to `WalletSchema` at runtime via three identical inline files (`packages/extension/src/wallet/services/wallet-sdk/nulo-schema-patch.ts`, `packages/faucet/src/lib/nulo-schema-patch.ts`, `packages/playground/src/lib/nulo-schema-patch.ts`). Each is a side-effect-only file. Drift is pinned by `packages/wallet-bridge/src/dispatcher.test.ts` (reachability test imports the real extension copy). When adding a new Nulo-custom RPC, update all three copies and pin the new shape in the dispatcher test.

### 5.32 MODIFIED — `packages/playground/README.md`

Drop the `simulateViews` / `getCompleteAddress` references (line 55 per Codex H3).

### 5.33 OPTIONAL — `packages/faucet/package.json`, `packages/playground/package.json`

Per Codex M2: declare `zod` as a direct dep if either package imports it. Currently transitive via `@aztec/aztec.js`. The schema-patch files import `zod` directly — adding it as a direct dep avoids transitive-removal breakage. Check version pin matches the extension's pin.

## 6. Deprecation summary (revised)

| Method | dApp wire surface | Op kind | Internal callers |
|---|---|---|---|
| `registerToken` | **Restored** (inline patch ×3, schema mutation) | `register_token` — keep | none (dApp-driven) |
| `getCompleteAddress` | **Dropped** | `get_complete_address` — **dropped entirely** | none |
| `simulateViews` | **Dropped** | `simulate_views` — **kept** | `balance-projector.ts:121-127`, `execution/service.ts:1509, 1537` |

## 7. Security & Adversarial Considerations (revised)

Drawn from both audits + Opus + Codex consensus.

### 7.1 Threat model

| Actor | Goal | Surface | Mitigation in this PR |
|---|---|---|---|
| Malicious dApp post-connect | Add a phishing token that looks like real USDC | `registerToken` RPC after `accounts` cap is granted | Popup with **resolved name + symbol + contract address + decimals + host-only origin** before Allow (D7). Per-call confirmation (D5 + B1 fix). |
| Malicious dApp post-connect | Token-list pollution / DoS | Repeated `registerToken` calls | Per-call popup; user can reject. **NEW**: short-circuit duplicate adds before journal write (Opus H2 fix in `executeRegisterToken`, see §5.34 below). |
| Compromised upstream `@aztec/wallet-sdk` | Bypass schema check or rewrite handler | Encrypted-channel layer | Out of scope (upstream concern). Mitigation: 7-day npm min-age via `bunfig.toml`, exact-pinned `@aztec/wallet-sdk == 4.2.0`. |
| Origin string spoofing in popup | Render an attacker-controlled string that looks like a token name | OperationCard "Requested by" rendering | **Host-only render**, separate visual treatment (D7 in §5.8). |

### 7.2 Defences

- **Popup gate works** (post-B1 fix in §5.5+§5.6): `register_token` always routes through `DappInteractionService.execute()` with explicit `isConfirmationNeeded` true.
- **Capability gate**: `registerToken` requires the `accounts` capability — dApp must already be permissioned.
- **Origin host-only rendering**: prevents "Requested by https://usdc.faucet-evil.com" from looking like the token name.
- **Resolved metadata before Allow**: user sees the actual on-chain name/symbol/decimals, not just an address.
- **Strict argument validation**: schema-patch Zod entry validates both args are addresses; signature drift throws at SW init.
- **Idempotency** with early short-circuit (see §5.34): repeat-add of same contract returns silently without PXE traffic or journal writes.

### 7.3 Risks accepted in this PR

- **Token name/symbol forgery**: a malicious contract can return `"USDC"` for its name. The popup shows the contract address ALONGSIDE the name/symbol — the user is responsible for cross-checking. Follow-up: `register-token-name-collision-detection` plan (see §10).
- **`TokenImportRow` disappears post-success** (Codex H5): the "Requested by" trail isn't durable. The journal entry persists internally but isn't surfaced in the tokens view after success. Follow-up: `token-import-history-persistence`.

### 7.4 §5.34 NEW — DoS short-circuit in `executeRegisterToken` (Opus H2)

Add an early-return in `tokenService.addToken` (or in `executeRegisterToken` before calling it): if `findToken(profileId, chainId, contract)` already returns a token, return immediately — NO journal entry write, NO PXE re-fetch.

```ts
// In tokenService.addToken, at the very top:
const existing = this.findToken(profileId, chainId, tokenInterface.contract)
if (existing) {
  this.logDebug(`addToken: ${tokenInterface.contract} already registered, skipping`)
  return existing
}
// Only THEN start the journal entry / parse / write.
```

This makes the function safely re-entrant under spam loads. Without this, a malicious dApp can force unbounded PXE traffic by passing junk addresses (each "new" address triggers `parseTokenInterface`).

For junk addresses (i.e. unique address-per-call), the dedupe doesn't help — the popup is the only gate. The user can simply Deny. Filed as an additional follow-up: `register-token-rate-limit` if real-world abuse appears.

### 7.5 Supply chain

- **No new external deps.** `zod` is transitive via `@aztec/aztec.js`; promoting it to a direct dep in faucet/playground (§5.33) doesn't bypass the 7-day age gate (`bunfig.toml` `minimumReleaseAge`).
- `bun audit` continues to run in CI; no new advisories expected.

## 8. Tests (revised)

Already covered in §5.25–§5.29 + §5.24. Summary:
- **Unit/component**: dispatcher contract tests (capability + accessLevel + reachability via real patch import), composable behavior, TokenCard rendering, drift pin via real-patch import.
- **E2E**: one parallel-safe network spec in `tests/e2e/network/` covering happy + cancel paths for both tokens.
- **Smoke**: not applicable (no smoke regression expected).
- **Manual**: alpha-testnet end-to-end on the deployed faucet.

## 9. Acceptance criteria

- [ ] `bun run audit:vue` passes.
- [ ] `bun run e2e:agent` passes including the new `tests/e2e/network/faucet-add-token.test.ts`.
- [ ] Parallel-safe: two `e2e:agent` worktree agents can run `faucet-add-token` concurrently without port collisions.
- [ ] On alpha-testnet, "Add to wallet" results in both USDC and ETH appearing in the wallet popup's token list within ~3s.
- [ ] Popup shows resolved name + symbol + decimals + address + host-only origin BEFORE Allow/Deny.
- [ ] Cancel returns the faucet status row to idle within ~3s (no error UI).
- [ ] Playground `registerToken` button works.
- [ ] Calling `wallet.getCompleteAddress` or `wallet.simulateViews` throws "Unsupported wallet method".
- [ ] `wallet.batch([{name: "registerToken", ...}])` rejects with a Zod validation error.
- [ ] Dispatcher contract test pins capability + accessLevel + reachability.

## 10. Open questions / follow-ups (filed)

- `deprecate-simulate-views`: refactor balance-projector + gas-balance to use `aztec_simulateTx` + `aztec_executeUtility`; drop `simulate_views` op kind.
- `register-token-name-collision-detection`: detect "wait, you have a USDC at a different address already" + warn the user.
- `token-import-history-persistence`: keep "Requested by <origin>" visible in tokens view post-success.
- `register-token-rate-limit`: per-origin rate limit on `registerToken` calls if real-world abuse emerges.

## 11. ASCII status (live)

```
[✓] 0. Clarifying questions
[✓] 1. Draft main plan + ELI5
[✓] 2. Dual audit (codex + opus)
[—] 3. Final codex review (SKIPPED per user direction)
[—] 4. Approval gate (SKIPPED per user direction)
[▶] 5. Implementation
[ ] 6. Post-impl codex review
[ ] 7. Fix loop
```
