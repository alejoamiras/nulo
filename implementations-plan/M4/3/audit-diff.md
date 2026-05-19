# M4.3 — audit-diff (post-dual-audit)

Date: 2026-04-26

## BLOCKERs to absorb at execution time

1. **Trust-check seam at the wrong layer (codex BLOCKING)**: plan says trust check moves into `ArtifactRegistry`, but Step 2 still wires it inside `HttpRegistryFetcher.fetchArtifact`. `RegistryFetcher` is the abstraction seam (`artifact-registry.ts:55`); `ArtifactRegistry.resolve` trusts whatever the fetcher returns at line 203. **Fix**: `ArtifactRegistry.resolve(...)` runs `verifyArtifactClassId(...)` on every returned artifact before returning, including the `"registry"` branch. Keep `HttpRegistryFetcher` responsible for fetch + schema parse only.
2. **Wrong imports in Step 1 sketch (codex BLOCKING)**: plan imports both `ContractArtifact` and `getContractClassFromArtifact` from `@aztec/stdlib/contract`. Repo consistently gets `ContractArtifact` from `@aztec/stdlib/abi` and the helper from `@aztec/stdlib/contract` (verified at `artifact-registry.ts:2` + `execution/service.ts:24`). Also: `ContractClassPublic` named at line 72 — installed type is `ContractClassWithId & ContractClassIdPreimage`, not that alias. **Fix**: update imports + type names.
3. **M4.7 dependency claim wrong (Plan agent BLOCKING)**: M4.3 owns no persisted state. Plan should explicitly state M4.7 is NOT a hard prereq. Risk #3 fixture (per-known-artifact class-id table for CI) MUST be a build-time JSON file in repo, NOT chrome.storage. (Otherwise it crosses M4.7's territory.)

## Codex SHOULD-FIX

- Step 3 internally inconsistent: line 89 + 126 talk about build-time define/gate work; line 93 + 95 say first cut is inline-array only. Pick one. Recommendation: M4.3 ships inline `REGISTRY_ALLOWLIST` ONLY; env-aware substitution is follow-up.
- Test section assumes no existing registry tests, but `artifact-registry.test.ts:43` already has coverage. Plan must explicitly preserve or move existing policy tests when adding new security cases.

## Plan agent SHOULD-FIX

- Defense-in-depth on "known" branch is wrong: `known.artifacts.get(classId.toString())` lookup at line 197 IS class-id match by definition (load-time `loadProductionKnownArtifacts` at `known-artifacts.ts:60-61` keys by computed class id). Recomputing is hash twice. **Drop recompute on "known" branch.**
- Performance: commit up-front to `Set<string>` of verified class-id strings cache. Don't "decide at execution time."
- Test #6 (schema-invalid smoke): tests upstream library. Drop or rephrase as "pin existing behavior."
- Test #1: explicit assertion that URL was `/api/artifacts/${classId-B}` while payload computes to class-A.
- Missing scenario: `pxeOnly: true` + mismatched pxe-local test.
- ExecutionService checks at `:557, 1100`: defense-in-depth survives ONLY on dApp-provided-artifact path (`:551, :1091`), NOT registry path (which becomes dead code post-M4.3). Plan should say so.

## NITs to absorb

- Drop "verify exact import path" caveat — path is `@aztec/stdlib/contract`, settled.
- Build-time allowlist deferral right call.
- Test count adjusts: drop schema-invalid (`+0`), add pxeOnly-mismatch (`+1`). Net 5-6.

## Recommended execution-time absorption

1. **Move `verifyArtifactClassId` call into `ArtifactRegistry.resolve`** (not fetcher). Runs on registry / known / pxe-local branches uniformly.
2. **Drop recompute on "known" branch** — keyed by class-id-from-load-time computation.
3. **Fix imports**: `ContractArtifact` from `@aztec/stdlib/abi`; helper from `@aztec/stdlib/contract`. Type name: `ContractClassWithId & ContractClassIdPreimage` (or just `ReturnType<typeof getContractClassFromArtifact>`).
4. **Cache verified class-ids** in `Set<string>` in ArtifactRegistry; commit up-front.
5. **Preserve existing `artifact-registry.test.ts`** tests when adding new security cases.
6. **Risk #3 fixture**: build-time JSON file `packages/aztec-runtime/src/pxe/known-classids.json` (or similar). NOT chrome.storage.
7. **Document defense-in-depth scope**: ExecutionService checks survive only on dApp-provided-artifact path post-M4.3.

## Status

- Plan v0 SHIPPED. Audits absorbed in this audit-diff.
- Plan v1 — small revisions in-place; mostly seam relocation + import fixes.
