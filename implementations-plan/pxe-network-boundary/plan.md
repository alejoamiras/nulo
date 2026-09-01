# pxe-network-boundary — round-2 plan 2 (blueprint light, BL/E)

Scope authority: [round-2 scope](../complexity-residue-round-2/scope.md) § 2. ONE PR.
Burns 6 directives: `pxe/service.ts` sweepOrphanStores 21 + getContractInstance-closure 26,
`pxe/public-events.ts` fetchPublicTokenTransferEvents 25, `pxe/client.ts` request 21,
`utils/fetch.ts` fetchOnce-closure 21, extension `network/service.ts` restore-closure 24.
Manifest 117 → 111. Discipline carried from plan 1: the codex flat-stream ruling — sync
guard ladders live in SYNC helpers; an async helper is only introduced where its call
replaces a span that already awaited, under a caller-side applicability guard.

## Recon + decomposition (per function)

- **`sweepOrphanStores` (21)** — the OPFS orchestration (selection + the barrier loop +
  the post-barrier liveness re-check) stays INLINE: the next orphan's `enterWrite()` must be
  reserved on the same continuation the previous `leaveWrite()` ran on (codex post-impl).
  Only `sweepLegacyIndexedDbs(dbs, pxes)` is extracted, TAIL-RETURNED behind the existing
  `pxes.length` guard so no hop precedes the first `deleteDatabase`. Suites:
  `service-sweep.test.ts` (4) + the barrier-pending pin.
- **`getContractInstance`'s closure (26)** — keep the closure + the PXE-preimage fast path;
  extract the `!instance && !pxeOnly` fallback body → `resolveInstanceFallback(node,
  address, opts)` (node try/catch incl. the ContractUpgradedError rethrow + best-effort
  degrade, then the known-bundle cascade). Guarded call: the fallback path already awaited;
  the PXE-hit/pxeOnly path stays sync. Suites: `service.test.ts`, `stub-overrides`.
- **`fetchPublicTokenTransferEvents` (25)** — extract `probeAncestry(node, args)` (the
  self-contained verifyAncestorHash block; its guard stays at the call site; probe path
  already awaited) and SYNC `validatePageOrdering(logsForTag, afterCursor, checkpointed,
  contract, log)` returning drop-or-ok (warn calls move with it). Decode loop already
  helper'd. Suite: `public-events.test.ts` (30 — incl. page-drop and ancestry cases).
- **`client.ts request` (21)** — extract sync predicate `needsGenerationStamp(netArg)`;
  keep the stamp await inline under it (already-awaited path); extract the catch's recovery
  tail → `recoverMissingStoreKey(method, args, err, profileId)` (onReady → provider →
  capture-equality guard → live-generation revalidation → provision + single retry, zeroize
  in finally — the WHOLE D4-hardened sequence moves as one unit, order untouched). The
  catch keeps the sync marker/method guard + rethrow. Suites: `client-capture.test.ts` (8),
  `incarnation-fence.test.ts` (13).
- **`fetch.ts` fetchOnce closure (21)** — both awaits and the timeout `finally` stay
  INLINE (the abort signal must stay live through a pending `resp.json()` — pinned); extract
  only the sync classifiers `mapFetchDispatchFailure` and `classifyRpcFailure`.
  `fetch.pins.test.ts` (11, committed first) is the closure's first coverage: the full
  reject oracle, header/signal passthrough, abort-through-pending-json, and the two
  retry-wrapper pins.
- **`network/service.ts` restore closure (24)** — extract SYNC
  `validateRestoredNetwork(raw, existing)` (shape gate `BACKUP_TOO_OLD`, NetworkSchema
  F-011/A-04 boundary validation, collision check — all throws stay synchronous into the
  loop's catch, zero new seams); the awaited id-realloc/epoch/set tail stays in the loop.
  Suite: `service.test.ts` (79).

## Equivalence

BL/E: the six named suites green with zero edits + the new fetch pins (committed first).
Error/warn strings and Result reasons byte-identical (they are the oracles).

## Gates (per scope.md)

`e2e:agent` — opfs-storage · networks · public-events-capability · incoming-public-transfers
(single sequential run; local sandbox pairs proven not to fit) + audit:vue + test:ci-gating
+ `packages/aztec-runtime` test script.

## Acceptance

- 6 directives burned; manifest 117 → 111 via regen, zero inserted (read the diff).
- Zero edits to the six existing suites; fetch pins green pre- and post-refactor.
- Codex loop: plan audit → implement → post-impl review to approve (one session).

## Rollback

Squash revert; pure in-process refactor, no persisted-state or wire-shape change.
