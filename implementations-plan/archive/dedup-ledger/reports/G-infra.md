# Cluster G — infra services + wallet runtime

## Cluster verdict

This cluster is noticeably tighter than the "verbose LLM slop" prior would predict: `runtime.ts`'s composition root is already a flat sequence of `services.add(new X(...))` calls with no boilerplate to factor out, the backup-migration engine (`backup-migration-registry.ts`, `row-map-migration.ts`) is dense but each function does genuinely distinct work under an explicit security/idempotency invariant, and most files sit well inside the complexity budget with only three pre-accepted `biome-ignore` functions (all in the backup DSL, all clearly essential-complexity). The single biggest lever is the hand-rolled `validateParams`/`request`/`validateResult` triplet repeated 16 times in `NetworkServiceClient` (and mirrored once per method in `NetworkService`) — a mechanical pattern the codebase already has infrastructure to collapse (`definePassthroughsExhaustive`), just not applied here because this client also validates. Total realistically removable: **roughly 45–50 lines** across three concrete, low-risk edits; there is no large dead-code or copy-pasted-service finding in this cluster.

## Findings

### F1 [duplication] `NetworkServiceClient` repeats the same validate→request→validate triplet 16 times

- **Where:** `apps/extension/src/wallet/services/network/client.ts:35-134` (16 method bodies), mirrored server-side once per method (15 of 16) in `apps/extension/src/wallet/services/network/service.ts` (e.g. lines 310, 391, 399, 410, 419, 433, 463, 479, 532, 550, 595, 643, 665, 684, 700).
- **Evidence:**
  ```ts
  // client.ts:41-45
  public async getNetworks(chainId?: number): Promise<Network[]> {
      validateParams(NetworkMethodSchemas.getNetworks.params, [chainId], "getNetworks")
      const result = await this.request("getNetworks", chainId)
      return validateResult(NetworkMethodSchemas.getNetworks.result, result, "getNetworks")
  }
  ```
  ```ts
  // client.ts:124-128 — identical shape, different name
  public async getNodeStatus(networkId: string): Promise<NodeStatus> {
      validateParams(NetworkMethodSchemas.getNodeStatus.params, [networkId], "getNodeStatus")
      const result = await this.request("getNodeStatus", networkId)
      return validateResult(NetworkMethodSchemas.getNodeStatus.result, result, "getNodeStatus")
  }
  ```
  16 occurrences confirmed via `grep -c "validateParams(NetworkMethodSchemas" client.ts` → 16, `validateResult(NetworkMethodSchemas` → 16. This is the ONLY client in the whole `services/` tree that hand-rolls this shape — every other client (`FpcServiceClient`, `LogViewerServiceClient`, and 14 more outside this cluster) uses `definePassthroughsExhaustive` from `packages/extension-messaging/src/core/service-client-factory.ts`, whose own doc comment says: *"That body is identical across ~110 methods in ~18 clients — pure boilerplate whose only per-method content is the name."* `NetworkServiceClient` can't use that helper as-is because it additionally validates params/results (the helper is a bare passthrough), so the validation shape was hand-written instead — but the validation shape itself is exactly as repetitive as the thing the helper exists to kill.
- **Refactor:** Add one private generic method to `NetworkServiceClient`:
  ```ts
  private async call<K extends keyof Methods>(method: K, params: Parameters<Methods[K]>): Promise<ReturnType<Methods[K]>> {
      const schema = NetworkMethodSchemas[method]
      validateParams(schema.params, params, method)
      const result = await this.request(method, ...params)
      return validateResult(schema.result, result, method) as ReturnType<Methods[K]>
  }
  ```
  Each of the 16 methods becomes a 1-line body, e.g. `getNetworks(chainId?: number) { return this.call("getNetworks", [chainId]) }`. Lives in `apps/extension/src/wallet/services/network/client.ts` only (no cross-package change). The identical `validateParams(NetworkMethodSchemas.X.params, [...], "X")` line repeated 15× server-side in `service.ts` is the same root pattern but each call site does materially different work afterward, so it isn't worth collapsing there beyond noting it's the same schema-lookup-by-method-name idea.
- **LOC delta:** ≈ **-26** (16 methods × -2 lines each = -32, +6 for the new helper).
- **Risk / tests:** low–medium. `apps/extension/src/wallet/services/network/service.test.ts` (1438 lines) exercises the service extensively, but there is no dedicated `network/client.test.ts` asserting the client's validation-throw behavior directly — coverage of the client boundary is indirect (composable/component tests that typically stub the client rather than exercise real validation). Recommend adding one small test asserting a bad param throws `ValidationError` through `call()` if this is taken.
- **Confidence:** high.

### F2 [duplication] `LoggerStore.log()` fully duplicates `logWithContext()` with a hardcoded context

- **Where:** `apps/extension/src/wallet/logger/store.ts:53-69` (`log`) and `:72-88` (`logWithContext`).
- **Evidence:**
  ```ts
  // store.ts:53-69
  public log(source: string, level: LogLevel, ...data: unknown[]): void {
      if (level < this.logLevel) {
          return
      }
      const log: Log = {
          id: this.nextId++,
          timestamp: Date.now(),
          source,
          level,
          context: "sw",
          data: trim(data) as unknown[],
      }
      this.logs.add(log)
      this.scheduleFlush()
      this.onLog.invoke(log)
      print(log)
  }
  ```
  ```ts
  // store.ts:72-88
  public logWithContext(context: string | undefined, source: string, level: LogLevel, ...data: unknown[]): void {
      if (level < this.logLevel) {
          return
      }
      const log: Log = {
          id: this.nextId++,
          timestamp: Date.now(),
          source,
          level,
          context: (context as Log["context"]) ?? "sw",
          data: trim(data) as unknown[],
      }
      this.logs.add(log)
      this.scheduleFlush()
      this.onLog.invoke(log)
      print(log)
  }
  ```
  Every line is identical except the `context:` field — `logWithContext(undefined, ...)` produces exactly `context: "sw"`, i.e. `log()`'s entire body is a special case of `logWithContext`'s.
