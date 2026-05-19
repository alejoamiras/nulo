# Plan — Typecheck cleanup (113 → 0 errors)

**Status**: revised after two-audit review (codex xhigh + Claude Plan agent)
**Branch**: `cleanup/typecheck-green` (off master `63d232e`)
**Baseline**: `bun run typecheck` emits 113 errors across 22 files. 458/458 unit + 31/31 E2E all green. None from Stage D.

## Motivation

1. CI gate readiness for M3.7 (`check:deps` + per-package typecheck need a green baseline).
2. Runtime-bug masking risk — at least one cluster (Aztec SDK drift) represents upstream API changes the code hasn't caught up to. Code compiles via coercion chains; runtime may silently pass wrong shapes into SDK calls.
3. Refactor velocity — M3.6 (`@nulo/extension-ui` extraction) moves ~300 components; green typecheck lets vue-tsc act as a correctness checker during the move.

## Audit incorporation (what changed from the draft)

11 revisions from the two-auditor pass:

1. **Phase 1 fake-node-factory**: do NOT delete (2 real consumers). Rewire import path.
2. **Phase 2 vue-router/auto**: plugin not configured in vite.config — fix is to switch imports to plain `vue-router`, not regenerate.
3. **Phase 3 (store + params)**: `ref<Network[]>([])` does not fix `updateNetwork(id,name,url)` implicit-any params — expand Phase scope to both.
4. **Phase 6.2 was wrong**: `.toString()` at `service.ts:1306` + `authwit-discoverer.ts:101` passes to `stubAccountAddresses: string[]` upstream — KEEP it. Only `opts.scopes` + `proveTx(...scopes)` at `service.ts:1305/1336/1342` become `AztecAddress[]`.
5. **Phase 6.3 root fix location**: `FeeStrategyContext.SimulateTxFn.opts.scopes: unknown[]` at `fee-strategy.ts:69` is the actual contract site — fix there, not in `service.ts:204/1455` lambdas.
6. **Phase 5 Capability narrowing**: B4 (codex-flagged) — dispatcher casts IPC payload blindly from `unknown[]`. Must add a runtime zod guard at the dispatcher boundary BEFORE narrowing the UI prop, else we're lying about runtime trust.
7. **Phase 4 Logger**: adopt the third option — separate RPC surface from the pure port. `LoggerService` implements `ServiceSpec<Methods>` only; `LoggerServiceClient` implements `ILogger` only; optional `ILoggerWithContext` for `LoggerStore`. Don't widen `ILogger` repo-wide.
8. **Phase 6.4 IntentInnerHash**: cleanest fix is `computeOuterAuthWitHash(consumer, chainId, version, innerHash)` from `@aztec/stdlib/auth_witness` directly (skip the structural wrapper). Zero runtime risk.
9. **Phase 2 SFC shims**: also add `shims-vue.d.ts` with `declare module '*.vue'` to prevent M3.6 extension-ui extraction from cascading new TS7016s.
10. **Phase 7 vitest fix**: just add explicit `import { describe, it, expect } from "vitest"` in `scope-enforcement.test.ts` — no tsconfig change.
11. **Ordering**: risky runtime phases FIRST (behind manual QA gate), not last, so failures don't block 5 green phases. Execution order: 1 → 2 → 3 (QA gate) → 4 → 5 → 6 → 7 → 8.

## Error taxonomy (same baseline, 113 errors, 22 files)

| # | Bucket | Errors | Representative |
|---|---|---|---|
| 1 | Stale import paths | 5 | `@aztec/stdlib/contract`→`/abi`, `../account/contracts`→`@nulo/aztec-runtime/account`, `fake-node-factory` port |
| 2 | Dead `@ts-expect-error` | 4 | 4 window files |
| 3 | Test fixture drift | 4 | `hexRpcUrl`, `credentialId`, `afterEach` |
| 4 | Vue SFC / JS shims | 8 | lang="ts" flip + 2 .js files + router import + blanket shim |
| 5 | Store + implicit-any params | 23 | `app.store.ts` refs/handlers, router guard, `x` lambdas |
| 6 | Aztec SDK drift (runtime-affecting) | 17 | timestamps, AztecAddress scopes, IntentInnerHash, GasFees, LocationQuery |
| 7 | Logger signature | 2 | Methods vs ILogger mismatch |
| 8 | Execute window Operation mismatch | 2 | UIOperation readonly-assignment |
| 9 | Capability narrowing | 37 | IPC-unsafe `Record<string,unknown>` → `Capability` union |
| 10 | offscreen test Promise-wrap | 1 | `Promise<Promise<string>>` |
| 11 | chrome.runtime.lastError + overload | 2 | files.ts |
| 12 | Passkey LocationQueryValue | 4 | passkey/index.vue |
| 13 | app.vue declaration | 1 | separate from #4 — popup/index.ts:22 |
| 14 | `.js` files no types | 2 | amount.js, syncedRef.js |
| 15 | vue-router-auto | 2 | popup/index.ts:21, setup/index.ts:2 |
| | **Sum** | **113** | |

