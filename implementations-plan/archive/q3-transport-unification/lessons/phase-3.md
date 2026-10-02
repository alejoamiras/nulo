# Phase 3 — Shared service core + RPC-surface guard + additive errorPayload

**Status:** ✓ complete. Standard gate + network both green (PR #121 run 27827688449 on d56c1d7, 8 network jobs ran+passed on latest-dev base).

## Execution summary

- `BaseService<TRequests, TEvents, TCtx>` (`src/core/base-service.ts`): owns envelope
  validation, the `rpcMethods`+`frameworkRpcMethods` guard, param unwrap (+ null-param
  clean error), invoke, `buildErrorResponseContent` (BOTH transports → offscreen
  `errorPayload` now wire-additive, D9), the unified 3-tier JSON-fallback send,
  emit, `awaitInitialized`. Transport seams = `subscribe`/`wrapResponse`/`rawSend`/
  `sendEvent`/`beforeInvoke`/`onSendDropped`. bg + offscreen `Service` are thin subclasses.
- `defineRpcMethods<Methods>()(...)` (`src/core/rpc-methods.ts`): exhaustiveness-checked
  (names must equal `keyof Methods`) so a missed registration won't compile.
- **Rolled out `rpcMethods` to all 21 bg services + PxeService (offscreen, in
  aztec-runtime) + 2 test doubles.** The exhaustiveness check validated every list
  as exact on the first typecheck (zero list errors). Negative tests assert
  `toString`/`constructor`/`start`/`emit`/public-non-RPC are rejected.
- **`frameworkRpcMethods = {backup, restore}` on bg `Service`** — these are live RPCs
  (full-backup import drives `restore` across ~10 services) NOT in their `Methods`
  types, so they can't be registered via `defineRpcMethods<Methods>` and must be
  allowed at the base. Caught BEFORE the rollout by auditing `.restore()` callers.

## Two traps caught + fixed

1. **`subscribe()` from the base ctor** ran before the subclass's arrow-function
   listener fields existed → `addListener(undefined)`. Moved the `subscribe()` call
   into each transport subclass's own ctor (after `super()` + its field inits).
2. **Vitest-4 mock construct (incoming-transfer scenarios).** The service does
   `new IncomingTransferRepository()`; the test mocked it as `vi.fn(() => ({...}))`
   — an ARROW impl, which Vitest 4 refuses to `new` ("did not use function or
   class"). Passed at P2, broke at P3 because the service-core import-graph change
   perturbed Vitest's construct tolerance. PRODUCTION CODE IS CORRECT — only the
   test mock was fragile. Fixed with a constructable `class` mock (Biome rewrites a
   `function` impl back to an arrow, so `class` is the `--write`-safe form; the
   `noConstructorReturn` suppression sits directly above the `return`). Flag for the
   post-impl audit: this is a test-infra change made to accommodate the refactor —
   verified it doesn't mask any production regression (the fake repo returns the
   same in-memory data; the 50 scenarios still pass).

## Gate

- extension-messaging test **103**; typecheck clean.
- extension test **2530** (+12 over P2: D10 negatives + service-test additions); vue-tsc clean.
- aztec-runtime test **32** (PxeService); typecheck clean.
- `bun run lint` → **exit 0**.
- Network leg: runs on the P3 push.

## Codex consult — D10 RPC-surface guard design (xhigh, session 019edfda-…)

**Question:** for the callable-any-method fix, which is the right minimal-churn-but-robust approach — (A) explicit per-service registry, (B) computed prototype surface (own methods below BaseService), or (C) hybrid?

**Verdict: A** (explicit per-service `rpcMethods`). `B` is NOT audit-grade. Reasoning I accepted:
- B's residual is bigger than "private helpers": it also exposes **public non-RPC composition methods already in the repo** — `TaskService.createNewTask/completeTask`, `NetworkService.getNode/purgeChain/reportEndpointFailure`. A much larger surface.
- B is **fail-open**: any future helper on a concrete service silently becomes remotely callable. A is **fail-closed**: a new RPC breaks until registered.
- The control objective (even under the first-party threat model) is "reduce post-compromise authority." B mostly removes Object.prototype/framework accidents; it does NOT freeze the intended RPC API.
- No cleaner runtime-precise source exists (the `Methods` types are erased).
- Prototype-walk traps that make B brittle anyway: must use `getOwnPropertyDescriptor(proto, m)?.value` is-function (reject accessors/getters), skip `"constructor"`, stop before BaseService.prototype; and class-field/arrow methods are own INSTANCE props (B misses them → refactor-sensitive).

**Codex's "what I'd ship":** explicit per-service `rpcMethods` via a tiny typed helper `defineRpcMethods<Methods>()("getTask","getTasks")` (compile-time checked) + a negative test rejecting `toString`, `createNewTask`, `purgeChain`.

**Decision:** implement A. This is exactly plan D10 ("explicit registered-method surface"). To make the 21-service rollout SAFE, the helper enforces **exhaustiveness** (names must equal `keyof Methods`) so `vue-tsc` errors on any missed method — a missed registration can't silently break a production RPC. Cost: ~2 lines per concrete service across the extension; in-scope per D10.

## Plan

1. `src/core/rpc-methods.ts` — `defineRpcMethods` (subset + exhaustiveness checked).
2. `src/core/base-service.ts` — unified `BaseService`: envelope validation, the `rpcMethods` guard, param unwrap (+ null-param clean error), invoke, `buildErrorResponseContent` (now BOTH transports → offscreen errorPayload becomes wire-additive, D9), result sanitize, unified 3-tier JSON-fallback send, emit, `awaitInitialized`.
3. Rewrite bg + offscreen `Service` as thin subclasses (transport seams: bg onConnect/Port; offscreen onMessage/from-to/keepalive).
4. Roll out `rpcMethods` to all 21 bg services + the offscreen service.
5. Negative test (toString / a public composition method / unknown rejected); update the offscreen-service error pin (now emits errorPayload — D9 additive).
