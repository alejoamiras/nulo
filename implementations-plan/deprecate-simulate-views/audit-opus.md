# Opus adversarial audit — `deprecate-simulate-views` plan

Model: Opus 4.7 via Agent subagent (general-purpose). Date: 2026-05-24.
Prompt: read `implementations-plan/deprecate-simulate-views/plan.md` end-to-end and verify claims against actual code.

## Verdict

> Plan is structurally sound and Shape C is right. One BLOCKER (F1 — missing `OperationCard.vue`), two HIGHs (F2 types, F4 sanity check). Fix those + the MEDIUMs and it's ready for the codex pass.

## Findings

### BLOCKER

**F1** — Plan §5 misses `packages/extension/src/popup/windows/execute/OperationCard.vue:288` which renders a dedicated `<template v-else-if="op.kind === 'simulate_views'">` branch with `op.calls` access. Once `SimulateViewsOperation` leaves the union, `op.calls` type-narrows to `never` on other branches and the template stops compiling under strict Vue type-checks. Acceptance grep at §8 would catch it, but plan should include §5.12bis: "drop OperationCard.vue:288-299 simulate_views template block".

### HIGH

**F2** — Type lie in `BatchedViewSimulationDeps`. Plan §4 declares `pxe: PXE`. Actual return type of `PxeServiceClient.getPXE(...)` is `IPXE` (`packages/aztec-runtime/src/pxe/client.ts:72`). `ContractResolver.resolveInstances(pxe: IPXE, ...)` takes `IPXE` too. `AccountContractRef` is not a real type — executor uses `IAccountContract` from `@nulo/aztec-runtime/account`. Will fail typecheck at acceptance gate.

**F4** — `previewedInterface` security argument is reasoning at the wrong layer. Plan §6.2 correctly says popup data is trustworthy (offscreen PXE → SW → popup, no dApp touch). But the threading happens via the `RegisterTokenRequest`/`RegisterTokenOperation` wire shape built in the popup. The popup itself is trusted, but the executor must still validate `op.previewedInterface.contract === op.address` and `chainId === network.chainId` to defend against a popup BUG (not malice) where the pre-fetch landed on the wrong contract. Plan §5.17 says "executor reads it if present" without the sanity check.

### MEDIUM

**F3** — Behavior parity gap. Today `executeSimulateViews` (`service.ts:1299-1315`) kicks off `pxe.executeUtility(...)` synchronously and stores the PROMISE in `utility: [Promise<UtilityExecutionResult>, ...]`. Awaits happen later at line 1441-1449 — concurrent execution kernel-side, serial await. If the helper rewrites this to `for { await pxe.executeUtility(...) }` it becomes strictly serial. For balance-projector chunks of 12 with utility-shaped balances, that's 12× the wall-clock. Plan §6.3 lists parity items but omits this one. Helper must preserve launch-then-await pattern.

**F5** — `previewedInterface` doesn't fully solve the stated problem. Popup at `execute/index.vue:268` stores only `{name, symbol, decimals}` — NOT the full 22-field `TokenInterface` (`token/spec.ts:55-108`). Plan §5.17 acknowledges this and proposes extending `previewTokenMetadata` to return `{name, symbol, decimals, interface}` — but this is a public service-method signature change. Plan §5 doesn't enumerate `token/spec.ts:183` or `token/client.ts:59-64` as MODIFIED files. Typecheck will fail without them.

**F8** — Tests confirmation. `materialize.test.ts` doesn't currently test `simulate_views`, so dropping the case from `materialize.ts:93` doesn't break tests, but plan §7.2 should explicitly confirm "no test deletions needed in materialize.test.ts". `scope-enforcement.test.ts:212-222` "retired methods are no-ops" guard correctly preserved.

**F9** — Helper test plan needs realistic PXE mock. `pxe.simulateTx` returns a `TxSimulationResult` with `getPublicReturnValues()` and `getPrivateReturnValues()` whose `.nested` shape is CONDITIONAL on `txRequest.origin.toString() === op.accountAddress` (`service.ts:1425-1428`). Without an integration test against real PXE, the `.nested[1].nested` indirection is untested at the helper level. Per user's CLAUDE.md testing philosophy ("external-system data → always include at least one `describe.skipIf(!ENV_VAR)` real-data integration test"), add ≥1 such test.

**F10** — Circular-dep risk on `ExecutionService.getViewSimulationDeps`. Plan §5.3 proposes pure-function file at `helpers/get-view-simulation-deps.ts`; plan §4 mentions a method-on-ExecutionService alternative. balance-projector already takes ExecutionService via DI so the method form has no cycle either. Plan currently waffles between "either-or" — pick one and commit.

### NIT

**F6** — `BATCH_SIZE = 12` has no justification comment in `balance-projector.ts:29`. Worth a one-line comment in this PR ("matches the historical PXE simulateTx payload-size sweet spot"). Not blocking.

**F7** — No migration risk. `simulate_views` was never journaled (`journal-state.ts` only handles `transfer` / `dapp_execute`). Plan's silence here is correct.

**F11** — Popup race verified safe. `execute/index.vue:312` (`if (tokenMetadataLoading.value) return`) + `:482` (Confirm button disabled while loading). Plan §5.17 should cite these as the gates so codex doesn't ask.

**F12** — `classifyOperationCatch` wrapper dropped — verified non-load-bearing. Pure cancel-classification + error rethrow + journal logging; no retry/backoff. Internal callers already have try/catch (`balance-projector.ts:147-151`, `service.ts:1509, 1538`). Plan §9 correct.

**F13** — Shape C is right. Shape A would (a) leave 200 lines of "internal helper masquerading as Operation executor" violating single-responsibility, (b) confuse maintainers, (c) make unit testing harder. Don't accept Shape A.

**F14** — `OperationKind = Operation["kind"]` shrinks by one member; downstream consumer `task/spec.ts:80` has no `"simulate_views"`-shape branches. Safe.

**F15** — `playground/src/sections/simulation.ts:7-9` comment update — plan §5.14 mentions it. Verified.

## ADOPT

1. Add §5.12bis: drop `OperationCard.vue:288-299` `simulate_views` template branch. **(F1 BLOCKER)**
2. Fix helper types: `pxe: IPXE`, `account: IAccountContract`. **(F2)**
3. Preserve parallel-launch / serial-await pattern for utility calls in the helper. **(F3)**
4. Add executor-side `previewedInterface.contract === op.address` + `chainId` sanity check before trusting it. **(F4)**
5. Enumerate `token/spec.ts:183` and `token/client.ts:59-64` as MODIFIED in §5.17 (return-type change cascades). **(F5)**
6. Pick one shape for `getViewSimulationDeps` (method-on-service vs pure function) and commit. **(F10)**
7. Add ≥1 `describe.skipIf(!RUN_NETWORK_E2E)` integration test exercising the helper against real PXE, especially the conditional `.nested[1].nested` branch. **(F9)**
8. Pin the popup race verification in §5.17: cite `execute/index.vue:312, :482` as the gates. **(F11)**
9. Confirm in §7.2 that `materialize.test.ts` needs no changes. **(F8)**

## REJECT

- Don't switch from Shape C to Shape A — helper extraction is the right call.
- Don't expand `BATCH_SIZE = 12` parameterization in this PR — defer per §9.
- Don't add journal migration code — `simulate_views` was never journaled.
- Don't gate this PR on `BATCH_SIZE` documentation either — one-line comment if convenient.
