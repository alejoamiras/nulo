# Arc 6 — row-service-method-families (F-Q09) — plan draft (pre-homing)

[mid] tier. Quality arc: ZERO behavior change. Recon verified all three targets not-stale against HEAD; the Q-09 commit's own deferral note ("Deferred: token 9-way + network pipeline (TOCTOU / push-vs-replace divergences)") corroborates the scope.

## Coverage gaps recon exposed — pins come FIRST

- `TokenService.getTokenInterface`: ZERO test coverage repo-wide. Pin before touching: stored-`token.*Fn` pick-source (vs parse's `getDefaultTokenFn`), `requireActiveProfile`/`requireOwnedRow` gate, no task wrapper, candidates mapping. Composition-test layer can drive it (no simulate needed — candidates come from the artifact).
- `NetworkService.updateEndpoint`: ZERO coverage. Pin before touching (unit describe mirroring addEndpoint's): success replace-in-place, self-excluding collision (unchanged URL doesn't collide with itself; another endpoint's URL does), invalid endpoint id, chain-mismatch, `transientNodes` eviction of OLD url, conditional `nodes` eviction only when primary.
- `addToken` unit-level: journal-title backfill + origin/subtitle branching pinnable with a stubbed `fetchTokenMetadata` (composition rules forbid simulate; a spy preserves the boundary).

## The three extractions

1. **`getTokenInterface`/`parseTokenInterface` → iterate `TOKEN_FN_DESCRIPTORS`** with a parameterized per-kind pick-source: `(kind, candidates) => FnImpl | undefined` — getTokenInterface's returns `token[`${kind}Fn`]`; parse's returns `getDefaultTokenFn(desc, candidates)?.getImpl()`. Field assembly via computed keys `${kind}Fn`/`${kind}FnCandidates` typed against `TokenInterface`. Preserve verbatim: the surrounding divergences (ownership gate vs TOFU pin-check vs task wrapper) stay in each method; only the 9-way assembly is shared.
2. **`addToken`/`addSeededToken` → `persistToken` with pluggable metadata source.** The shared machine (idempotency short-circuit, journal create, ONE `this.lock` hold, re-check-under-lock, 16-field build, set+emit, succeed/fail transitions with catch INSIDE the lock — audit D3) extracts once; the metadata source is a callback invoked only in the `!token` branch — addToken's does the live `fetchTokenMetadata` + `setOperationMeta` title backfill; addSeededToken's returns the validated snapshot (the no-refetch TOCTOU fix preserved BY CONSTRUCTION — the seed callback cannot fetch). Journal labels (origin/title/subtitle) are per-caller params.
3. **`addEndpoint`/`updateEndpoint` → shared locked tail** parameterized by (collision predicate, endpoint build, array mutation, post-write eviction). Preserve verbatim: probe-OUTSIDE-lock placement (serialization behavior), the chain-mismatch guard text, update's dead `!== undefined` guard (or document its deadness — codex judges), normalize placement (inert but keep textual order per method if cheap). deleteEndpoint/setPrimaryEndpoint deliberately EXCLUDED (different guards/mutations/events — the abstraction would grow 1-of-4-caller params).

## Process
Mid tier: this draft + a competing outline (per-method local helpers instead of shared machines) → dual audit (codex xhigh + fable) → implement pins-first → end-diff codex pass. Validation: repo gates + audit:vue (no smoke/e2e required for arc 6; unit+composition cover it).
