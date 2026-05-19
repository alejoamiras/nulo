# M3.5 Stage D — handoff breadcrumb

Stages A-C shipped to master (scaffold + 7 leaf files + dead-rpc cleanup).
This doc captures what a future session needs to complete M3.5 cleanly.

## What's left to move

Two extension files still tangle the wallet-sdk dispatch layer with
extension-internal domain types. They're blocked on a non-trivial
type-migration that warrants its own commit (and QA cycle).

| File | Blocker | Decoupling pattern |
|---|---|---|
| `packages/extension/src/wallet/services/wallet-sdk/dispatcher.ts` (~795 lines) | 10+ extension-internal type imports: `Operation` + 10 variants, `Network`, `Account`, `ExecutionResult`, `OriginType` (value enum) + `LocalTxOrigin`, `DappSession`, `AztecSendTxRequest`, `packageJson.version` | See type-migration plan below. |
| `packages/extension/src/wallet/services/wallet-sdk/services-contract.ts` (~75 lines, `IDispatcherServices` interface family) | Same domain imports as dispatcher (it mirrors dispatcher's surface) | Move with dispatcher — they're one atomic unit. |

## What's already done (safe to build on)

- `@nulo/wallet-bridge` scaffold exists at `packages/wallet-bridge/` with `package.json`, `tsconfig.json`, and `src/index.ts` barrel.
- Subpath exports already declared: `.` and `/rpc` (the latter currently unused — can drop if rpc never repopulates).
- 7 leaf files moved to wallet-bridge, tests included:
  - `capabilities.ts`, `caip.ts`, `capability-map.ts`, `types.ts` (SessionContext), `discovery-queue.ts`, `scope-enforcement.ts`, `scope-enforcement.test.ts`
- Extension's `vitest.config.ts` has `include: ["src/**/*.test.ts", "../wallet-bridge/src/**/*.test.ts"]` so co-located tests run from the same harness.
- 4 extension consumers already rewired to import from `@nulo/wallet-bridge`: `dispatcher.ts`, `services-contract.ts`, `background.ts`, `dapp-session/spec.ts`.
- Dead `rpc/types.ts` + `rpc/utils.ts` deleted (zero consumers, pre-rebrand cruft).
- M0.1 scope-enforcement audit: `createAuthWit` checks confirmed present at `scope-enforcement.ts:248/264/279`. Gap closed by a prior commit.

## Migration plan for Stage D

### Step 1 — move the Operation type family to wallet-bridge

The 10+ Operation types in `packages/extension/src/wallet/services/execution/models/operation.ts` (and its siblings `operation-result.ts`, `action.ts` etc.) are **pure type definitions** — no runtime logic. They belong to the wallet-sdk protocol layer (the dispatcher and ExecutionService are the only consumers at the type level).

Approach (mechanical):

1. Move `execution/models/operation.ts` → `wallet-bridge/src/operation.ts`
2. Move `execution/models/operation-result.ts` → `wallet-bridge/src/operation-result.ts`
3. Inspect `execution/models/action.ts` — if it's only referenced by `operation.ts`, move it too. Otherwise structurally factor.
4. Export from wallet-bridge barrel.
5. Update `execution/models/index.ts` (or wherever) to re-export from `@nulo/wallet-bridge` for backward compat. Most of extension will continue importing `Operation` from its existing path.
6. Extension's `execution/service.ts`, `execution/client.ts`, `execution/spec.ts`, `execution/execution-coordinator.ts`, etc. keep working via the re-export shim.

**Blast radius**: ~15-20 extension files import `Operation` or a variant. Re-export shim keeps them compiling; only wallet-bridge-side imports are the new path.

### Step 2 — move `OriginType` + `LocalTxOrigin`

These live in `packages/extension/src/wallet/services/transaction/service.ts` and `spec.ts`. `OriginType` is a **value** (enum) — dispatcher imports it at runtime (`OriginType.Dapp`), not just as a type.

Approach:

1. Move the `OriginType` enum + `LocalTxOrigin` type to `wallet-bridge/src/transaction-origin.ts`.
2. Re-export from extension's `transaction/service.ts` for backward compat.

Size: small, ~20 lines.

### Step 3 — move (or structuralize) the dapp-interaction types

Dispatcher imports `ExecutionResult`, `AztecSendTxRequest` from `@/wallet/services/dapp-interaction/spec`. `services-contract.ts` also imports `ExecutionParams`, `CapabilityParams`, `CapabilityResult`.

Options:

- **(a)** Move these 5 types to wallet-bridge. Clean but affects more consumers.
- **(b)** Structuralize: declare narrow `IExecutionResult`, `IAztecSendTxRequest` etc. in wallet-bridge with the fields actually touched, leave concrete types in extension. Dispatcher uses the structural versions; extension's real implementations satisfy via structural subtyping.

**Recommendation**: (a). These are protocol-level types (they describe what a dApp sends in); they belong to the wallet-sdk bridge layer. Same reasoning as the Operation move.

### Step 4 — structural Network / Account / DappSession

These three types are domain-rich and used widely in extension. Moving them would balloon the migration.

Dispatcher touches:
- `Network.id` (passed to `network.getNetworks(chainId).id`, no other fields in dispatcher)
- `Account.address` (only `.address` is read)
- `DappSession.id`, `.accounts`, `.permissions`, `.capabilityGrants`, `.capabilityRejections`, `.accountAliases`

Approach: narrow structural interfaces in wallet-bridge's `services-contract.ts` (or a new `session-types.ts`):

```ts
export interface INetworkRef { id: string; chainId: number }
export interface IAccountRef { address: string; chainId: number /* etc. narrowed */ }
export interface IDappSessionRef {
  id: string
  origin: string
  accounts: string[]
  capabilityGrants?: GrantedCapabilityRecord[]
  capabilityRejections?: RejectedCapabilityRecord[]
  // ... whatever dispatcher actually reads
}
```

Extension's concrete `Network` / `Account` / `DappSession` types satisfy these structurally at the call sites. Zero concrete imports from dispatcher.

### Step 5 — packageJson → __VERSION__

`dispatcher.ts:82` does `import packageJson from "../../../../package.json"` and uses `packageJson.version` in 3 places (lines ~378, ~406, ~503 in the original source).

Approach:
1. Replace `import packageJson` with `declare const __VERSION__: string`.
2. Replace `packageJson.version` with `__VERSION__`.
3. Verify extension's vite.config + vitest.config both `define` `__VERSION__` (already done — see vite.config.ts:201-202, vitest.config.ts:33-39).

### Step 6 — move dispatcher.ts + services-contract.ts + isNoFromRequest helper

Once Steps 1-5 land, dispatcher's imports are all either (a) wallet-bridge-internal, (b) `@aztec/*`, or (c) `@nulo/wallet-core` / `@nulo/extension-messaging`. The move is then mechanical.

- Move `dispatcher.ts` → `wallet-bridge/src/dispatcher.ts`
- Move `services-contract.ts` → `wallet-bridge/src/services.ts` (rename to match plan's `services.ts`)
- Delete the dispatcher's inlined `isNoFromRequest` helper (already present at dispatcher.ts:93-95) OR extract to `wallet-bridge/src/utils.ts`. Keeping inlined is fine.
- Update extension's `wallet-sdk/background.ts`:
  - `import { WalletSdkDispatcher } from "./dispatcher"` → `from "@nulo/wallet-bridge"`
  - `import type { IDispatcherServices } from "./services-contract"` → same

### Step 7 — delete the empty wallet-sdk directory

After Stage D, extension's `wallet-sdk/` only contains `background.ts`. Leave it — it's the "wiring point" per the plan ("background.ts stays in @nulo/extension as the wiring point").

## Recommended order for Stage D

1. **Step 5 first** (__VERSION__ swap — smallest, no type surface).
2. **Step 1** (Operation type family — biggest blast radius; do it early to validate the re-export shim pattern).
3. **Verify green** (typecheck, unit tests, build). Commit.
4. **Step 2** (OriginType + LocalTxOrigin).
5. **Verify green.** Commit.
6. **Step 3** (dapp-interaction types).
7. **Verify green.** Commit.
8. **Step 4** (structural Network / Account / DappSession). This is the trickiest — expect typecheck iteration.
9. **Step 6** (move dispatcher + services-contract). If prior steps are clean, this is ~30 lines of import rewrites.
10. **Full E2E + dApp connection smoke.** Commit.

Each step is independently verifiable. Commit between them. Full E2E (smoke + network) + a real dApp connect gate the final commit.

## Risks to watch

- **`Operation` re-export shim: duplicate identifier if barrel re-exports something wallet-bridge also exports.** Mitigation: grep `export * from "@nulo/wallet-bridge"` after the shim lands — if any test file imports via both paths, one becomes a duplicate.
- **`OriginType` is a value, not a type.** Runtime import cycle risk: wallet-bridge's dispatcher uses `OriginType.Dapp`. If `transaction/service.ts` imports from wallet-bridge *and* wallet-bridge's dispatcher imports from `transaction/service.ts` for Transaction-level types, we get a cycle. Keep the enum in wallet-bridge; extension's transaction service re-exports.
- **`__VERSION__` in test env**: wallet-bridge tests running under extension's vitest already get `__VERSION__` from extension's `vitest.config.ts:define`. No action needed as long as we don't add a separate wallet-bridge vitest config.
- **DappSession structural narrowing**: dispatcher reads `session.accountAliases` (a Record) and `session.capabilityGrants` (array). If the structural interface omits a field the dispatcher actually reads, you'll get a runtime `undefined`. Grep dispatcher for every `session.` access and mirror them in the interface.

## State as of M3.5 Stages A-C merge

- Branch `m3/5-wallet-bridge`: merged to master (commits preserved).
- Version bumped in its own commit before merge (next: 0.12.8 for Stage D build).
- Extension's `wallet-sdk/` directory: `background.ts`, `dispatcher.ts`, `services-contract.ts` (3 files, down from 10).
- 377/377 unit tests pass, 15/15 E2E smoke, 16/16 E2E network.

## Reference — what the M3.5 plan at `implementations-plan/M3/5/plan.md` originally wanted

Read that plan for the full architectural rationale + risk register. The deferred items above correspond to:

- Plan's "**Pre-extraction refactor (Step 0)**": ✅ already done by prior commits (services-contract.ts + caip.ts + capabilities.ts exist)
- Plan's "**What goes in @nulo/wallet-bridge**" table: 5/7 rows shipped; `dispatcher.ts` + `rpc/*` deferred (rpc was dead code, deleted instead)
- Plan's "**`version` from package.json**": ⏳ deferred (Step 5 above)
- Plan's "**NuloWalletInfo factory**": ✅ irrelevant (rpc/types.ts was dead code, deleted)
- Plan's "**Scope enforcement M0.1 audit**": ✅ verified closed
