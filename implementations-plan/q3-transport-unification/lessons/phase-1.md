# Phase 1 — Extract pure helpers + fix the bugs they expose

**Status:** code + standard gate ✓. Network leg (liveness) triggered in CI — see "Network" below; phase marked ✓ only once that run is confirmed green on a latest-dev base.

## What shipped

New `src/core/` helpers (the genuinely-pure, genuinely-shared pieces):

- `decode.ts` — `decodeResult(result, resultIsJson)`: success-path result decode
  ONLY (JSON.parse iff `resultIsJson && typeof result === "string"`). Both
  clients now call it. Error decode stays per-transport (P2 hook), NOT here.
- `error-response.ts` — `buildErrorResponseContent(error) → {error, errorPayload?}`.
  Background service wired now (proves equivalence); the offscreen service adopts
  it in P3 (D9 keeps offscreen `errorPayload` emission for P3).
- `initialization.ts` — `awaitInitialized(getInitialized, timeoutMs=30_000)`. The
  two services' `ensureInitialized` were byte-identical; both now delegate.

## The three fixes (fix-don't-pin)

- **(a) Offscreen A6 swallow → 3-tier (D12, user-visible).** The offscreen
  service used to silently swallow when both the response send AND the
  jsonStringify fallback failed, leaving the client to hang for its full
  timeout. It now sends a `{error: "Response not serializable: …"}` response as a
  3rd tier, matching the background service. Pinned by new offscreen
  service-test tiers 3 (error response) + 4 (all-fail → 3 attempts then drop).
- **(b) Client `onMessage` null-guards.** Both clients deref'd `message.type`
  (background) / `message.to` (offscreen `onMessageListener`) on a possibly-null
  inbound message → throw. Added leading `!message` guards. New "null/malformed
  inbound … no throw" tests in both client suites.
- **(c) Service null-params hang.** `typeof null === "object"` let `null` params
  past the guard → `unwrapParams(null)` threw → no response → client hung.
  Per the fable audit, the meaningful fix is to **reply with a clean error** (not
  just drop), so the client rejects instead of hanging. Background replies with a
  structured `ValidationError` (errorPayload); offscreen replies with a flat
  error string (errorPayload deferred to P3). New "malformed params" tests both
  sides.

## Gate

- `bun run --cwd packages/extension-messaging test` → **90 passed** (6 files;
  +19 over Phase 0: 11 core + 8 fix/guard tests).
- `bun run --cwd packages/extension-messaging typecheck` → clean.
- `bun run --cwd packages/extension typecheck` (vue-tsc) → clean.
- `bun run --cwd packages/extension test` → **2517 passed | 1 skipped** (consumers
  unaffected by the helper rewiring + the 3 fixes).
- `bun run lint` → **exit 0** (the `noBannedTypes` on the pre-existing `= {}`
  generic defaults that `npx biome` flags is an npx-version artifact — the repo's
  pinned biome via `bun run lint` does not flag it, and those lines were not
  touched).

## Network (liveness)

Triggered via the `e2e:network` label on the PR (covers Phase 0 + Phase 1). The
suite exercises the real popup↔SW↔offscreen wire, so a green run confirms the
helper extraction + the three fixes did not break the happy path. Must be judged
on a branch synced to latest dev incl. de-flake commits (Q22/Q7 base-staleness
lesson). Run id + verdict recorded here once it completes.

No codex consult needed — each fix was small + audit-blessed (D9/D12 + fable's
"reply, don't drop" for (c)).
