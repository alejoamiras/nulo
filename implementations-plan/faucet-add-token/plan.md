# Faucet "Add USDC / ETH to Wallet" — one-click token registration via wallet-sdk

## 1. Summary

Add a one-click button on the faucet's `TokenCard` (both USDC and ETH) that, once the user is connected, calls a Nulo-custom `registerToken` RPC over the existing `@aztec/wallet-sdk` encrypted channel. The extension shows a confirmation popup, then adds the token to the user's wallet popup token list (per-account, per-chain), so the user immediately sees the dripped balance without manually pasting the contract address.

The wallet-bridge already has a `register_token` operation wired end-to-end (dispatcher → execution service → token service → popup confirmation card). The only thing missing is the dApp-side surface: the canonical `@aztec/wallet-sdk` `Wallet` proxy refuses unknown methods, so we have to re-introduce a minimal runtime extension of `WalletSchema` on **both** sides (faucet + extension). This was previously done via a single `schema_patch.ts` that was dropped in the "canonical refactor" — the current `register_token` plumbing in the dispatcher is dead code today.

This PR resurrects only the `registerToken` surface, and **removes** the still-dead `getCompleteAddress` and `simulateViews` *dApp-facing* surfaces while keeping their internal operation uses (the balance projector still emits internal `simulate_views` operations — those stay).

## 2. State of the world (recon)

| Layer | File | Status |
|---|---|---|
| dApp Wallet proxy (`@aztec/wallet-sdk`) | upstream | `Proxy` validates each method against `WalletSchema` — unknown method names fall through and error |
| Extension `BackgroundConnectionHandler` | upstream | Also validates `message.type` against `WalletSchema` and rejects unknown types |
| `WalletSchema` mutability | upstream (`yarn-project/aztec.js/src/wallet/wallet.ts`) | Plain object, not frozen — third parties can extend at runtime with Zod `args(...).returns(...)` entries |
| Dispatcher `registerToken` mapping | `packages/wallet-bridge/src/dispatcher.ts:165, 193, 723-767` | Wired. Requires the schema patch to be reachable. |
| Capability gate (`registerToken` → `accounts`) | `packages/wallet-bridge/src/capability-map.ts:21` | Wired. `accounts` already mentions "register tokens" in the popup copy (`extension/src/wallet/services/dapp-session/capability-meta.ts:38`). |
| Confirmation popup card for `register_token` | `packages/extension/src/popup/windows/execute/OperationCard.vue:193`, `windows/execute/index.vue:160` | Wired. AccessLevel = `AppState` (popup shown per call). |
| Extension handler `executeRegisterToken` | `packages/extension/src/wallet/services/execution/service.ts:895, 1038-1059` | Wired. Parses token interface via PXE, calls `tokenService.addToken` with `opContext.origin: "dapp"` + `dappOrigin: <faucet origin>`. Idempotent — silently skips if the token is already registered. |
| Faucet wallet integration | `packages/faucet/src/composables/useWalletConnection.ts:1-241`, `src/lib/capabilities.ts` | Full wallet-sdk flow already present. `accounts` capability is requested with `canGet: true, canCreateAuthWit: false`. No `registerToken` call site. |
| Playground caller | `packages/playground/src/sections/contracts.ts:3` | Comment: "registerToken (Nulo-custom) was dropped in the canonical refactor." No button. |

**Implication.** The `registerToken` machinery is intact on the extension side, but **the current code path is unreachable** because the `WalletSchema` validation rejects the method on both ends. Resurrecting it requires applying a small Zod schema patch on both ends *before* the wallet-sdk proxy or `BackgroundConnectionHandler` reads `WalletSchema`.

## 3. Architecture decisions (locked in)

