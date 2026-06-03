# P13 lessons — Manual QA + lessons + PR rollback matrix

## Final state at arc completion

| Gate | Result |
|---|---|
| `bun run typecheck` | exit 0 |
| `bunx vitest run` (from packages/extension) | 177 files passed, 1 skipped, 2123/2130 tests passing, 7 todo |
| `bun run lint` (full repo) | 0 errors, 58 warnings (pre-existing across codebase, not introduced by this arc), 6 infos |

## Phase summary

```
[✓] P1   ─ fees.vue copy (A1-A4)                              [copy]      ▒
[✓] P2   ─ method label "Claim Fee Juice" (D1)                [copy]      ▒
[✓] P3   ─ aria-controls conditional + v-show                 [a11y]      ▒
[✓] P4a  ─ C2 popup-reopen failing repro e2e                  [test]      ▒
[✓] P5   ─ onTransactionAdded per-hash + account filter       [bug-fix]   ▒▒
[✓] P6   ─ PopupManager visibility seed + onUnmount cleanup   [bug-fix]   ▒▒
[✓] P7   ─ Tactical C1: NewTokenPopup auto-setTrustAllow      [bug-fix]   ▒▒
[✓] P8   ─ Tactical C2: one-shot replay on triple-ready       [bug-fix]   ▒▒
[✓] P9   ─ B2 categorical label helper                        [util]      ▒
[✓] P10  ─ B1 brutalist restructure of journal/[id].vue       [ui]        ▒▒▒
[✓] P11  ─ E1 identity-scoped consumer rehydration            [bug-fix]   ▒▒▒
[✓] P12  ─ Test pin backfill                                  [test]      ▒
[✓] P13  ─ Manual QA + lessons + PR rollback matrix           [docs]      ▒
```

13 phases, all green.

## Manual QA matrix (run before squash-merge to dev)

| Area | Verify | Phase |
|---|---|---|
| F1 onboarding | StepIndicator widths, fees.vue copy, /learn-skip /fees-skip both → /accelerator | P1 |
| F2 incoming | First-receive popup, multi-contract queue, USDC-twin (cross-network), C1 auto-trust on add, C2 popup reopen recovery | P7, P8 |
| F3 cancelled detail | Brutalist match, dev mode raw error preserved, every category chip variant | P9, P10 |
| F4 tx-card name | "Claim Fee Juice" displays correctly | P2 |
| Settings toggle | Visibility OFF → no popup; toggle ON → no event leak (P6 fix) | P6 |
| Profile switch | A → B → Send shows tokens AND balances AND contacts immediately (P11) | P11 |
| Trust popup a11y | Tab to expand toggle; aria-controls only present when expanded | P3 |
| Multi-account same-hash | A's outgoing tx with shared hash → only A's records deleted, B's stay | P5 |

## Per-phase rollback notes

| Phase | Independent revert? | Pairs with |
|---|---|---|
| P1, P2, P3 | YES (independent) | — |
| P4a | YES (test only; survives any rollback) | — |
| P5 | YES (per-hash guard + account filter; safe alone) | — |
| P6 | YES (visibility seed; safe alone) | — |
| P7 | YES (tactical popup-side; independent) | — |
| P8 | YES (tactical replay watcher; depends on P4a only as the regression test) | P4a |
| P9 | YES, but P10 consumes the helper | P10 |
| P10 | NO; depends on P9's helper. Revert requires reverting P9 OR stubbing the helper inline. | P9 |
| P11 | YES (single file send.vue; independent) | — |
| P12 | YES (test-only, additive) | — |

## Residual risks documented for the PR description

- **C1 race**: scheduler poll could beat the popup's `setTrustAllow` write
  (~100ms vs 30s poll cadence; extremely unlikely under normal usage).
- **C2 rapid-switch race**: a replay for an old profile could enqueue
  stale payloads after the user has switched profiles; the existing
  triple-key queue dedup absorbs the worst case (popup doesn't open
  for a non-active triple).
- **P11 scope**: only `send.vue` was rehydrated; other identity-scoped
  consumers (activity.vue, RecentActivityView, settings/tokens,
  detail pages) are deferred to the trust-state-machine follow-up arc.
- **Full trust-state-machine concurrency** (mutex serialization,
  scanContract orphan race, cross-profile address collision, journal
  `submitting.txHash` hook, full setUserAddTrustHandler architecture):
  ALL deferred to a separate planning arc per the 4-round audit
  iteration's split decision.
- **Multi-window popup duplicate**: out of scope.

## User sign-off items pre-squash

- A1 em-dash strategy: in-place substitution applied (default per plan).
  Confirm rendered copy reads naturally.
- P9 categorical copy table (`categoricalLabel` outputs): the seven
  category buckets + context strings. Confirm each matches your
  mental model.
- P10 brutalist visual: screenshot review of the failed/cancelled
  detail page across `simulation`, `network`, `popup_bound`,
  `user_rejected`, and `sw_restart_post_prove` error kinds.
- P11: visit Send page on profile A → switch profile to B → tokens +
  balances + contacts populate immediately (no token-detail-click
  required).

## Open items for the next arc

- The full trust-state-machine concurrency design (per-`(profile,
  network, contract)` mutex with proper unlocked-helper split).
- scanContract upsert orphan race (end-of-scan sweep + reconcileTrust).
- Self-note PXE race full fix via journal `submitting.txHash` hook +
  4-site reconcile invocation.
- Cross-profile address collision fix (journal cross-reference in
  outgoing-tx lookup).
- Full `setUserAddTrustHandler` architecture with startup-ordering
  guard.
- Proper C2 fix with AbortController + cancellation on rapid profile
  switch.
- P11 sweep across all 10+ identity-scoped consumers via shared
  `useIdentityScopedFetch` composable.
- Perf optimization for the 8-10 storage reads per scan.

These were all written up + audit-graded across 4 codex Reject rounds.
The split decision (this arc ships user-visible bug fixes + tactical
C1/C2; the concurrency-safe trust state machine ships separately)
preserved the analysis without rolling it into a single mega-PR.
