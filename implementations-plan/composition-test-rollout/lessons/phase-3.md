# Phase 3 — TokenService composition test (parseTokenInterface, bb-free)

## What landed
`token/service.composition.test.ts` drives the REAL `parseTokenInterface` through the shared fake:
- resolve the contract → getContractInstance returns a HARDCODED fake instance (deriving a real one needs bb, not loaded in vitest; mirrors `contract-resolver.test.ts:34`'s `fakeInstance`),
- getContractArtifact returns the REAL `TokenContractArtifact` (`@aztec/noir-contracts.js/Token`, importable in vitest per `note-schemas.test.ts:20`),
- dedup-register: `getContracts()` `[]` → `registerContract` once; seeded-registered → skip,
- bb-FREE name-based candidate extraction (`GetNameFn`/`TransferPublicFn.getCandidates` filter `artifact.functions` by name/params).

Asserts: real candidate lists non-empty (real artifact), contract echoed, `registerContract` called once / deduped to zero.

## Scope-out (verified by codex 019ee71c + compile)
NOT driven: `fetchTokenMetadata`/`previewTokenMetadata`/`addToken` — they call `simulate(...)` (`token/service.ts:484`, deep) + `utils/fn.ts:33` selector derivation (bb). `parseTokenInterface` itself is bb-free. This is the doc's "one service, shallow path (composition) + deep path (e2e), split at the method seam" worked example.

## Gate — MET
`vitest run token/service.composition.test.ts` (2/2) · token dir green · typecheck 0 · lint clean · build:chrome + marker grep `dist/chrome` → 0.

LESSONS_FILE=implementations-plan/composition-test-rollout/lessons/phase-3.md