| # | Decision | Rationale |
|---|---|---|
| D1 | **Inline schema patch in both** (faucet + extension), no shared `@nulo/wallet-bridge` export, no new published package | User preference. The patch is a single Zod entry — drift surface is minimal and easy to pin with a contract test. Avoids exposing wallet-bridge to dApp consumers (it currently imports `wallet-core` + `extension-messaging` — keeping its consumer surface to the extension is a clean boundary). |
| D2 | **Patch scope: only `registerToken`** | Smallest blast radius. `getCompleteAddress` and `simulateViews` *dApp-facing surfaces* are dead today and stay dead (deleted in this PR — see §6). Internal operation uses remain. |
| D3 | **Schema patch is applied via top-of-module side-effect imports** on each side. Extension: `import "./nulo-schema-patch"` at the top of `extension/src/wallet/services/wallet-sdk/background.ts`. Faucet: `import "@/lib/nulo-schema-patch"` at the top of `faucet/src/composables/useWalletConnection.ts`. | Deterministic. Module-load order guarantees the patch is applied before any `WalletManager.configure` / `BackgroundConnectionHandler` construction reads `WalletSchema`. No runtime branching, no lazy paths. |
| D4 | **Both USDC and ETH** get the button; **always visible** once connected; **per-token** click | Symmetric UX, matches the existing dual-token TokenCard layout. The extension's `tokenService.addToken` is idempotent (silently skips if the contract is already registered for this profile/chain). |
| D5 | **Keep the AccessLevel.AppState popup confirmation** in the extension | Defense against silent token-list pollution and phishing tokens. Matches MetaMask's `wallet_watchAsset` UX. Cost is one extra click per token add — acceptable. |
| D6 | **Add e2e network test** + **reinstate playground button** | Per-user-ask. E2E goes in the network suite (`e2e:agent`). Playground button reuses the patched schema. |

## 4. Component-level architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Faucet (packages/faucet, Vue + Vite SPA)                        │
│                                                                  │
│  TokenCard.vue                                                   │
│    ├── existing: drip_to_public / drip_to_private buttons        │
│    └── NEW: "Add USDC to Wallet" button                          │
│          └─→ useFaucetAddToken composable                        │
│                ├── reads wallet from useWalletConnection         │
│                ├── calls (wallet as WalletWithRegisterToken)     │
│                │       .registerToken(account, tokenAddress)     │
│                └── normalises errors, exposes status to UI       │
│                                                                  │
│  src/lib/nulo-schema-patch.ts          ← side-effect: extends    │
│    └── patches WalletSchema.registerToken once                   │
│        (imported once via useWalletConnection.ts top-of-file)    │
└─────────────────────────────────────────────────────────────────┘
                              │ wallet-sdk encrypted channel
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│ Extension (packages/extension)                                   │
│                                                                  │
│  wallet-sdk/nulo-schema-patch.ts       ← side-effect: extends    │
│    └── patches WalletSchema.registerToken once                   │
│        (imported once at the top of wallet-sdk/background.ts)    │
│                                                                  │
│  wallet-sdk/background.ts              ← unchanged behaviour     │
│    └── BackgroundConnectionHandler.initialize() now sees the     │
│        patched schema, accepts incoming "registerToken" type     │
│                                                                  │
│  wallet-bridge dispatcher              ← already wired           │
│    └── METHOD_TO_KIND["registerToken"] = "register_token"        │
│        capability gate: "accounts"                               │
│        → buildAccountOperation → ExecutionService                │
│                                                                  │
│  execution/service.ts::executeRegisterToken                      │
│    └── tokenService.parseTokenInterface(networkId, address)      │
│        + tokenService.addToken(profileId, networkId,             │
│           accountAddress, tokenInterface,                        │
│           { origin: "dapp", dappOrigin: <faucet url> })          │
│                                                                  │
│  popup windows/execute/                ← already wired           │
│    └── shows OperationCard for op.kind === "register_token"      │
│       (renders the token address row + Allow / Deny buttons)     │
└─────────────────────────────────────────────────────────────────┘
```

## 5. File-by-file changes

### 5.1 NEW — `packages/extension/src/wallet/services/wallet-sdk/nulo-schema-patch.ts`

```ts
/**
 * Runtime extension of the canonical `WalletSchema` for Nulo-custom RPC
 * methods. Mirrored by `packages/faucet/src/lib/nulo-schema-patch.ts`.
 *
 * Why a local copy on each side (instead of a shared @nulo/wallet-bridge
 * export): the drift surface is one Zod entry. A pinned contract test in
 * dispatcher.test.ts verifies the registered shape; if the two copies
 * diverge, the e2e suite catches it before merge.
 *
 * Why side-effect only: WalletSchema is a plain object imported by both
 * `@aztec/wallet-sdk`'s ExtensionWallet proxy AND the
 * `BackgroundConnectionHandler`. Mutating it before either reads it makes
 * the new method appear in both directions of the encrypted channel.
 *
 * ⚠ Upstream contract: `WalletSchema` is currently not frozen. If a future
 * `@aztec/wallet-sdk` release freezes it, this throw fires at SW init
 * (loud failure beats silent regression). Pin the wallet-sdk version
 * (already exact-pinned in package.json) and re-evaluate on bump.
 */

