# Codex iteration loop — consult log (post-implementation, pre-PR)

## Round 1 (2026-08-12, gpt-5.6-sol xhigh, fresh, full diff origin/dev...HEAD)

**Verdict: iterate** (0 Critical, 1 High, 4 Medium, 2 Low). All folded same-session:

| # | Finding | Disposition |
|---|---|---|
| H1 | Balance write TOCTOU: queue's re-read→write window could resurrect a row deleted mid-sync | **FOLDED** — deletion fence (`invalidatedBalanceIds`): ids added BEFORE every awaited `repo.delete`, checked SYNCHRONOUSLY before both queue writes (no await between check and dispatch — single-threaded ordering makes write-after-delete impossible); released on id reuse in `createTokenBalance`. Two interleaving pins added. |
| M1 | Absolute deadline exceeded page-side (forced 100ms attempts, +1s/+2s race graces, service clock after init) | **FOLDED** — preflight skips attempts under 100ms remaining, races at the exact budget; registration races at the exact remainder; service computes `deadlineAt` BEFORE `ensureInitialized`. Timing pin updated ([5000,5000,5000]). |
| M2 | Collector throws on non-object result entries post-finalize | **FOLDED** — object guard; `[null, undefined, 42]` collapses into ONE constant record; test added. |
| M3 | `networks` argument un-validated at the trust boundary | **FOLDED** — array-required, 64-cap, `NetworkSchema.safeParse` filter; invalid entries behave as absent networks. |
| M4 | Marker deletion ordered before session close + pending-secret zeroization in `deleteProfile` | **FOLDED** — marker delete moved to the fallible tail (after close + zeroize); a failure leaves the tombstone for crash-resume. Rejecting-remove pin added (session closed anyway). |
| M5 | Smoke test's two waits not one true 90s deadline | **FOLDED** — `routeRemainder()` throws on exhaustion and feeds BOTH waits the remainder of `submittedAt + 90_000` (literal unchanged; only ever TIGHTER). |
| L1 | Imported `syncFailure.message` unbounded at the schema | **FOLDED** — schema-level truncate-not-reject transform (200 chars). |
| L2 | Rehydration accepted a generation-mismatched marker without purging | **FOLDED** — best-effort purge on the silent path too; restart pin added (session survives + marker gone). |

Round-1 "looks right" confirmations covered every prior audit condition (probe abort, caps,
per-launch deadline, marker bracket, settled race, zeroization, testids, e2e stubs).

## Round 2 (resumed, on the fold commit)

**Verdict: iterate** — seven folds verified sound; ONE High remained: the fence's boolean
lifetime broke across id reuse (release-on-reuse let a deleted row's in-flight projection write
onto the new incarnation — ABA; and the un-released restore path permanently suppressed the
restored row's syncs). **FOLDED**: `allocateUnfencedId()` skips past fenced ids in BOTH
allocation sites; the release is gone; a worker restart forgets the fence safely. Incarnation
pin added (max=4, fence 5 → restore allocates 6, writable).

## Round 3 (resumed, on the r2 fold)

**Verdict: APPROVE** — "Both creation and restore exclusively use allocateUnfencedId; no
fence-release remains; all fenced IDs are skipped before persistence; the incarnation pin
correctly exercises max+1 landing on a fence; no allocation or write bypass found." Non-blocking
comment nit fixed same-session. **Iteration loop complete: 3 rounds, verdicts iterate → iterate
→ approve.**

## Dual-lens review (Anthropic, post-iteration, pre-codex-final)

`/code-review max --fix` ran as two independent lenses over `ea30c6f..HEAD`; fixes landed as ONE
separate commit (`fix(review): dual-lens findings …`) per the blueprint provenance rule.

| Lens | Finding | Disposition |
|---|---|---|
| correctness High | Foreign-profile/unknown-token row could take a bogus `syncFailure` write and abort the batch via the emit path's token lookup | **FOLDED** — `isRowEmittable` callback guard in the queue (service wires `tokens.has(tokenId)`); skip-not-record; healthy rows in the batch still process. Pin added. |
| correctness Medium | A FAILED first sync (updatedAt 0 + syncFailure) rendered the infinite loading spinner — exactly the failed-vs-still-running ambiguity the record exists to close | **FOLDED** — loading block yields to the failed caption (`isInitialSync && !syncFailed`). Old pin consciously flipped. |
| correctness Lows | connectivity regex gaps (`ERR_CONNECTION`, `network error`); fake probe composing inline instead of `walletChainId`; two comment drifts | **FOLDED** |
| quality M1 | `settled` flag guaranteed single-record only temporally, not structurally | **FOLDED** — flag removed; `goIds` filter makes the guarantee structural. |
| quality M2 | `importChainSync` deps carried injectable `now`/`sleep` used only by tests | **FOLDED** — deps slimmed; `realSleep` shared from importPreflight. |
| quality Lows | `maxSliceBytes` misnamed (counts UTF-16 code units → `maxSliceCodeUnits`); preflight options over-wide; contract records not spreading like sender records (safe: normalizer reconstructs children) | **FOLDED** |
| quality L3 | Extract `classifyNodeStatus` from `probeNodeStatus` | **NOTED, not applied** — 3 commented lines, already service-test-covered; extraction adds indirection without coverage. |
| quality L8 | Share chain-id composition into aztec-runtime | **NOTED, not applied** — the formula IS the documented port contract (`node-factory-port.ts`); sharing would invert layer direction for a two-line formula. |

Post-fold gates: 4021 extension units + 135 aztec-runtime tests green, lint + typecheck clean.
Lesson: a raw `bun test` inside `packages/aztec-runtime` bypasses the package's vitest script and
reds on unresolved vitest aliases (`@wonderland-token-artifact`) — always run the package's own
`test` script.

## Post-impl audit (resumed, net diff ea30c6f..HEAD + dual-lens summary)

**Verdict: conditional approve** — no Critical/High; three Mediums (all source-verified true) + two Lows:

| # | Finding | Disposition |
|---|---|---|
| M1 | `Array.isArray` gate on the import tail silently skipped a present-but-non-array account-state slice — hostile `{}`/`null` never reached the normalizer's violation record and auto-routed past Continue | **FOLDED** — gate is `!== undefined`; malformed slices enter the chain-sync and land as "not an array" violations. Composable-level pin added. |
| M2 | Queue emits ran after awaited `repo.set` with no ownership re-check — a token deleted DURING the await made the service emit throw into the batch catch, falsely failing healthy siblings; success path had no ownership check at all | **FOLDED** — `isRowEmittable` re-checked after BOTH awaited writes before emitting; success path also skips the write + fails the task for un-owned rows. Mid-set-deletion pin with healthy sibling added. |
| M3 | The dual-lens commit NARROWED the connectivity matcher (bare `timeout`→`timeout after`, `refused`→`connection refused`) — "RPC timeout" defeated per-network fail-fast | **FOLDED** — bare forms restored, comment pins why. Three matcher pins added. A lens fix can itself regress an approved invariant: diff the fix, not just the finding. |
| L1 | `updatedAt=0 + syncFailure + isUpdating` rendered a failed caption with no in-flight indicator | **FOLDED** — `syncFailed` gated on `!isUpdating`; initial retry shows the loader. Pin added. |
| L2 | Slice-size local + message still said "bytes" | **FOLDED** — code units throughout. |

Fold committed as `29865c5`; gates green (4025 units + lint + typecheck). **Fold verification (resumed): APPROVE** — "No new hazards found. All five folds satisfy the conditions." Post-impl audit complete: conditional approve → fold → approve.
