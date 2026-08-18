# Arc 6 — row-service-method-families (F-Q09: token 9-way + persistToken + endpoint pipeline)

[mid] tier of the 2026-08-16 remediation follow-ups ([spec](../remediation-followups/plan.md) §6). Quality arc: **ZERO behavior change** — characterization pins FIRST, then structure-only refactors; every pre-existing test stays green unmodified. Validation: repo gates + `audit:vue` (no smoke/e2e required for this arc). Dual plan audit (codex + fable), then ONE end-of-arc codex diff pass.

## Recon verdict (against `dev@adf07a55`; two parallel agents, full report in [recon-notes.md](./recon-notes.md))

All three targets verified NOT-stale — the exact structural facts the spec cites match HEAD verbatim, and the prior Q-09 commit's own message records the deferral ("Deferred: token 9-way + network pipeline (TOCTOU / push-vs-replace divergences)"). Two coverage holes dominate the risk profile:

- **`TokenService.getTokenInterface` has ZERO test coverage repo-wide.** Its stored-`token.*Fn` pick-source, `requireActiveProfile`/`requireOwnedRow` gate, and no-task-wrapper shape are all invisible to CI.
- **`NetworkService.updateEndpoint` has ZERO test coverage** (no unit describe; the only e2e never clicks submit). Its self-excluding collision predicate, index-replace, `oldUrl` capture, and both cache evictions are unpinned.

## Phase 1 — characterization pins (before ANY refactor)

1. `getTokenInterface` composition pins (the layer can drive it — candidates come from the real artifact, no simulate): stored-`*Fn` passthrough (differs from parse's re-derivation), ownership gate (foreign profile → throw), candidates present per kind.
2. `updateEndpoint` unit describe mirroring `addEndpoint`'s: successful replace-in-place (same id, new url/label; array length unchanged); unchanged URL does NOT self-collide; ANOTHER endpoint's URL collides (`ERR_DUPLICATE_ENDPOINT`); invalid endpoint id; chain mismatch (`ERR_ENDPOINT_CHAIN_MISMATCH`); `transientNodes` eviction of the OLD url; `nodes` eviction ONLY when the edited endpoint is primary.
3. `addToken` unit pins with a stubbed `fetchTokenMetadata` (spy on the instance — composition rules forbid simulate): journal title backfill via `setOperationMeta`, `origin`/subtitle propagation, idempotency short-circuit creates NO journal op.

## Phase 2 — the three extractions

1. **Token 9-way → iterate `TOKEN_FN_DESCRIPTORS`.** Shared assembly helper parameterized by the per-kind pick-source (`(kind, candidates) => FnImpl | undefined`): `getTokenInterface` picks `token[\`${kind}Fn\`]`; `parseTokenInterface` picks `getDefaultTokenFn(desc, candidates)?.getImpl()`. Computed-key field assembly typed against `TokenInterface`. Everything AROUND the 9-way stays put per method (ownership gate vs TOFU `expectedClassId` pin-check vs task wrapper — those are the methods' identities, not duplication).
2. **`addToken`/`addSeededToken` → `persistToken` with a pluggable metadata source.** The byte-identical machine extracts once: pre-lock idempotency short-circuit, journal `createOperation`, ONE `this.lock` hold, re-check-under-lock, 16-field build, `set`+`onTokenAdded` emit, succeeded/failed transitions with the catch INSIDE the lock (audit D3 — preserve verbatim). The metadata source is a callback run only in the `!token` branch: `addToken`'s does the live `fetchTokenMetadata` + `setOperationMeta` title backfill; `addSeededToken`'s returns the validated snapshot. **The no-refetch TOCTOU fix is preserved BY CONSTRUCTION** — the seed path's callback cannot fetch. Journal labels (`origin`/`title`/`subtitle`) are per-caller params. `addSeededToken` stays off the RPC surface.
3. **`addEndpoint`/`updateEndpoint` → shared locked tail** parameterized by (collision predicate, endpoint construction, array mutation, post-write eviction). Preserved verbatim: the probe-OUTSIDE-lock placement (whole-service serialization behavior — moving it is a behavior change), the guard texts, update's dead `probedChainId !== undefined` guard (kept as-is; deadness documented in the plan only), each method's normalize call site. `deleteEndpoint`/`setPrimaryEndpoint` deliberately EXCLUDED (different guards/mutation shapes/events — 1-of-4-caller params are the over-abstraction this charter forbids).

## Competing outline (for the audit)

No shared machines: keep the three duplications, add ONLY the phase-1 pins (closing the coverage holes), and reject F-Q09 as not-worth-it. Weigh: the duplications are stable (2 commits in a year), the divergences are semantic booby-traps (TOCTOU, push-vs-replace, self-excluding predicate) that a parameterized helper must thread as knobs — is knob-count complexity < duplication cost at these sites' change frequency?

## Audit ledger

_pending._
