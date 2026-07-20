# Q-18 — single aztec-runtime artifact catalog · tier: **light**

**Re-verify (STEP 1, vs `dev-quality` @ 5e7d98d):** VALID. `known-artifacts.ts` (75L) loads 12 artifacts + class-ids each; `note-schemas.ts` (99L) independently re-loads Token/NFT/Wonderland/PrivateFPC (`loadContractArtifact` ×2 for the JSON ones) + re-computes their class-ids via `getContractClassFromArtifact` (double Poseidon hash). Both-models, high-confidence, cold change-freq.

## Duplication
- `loadContractArtifact(WonderlandTokenJson)` + `(PrivateFPCJson)` in BOTH files.
- `getContractClassFromArtifact` computes Token/NFT/Wonderland/PrivateFPC class-ids in BOTH (16 hashes incl. 4 dupes vs 12 needed).
- **Risk the finding names:** an artifact-alias / Aztec class-id change can leave note schemas keyed under a DIFFERENT class-id than known-artifact resolution → notes silently undecodable.

## Design (public API STABLE — dedupe internals only)
New internal `packages/aztec-runtime/src/pxe/artifact-catalog.ts`:
- Owns the raw artifact refs (incl. the two JSON `loadContractArtifact` calls) keyed by a `CatalogArtifactKey` union (all 12).
- `getCatalogEntry(key): Promise<{ artifact, classId }>` — **per-key cached** (NOT eager all-12, per codex HIGH#1: note-schemas needs only 4 keys, so a transient failure hashing an unrelated protocol artifact can't break note rendering; a key both callers request is still hashed once). `ALL_CATALOG_KEYS` is the 12-key resolution order (preserves the known-artifacts map insertion order — codex HIGH#2).
- `_resetArtifactCatalogForTests()`; `_resetNoteSchemasForTests()` stays the single authoritative reset (clears its own cache + the catalog — codex MED#3). note-schemas keeps its cached-map identity (codex HIGH#2).

Both production loaders derive from it (public signatures UNCHANGED → consumers `service.ts:122/228` + `index.ts` re-exports + all mocked tests untouched):
- `loadProductionKnownArtifacts`: build `artifacts` (classId→artifact) for all 12 + the SponsoredFPC instance (salt 0) — from the catalog.
- `loadProductionNoteSchemas`: keep the note metadata HERE (slots `0x3`/`0x7`/`0x7`/`0x1`, `uintNote`/`nftNote`, contractNames); key each by `catalog.get(key).classId`.

## Behavior preservation (the proof obligation)
- Same `getContractClassFromArtifact` → byte-identical class-ids → identical map keys.
- Same artifact set, same instance (SponsoredFPC salt 0), same note slots/names.
- Catalog cache + retry-reset mirrors the current per-loader caching; `_resetNoteSchemasForTests` must ALSO reset the catalog (or the catalog reset is wired into it) so the note-schemas test seam still fully resets.

## Test (e2e-gated, not unit — alias/wasm constraint)
The invariant ("note-schema keys ⊆ known-artifact keys") is now **structurally guaranteed** — both loaders resolve class ids via the SAME `getCatalogEntry(key).classId`, so there is no code path where they diverge. A real-artifact UNIT test is infeasible in `aztec-runtime` (no vitest config, no `@wonderland-token-artifact`/`@private-fpc-artifact` alias, noir-contracts wasm — which is exactly why every existing test here MOCKS the loaders; verified). Gate: typecheck (structure) + the existing mocked `service.test.ts` (consumers unchanged) + **network e2e** (notes-viewer decode → the real class ids must match deployed contract class ids, else notes don't render). **Codex consult `conditional approve` (session 019f19ca):** all HIGH/MED folded in (per-key cache, order/cache-identity preservation, authoritative reset, note metadata stays here). Noted non-blocking: `apps/extension/.../fpc/service.ts` is a 3rd PrivateFPC loader (instance discovery, not class-id hashing) — out of Q-18 scope.

## Validation gate
- `bun run lint` + `bun run typecheck:all`.
- `bun run test` for **aztec-runtime** (catalog + pxe service + note tests).
- smoke + FULL network e2e (notes-viewer exercises note-schemas; PXE init exercises known-artifacts).

## Codex consult questions
1. Is keeping note-schema metadata in note-schemas.ts (vs moving it into the catalog) the right call, or does the finding want the catalog to own note-schemas too?
2. Any consumer relying on the CURRENT double-load / independent caches (load order, separate failure isolation)?
3. Test-seam: does folding the catalog reset into `_resetNoteSchemasForTests` fully preserve the existing reset contract?
