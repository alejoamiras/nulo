# Draft plan (codex, xhigh) — wallet-bridge MethodDescriptor registry (Q1)

> One of three independent `deep` drafts. Cross-family (codex). Captured from `response.md`.

## Descriptor shape
Flat `Record<methodName, MethodDescriptor>` in a new `packages/wallet-bridge/src/method-descriptors.ts`.
- Shape: `{ capability XOR exempt, kind?, context?, scopeCheck?, audit? }`.
- Reason: the surface is orthogonal, not a clean union. `getChainInfo` = exempt + kind + no scope; `requestCapabilities`/`batch` = exempt-only; `getAccounts`/`isTokenRegistered`/`grantPublicAuthwit` = capability-gated, no kind; `registerToken` = capability-gated, no kind, no scope-checker today.
- Keep `context` per-method (METHOD_TO_KIND is 1:1; a separate kind-registry recreates the smell).
- No DSL/builder — this is a security seam; reviewers need one literal row per method, not metadata behind helpers.

**Cycle break:** extract the real checker helpers + bodies into a NEW LEAF module `packages/wallet-bridge/src/method-scope-checkers.ts` (from scope-enforcement.ts:31). The registry imports named checkers from the leaf; `capability-map.ts`, `scope-enforcement.ts`, and the dispatcher kind maps become thin facades over the registry. No cycle (leaf ← descriptors ← facades).

**The win:** a new method = one descriptor row for authz/routing facts. Only a NEW operation kind also needs the kind-keyed build switch (out of scope).

## Phases
1. **Shadow registry + parity harness BEFORE the swap.** Add `method-descriptors.ts` + `deriveCapabilityMap()`/`deriveMethodToKind()`/`deriveKindContextSets()`/`deriveMethodScopeChecker()`. **Lift anonymous checker lambdas into named functions** (`sendTx`/`simulateTx`/`profileTx`, scope-enforcement.ts:384) so parity can compare by reference. Add `method-descriptors.test.ts` with a frozen 18-method normalized surface (`capability`, `exempt`, `kind`, `context`, `hasScopeCheck`, `audit`) encoding current partial shapes EXACTLY (incl. `registerToken` no-scope-row, `requestCapabilities`/`batch` no-kind). Gate: `bun run --filter @nulo/wallet-bridge typecheck` + `test`. Pass: shadow reproduces all six tables; F1/F-003/F-004/F-005 tests stay green.
2. **Swap production to derived tables.** Replace `EXEMPT_METHODS`/`METHOD_CAPABILITY_MAP` (capability-map.ts:18), `METHOD_TO_KIND`/`NETWORK_ONLY_KINDS`/`ACCOUNT_KINDS` (dispatcher.ts:251), `METHOD_SCOPE_CHECKER` (scope-enforcement.ts:379) with derived exports; keep `enforceScope`/`enforceScopeWithSession` stable. **Resolve the descriptor at the TOP of `dispatch()` before any special-case branch** so "supported but missing metadata" is impossible (dispatcher.ts:316); keep popup/meta/reader branches unchanged. DELETE stale sync comments (scope-enforcement.ts:9, dispatcher.ts:987, scope-enforcement.ts:406). Gate: `typecheck` + `test` + `bun run lint`. Pass: no hardcoded parallel registries remain; reachability/routing tests for registerToken/isTokenRegistered/grantPublicAuthwit/batch/retired-methods green.
3. **Conditional bug-fix lane.** If parity surfaces a genuine bug: pin old behavior → fix descriptor row → corrected test → preserve/update F1/F-00x marker. Already-classified example: grantPublicAuthwit's transaction-cap row (F1). **Non-example: registerToken lacking METHOD_SCOPE_CHECKER is NOT a bug** — its session-account authz is inline in handleRegisterToken() (dispatcher.ts:593). Gate: `typecheck` + `test`. Pass: every intentional change auditably labeled + paired old/new tests.
4. **Full-stack validation.** `bun run typecheck:all` + `lint` + `test` + `test:e2e` + `e2e:agent`. Pass: all green.

## Security & Adversarial
- Threat: malicious dApp finds a method reachable in `dispatch()` but absent from one authz table (the F1 class: `getRequiredCapability()` null → `enforceCapability()` [] → scope never runs; dispatcher.ts:324,1003).
- **Core invariant: every supported method row has exactly ONE of `capability` or `exempt`. Anything else is an authz hole.**
- Trust nothing "because dispatcher is trusted" — scope is per-message, dispatcher is the chokepoint (README.md:197,204).
- Keep runtime-free; no new aztec-runtime coupling.

## Assumptions
- **Facts:** six registries split across the 3 files; special routing real for requestCapabilities/getAccounts/isTokenRegistered/batch/sendTx/registerToken/grantPublicAuthwit; checker closures live with helpers in scope-enforcement.ts:31.
- **Inferences:** flat record safer than DU (no clean partition axis); leaf checker module is the cleanest cycle-avoidance.
- **Asks:** optional README cleanup in same PR (today documents only registerToken as custom RPC; runtime patch exposes three customs).

## Adversarial self-review
- Weakest assumption: per-method `context` only works while method→kind stays 1:1. If a future method reuses a kind with different context, add a failing invariant test + explicit exception, don't silently widen.
- Highest-risk edge: accidentally "improving" registerToken or popup paths during the refactor. Keep inline authz where it is unless separately audited.
- Main win: once `dispatch()` resolves a descriptor before routing, a method can't be supported in one place and silently omitted from METHOD_CAPABILITY_MAP elsewhere.