import { WalletSchema } from "@aztec/aztec.js/wallet"
import { AztecAddressSchema } from "@aztec/aztec.js/addresses"
import { z } from "zod"

if (!("registerToken" in WalletSchema)) {
  Object.assign(WalletSchema, {
    // Signature mirrors the dispatcher's buildAccountOperation case:
    //   registerToken(account: AztecAddress, token: AztecAddress) → void
    registerToken: z
      .function()
      .args(AztecAddressSchema, AztecAddressSchema)
      .returns(z.void()),
  })
}
```

- Side-effect file. **No exports.** Importing it once patches the global schema.
- Uses `Object.assign` rather than a direct mutation to keep the patch idempotent (multi-import safe) and to fail loudly if `WalletSchema` is frozen in a future upstream.
- The `AztecAddressSchema` import is the same Zod address validator already used by the rest of `WalletSchema` entries — keeps validation behaviour identical to the canonical methods.

### 5.2 NEW — `packages/faucet/src/lib/nulo-schema-patch.ts`

Verbatim mirror of 5.1, with one change: it lives in the faucet package and uses the same `@aztec/aztec.js/wallet` + `@aztec/aztec.js/addresses` imports. Documented as a deliberate copy with a pointer to the extension's copy.

### 5.3 MODIFIED — `packages/extension/src/wallet/services/wallet-sdk/background.ts`

Add a single side-effect import as the FIRST import (above the wallet-sdk imports), so the patch is applied before `BackgroundConnectionHandler` is constructed. Existing imports/logic untouched.

```ts
// Patch WalletSchema before any wallet-sdk code reads it.
import "./nulo-schema-patch"

import { BackgroundConnectionHandler, ... } from "@aztec/wallet-sdk/extension/handlers"
// ... rest unchanged
```

### 5.4 NEW — `packages/faucet/src/composables/useFaucetAddToken.ts`

A small composable that wraps the `wallet.registerToken(account, tokenAddress)` call with the same status + error-normalisation conventions used by `useFaucetDrip`:

```ts
import type { Wallet } from "@aztec/aztec.js/wallet"
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { ref } from "vue"
import { type NormalizedError, normalizeError } from "@/lib/errors"

// Local typed augmentation matching the side-effect patch in
// src/lib/nulo-schema-patch.ts. The cast is the typed boundary — the
// patch makes it true at runtime, this declaration makes it true at
// compile time.
type WalletWithRegisterToken = Wallet & {
  registerToken(account: AztecAddress, token: AztecAddress): Promise<void>
}

