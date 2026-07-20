# Q-12 — collapse the 9 token-function copy-paste catalogs into a `TokenFnDescriptor` registry · tier: **mid**

**Re-verify (STEP 1, vs `dev-quality` `4906f0f`):** VALID. The 9 modules in `token/functions/` each repeat `enum <Fn>Impl{Default}` + `abstract <Fn>Fn extends ViewFn|Fn` (buildArgs / static new / getCandidates-scoring / getDefault) + `Default<Fn>Fn` (abi literal / unpackResult / getCandidates-predicate). `service.ts:322-371,401-450` repeats 9 verbatim `<Fn>Fn.getCandidates(artifact).map(x=>x.getImpl())` blocks; `spec.ts:17-25,61-104` + `utils.ts:18-27` re-thread the 9-kind set.

## Decision ledger (codex leg `7yfBihLE` — [plan-leg-codex.md](./plan-leg-codex.md) — + main verification; opus leg glitched 0-tool-uses, discarded)
Main verified every codex claim against the code (all Facts confirmed): fixture source, ViewFn/Fn base, external consumers.

- **Descriptor objects + TWO shared runtime wrappers** (`DescriptorViewTokenFn extends ViewFn`, `DescriptorCallTokenFn extends Fn`), **NOT 9 subclasses, NOT a base-class-per-kind.** The fpc/handlers model (`IFpcHandler` + `getFpcHandler(type)`) is the analog, but token variation is DATA (name/scoring/abi/predicate/args) → a descriptor TABLE, not 9 thinner catalogs. `TOKEN_FN_DESCRIPTORS` is the single kind list; `TokenFnKind` derived/`satisfies`-checked against it.
- **File layout:** `token/functions/{types,descriptors,runtime,index}.ts` + `token-functions.characterization.test.ts` + `__fixtures__/aztec-token-artifact.json`.
- **Shared machinery:** `createTokenFn(kind,name,impl)` (invalid impl throws the SAME current string e.g. `"Invalid TransferPrivateImpl"`), `getTokenFnCandidates(kind,artifact)` (iterate variants in declared order → source array in artifact order → predicate → sort by `score(b)-score(a)` ONLY), `getDefaultTokenFn(kind,candidates)` (name-only `candidates.at(0)?.name` vs `defaultNames`).

## Behavior-preservation — THE risky part (a wrong ABI/mis-scored candidate = wallet calls the WRONG token fn: mis-read balance / mis-routed transfer)
- **Characterization test FIRST (P13.1), snapshot BEFORE refactor, keep green after:** for all 9 kinds snapshot (a) `abi()` JSON per impl variant, (b) `getCandidates(REAL artifact)` output (`name/impl/type/isStatic/returnTypes`) in order, (c) `getDefault` output; + synthetic adversarial artifacts (exact-name priority, partial scores, duplicate names across variants, score ties). Use `JSON.stringify` snapshots (catch property-order changes — selectors + encode derive from ABI shape). After the refactor, change ONLY the harness (old classes → registry API); snapshots MUST be byte-identical.
- **Fixture (verified):** `TokenContractArtifact` from `@aztec/noir-contracts.js/Token` (already used at `service.composition.test.ts:20`). FREEZE a JSON copy under `__fixtures__/` so an Aztec bump can't silently rewrite the Q-12 snapshots.
- **PRESERVE verbatim (codex, all real): impl NUMBERS** (stored in browser storage as `FnImpl.impl` → numeric compat MANDATORY), **variant ORDER** (tie winners), **NO dedupe**, **loose predicates stay loose** (balance checks integer kind not width/sign; transfer amount same; transfer nonce accepts `authwit_nonce` OR `_nonce` while ABI emits `authwit_nonce`), **exact scores** (metadata bare 102 / private 101 / public 100; balance canonical 100; transfer public `transfer_public_to_public` 102 / `transfer_in_public` 100; private 102/101/100; bridge 101/100). Do NOT "improve" while consolidating.

## Re-threading scope (verified — includes EXTERNAL consumers)
`service.ts` (`getTokenInterface`/`parseTokenInterface`/`fetchTokenMetadata:497-499`) → registry helpers. `spec.ts` keep public field names (`Token`/`TokenInterface`/`TokenInfo` stay explicit for API stability) + add `satisfies` coverage so every descriptor has valid `selectedKey`/`candidatesKey`. `utils.ts` `isTokenComplete` → `TOKEN_FN_DESCRIPTORS.every(d=>!!ti[d.selectedKey])`; `getTokenInfo` uses `infoFlagKey`. **EXTERNAL (main-verified, beyond codex's service.ts focus):** `execution/operation-planner.ts` (transfer class factories → `TransferType→TokenFnKind` map + `createTokenFn`) + `token-balance/balance-projector.ts` import from `./functions` too — both must migrate. `rg` for old class names before deleting the 9 modules.

## Phasing (each behavior-preserving + independently gated: token units + characterization snapshot + smoke + FULL network)
1. **P13.1** pin characterization tests (frozen artifact + adversarial synthetics). No refactor.
2. **P13.2** add descriptor registry ALONGSIDE old modules (registry reproduces every snapshot; service still uses old).
3. **P13.3** migrate metadata kinds (getName/getSymbol/getDecimals).
4. **P13.4** migrate balance kinds.
5. **P13.5** migrate transfer kinds + OperationPlanner + balance-projector.
6. **P13.6** re-thread service.ts/spec.ts/utils.ts from descriptor keys.
7. **P13.7** delete the 9 old modules (+ compat `*Impl` shims) after `rg` confirms no class imports remain; full ext + smoke + network before merge.

Given the size (~1.3k LOC, days), P13 lands as **sub-PRs** (likely: P13.1 pin, P13.2 registry+P13.3-5 migration, P13.6-7 re-thread+delete) each independently gated — mirrors the Q-10 cluster approach.

## Security / adversarial
Internal (no dApp trust boundary), but the characterization snapshot (byte-identical ABI + candidate ORDER + default) IS the security gate — it's what prevents a silent wrong-function-selection. codex risks pinned: impl-number change corrupts stored FnImpl; variant-order change flips tie winners; dedupe changes duplicates; tightened predicate changes candidate sets; canonicalName-for-default breaks accepted aliases; ABI-helper reuse changes param names/order/fnType.

## Assumptions
- **Facts (main-verified):** fixture `TokenContractArtifact`@composition.test:20; `Fn`(abstract)+`ViewFn extends Fn`, no CallFn (`utils/fn.ts:10-51`); `./functions` consumed by operation-planner.ts + balance-projector.ts (+ tests) — **so class exports ARE effectively internal API across the extension** → migrate all call sites, delete after `rg` clean (no cross-package/published consumer found).
- **Inferences:** stored `impl` values exist in user storage → numeric compat mandatory.
- **Asks:** none blocking (the "public API?" ask resolved: internal-only, migrate+delete).
