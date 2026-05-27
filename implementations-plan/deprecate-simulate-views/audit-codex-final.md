# Codex Phase 3 final pass — `deprecate-simulate-views` plan-v2

Model: GPT-5.x via `codex exec resume` (xhigh). Date: 2026-05-24.
Session ID: `019e5aa2-2bf9-7193-95b0-616c75f90557` (resumed from the earlier audit).
RESPONSE_FILE: `/var/folders/p9/.../codex-slDjjj7X/response-1.md`

## Verdict

> Not approval-ready yet.

Three real fixes needed; the architectural direction is sound (codex confirms Shape C + the Omit pattern type-checks + pure function `getViewSimulationDeps` is right).

## Findings

### BLOCKER

**FC1** — `plan-v2` still places `previewedInterface?: TokenInterface` on `RegisterTokenOperation` in `wallet-bridge/src/operation.ts`, but `TokenInterface` only exists in `packages/extension/src/wallet/services/token/spec.ts:55-99`. **`@nulo/wallet-bridge` has no dependency on `@nulo/extension`**; the extension depends on wallet-bridge, not vice versa (verified `packages/wallet-bridge/package.json`). The `Omit` idea is fine; the type placement isn't.

**Fix**: define `previewedInterface` on an extension-local extended type, not on the wallet-bridge `RegisterTokenOperation`. The Omit-from-Request pattern becomes unnecessary because the field never lives in wallet-bridge at all.

### HIGH

**FC2** — Popup merge timing is wrong. Plan-v2 §5.15 says attach `previewedInterface` from `tokenInterfaces` in the popup materialization loop at `execute/index.vue:183-198`. But that loop runs BEFORE `previewTokenMetadata()` populates any map at `:261-279`. So at materialization time, the map is empty.

**Fix**: attach the field in the approve mapper at `execute/index.vue:327-330` (which runs after the user clicks Allow, by which time prefetch has completed AND the Allow button was gated behind `tokenMetadataLoading` per `:312, :482`).

**FC3** — §5.14 is internally inconsistent. It says `materialize.ts` should thread `previewedInterface` because "popup-side interactionPayload may carry it." But D5 explicitly Omits it from `RegisterTokenRequest`, and the current wire shape is `RegisterTokenRequest = Omit<RegisterTokenOperation, AccountParams> & { account }` (`dapp-interaction-protocol.ts:49-50`). The popup payload won't carry it.

**Fix**: drop §5.14's `previewedInterface` threading clause. `materialize.ts` is unchanged for `register_token` aside from the legacy `simulate_views` case removal.

### MEDIUM

**FC4** — `Omit` pattern works (verified): `Omit<RegisterTokenOperation, AccountParams | "previewedInterface"> & { account: CaipAccount }` yields exactly `{ kind, address, account }`, doesn't break dispatcher construction at `dispatcher.ts:436-440`. Moot now since the field moves off wallet-bridge entirely (FC1 fix).

**FC5** — `Map` shape compatible with existing reactivity. `tokenMetadata` is a `ref(new Map())` populated via `.set()` and read in template — parallel `tokenInterfaces` map is fine. No shape change needed.

**FC6** — Projector dep reach-in is messy. §5.6 references `this.execution.resolver`, but `resolver` is `private` on `ExecutionService` (`service.ts:250, 303`). Cheap operationally (only one `new BalanceProjector(...)` callsite at `token-balance/service.ts:60`), but the reach-in violates encapsulation.

**Fix**: expose a public `get contractResolver()` getter on `ExecutionService`, OR inject `ContractResolver` directly into `BalanceProjector`. Getter is the minimal change.

### NIT

**FC7** — Concurrency test should assert explicit event order, not just "microtask resolution." Useful invariant: utility promises are CREATED before `simulateTx` settles, and AWAITED only after the tx-typed path completes. Test should record event sequence (e.g., via timestamps or a shared log array).

## READY (per codex)

- C1/C2/C3 fixes from the earlier audit are actually reflected: parallel-launch/serial-await is pinned, parity gaps are in the test matrix, cleanup inventory now includes `OperationCard.vue` + `dapp-interaction/spec.ts` + stale comments.
- The `RegisterTokenRequest` Omit approach is type-correct (verified) and doesn't break dispatcher construction.
- Pure `getViewSimulationDeps` function is the right shape — don't replace with a helper class.

## MUST-FIX-BEFORE-APPROVAL (codex's distilled list)

1. Move `previewedInterface` off wallet-bridge's `RegisterTokenOperation`, or define a bridge-safe local structural type there.
2. Fix the popup threading point: merge `previewedInterface` after prefetch, not in the initial materialization loop.
3. Remove or rewrite §5.14's `materialize.ts` threading claim; it contradicts the wire-`Omit` design.
4. Replace the `execution.resolver` reach-in with an explicit, legal seam.
