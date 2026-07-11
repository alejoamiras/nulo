# Q-12 Implementation Plan

## Target Shape

Use descriptor objects plus shared machinery, with one generic runtime wrapper for `Fn` and one for `ViewFn`. Do not create nine new subclasses. The FPC model has `IFpcHandler` plus `getFpcHandler(type)` factory; Q-12 should be the same idea, but data-driven because token functions differ mostly by literals and some kinds have multiple impl variants.

File layout:

- `apps/extension/src/wallet/services/token/functions/types.ts`
- `apps/extension/src/wallet/services/token/functions/descriptors.ts`
- `apps/extension/src/wallet/services/token/functions/runtime.ts`
- `apps/extension/src/wallet/services/token/functions/index.ts`
- `apps/extension/src/wallet/services/token/functions/token-functions.characterization.test.ts`
- `apps/extension/src/wallet/services/token/functions/__fixtures__/aztec-token-artifact.json`

Descriptor shape:

```ts
export type TokenFnKind =
	| "getName"
	| "getSymbol"
	| "getDecimals"
	| "balanceOfPrivate"
	| "balanceOfPublic"
	| "transferPrivate"
	| "transferPublic"
	| "transferPrivateToPublic"
	| "transferPublicToPrivate"

export type TokenFnMode = "view" | "call"
export type CandidateSource = "functions" | "nonDispatchPublicFunctions"

export interface TokenFnVariantDescriptor {
	impl: number
	implName: string
	source: CandidateSource
}

export interface TokenFnScoringRules {
	exact: readonly [name: string, points: number][]
	defaultNames: readonly string[]
	partial(candidate: Fn & FnImpl): number
}

export interface TokenFnDescriptor<K extends TokenFnKind = TokenFnKind> {
	kind: K
	canonicalName: string
	selectedKey: keyof Token
	candidatesKey: keyof TokenInterface
	infoFlagKey?: keyof TokenInfo
	fnType: TokenFnMode
	variants: readonly TokenFnVariantDescriptor[]
	scoringRules: TokenFnScoringRules
	invalidImplMessage: string

	abiBuilder(name: string, impl: number): FunctionAbi
	candidatePredicate(fn: FunctionAbi, impl: number): boolean
	buildArgs(impl: number, ...args: TokenFnArgs[K]): unknown[]
	unpackResult?: (impl: number, result: Fr[]) => TokenFnResult[K]
}
```

Shared machinery:

- `TOKEN_FN_DESCRIPTORS` is the only kind list. `TokenFnKind` is derived from it or checked against it with `satisfies`.
- `createTokenFn(kind, name, impl)` finds the descriptor variant by explicit numeric `impl`; invalid impl throws the same current string, e.g. `"Invalid TransferPrivateImpl"`.
- `getTokenFnCandidates(kind, artifact)` iterates descriptor variants in declared order, iterates the exact source array in artifact order, applies the predicate, creates runtime fn objects, then sorts with only `score(b) - score(a)`.
- `getDefaultTokenFn(kind, candidates)` checks only `candidates.at(0)?.name` against `defaultNames`, matching today’s name-only default logic.
- `DescriptorViewTokenFn extends ViewFn`; `DescriptorCallTokenFn extends Fn`. There is no per-kind subclass.

Do not “improve” behavior while consolidating. Keep loose predicates where they are loose today: balance candidates check integer kind but not width/sign; transfer amount checks integer kind but not width/sign; transfer nonce accepts `authwit_nonce` or `_nonce` while ABI still emits `authwit_nonce`.

## Behavior-Preservation Proof

Add characterization tests before refactor. They should import the current nine classes and snapshot:

- ABI JSON for every current impl variant using `(fn as unknown as { abi(): FunctionAbi }).abi()`.
- Candidate output for every kind against a real Aztec token artifact: `name`, `impl`, `type`, `isStatic`, `returnTypes`.
- Default output for every kind against that same candidate set.
- Synthetic adversarial artifacts that exercise exact-name priorities, partial scores, duplicate names across variants, and score ties.

The real fixture source is already proven in `apps/extension/src/wallet/services/token/service.composition.test.ts`: it imports `TokenContractArtifact` from `@aztec/noir-contracts.js/Token` and uses it as the parse artifact. Freeze a JSON copy of that artifact under `functions/__fixtures__/aztec-token-artifact.json` so future Aztec package bumps do not silently rewrite Q-12 snapshots.

After introducing descriptors, change only the test harness from “old classes” to “registry API”; snapshots must remain unchanged. Use `JSON.stringify` snapshots for ABI objects so property order changes are caught. This matters because selectors derive from ABI name/parameters, and encode behavior derives from ABI shape.

Adversarial cases to pin:

- Metadata exact scores: bare `name/symbol/decimals` scores 102, private exact scores 101, public exact scores 100.
- Balance exact score is only canonical name at 100.
- Transfer exact names differ by kind: public has `transfer_public_to_public` 102 and `transfer_in_public` 100; private has 102/101/100; bridge directions have 101/100.
- Stable tie behavior: current result order is variant concatenation order plus artifact order, then stable sort by score only. No alphabetical tie-breaker, no dedupe.