- **Refactor:** Replace `log()`'s body with a one-line delegate: `this.logWithContext(undefined, source, level, ...data)`. No new abstraction is introduced (both methods already exist and are both part of the public `ILoggerStore`/RPC surface); this just removes the copy.
- **LOC delta:** **-13** (`log()` shrinks from a 16-line body to a 3-line one).
- **Risk / tests:** low. `apps/extension/src/wallet/logger/store.test.ts` has direct coverage for both `log()` (many call sites, e.g. lines 71, 85-86, 98) and `logWithContext()` (lines 149-167, including the "defaults to sw when context is undefined" case at line 158-163, which is exactly the equivalence this refactor relies on).
- **Confidence:** high.

### F3 [duplication] `simulate()` builds the identical `FunctionCall` twice, once per branch

- **Where:** `apps/extension/src/wallet/utils/fn.ts:68-92`.
- **Evidence:**
  ```ts
  // fn.ts:68-79 (UTILITY branch)
  if (viewFn.type === FunctionType.UTILITY) {
      const call = new FunctionCall(
          viewFn.name, contractAddress, fnSelector, viewFn.type, false, viewFn.isStatic, encodedArgs, viewFn.getReturnTypes(),
      )
      const { result } = await pxe.executeUtility(call, { scopes: [account.address] })
      return viewFn.unpackResult(result)
  }

  // fn.ts:83-92 (fallthrough) — byte-identical constructor call
  const call = new FunctionCall(
      viewFn.name, contractAddress, fnSelector, viewFn.type, false, viewFn.isStatic, encodedArgs, viewFn.getReturnTypes(),
  )
  ```
  (Line breaks collapsed above for the diff; the actual file spells the 8 args one per line, identically, in both places.) The `call` value doesn't depend on which branch is taken — only what's done with it afterward differs.
- **Refactor:** Hoist the single `const call = new FunctionCall(...)` above the `if (viewFn.type === FunctionType.UTILITY)` check, delete the duplicate inside the branch. Pure control-flow tidy, zero behavior change, all in `apps/extension/src/wallet/utils/fn.ts`.
- **LOC delta:** **-9**.
- **Risk / tests:** low. No dedicated `fn.test.ts`, but `simulate()` is exercised indirectly through `apps/extension/src/wallet/services/token/service.test.ts` and `service.composition.test.ts` (both call through `TokenService` view-function reads). The change is a mechanical hoist with identical runtime output for both branches, so regression surface is minimal.
- **Confidence:** high.

## Not worth it

- **`NetworkService.addEndpoint` / `updateEndpoint`** share an identical 8-line chain-mismatch check (`ERR_ENDPOINT_CHAIN_MISMATCH` double-if) — real duplication, but only 2 occurrences at 8 lines each, under the "twice-only needs >20 lines/copy" bar. Noted, not proposed.
- **`NetworkService.getNodeStatus` / `probeNodeStatus`** share a ~6-line preamble (ensureInitialized → requireActiveProfile → requireOwnedRow → primary-endpoint lookup) — same twice-only / under-20-lines situation. Skipped.
- **`FpcService.getFpcs`'s discovery-failure catch** logs the same error at both `logWarn` and `logError` back-to-back (`service.ts:189-190`) — likely a leftover from a level change, but it's 2 lines, occurs once, not worth a ranked finding.
- **`DefaultSponsoredFpcHandler` / `PrivateFpcHandler`** share the `getFeePayload`/`getTeardownGas` shape — only 2 handlers, each well under 20 duplicated lines; the interesting logic (`validateArtifact`, `getTotalGas`) is genuinely handler-specific.
- **Zod schema (`NetworkMethodSchemas`) + hand-written `Methods` type declaring the same signatures twice** — looks like the "interface re-declaring a type that already exists upstream" smell, but this is a deliberate, documented, repo-wide pattern (`packages/extension-messaging/src/zod-helpers.ts`: *"Schemas live next to the types they describe, not here"*), used identically by every other service in the app, not specific to this cluster. Not proposing a cross-cutting architecture change here.
- **`PxeServiceClient`'s re-export shim** (`services/pxe/client.ts:48-51`, forwarding `@nulo/aztec-runtime/pxe`'s public surface) reads like a stale compat shim, but 17 non-test files still import through `@/wallet/services/pxe/client` specifically — it's live, not dead.
- **`ConfigServiceClient` hand-rolling `request()` calls** instead of `definePassthroughsExhaustive` (unlike `FpcServiceClient`/`LogViewerServiceClient` in the same cluster) looked like an inconsistency, but `Methods.getValue`/`setValue` are generic (`<TKey extends ConfigKey>`), and `MethodsSpec<T>`'s `Parameters<T[M]>`/`ReturnType<T[M]>` mapped type collapses that generic to a `ConfigKey`-union signature, which would lose per-key type inference for every caller (`getValue("theme")` would stop inferring `boolean`). The hand-written version is the correct, deliberate choice.