Plus 3 per-package standalone-typecheck errors (aztec-runtime, wallet-bridge) surfaced for Phase 8.

## Execution order (revised)

**Phase 1 → 2 → 3 (MANUAL QA GATE) → 4 → 5 → 6 → 7 → 8.** Phase 3 runs before the safe phases so the runtime-risky changes are isolated; if they break we roll back only that commit, not 5 phases worth of cleanup.

---

## Phase 1 — Trivial sweep (mechanical, ~19 errors removed)

**Zero runtime risk. ~30 min.**

1.1 Stale paths (5 errors):
- `execution/authwit-discoverer.ts:42` — `ContractArtifact` moves from `@aztec/stdlib/contract` to `@aztec/stdlib/abi`. Keep `ContractInstanceWithAddress, NodeInfo` on `/contract`.
- `execution/contract-resolver.ts:32` — same.
- `execution/contract-resolver.test.ts:15` — same.
- `transaction/service.ts:25` — `../account/contracts` → `@nulo/aztec-runtime/account`.
- `transaction/spec.ts:2` — same.
- `core/testing/fake-node-factory.ts:19` — `../ports/node-factory-port` → `@nulo/aztec-runtime/ports/node-factory-port` (confirm actual export path via aztec-runtime's package.json `exports` field or barrel re-export; file is NOT to be deleted, it has consumers at `network/service.test.ts:22` and `core/testing/index.ts:11`).

1.2 Dead `@ts-expect-error` (4 errors):
- `windows/capabilities/index.vue:50`, `windows/discover/index.vue:29`, `windows/execute/index.vue:47`, `windows/verify/index.vue:16` — delete each directive.

1.3 Test fixture drift (4 errors):
- `pxe/artifact-registry.test.ts:14` — drop `hexRpcUrl`, add `isDefault: false` to match real `Network` shape.
- `pxe/chain-runtime.test.ts:13` — same.
- `profile/service.integration.test.ts:276` — `credentialId` gone from `ProfileInfo`. Check blame; likely swap to the new field name or drop the assertion.
- `wallet/logger/store.test.ts:31` — add `afterEach` to the vitest import.

1.4 offscreen Promise wrap (1 error):
- `wallet/base/offscreen/client.test.ts:27` — drop the outer `Promise.resolve()` on an already-promise-returning call.

**Verify**: error count 113 → ~94. Commit: `fix(typecheck): sweep stale imports + dead directives + test fixtures [Phase 1]`.

## Phase 2 — IntentInnerHash rewrite (was 6.4; zero runtime risk, 3 errors)

The `as IntentInnerHash` cast at `execution/authwit-discoverer.ts:117` and `execution/service.ts:1320` is wrong — `authRequest.innerHash` is a single `Fr`, not the full intent. Both currently build `{ consumer: effect.contractAddress, innerHash: authRequest.innerHash as IntentInnerHash }` — the cast is applied to the inner `Fr` field, not the object.

Cleanest fix: use `computeOuterAuthWitHash(consumer, chainId, version, innerHash)` from `@aztec/stdlib/auth_witness` directly and skip building the structural wrapper. Single replacement, zero runtime risk (verified in `@aztec/aztec.js/src/utils/authwit.ts:24,79` + `call_authorization_request.ts:19` + `@aztec/stdlib/src/auth_witness/auth_witness.ts:79`).

If rewiring via `computeOuterAuthWitHash` requires too much caller-side change (need to pass chainInfo through), fallback: remove the cast and restructure to `{ consumer: effect.contractAddress, innerHash: authRequest.innerHash }` — the object literal is already `IntentInnerHash`-shaped, the cast is what's wrong.

**Verify**: error count → ~91. Commit: `fix(typecheck): correct IntentInnerHash construction at authwit sites [Phase 2]`.

## Phase 3 — Aztec SDK drift (runtime-affecting, MANUAL QA GATE, ~14 errors)

**Highest risk. Manual send-tx QA required after this phase.**

3.1 Timestamp is bigint, not Fr (4 errors):
- `execution/service.ts:1225,1346` — replace `typeof timestamp.toBigInt === "function" ? timestamp.toBigInt() : BigInt(timestamp.toString())` with `BigInt(timestamp)` or just `timestamp` (confirm via `provedTx.publicInputs.constants.anchorBlockHeader.globalVariables.timestamp` upstream type). This was a cross-version runtime guard; simplifying removes the fallback.

3.2 Scopes type change — SURGICAL (5 errors, not 3 like the draft plan claimed):
- `execution/service.ts:1305` — `opts.scopes` (arg 2 of `pxe.simulateTx`) was `string[]`, upstream now wants `AztecAddress[]`. Remove `.toString()` on the arr elements.
- `execution/service.ts:1336` — same.
- `execution/service.ts:1342` — `proveTx(...scopes)` call — pass AztecAddresses, not strings.
- **KEEP** `.toString()` at `service.ts:1306` + `authwit-discoverer.ts:101` — that's the 3rd arg `stubAccountAddresses?: string[]` which is explicitly string in `pxe/spec.ts:30`.

3.3 Fee strategy context (2 errors, root in contract not lambdas):
- `execution/fee/fee-strategy.ts:69` — `SimulateTxFn.opts.scopes: unknown[]` → `AztecAddress[]` (this is the type contract every strategy implements). Changing here removes 3.1–3.3 upstream consumer errors.
- Confirm no consumers pass strings — grep the callers.

3.4 GasFees structural return type (2 errors):
- `execution/operation-planner.ts:211`, `execution/service.ts:1276` — `GasFees` instance has `feePerDaGas: UInt128` (bigint). Consumer wants `{ feePerDaGas: string | number; feePerL2Gas: string | number }`. Convert at the site: `gasFees ? { feePerDaGas: gasFees.feePerDaGas.toString(), feePerL2Gas: gasFees.feePerL2Gas.toString() } : undefined`.

3.5 Misc drift (1 error):
- `execution/authwit-discoverer.ts:231` — `string | undefined` to `string` — narrow with `??` or early return.

**Manual QA gate** (required before Phase 4 lands):
- Cold start the extension (uninstall → reinstall fresh).
- Send a tx from the UI (NOT via dApp — direct UI send).
- Send a tx via playground/gregoswap dApp (exercises authwit flow at `service.ts:1320`).
- Extension reload mid-session + retry a tx (offscreen recovery via `ensureOffscreenRunning()`).
- `bun run build` after Phase 3 PR (typecheck doesn't exercise the bb.js shim).

**Verify**: error count → ~77. Commit: `fix(typecheck): upstream Aztec SDK drift — timestamps/scopes/GasFees [Phase 3]`.

## Phase 4 — Vue SFC shims + router (11 errors)

**Low risk.**

4.1 Add `lang="ts"` to 5 SFCs (audit each post-flip for fresh errors):
- `popup/app.vue`, `popup/components/modules/general/NetworkBadge.vue`, `EmojiGrid.vue`, `popup/components/modules/send/FeeSettingsCard.vue`, `popup/components/popups/RegisterPopup/WalletPasswordContent.vue`
- Expect minor fallout (e.g., event-parameter implicit-any, `.value.inputEl` null-checks). Fix inline.

4.2 Blanket shim — add `packages/extension/src/shims-vue.d.ts`:
```ts
declare module "*.vue" {
  import type { DefineComponent } from "vue"
  const component: DefineComponent<{}, {}, any>
  export default component
}
```
This prevents M3.6 ui extraction from cascading new TS7016s.

4.3 `.js` file handling (2 errors):
- `src/utils/amount.js` — inspect. If TS-compatible, rename `.ts`. Else write `amount.d.ts`.
- `src/composables/syncedRef.js` — same.

4.4 vue-router-auto (2 errors):
- `popup/index.ts:21`, `setup/index.ts:2` — `unplugin-vue-router` is NOT configured in `vite.config.ts:80`, the stub is empty. Fix: swap imports to plain `vue-router` (`import { createRouter, createWebHashHistory } from "vue-router"`). Minimal delta.

**Verify**: error count → ~66. Commit: `fix(typecheck): vue SFC lang=ts + blanket shim + router imports [Phase 4]`.

## Phase 5 — Stores + implicit-any params (23 errors)

**Low-medium risk.**

5.1 `stores/app.store.ts`:
- `profile = ref<ProfileInfo | undefined>()` (line 49)
- `profiles = ref<ProfileInfo[]>([])` (line 50)
- `networks = ref<Network[]>([])` (~line 120)
- `transactions = ref<Tx[]>([])` (~line 140)
- Handlers:
  - `updateNetwork(id: string, name: string, url: string)` (~122)
  - `setDefaultNetwork(target: Network)` (~126)
  - `addTransaction(tx: Tx)` (~133)
  - `removeTransaction(tx: Tx)` (~144)
- Re-run typecheck after each ref flip to catch cascades (reactive consumers that read `.networks` and access a removed field will surface here).

5.2 Router guard + lambdas:
- `popup/index.ts:63` — `(to: RouteLocationNormalized, from: RouteLocationNormalized, next: NavigationGuardNext) => void` from `vue-router` (after Phase 4's switch to plain vue-router, not vue-router/auto).
- `tx-request-builder.ts:275,276`, `execution/service.ts:657,741,742`, `authwit-discoverer.ts:151,152`, `clock-ticker-adapter.test.ts:13` — annotate `x` / `fn` / `_ms`. Type inference from the array/context will usually tell us the right type.

5.3 Execute window Operation assignment (2 errors):
- `windows/execute/index.vue:261` — strip `network`/`account` fields from the array before passing to `executeOperations(ops: Operation[])`. Use `ops.map(({network, account, ...op}) => op)`.
- `windows/execute/index.vue:591` — `$event!` assigns to readonly `feeSettings`. Declare mutable cast at assignment site or restructure.

5.4 Passkey LocationQueryValue (4 errors):
- `windows/passkey/index.vue:124,127,129,132` — narrow with `typeof x === "string" ? x : undefined` guards.

5.5 Chrome types (2 errors):
- `utils/files.ts:71` — `chrome.runtime.lastError` access. Check `chrome-types` version; may need direct typing via `(chrome.runtime as any).lastError` or swap to named prop access.
- `utils/files.ts:243` — `TS2769 No overload matches this call` — inspect the call site.

**Verify**: error count → ~43. Commit: `fix(typecheck): stores + implicit-any annotations + misc [Phase 5]`.

## Phase 6 — Logger signature separation (2 errors, architecture cleanup)

**Medium risk (spillover to ILogger consumers).**

Current drift: `logger/service.ts:18` implements `ILogger` (from wallet-core) AND `ServiceSpec<Methods>` — but `Methods.log` has wider signature `(context?, source, level, ...data)` than `ILogger.log(source, level, ...data)`. Can't satisfy both.

Third option (audit-recommended):
- `LoggerService` implements `ServiceSpec<Methods>` only (drop `implements ILogger`).
- `LoggerServiceClient` implements `ILogger` only; its `log(source, level, ...data)` binds to its ctor-provided `context` and calls `this.request("log", this.context, source, level, ...data)` internally.
- Introduce `ILoggerWithContext extends ILogger { logWithContext(context, source, level, ...data): void }` in wallet-core ONLY if `LoggerStore` needs it.

Grep `: ILogger` across the codebase — ~29 sites depend on the narrow shape; this change preserves all of them.

**Verify**: error count → ~41. Commit: `refactor(logger): split RPC surface from pure port [Phase 6]`.

## Phase 7 — Capability narrowing with runtime guard (37 errors)

**Medium risk. Requires a runtime schema first (audit B4).**

7.1 Add zod schemas for each Capability variant in `packages/wallet-bridge/src/capabilities.ts`:
```ts
import { z } from "zod"

export const ScopePatternSchema = z.object({ contract: z.string(), function: z.string() })
export const ScopeSchema = z.union([z.literal("*"), z.array(ScopePatternSchema)])

export const AccountsCapabilitySchema = z.object({
  type: z.literal("accounts"),
  // ... other fields
}).passthrough()

// ...one schema per variant...

export const CapabilitySchema = z.discriminatedUnion("type", [
  AccountsCapabilitySchema, ContractsCapabilitySchema, /* ... */
])

export const CapabilityArraySchema = z.array(CapabilitySchema)
```

`.passthrough()` lets extras through without failing — forward-compatible with dApp-manifest extensions. The schema is at the IPC boundary; the static `Capability` union stays as source of truth for the UI.

7.2 Use schema at dispatcher boundary (`packages/wallet-bridge/src/dispatcher.ts:373,438,475`):
- Currently: `(manifest?.capabilities ?? []) as Record<string, unknown>[]` — blind cast.
- Switch to: `CapabilityArraySchema.parse(manifest?.capabilities ?? [])` (throws on malformed) or `.safeParse()` with fallback log + empty array.

7.3 Narrow UI props:
- `CapabilityDetailPanel.vue:5` — `defineProps<{ capability: Capability }>()`. The template's `v-if="capability.type === 'transaction'"` then narrows `capability.transactions.scope` correctly through the discriminated union.
- `windows/capabilities/index.vue:156-259` — callback types switch from `(cap: Record<string, unknown>) => ...` to `(cap: Capability) => ...`. Audit `approvedNew`, `existing`, `granted` array types at :251-255 — they may need narrowing too.

**Verify**: error count → 0 in extension. Commit: `refactor(capability): runtime zod guard + UI discriminated-union narrowing [Phase 7]`.

## Phase 8 — Standalone per-package typecheck + CI gate (3 errors + wire-up)

8.1 Fix standalone-typecheck errors in workspace packages:
- `packages/aztec-runtime/src/account/nulo-account.ts:36` — `@/wallet/logger` is an extension-only alias. Fix to `@nulo/wallet-core/logger`.
- `packages/aztec-runtime/src/utils/index.ts:1` — `DEFAULT_REQUEST_TIMEOUT_MS` is a `const`, re-export as value: `export { DEFAULT_REQUEST_TIMEOUT_MS } from "./fetch"`.
- `packages/wallet-bridge/src/scope-enforcement.test.ts:1` — add `import { describe, it, expect } from "vitest"` explicitly at top of file.

8.2 Wire CI gate. Add to root `package.json`:
```json
"typecheck:all": "bun run --filter '@nulo/*' typecheck"
```

This uses Bun's workspace filter (explicit `@nulo/*` glob — avoids pulling in `playground` + `landing` scaffolds). Auto-joins `@nulo/extension-ui` when M3.6 lands.

8.3 Optional: wire into `.githooks/pre-commit` or CI workflow. For this PR, just make the script available and run it once clean.

**Verify**: `bun run typecheck:all` returns exit 0 across 6 packages. Commit: `ci(typecheck): per-package gate + wire-up [Phase 8]`.

---

## Verification sequence (every phase)

1. `bun run typecheck` — error count dropped, error set is a strict subset of `/tmp/errors-before-d1.txt`.
2. `bun run test` — 458/458.
3. Commit with message `fix(typecheck): <phase description> [Phase N]`.

After Phase 3 (manual QA gate):
4. `bun run build` — clean.
5. Manual send-tx from UI.
6. Manual send-tx via dApp.
7. Manual extension reload + retry tx.

After Phase 8:
8. `bun run typecheck:all` — exit 0.
9. `bun run test:e2e:all` — 31/31 + 5 skipped.
10. Open PR against master.

## Risk gate (stop rule)

Per auto-memory's autonomous-run stop rule: **if any phase breaks 2 consecutive `bun run test` or E2E runs, halt and keep changes on the branch — do NOT merge.** User reviews next session.

## Blast radius summary

| Phase | Runtime-change? | Consumers touched | QA required |
|---|---|---|---|
| 1 | No | ~10 files | None |
| 2 | No (cast rewrite) | 2 files | None |
| 3 | **YES** — address/timestamp/scope types | ~5 files | Manual send-tx + dApp + reload |
| 4 | No | 8 files + shim | Visual check 5 SFCs |
| 5 | No (annotations only) | 10+ files | None |
| 6 | Yes if ILogger consumers broke | 2 files + ~29 consumers | Grep `: ILogger` pre-commit |
| 7 | Schema-guard is new code | 3 files | Visual check capability popup |
| 8 | Config changes only | 3 files + root | CI run |

## Open issues (not blocking this plan)

- proveTx / dApp connect e2e are `.skip`'d — Phase 3's QA gate is manual-only. Un-skipping is a separate M3.X epic.
- If B4 (capability runtime schema) reveals a shape the dispatcher currently accepts but zod rejects, we have a real bug to fix — flag it, don't silently swallow.
- The `@/utils/amount.js` + `syncedRef.js` rewrite (4.3) may surface fresh errors in their consumers.

## Deferred

- Typifying all 90 SFCs without `lang="ts"` (blanket shim in Phase 4 handles the symptom).
- `noImplicitAny` stricter flags.
- Test coverage for `proveTx` + `connect-dapp`.
