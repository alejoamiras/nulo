# Plan — dedup-pxe-memo (Arc 3 of audit 2026-08-14-dedup-mid)

**Tier**: `/blueprint light` · **Branch**: `worktree-dedup-pxe-memo` → PR into `dev`
**Scope**: finding Q-04 (verified: `audit/quality/2026-08-14-dedup-mid/findings/verified/Q-04.md` — authoritative instance table, helper contracts, per-instance care flags)
**Approval**: standing authorization via the owner's `/goal` (2026-08-16). ELI5 omitted (autonomous mode). Zero behavior change; production quality bar.

## Assumptions

**Facts (all verified in verified/Q-04.md §Strengthened evidence, table reproduced byte-for-byte against source)**
1. Six hand-rolled "cache a promise, clear on rejection" instances in `packages/aztec-runtime/src/pxe/`: artifact-catalog.ts:88,93-106 (Map-keyed, HAS the identity guard); note-schemas.ts:61,63-89 (singleton, no guard); public-events.ts:169-182 + :184-194 (singletons, no guard); artifact-registry.ts:52,99-112 (singleton class field, no guard); service.ts:508,510-524 (WeakMap-keyed by live PXE, no guard).
2. No shared memoize helper exists anywhere in the workspace (repo-wide grep).
3. #6's WeakMap is load-bearing GC behavior (torn-down PXE must not be pinned) — the keyed helper must accept an injected WeakMap, not default-only Map.
4. #5 (`artifact-registry.ts`) is not a pure promise cache: `ensureKnown()` caches `Promise<void>` whose loader side-effects `this.known`, which other methods read SYNCHRONOUSLY. The minimal preserving migration keeps `this.known` as the loader's side effect; sync readers are untouched.
5. The missing-guard race is latent, not live (resets are test-only / never-called `clear()`), so migration carries no urgency-driven behavior risk; applying the guard uniformly is a strict hygiene tightening on unreachable-today paths.
6. `_resetNoteSchemasForTests` / `_resetPublicEventMemosForTests` hooks exist and must keep working (become `.reset()` wrappers).
7. Adjacent doc-drift surfaced by the verifier (`ArtifactRegistry.clear()`'s "Called during onProfileDeleted" comment describes wiring that doesn't exist) — OUT of this arc's scope; recorded for the final report.

**Inferences (audit: challenge)**
- I1: the helper lives at `packages/aztec-runtime/src/pxe/async-memo.ts` (all 6 consumers are in pxe/; wallet-core placement would be Speculative Generality until a second package needs it).
- I2: uniform identity-guard application at the 5 previously-unguarded sites changes behavior ONLY on unreachable-today paths (F5) — inside the zero-behavior-change envelope, same class as Arc 2's R2.
- I3: `memoizeAsync` needs no `peek()` — #5's sync fast path reads `this.known`, not the cache (F4).

## Architecture & Implementation

Per verified §Refined recommendation, verbatim contracts:

```ts
export function memoizeAsync<T>(loader: () => Promise<T>): { get(): Promise<T>; reset(): void }
export interface AsyncMemoStore<K, V> {
	get(key: K): Promise<V> | undefined
	set(key: K, value: Promise<V>): unknown
	delete(key: K): unknown
}
export function memoizeAsyncBy<K, V>(
	loader: (key: K) => Promise<V>,
	store?: AsyncMemoStore<K, V>, // Map (default; any K incl. CatalogKey's string union) or WeakMap (object K)
): { get(key: K): Promise<V>; reset(key: K): void }
```

(Self-caught pre-audit: `CatalogKey` is a string-literal union, so the earlier `K extends object` constraint would have rejected instance #1's Map keys; `K` is unconstrained and the structural store type lets `WeakMap` satisfy it exactly when `K` is an object type — which is what instance #6 passes. Codex adds: never type the store as `Pick<Map<…>>` — WeakMap fails it under strict TS because `set()` returns polymorphic `this`; the structural `set(...): unknown` shape is required.)

**Codex audit conditions (all adopted):**
- **Catalog-wide reset preserved**: `_resetArtifactCatalogForTests()` clears the WHOLE map (and `_resetNoteSchemasForTests()` calls it) — the catalog site injects its own `Map` and the hook clears that store directly; the helper keeps per-key `reset` only. Regression test added for the catalog-wide path.
- **ArtifactRegistry semantics**: keep the `if (this.known) return` sync fast path; the loader assigns `this.known`; `clear()` resets memo + `known` + `verifiedClassIds`. The pre-existing "old successful loader repopulates `known` after a concurrent `clear()`" behavior is UNCHANGED and not claimed fixed.
- **Reachability wording**: the guard-delta paths have "no current in-repo production callsite" (clear() and the reset hooks are exported publics) — not "unreachable".
- **Façade shapes preserved**: catalog/public-events/service façades stay non-async returning `memo.get()` directly (public-events tests pin promise identity); note-schemas + registry keep their async façade shapes.

Both encode clear-on-reject **with the identity guard** from instance #1 exactly once: a rejection handler deletes the cache slot only if it still holds THIS promise, so a stale rejection can never clobber a newer in-flight retry. `reset()` clears unconditionally (caller intent). Note `memoizeAsyncBy.reset(key)` is per-key only — an all-keys reset can't exist over an injected WeakMap (not enumerable); no current consumer needs it.

**Migrations** (all in `packages/aztec-runtime/src/pxe/`):
- Mechanical: note-schemas.ts, public-events.ts ×2, service.ts (`memoizeAsyncBy` with an explicit `new WeakMap()`); `_reset*ForTests` hooks delegate to `.reset()`.
- Reference: artifact-catalog.ts → `memoizeAsyncBy` with default Map; verify per-key laziness is preserved (no eager load of the whole catalog).
- Care: artifact-registry.ts → `memoizeAsync<void>` whose loader performs today's body incl. the `this.known` assignment; `ensureKnown()` = `return this.memo.get()`; `clear()` calls `.reset()` + clears `this.known` as today.

*What disappears*: 6 independently-typed cache members + their clear-on-reject plumbing; the guard divergence.

## Phases & validation gates
1. `async-memo.ts` + colocated tests (~9: singleton caches/retries/guard/reset; keyed per-key isolation, Map default, WeakMap injection, guard per key, reset(key); guard test = stale rejection after reset+re-get does NOT clobber the newer promise). Gate: `bun run --cwd packages/aztec-runtime test`.
2. Migrate the 6 instances (one commit; small file set). Gate: aztec-runtime suite + `bun run typecheck:all`.
3. Whole-arc: `bun run audit:vue` + `NULO_E2E_PROVERLESS=1 bun run e2e:agent` SOLO (pxe touched).
4. Post-impl: ONE codex xhigh diff pass → converged → PR → babysit → squash-merge.

## Security & Adversarial Considerations
The cached values are protocol constants/artifacts (class ids, tags, schemas) — no secrets. The risk class is stale-cache poisoning: the identity guard strictly narrows it; `reset()` paths preserved. No trust-boundary input reaches the helper.

## Trade-offs / alternatives rejected
wallet-core placement (I1 — premature generalization); `peek()` accessor (I3 — no consumer); fixing `ArtifactRegistry.clear()`'s dead wiring claim (out of scope, flagged).