## Nine-Kind Re-Threading

`service.ts` currently imports all nine classes and repeats candidate/default assembly in `getTokenInterface` and `parseTokenInterface`. Replace that with registry helpers:

- `getTokenInterface`: for each descriptor, compute candidates via `getTokenFnCandidates(kind, artifact).map(getImpl)` and read the stored selected key from `token[descriptor.selectedKey]`.
- `parseTokenInterface`: for each descriptor, compute candidates, default via `getDefaultTokenFn`, and assign `selectedKey` plus `candidatesKey`.
- `fetchTokenMetadata`: replace `GetNameFn.new`, `GetSymbolFn.new`, `GetDecimalsFn.new` with `createTokenFn("getName"...)`, etc.
- `OperationPlanner`: replace transfer class factories with a `TransferType -> TokenFnKind` mapping, then `createTokenFn(kind, stored.name, stored.impl)`.

`spec.ts` should preserve public field names. Do not force consumers to accept a map-shaped API. Internally, derive completeness and assembly from descriptor keys. `Token`, `TokenInterface`, and `TokenInfo` can remain explicit for readability/API stability, but add `satisfies` coverage checks so every descriptor has valid `selectedKey`/`candidatesKey` and every required kind participates in completeness.

`utils.ts`:

- `isTokenComplete(ti)` becomes `TOKEN_FN_DESCRIPTORS.every((d) => !!ti[d.selectedKey])`.
- `getTokenInfo(token)` uses `infoFlagKey` for the six capability booleans; metadata kinds have no flag.

`functions/index.ts` exports descriptor APIs. Keep compatibility `*Impl` const exports with explicit numbers during migration if any monorepo consumer still imports them. Delete the nine copy-paste modules after internal call sites are migrated and `rg` confirms no class imports remain.

## Phasing And Gates

1. Pin characterization tests.
   Gate: `bun run --cwd apps/extension test apps/extension/src/wallet/services/token`, existing composition test, and typecheck.

2. Add descriptor registry beside old modules.
   Registry must produce identical snapshots, but service still uses old modules.
   Gate: token characterization + `service.composition.test.ts`.

3. Migrate metadata kinds: `getName`, `getSymbol`, `getDecimals`.
   Gate: token unit/composition tests, metadata preview path smoke.

4. Migrate balance kinds.
   Gate: token units, token-balance tests if affected.

5. Migrate transfer kinds and `OperationPlanner`.
   Gate: operation-planner tests plus token characterization.

6. Re-thread `service.ts`, `spec.ts`, `utils.ts` from descriptor keys.
   Gate: `bun run typecheck`, `bun run --cwd apps/extension test`.

7. Delete old modules and compatibility classes.
   Gate: `rg` for old class names, full extension test, network smoke, then `bun run test:e2e:network` or the repo’s full network suite before merge.

## Decision Ledger

Chosen: descriptor registry plus shared runtime wrappers. This matches the FPC factory idea but avoids turning literal catalogs into nine thinner catalogs.

Rejected: base class plus nine subclasses. It preserves types but keeps the duplication and makes scoring/default drift likely.

Rejected: one flat descriptor per impl variant only. It loses kind-level scoring/default semantics; current scoring is per kind after concatenating variants.

Main risks:

- Changing impl numbers corrupts stored `FnImpl`.
- Changing variant order changes tie winners.
- Dedupe by name changes duplicate candidate behavior.
- Tightened predicates change candidate sets.
- Using `canonicalName` for default breaks accepted exact aliases.
- ABI helper reuse can change parameter names/order or function type.

## Assumptions

Facts:

- `FnImpl` stores only `name` and numeric `impl`; `Fn.getImpl()` recreates that pair in `wallet/utils/fn.ts:10-47`.
- `ViewFn` is the only special read wrapper; transfers use `Fn`, not a separate `CallFn`, in `wallet/utils/fn.ts:51-52`.
- The token barrel exports nine modules in `token/functions/index.ts:1-9`.
- `service.ts` repeats candidate/default assembly at `service.ts:322-371` and `service.ts:401-450`.
- Metadata simulation reconstructs function objects at `service.ts:497-499`.
- Token function fields are explicit in `spec.ts:17-25` and `spec.ts:61-104`.
- Completeness is currently a hand-written nine-field check in `utils.ts:18-27`.
- FPC uses an interface plus factory switch in `fpc/handlers/index.ts:9-27`.
- A real token artifact fixture already exists via `TokenContractArtifact` in `service.composition.test.ts:20`.

Inferences:

- Stored `impl` values may already exist in browser storage, so numeric compatibility is mandatory.
- `TokenInterface` field names are effectively API surface and should not become a map in this refactor.

Asks:

- Decide whether `./functions` class exports are public API. If yes, keep one-release compatibility shims; if no, delete them once monorepo imports are gone.