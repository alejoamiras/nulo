# P20 / Q-02 — typed RPC dispatch

**Tier:** mega-deep, dApp TRUST BOUNDARY (registry cluster P15/P18/P19/P20).
**Status:** BLUEPRINT CONSOLIDATED (main + codex `bg0v9z0zg`... `Bemq2IzR` + Explore `a2c51354`; opus env-blocked). **Verdict: PARTIALLY REMEDIATE — minimal oracle-safe entry scaffolding; DEFER the high-value arg-tuple typing (HALT-blocked).** Impl on `dev-quality` HEAD `f2d0e5b`.

## Finding
"Untyped RPC Dispatch." `MethodsMap = Record<string,(...args:any[])=>unknown>` is LOCALLY JUSTIFIED (variance constraint). The smell is downstream: `WalletSdkDispatcher.dispatch(methodName:string, args:unknown[])` hand-indexes `args[N] as X` in handlers/builders/scope-checkers; `BaseService.invoke` does `(this as Record<string,fn>)[method](...params)`.

## STEP 1 (verified HEAD f2d0e5b — casts persist)
`dispatcher.ts:334` dispatch + `args[N] as` (387/396/408/568/593/…); `method-scope-checkers.ts` positional casts; `scope-enforcement.ts:82` enforceScopeWithSession arg-indexing; `base-service.ts:125` dynamic invoke.

## Two SEPARATE dispatch boundaries (Explore — do not conflate)
1. **dApp TRUST BOUNDARY** = `WalletSdkDispatcher.dispatch` (dispatcher.ts:334), entered from wallet-sdk/background.ts:637. NOT a BaseService. ALL the `args[N] as X` hand-indexing is here.
2. **extension-internal service RPC** = `BaseService.invoke` (base-service.ts:125), guarded by the `rpcMethods` allowlist (a DIFFERENT, already-fail-closed, compile-time-checked mechanism via `defineRpcMethods`). No `args[N]` casts here (params flow as `unknown[]` into the concrete method).

## The dispatch is ALREADY well-guarded (Explore — this shrinks the finding)
- Entry guard `dispatcher.ts:352` `if (!Object.hasOwn(METHOD_REGISTRY, methodName)) throw` — fail-CLOSED, upstream, rejects prototype names.
- The permissive `enforceCapability` `return []` (`:1029`) is NEUTRALIZED: unreachable for unknown (entry guard threw) + for registry methods (D7 XOR invariant — every non-exempt method has a non-null capability, pinned by `method-descriptors.test.ts:181`).
- Derived scope-checker map (`deriveScopeCheckerMap`); `enforceScope` reaches `enforceScopeWithSession(methodName, args, ...)` before routing.
- Frozen oracle pins capability/exempt/kind maps by VALUE + the 15 scope checkers BY REFERENCE (`.toBe` identity, `:154`). Exhaustiveness tests (`:206-250`) kill silent method-omission.

## THE HALT constraint (Explore — decisive for scope)
An `RpcRequest` union that only READS existing descriptor fields (capability/scope/routing) is ORACLE-SAFE. But the finding's HIGH-VALUE fix — typing the `args[N]` to catch arg-reorder/signature-drift — needs per-arg SCHEMA/arity, which is NOT a descriptor field. Adding `popupGated`/`batchAllowed`/arg-schema fields to `MethodDescriptor` changes the structural invariants the frozen oracle asserts (D7 XOR, kind-partition, exhaustiveness) → **editing the frozen authz oracle = HARD-LIMIT HALT.** So the valuable arg-typing is HALT-blocked; it cannot land without an owner decision to change the oracle.

## Scope (codex-adjudicated: "risk > payoff for the full refactor")
- **P20a (this phase) — minimal, oracle-safe:** derive `MethodName`/`RpcRequest` TYPES from the existing `METHOD_REGISTRY` surface (LAYER from it, never re-derive); narrow `methodName` → `MethodName` at the dispatch entry AFTER the `Object.hasOwn` guard; a fail-closed `toRpcRequest` choke point (NO permissive default, NO `as keyof` at the boundary, THROW on any registry-method-without-a-typed-row — but since the union is DERIVED from the registry this is automatic/exhaustive). + an exhaustiveness assertion that every `METHOD_REGISTRY` method has an `RpcRequest` representation. Reads existing fields ONLY → frozen oracle byte-UNEDITED. Keep passing `request.args` to the EXISTING enforceScope/handlers/builders (security path unchanged). **This is "typed method discrimination + a central choke point" — modest value, but oracle-safe + behavior-preserving.**
- **DEFERRED (HALT-blocked / risk>payoff):** (a) typed arg TUPLES replacing `args[N] as X` in handlers/builders/scope-checkers — needs per-arg schema = new descriptor fields = oracle change = HALT (owner decision); (b) `popupGated`/`batchAllowed` as descriptor fields (same); the hardcoded batch-forbidden `{sendTx,registerToken}` + implicit popup-gating (which also covers grantPublicAuthwit/requestCapabilities — an ASYMMETRY noted) stay as-is.

