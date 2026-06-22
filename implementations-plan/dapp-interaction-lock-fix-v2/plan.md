# dapp-interaction-lock-fix-v2 — Layer A only

Closes the codex P1 audit (`019e6abf`) findings from PR #53. Mechanical follow-up to plumb `submitting.txHash` + refactor the pending-tx filter to be journal-first.

**Layer B (parallel popups UX) is deferred to v3** with its own plan + spike of opus's simpler architecture, per dual-audit recommendation (see `audit-codex.md` + `audit-opus.md`).

## Scope (Layer A only)

### 1. Populate `submitting.txHash` at all four call sites

`packages/extension/src/wallet/services/execution/service.ts` — four `markJournal({ stage: "submitting" })` sites:

- L~519 (UI transfer path)
- L~1148 (dApp execute path)
- L~1791 (`executeAztecSendTx` standard sendTx)
- L~1958 (`executeAztecSendTx` NO_FROM sendTx)

All four sites already have `tx` in scope (from `provedTx.toTx()` just above). Change:
```ts
// before
await this.markJournal(journalId, { stage: "submitting" })
// after
await this.markJournal(journalId, { stage: "submitting", txHash: tx.getTxHash().toString() })
```

The schema (`operation-journal/spec.ts:170`) already permits `submitting.txHash` as optional. No schema change needed.

### 2. Add invariant assertion in `transitionOperation`

`packages/extension/src/wallet/services/operation-journal/service.ts` — when transitioning from `submitting` (with non-empty `txHash`) → `succeeded` (with `txHash`), assert the two match. Drift would silently break the new filter; the invariant pins it at the FSM layer.

### 3. Refactor `filteredRecentTransactions` to journal-first

`packages/extension/src/popup/components/modules/general/RecentActivityView.vue` — drop the blanket `if (executingTask.value) → blanket-suppress all Pending` branch (lines ~58-60 currently). Always use `filterPendingDoubleRender(source, inFlightJournalOps.value)`.

**The orphan-task path decision (codex P2):** verify whether `hasOrphanExecutingTask` is actually reachable post-W5. If yes, keep a narrow fallback. If no, drop entirely. Document the call in the diff.

### 4. Clean up synthetic-state TODOs

- `recent-activity-handlers.ts` — drop the "production no-op" TODO; the filter is live now.
- `recent-activity-handlers.test.ts` — drop the "intended contract" TODO; assertions are now live coverage.
- `RecentActivityView.vue` — drop the "residual leak" TODO from the executingTask blanket branch.
- `execution/service.ts` — drop the four `Populate txHash here` TODOs.
- `concurrent-sendtx.test.ts` — drop the "approval-path test missing" TODO (it WILL be missing until v3 closes Layer B, but the TODO message should reference v3 not v2).

### 5. Update tests to assert live behavior

- `recent-activity-handlers.test.ts` — confirm the existing 7 tests pass against the now-live filter behavior. Add a multi-pending case (two journal records both at `submitting` with distinct txHashes — should suppress both matching chain txs).
- `operation-journal/service.test.ts` (or `spec.test.ts`) — add a test asserting the new `submitting.txHash === succeeded.txHash` invariant assertion fires when the hashes differ.

### Not in scope for Layer A

- Approval-path e2e companion test → **Layer B (v3)**. The e2e tests Layer B's new boundary (popup #2 opens immediately after popup #1 approval), so it belongs there.
- Parallel popups UX refactor → **Layer B (v3)**.
- v1 docs carve-out → separate cleanup PR, independent of v2/v3.

## Files touched (Layer A — estimated)

```
packages/extension/src/wallet/services/execution/service.ts                      4 small edits + remove TODOs
packages/extension/src/wallet/services/operation-journal/service.ts              1 small edit (invariant)
packages/extension/src/wallet/services/operation-journal/service.test.ts         1 new test
packages/extension/src/popup/components/modules/general/RecentActivityView.vue   ~15 LOC removed + TODO removed
packages/extension/src/popup/components/modules/general/recent-activity-handlers.ts     ~15 LOC TODO removed
packages/extension/src/popup/components/modules/general/recent-activity-handlers.test.ts ~10 LOC TODO removed + 1 new test
packages/extension/tests/e2e/network/concurrent-sendtx.test.ts                   TODO message references v3 (Layer B)
```

Net diff: ~150 LOC. One PR.

## Security & adversarial considerations

Layer A is genuinely small and load-bearing in a contained way. The risks remain:

- **txHash function drift**: if `tx.getTxHash().toString()` returns one value at the `submitting` transition and a different value at the `succeeded` transition (different Tx state, different serializer, future upstream change), the filter silently no-ops AND the invariant assertion catches it. The invariant assertion is the load-bearing safety net.
- **Orphan-task path removal**: if I drop it but it's actually reachable, a legitimate awaiting card surface goes invisible. **Mitigation:** add a `console.warn` for the case where `executingTask` exists but no matching journal record (record-of-occurrence rather than silent failure) before the next release. If we never see the warning across N days, drop the case entirely in a follow-up.

No new attack surface. No concurrency-boundary changes. Pure UI/service layer cleanup.

## Tier B protocol — abbreviated for Layer A

The dual-audit on the v0 plan ALREADY greenlit Layer A as "mechanical, shovel-ready, ~150 LOC, fully solves codex P1". Re-auditing the Layer-A-only plan adds no value. So:

```
[✓] 0. Clarifying questions (user answered)
[✓] 1. Dual audit on v0 plan (codex + opus) — Layer A greenlit
[✓] 2. Consolidate findings → split A/B
[✓] 3. User decision: Layer A only for v2; Layer B deferred to v3
[▶] 4. Implementation + per-phase lessons under lessons/
[ ] 5. Local validation (audit:vue + targeted smoke)
[ ] 6. Post-impl codex review
[ ] 7. Fix loop (if any)
[ ] 8. PR open → CI green → merge
```

Layer B (v3) gets its own plan + dual audit when we're ready to start it.
