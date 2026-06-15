# Phase 1 — Shadow registry + harness (additive)

## Outcome — ✓ (2026-06-15, commit `4ee43a8`)
- **147 tests pass** (134 existing UNCHANGED + 13 new in `method-descriptors.test.ts`).
- Parity EXACT: `deriveCapabilityMap/ExemptSet/MethodToKind/NetworkOnlyKinds/AccountKinds` deep-equal the frozen snapshots; `deriveScopeCheckerMap` keys === the 14 names + each checker identical by reference.
- Exhaustiveness green: 18 patched-`WalletSchema` keys ↔ 18 descriptors (forward + reverse); 7 dispatch handler literals all have descriptors; scope-or-note invariant holds.
- `typecheck:all` ✓, `lint` ✓.

## What landed
- `method-scope-checkers.ts` (NEW leaf): checker bodies + helpers moved out of scope-enforcement.ts; 3 inline arrows lifted into named `checkSendTx`/`checkSimulateTx`/`checkProfileTx`.
- `method-descriptors.ts` (NEW registry): `CapabilityType` (relocated), `NetworkOperationKind`/`AccountOperationKind` route-narrowed sub-unions (with `AssertExtends` compile proofs), `MethodRouting` discriminated union, `MethodDescriptor`, `METHOD_REGISTRY` (18 rows), six `derive*` fns + pre-computed exports.
- `scope-enforcement.ts`: rewired to import the leaf checkers; `enforceScope`/`enforceScopeWithSession`/`validateAccountScopes` unchanged → behavior-preserving (proven by the 134 staying green).
- `capability-map.ts`: `CapabilityType` now `import type` + re-export from the registry (D4 back-edge fix); its own `METHOD_CAPABILITY_MAP` literal still present (Phase 2 deletes it).

## Decisions / notes
- The leaf extraction (D4) touches scope-enforcement.ts in Phase 1 — but it's a behavior-preserving internal move (same checker bodies, same `enforceScope`), so the 134 staying green is the proof. Not a "consumer rewire" (that's Phase 2: deleting the literals + pointing facades at the derived maps).
- The route-narrowed kinds (D2) compiled clean — `AssertExtends<NetworkOperationKind, OperationKind>` confirms they're valid subsets. A future kind rename in operation.ts that misses these will fail typecheck.
- `getAccounts` non-exempt is explicitly pinned in the new test (guards the stale dispatcher.ts:987 comment from re-creating the F1-class hole during Phase 2's comment cleanup).
- Parity is EXACT on first derivation — strong early signal that Phase 2's swap will be a true zero-change, and Phase 3 (latent-bug lane) is likely a no-op as the matrix predicted.

## Next (Phase 2)
- Point `capability-map.ts` (getRequiredCapability/isCapabilityExempt) + `dispatcher.ts` (METHOD_TO_KIND/NETWORK_ONLY_KINDS/ACCOUNT_KINDS) + `scope-enforcement.ts` (METHOD_SCOPE_CHECKER) at the registry-derived exports; DELETE the six literals.
- Add the dispatch-entry descriptor guard (after session capture :322, before enforceCapability :326; replace the `if(!kind)` at :392), preserving the `Unsupported wallet method` string (pinned by dispatcher.test.ts:813/817/824).
- Delete dead sync comments (scope-enforcement.ts:9,:406); CORRECT the wrong getAccounts-exempt comment (dispatcher.ts:987).
- Zero-change gate: all 147 green UNCHANGED.