## Fail-open PINS (preserve — security invariants)
- batch-forbidden `{sendTx, registerToken}` (`handleBatch:540`, hardcoded) UNCHANGED.
- entry guard (`:352`) strictly UPSTREAM of the permissive `return []` (`:1029`).
- every method KEEPS its scope checker; a no-checker method = `enforceScope` silently returns = unenforced (`scope-enforcement.ts:62-64`) — the exhaustiveness test (`method-descriptors.test.ts:233`, non-exempt ⟹ scopeCheck OR in `SCOPE_EXEMPT_BY_DESIGN={registerToken}`) guards this.

## Oracle / trust-boundary proof
Frozen `method-descriptors.test.ts` FROZEN_* byte-UNEDITED (git diff --exit-code) — if P20a ever needs to edit it → HALT. wallet-bridge adversarial-bypass (159) + dispatcher.test.ts + scope-enforcement.test.ts green UNEDITED. NEW: an exhaustiveness assertion that every registry method has an `RpcRequest` type row (drift guard for the entry layer).

## Assumptions
- Facts: Explore `a2c51354` surface map (HEAD f2d0e5b) — the dispatch flow, the two boundaries, the 19-method matrix, the frozen-oracle pin surface, the HALT constraint.
- Inferences: (a) narrowing methodName post-guard is behavior-preserving (compile-time only); (b) an RpcRequest union derived from METHOD_REGISTRY needs no new descriptor fields → oracle-safe.
- Asks (SURFACE to owner): the high-value arg-tuple typing requires editing the frozen authz oracle (new descriptor fields) — an owner call, not autonomous. Documented as deferred.

## Ordered steps (P20a)
1. `MethodName`/`RpcRequest` types derived from `METHOD_REGISTRY`; the fail-closed `toRpcRequest` choke point. Gate: wallet-bridge units + typecheck:all.
2. Wire `toRpcRequest` at the dispatch entry (post-guard narrowing); args flow UNCHANGED to enforceScope/handlers/builders. Gate: dispatcher.test.ts + scope-enforcement.test.ts + the exhaustiveness assertion + frozen oracle byte-UNEDITED (git diff --exit-code).
3. Per-arc tail: `/code-review max --fix` → codex post-impl audit → fix loop.
4. Gate PR `qa/Q-02-typed-dispatch-entry`: frozen oracle UNEDITED + adversarial-bypass + units + smoke + full network → plain squash-merge (no --admin).
5. Re-run P15 adversarial-bypass + frozen oracle vs new HEAD (registry-cluster).
   Arg-tuple typing / descriptor-field additions = DEFERRED (owner decision on oracle change).

## Decision ledger (codex Bemq2IzR + Explore a2c51354)
- **scope** → P20a = minimal oracle-safe entry scaffolding (RpcRequest types + methodName narrowing + choke point); end-to-end arg-tuple typing DEFERRED (HALT-blocked). "Partially remediated."
- **HALT constraint** → arg-typing / popup-gated / batch-allowed as descriptor fields would edit the frozen oracle → HALT (owner decision). Do NOT.
- **fail-closed** → registry-method-missing-row throws; keep `Object.hasOwn` guard; no permissive default; no `as keyof` at boundary.
- **oracle** → LAYER types from METHOD_REGISTRY, never re-derive; byte-UNEDITED or HALT.
- **security path** → unchanged: enforceScope(methodName,args) before routing; scope checkers + their arg-access untouched in P20a.
- **value note** → the dispatch is already well-guarded (entry guard + D7 XOR + derived checker map + frozen oracle + exhaustiveness); P20a is modest (typed discrimination + drift guard); the finding's own evidence says MethodsMap is locally justified.