export type AddTokenStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "ok" }
  | { kind: "rejected" }   // user denied in extension popup
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
      // EIP-1193 4001 = user-rejected (per wallet-bridge README cancel recipe).
      status.value = normalized.code === 4001
        ? { kind: "rejected" }
        : { kind: "error", error: normalized }
    }
  }

  function reset() {
    status.value = { kind: "idle" }
  }

  return { status, addToken, reset }
}
```

### 5.5 MODIFIED — `packages/faucet/src/components/TokenCard.vue`

Add an "Add to Wallet" button next to (or below) the drip buttons. The button:

- Is visible only when `walletConnection.status.value === "connected"`.
- Calls `addToken(wallet.value, selectedAccount.value, tokenAddress)` from the new composable.
- Surfaces status: `submitting` → spinner + disabled, `ok` → small ✓ confirmation in the status row, `rejected` → silent return to idle (matches the cancel recipe in wallet-bridge README), `error` → red text in the status row.
- Idempotency UX: button stays visible after `ok`; clicking again triggers another popup, and the extension silently skips on duplicate add. We could hide on `ok` but that's lossy — if the user removes the token from the wallet, they'd have to refresh the faucet to see the button. Keep visible.

Layout: piggyback on the existing `actions` flex row. New element `<button data-testid="faucet-add-token-{symbol}">Add to wallet</button>`. testid pattern matches the existing `data-testid="drip-public-{symbol}"` / `drip-private-{symbol}` convention.

### 5.6 MODIFIED — `packages/faucet/src/composables/useWalletConnection.ts`

One change: add `import "@/lib/nulo-schema-patch"` as the FIRST import, so the patch is in place before the module imports `@aztec/wallet-sdk/manager`. Nothing else changes.

### 5.7 MODIFIED — `packages/wallet-bridge/src/dispatcher.ts`

Drop the `getCompleteAddress` and `simulateViews` *dApp-facing* mappings:

- Remove `getCompleteAddress: "get_complete_address"` and `simulateViews: "simulate_views"` from `METHOD_TO_KIND` (lines 166-167).
- Remove `"get_complete_address"` and `"simulate_views"` from `ACCOUNT_KINDS` (lines 194-195).
- Remove the `case "get_complete_address"` and `case "simulate_views"` branches in `buildAccountOperation` (lines 768-780) and the `functionCallsToEncodedActions` helper if it becomes unused (verify; keep if shared).
- Update the JSDoc comment block on `buildAccountOperation` (lines 717-725) to drop the dropped methods.
- Update the file-header JSDoc on lines 6-9 to drop `registerToken` mentions if they reference the patched schema location (keep the `register_token` references — the OPERATION kind still flows for dApp-initiated calls).

The dispatcher remains the choke point; the internal `simulate_views` operation kind type still exists in `operation.ts` because the balance projector emits it (see §6).

### 5.8 MODIFIED — `packages/wallet-bridge/src/capability-map.ts`

Remove `getCompleteAddress: "accounts"` (line 19) and `simulateViews: "simulation"` (line 34) from `METHOD_CAPABILITY_MAP`. The `registerToken: "accounts"` entry (line 21) stays.

### 5.9 MODIFIED — `packages/wallet-bridge/src/scope-enforcement.ts`

Remove the `simulateViews` entry in the `SCOPE_CHECKERS` record (line 299) and the `checkSimulateViews` function + its error messages (lines 153-171). Keep all other entries — `simulateTx`, `executeUtility`, `profileTx`, `sendTx`, `createAuthWit`, `registerToken` (verify a `registerToken` scope check exists; if not, document why one is not needed — the capability gate alone is sufficient because there's no per-call sub-scope).

### 5.10 MODIFIED — `packages/wallet-bridge/src/operation.ts`

Remove the `GetCompleteAddressOperation` type definition (the `get_complete_address` kind has no internal callers per recon). **Keep** `SimulateViewsOperation` (kind `simulate_views`) — the balance projector at `extension/src/wallet/services/token-balance/balance-projector.ts:123` emits it internally, and `executeSimulateViews` in `execution/service.ts:911` still runs.

Add a comment on the `SimulateViewsOperation` kind explaining: "Internal-only operation. The dApp-facing `simulateViews` wallet-sdk method was retired; the `simulate_views` operation kind survives for internal callers (balance projector, etc.)."

### 5.11 MODIFIED — `packages/extension/src/wallet/services/dapp-interaction/service.ts`

In `validateSession` (lines 270, 291), drop the `case "get_complete_address":` and the `case "simulate_views":` branch IF the `simulate_views` operation is never received over the dApp wire path (it's internal — confirm before deleting). If it could still arrive via materialize replay or queued state, **keep** the branch.

In `getOperationAccessLevel` (lines 378, 388-389), do the same — drop `get_complete_address`. Keep `simulate_views` if internal callers ever surface it through this path; otherwise drop.

### 5.12 MODIFIED — `packages/extension/src/wallet/services/dapp-interaction/materialize.ts`

Lines 90, 94 — drop the dropped methods' materialization branches. **Verify first** that no internal callsite materializes `simulate_views` ops. If the balance projector calls `executeOperations` directly (it does — `execution/service.ts:1510, 1538`), the materialize path is not on its critical line and the branch can go.

### 5.13 MODIFIED — `packages/extension/src/wallet/services/execution/service.ts`

Remove the `case "get_complete_address":` branch (line 883) and its `executeGetCompleteAddress` helper (lines 986-994). **Keep** the `case "simulate_views":` branch (line 911) and its `executeSimulateViews` helper — the balance projector at lines 1510 and 1538 still creates these operations internally.

### 5.14 MODIFIED — `packages/extension/src/popup/windows/execute/index.vue`

Drop the `case "get_complete_address":` and `case "simulate_views":` branches at lines 159, 163. Both methods never showed a meaningful UI in the popup; the cases were placeholders.

### 5.15 MODIFIED — `packages/extension/src/popup/windows/execute/OperationCard.vue`

Drop the `simulate_views` template branch (line 234). The `get_complete_address` kind has no template branch (no popup payload needed).

### 5.16 MODIFIED — `packages/playground/src/sections/contracts.ts`

Remove the leading comment about `registerToken` being "dropped". Add a `registerToken` button next to `registerContract` / `registerSender`, using the same `safe` wrapper:

```ts
root.querySelector<HTMLButtonElement>('[data-testid="pg-btn-registerToken"]')?.addEventListener(
  "click",
  safe("registerToken", async () => {
    const wallet = getWallet()!
    const account = AztecAddress.fromString(getInput("accountAddress"))
    const token = AztecAddress.fromString(getInput("tokenAddress"))
    // biome-ignore lint/suspicious/noExplicitAny: schema-patched method
    return (wallet as any).registerToken(account, token)
  }),
)
```

Playground HTML gets a new `<button data-testid="pg-btn-registerToken">registerToken</button>` and an `accountAddress` input if not already present. **Caveat**: the playground must also import the schema patch — add `import "@/wallet-bridge-schema-patch"` (or however playground's existing init structures it) once at the top of `src/main.ts` (or the entry point). One inline copy lives in the playground too — same Zod entry. **Three** total copies, all pinned by the contract test in §7. (This is the cost of "inline copy" — accepted per D1.)

### 5.17 MODIFIED — `packages/playground/src/sections/meta.ts` + `packages/playground/src/sections/simulation.ts`

Drop the leading "dropped in the canonical refactor" comments — the deprecation is now durable and documented in the wallet-bridge README.

### 5.18 NEW — Documentation update in `packages/wallet-bridge/README.md`

Add a section "Custom RPC methods (Nulo extensions)":

> Nulo extends `@aztec/wallet-sdk`'s canonical `WalletSchema` with one custom method:
> - `registerToken(account: AztecAddress, token: AztecAddress): Promise<void>` — gated by the `accounts` capability; shown to the user in the AppState confirmation popup. Idempotent (silently skips if the token is already in the user's list).
>
> The schema extension is applied via a runtime patch on each side of the encrypted channel. The patch is **inline-copied** rather than shared:
> - Extension: `packages/extension/src/wallet/services/wallet-sdk/nulo-schema-patch.ts`
> - Faucet: `packages/faucet/src/lib/nulo-schema-patch.ts`
> - Playground: `packages/playground/src/<entry-point>/nulo-schema-patch.ts`
>
> Each copy is one Zod entry. Drift is pinned by the dispatcher contract test (`dispatcher.test.ts`). The shared-package alternative was deliberately rejected to keep `@nulo/wallet-bridge` from acquiring third-party dApp consumers.
>
> Previously dropped Nulo-custom methods (intentionally not re-instated): `getCompleteAddress`, `simulateViews`. The `simulate_views` *operation kind* is still emitted internally by the balance projector — only the dApp-facing wire surface was removed.

### 5.19 NEW — Top-level note in CLAUDE.md (project file)

Add a short bullet under "Quality gates" or "Package boundaries":

> **Custom RPC schema patch**: The `registerToken` method is added to `WalletSchema` at runtime via three identical inline files (extension, faucet, playground). Each file's only export is a side-effect. Drift is caught by `wallet-bridge/src/dispatcher.test.ts` which pins the patched schema shape. Do NOT extend the patch surface without updating all three copies AND adding a new contract test case.

## 6. Deprecation summary

| Method | dApp-facing wire surface (this PR) | Internal operation kind |
|---|---|---|
| `registerToken` | **Restored** (inline schema patch ×3) | `register_token` — keep |
| `getCompleteAddress` | **Dropped** (no schema patch; capability map / dispatcher / popup cases removed) | `get_complete_address` — **drop** (no internal callers) |
| `simulateViews` | **Dropped** (no schema patch; capability map / dispatcher / scope-enforcement entries removed) | `simulate_views` — **keep** (used by balance projector internally) |

## 7. Tests

### 7.1 Unit / component

- `packages/wallet-bridge/src/dispatcher.test.ts` — **NEW** test cases:
  - `dispatches registerToken to register_token operation with [accountAddress, tokenAddress]` — exercises `dispatch("registerToken", [account, token], ctx)` → asserts `executeOperations` was called with one op of kind `register_token`, correct addresses.
  - `enforces accounts capability before registerToken` — the dispatcher's capability gate test pattern, asserting `CapabilityNotGrantedError` when accounts cap is absent.
  - `does NOT dispatch getCompleteAddress / simulateViews` — asserts `dispatch("getCompleteAddress", ...)` throws `"Unsupported wallet method"` (regression guard against accidental re-introduction).

- `packages/wallet-bridge/src/scope-enforcement.test.ts` — drop the `simulateViews` test cases; add a one-liner test asserting that calling `enforceScope("simulateViews", ...)` is a no-op (no checker registered).

- `packages/wallet-bridge/src/dispatcher.test.ts` — **NEW** schema-patch contract test: imports `@aztec/aztec.js/wallet` `WalletSchema` and asserts `"registerToken" in WalletSchema === false` BEFORE patching, then imports the extension's `nulo-schema-patch` (or constructs the equivalent inline Zod) and asserts the patched shape — `WalletSchema.registerToken.parameters().items.length === 2` and both items are address schemas. This pins drift between the three inline copies.

  Cleaner alternative: put the actual Zod entry into a single non-side-effect helper inside the test file, and have all three production copies import that helper... wait, that violates D1 (inline copy). Instead: the test asserts on the *shape*, not by importing the production copies. Each production copy independently produces the same shape; the test pins the shape's invariants.

- `packages/faucet/src/composables/useFaucetAddToken.test.ts` — **NEW**:
  - happy path (`addToken` resolves → status becomes `ok`)
  - rejected (`AbortError`/4001 → status becomes `rejected`, not `error`)
  - error (network failure → status becomes `error`)
  - re-entrancy guard (calling twice during `submitting` is ignored)

- `packages/faucet/src/components/TokenCard.test.ts` — extend existing tests: button visibility under each `status` of `useWalletConnection`, button click invokes `useFaucetAddToken.addToken`, button disabled while `submitting`.

### 7.2 E2E (network suite, `bun run e2e:agent`)

NEW spec: `packages/extension/tests/e2e/faucet-add-token.test.ts`. Parallel-safe per the suite conventions (`e2e:agent` allocates ephemeral ports + path-scoped cleanup — see `packages/extension/tests/e2e/README.md`).

Scenario:

1. Boot anvil + aztec sandbox + playground (already done by the `e2e:agent` global setup).
2. Launch the extension + onboard a fresh wallet via the existing helpers.
3. Open the faucet (use the faucet's `dev` server or the built artifact; the suite already supports per-worktree dev ports).
4. Connect the wallet to the faucet (existing discovery + emoji + capabilities helpers from the faucet's own `tests/e2e/`).
5. Click `data-testid="faucet-add-token-USDC"`.
6. Switch to the extension popup window (the wallet-sdk opens an execute window).
7. Assert the OperationCard renders the token address.
8. Click `data-testid="execute-approve"` (or whatever the existing approve button testid is).
9. Switch back to faucet, assert the status row says ✓ added.
10. Open the wallet popup, navigate to the tokens tab, assert the USDC token now appears.
11. Repeat for ETH.
12. Cancel path: same flow, click `data-testid="execute-reject"` instead, assert faucet status row becomes idle (no error UI).

### 7.3 Smoke

`bun run test:e2e` (smoke, no Aztec sandbox) doesn't apply — the feature requires network. Run smoke only to verify no regression on the existing UI flows.

### 7.4 Manual

Before merge:
- Hit the faucet on `localhost:5173`, connect Nulo, drip USDC + ETH, click "Add to wallet" for both, verify the wallet popup shows both tokens with correct balance.
- Repeat against alpha-testnet (the production faucet target).
- Verify the playground's new `registerToken` button works.
- Verify that the network-test-agent runs the new e2e test in parallel with at least two worktree agents (no port collisions).

## 8. Security & Adversarial Considerations

Drawn from the global `Security & Adversarial mindset` in user CLAUDE.md.

### 8.1 Threat model

| Actor | Goal | Surface |
|---|---|---|
| Malicious dApp (post-connect) | Spam the user's token list with junk / phishing tokens | `registerToken` RPC, capability already granted |
| Malicious dApp (pre-connect) | Trick the user into adding a fake USDC that looks identical to real USDC | Connection / capability dialogs (out of scope — already audited) |
| Compromised dependency (`@aztec/wallet-sdk`) | Bypass the schema-patch check or hijack the channel | Encrypted-channel layer (out of scope — upstream) |
| Compromised dependency (a Vue package the faucet pulls in) | Inject a malicious `registerToken` call from inside the faucet | Supply chain — covered by `bunfig.toml`'s 7-day min-age gate + `bun.lock` |

### 8.2 Defences in this PR

- **Confirmation popup per call** (D5) — every `registerToken` call shows the OperationCard with the *contract address* visible to the user. The malicious dApp cannot bypass this because `getOperationAccessLevel("register_token") = AccessLevel.AppState` (verified in recon).
- **Capability gate** — `registerToken` requires the `accounts` capability. Sessions without the capability throw `CapabilityNotGrantedError` (4100) before any popup is shown.
- **Origin tracking in the journal** — `executeRegisterToken` writes `opContext.dappOrigin = origin.name` to the operation journal entry. The wallet UI's `TokenImportRow` renders "Requested by <origin>" (verified in `execution/service.ts:1052-1058`), so the user has post-hoc forensic visibility.
- **Per-(profileId, chainId) scoping** — tokens are stored against the active profile + active chain. A faucet on alpha-testnet cannot pollute the user's testnet or mainnet token lists.
- **Idempotency** — `tokenService.addToken` short-circuits if `(profileId, chainId, contract)` already exists. A spam loop can't bloat storage.
- **Strict argument shape** — the schema-patch Zod entry validates both arguments are addresses. A dApp passing garbage gets a wire-level rejection before any extension state mutates.
- **Loud failure on schema freeze** — the patch file's `if (!("registerToken" in WalletSchema))` guard makes accidental re-application a no-op, AND the throw on `Object.assign` against a frozen target will fire at SW init, not at first-call time. CI catches it on every PR via the smoke / network suite.

### 8.3 Risks accepted

| Risk | Why we accept it |
|---|---|
| Token name/symbol are fetched by the extension via PXE — a malicious token contract can return arbitrary strings ("USDC", "USDT"…) | The user sees the contract address in the popup. The popup's responsibility is to surface this. Mitigation outside this PR: token-allow-list / collision-detection ("you already have a USDC at a different address") — filed as `tokens-collision-detection` follow-up. |
| Three inline copies of the Zod patch may drift | Pinned by `dispatcher.test.ts` shape-assertion contract test (§7). The drift would be caught at unit-test time, not at runtime. |
| Schema patch mutates a third-party global | The patch file documents this, the throw guard fails loudly on upstream change, and the wallet-sdk version is exact-pinned (`@aztec/wallet-sdk == 4.2.0`). A bump triggers an explicit re-evaluation. |
| The popup confirmation may be confusing for users who don't know what "Token contract address" means | Mitigation outside this PR: improve the OperationCard's `register_token` template to show the resolved name / symbol AFTER PXE parse (`parseTokenInterface` already fetches them — surface them before the Allow / Deny). Filed as `register-token-popup-clarity` follow-up. |

### 8.4 Out of scope (deferred follow-ups)

- Pushing a canonical `wallet_watchAsset`-equivalent into `@aztec/wallet-sdk` upstream — long-term clean answer, blocks on upstream review/release. Tracked as `wallet-sdk-watchasset-upstream`.
- Token-allow-list / phishing-token detection (collision with already-known names/symbols).
- Auto-fire `registerToken` after a successful drip without user click — rejected during clarifying because it spawns extra popups.
- Surface the resolved token name/symbol in the OperationCard (UX polish).

## 9. Acceptance criteria

A reviewer who pulls this branch should be able to verify all of:

- [ ] `bun run audit:vue` passes (typecheck + unit + component tests + lint + build).
- [ ] `bun run test:e2e` passes (no smoke regression).
- [ ] `bun run e2e:agent` runs the new `faucet-add-token.test.ts` and passes (network suite, includes the full happy-path + cancel-path described in §7.2).
- [ ] On alpha-testnet, connecting Nulo to the faucet + clicking "Add to wallet" for both USDC and ETH results in both tokens appearing in the wallet popup's token list within ~3s.
- [ ] The wallet popup's TokenImportRow shows "Requested by <faucet-origin>" for both tokens.
- [ ] Cancelling the popup leaves the faucet status row at idle (no error UI), per the wallet-bridge cancel recipe (4001 → silent).
- [ ] The playground's `registerToken` button works end-to-end.
- [ ] Calling `wallet.getCompleteAddress` or `wallet.simulateViews` from any code path throws "Unsupported wallet method" (regression guard).
- [ ] The dispatcher contract test pins the patched `WalletSchema.registerToken` shape.

## 10. Open questions / follow-ups

- **Should the OperationCard fetch + display the token name / symbol BEFORE the Allow / Deny?** Currently it shows only the contract address. The PR ships as-is (address only), and the polish is filed as `register-token-popup-clarity`. If reviewer wants it bundled, swap §5.15 to extend the template and add a `tokenService.parseTokenInterface` pre-fetch on popup open.

- **Should the faucet auto-prompt registerToken on first successful drip?** Rejected during clarifying; revisit if user metrics show low adoption.

- **Push `wallet_watchAsset` upstream**? Filed as `wallet-sdk-watchasset-upstream` — separate, deferred. Would let us delete the schema-patch entirely.

- **Sponsored token-add gas / fee path?** `registerToken` is purely off-chain (no tx, no fee, just PXE state). No fee model needed. Confirmed via reading `executeRegisterToken` — no `SendTransactionOperation` constructed.

## 11. ASCII status (live)

```
[✓] 0. Clarifying questions
[▶] 1. Draft main plan
[ ] 2. Dual audit (codex + opus)
[ ] 3. Final codex review
[ ] 4. Approval gate
[ ] 5. Implementation
[ ] 6. Post-impl codex review
[ ] 7. Fix loop
```
