The six sites fit the abstraction, but the plan has one concrete reset-contract bug and two claims that need tightening.

- `CatalogKey` is a string union, so unconstrained `K` is correct; `K extends object` would fail. Default `Map` preserves per-key laziness. The plan’s `AsyncMemoStore` also accepts both `Map` and `WeakMap`. Crucially, `Pick<Map<…>, "get" | "set" | "delete">` does **not** accept `WeakMap` under strict TypeScript because `set()` returns polymorphic `this`; do not revert to that typing. Use an explicitly typed `WeakMap<PXE, Promise<Fr>>` for service.

- The assertion that no consumer needs all-keys reset is false. [`_resetArtifactCatalogForTests()`](packages/aztec-runtime/src/pxe/artifact-catalog.ts:108) clears the entire map, and [`_resetNoteSchemasForTests()`](packages/aztec-runtime/src/pxe/note-schemas.ts:91) invokes it. A helper with only `reset(key)` and an inaccessible default store cannot preserve this hook. Inject a catalog `Map` and clear it, or reset every `ALL_CATALOG_KEYS` entry.

- `ArtifactRegistry` needs no `peek()` because `this.known` remains the synchronous resolved-value store. However, preserve `if (this.known) return`, make the loader assign `this.known`, and have `clear()` reset the memo, `known`, and `verifiedClassIds`. Also note that rejection identity guards do not prevent an old *successful* loader from repopulating `known` after concurrent `clear()`—existing behavior that should not accidentally be broadened or claimed fixed.

- I2 is overstated. There is no current in-repo production caller of `ArtifactRegistry.clear()`, and service has no WeakMap reset path, but `ArtifactRegistry` and `clear()` are public/exported, while the note reset hook is exported from the package. Say “no current in-repo production callsite,” not “unreachable.”

- No current consumer observes memo microtask ordering. Public-events does explicitly test promise identity, so keep catalog/public-events/service facades non-async and return `memo.get()` directly. Preserve note-schema and registry async façade shapes to honor the zero-change claim.

- I1 is sound. The helper tests are otherwise proportionate, but add a regression for the catalog-wide reset through `_resetNoteSchemasForTests`. The dead `clear()` documentation is correctly retained as an out-of-scope follow-up.

**Verdict: conditional approve (with conditions: preserve catalog-wide reset; retain ArtifactRegistry’s known fast path and full clear semantics; replace “unreachable” with the narrower verified claim; prohibit `Pick<Map<…>>`; preserve façade promise/timing shapes).**
---

## Post-implementation diff review (fresh codex session, xhigh)

### Low

- [note-schemas-reset.test.ts:10](packages/aztec-runtime/src/pxe/note-schemas-reset.test.ts:10) mocks the entire catalog. The test proves that the schema memo resets and that the catalog-reset collaborator is called, but not that the real catalog `Map` is cleared. The generic injected-store test at [async-memo.test.ts:103](packages/aztec-runtime/src/pxe/async-memo.test.ts:103) is likewise disconnected from the actual hook. Making [artifact-catalog.ts:106](packages/aztec-runtime/src/pxe/artifact-catalog.ts:106) a no-op would leave both tests green. Thus the promised end-to-end cascading-reset regression is not genuinely pinned. Test the real catalog module with the class-ID hasher mocked, then verify cached keys recompute after the note-schema reset.

No implementation defect found in the six migrations. Promise façade/identity shapes, catalog laziness, guarded rejection cleanup, registry fast path and three-part `clear()`, WeakMap/`PXE`/`Fr` typing, and the dynamic import are preserved. The `knownMemo` field initializer is safe because it only captures `this.loader`; invocation occurs after construction.

**Verdict: fix required**

### Convergence

No new material findings. The relocated test exercises the real catalog `Map` and both real reset hooks; only hashing is mocked. The 4→8 assertion genuinely pins wholesale catalog clearing through the note-schema cascade.

converged