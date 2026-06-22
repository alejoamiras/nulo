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

- **C1 race**: the scheduler's `startScheduler` fires an IMMEDIATE poll
  on token-add (zero-delay), THEN 30s ticks. The race is with the
  immediate-kick poll (not just the 30s tick); in practice the PXE
  call + note-decode latency still exceeds the popup's sub-100ms
  `setTrustAllow` write. Documented per post-impl codex audit Low.
- **C2 identity-switch race**: closed via three layers landed across
  the post-impl audit cycles. `onIncomingTransferPending` drops
  payloads for non-active triples on ingress; the identity-switch
  watcher purges queued payloads and closes a stale open popup
  (full triple comparison: profile + network + account per the 3rd-
  cycle audit Medium fix); `dequeueNextPendingTrust` defensively
  skips mismatched entries on its way out. Covers profile-switch,
  network-switch, AND account-switch transitions.
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

## Post-impl audit fixups (after codex Reject)

Codex post-impl returned Reject with 2 Highs + 1 Low + 1 Nit. The two
Highs were real and addressed in a fixups commit; the Low was a docs
correction (applied here); the Nit was a false-positive (verified via
grep — no source consumers of the dropped testid; only stale built
output in `dist/`).

### High #1 — Stale-triple defense in PopupManager

`PopupManager.vue:onIncomingTransferPending` now drops payloads whose
`(profileId, networkId, accountAddress)` doesn't match the LIVE
`appStore` triple. Under rapid profile switch (A→B→A), a replay
emitted for A's triple can resolve after the user has moved to B;
without this defense, the stale payload would enqueue under A's key
and the allow/reject closures would bind to A's triple at dequeue
time. Test added:
`PopupManager.test.ts > stale-triple defense: payload for non-active
triple is dropped`. The existing cross-network test was updated to
switch `appStoreState.network` between fires so each payload is
valid at fire-time.

### High #2 — send.vue activeTokenIdx reset + onMounted sequence guard

`refetchIdentityScopedState` now resets `cacheStore.activeTokenIdx`
when the new token list doesn't contain the prior id + re-runs
`initSendType` + `initReceiverType` to re-validate the form state.

`onMounted` now routes through the sequence counter so a slow mount-
fetch from a prior identity can't overwrite newer data. Also resets
`activeTokenIdx` if the stored id isn't in the post-mount token list.

(No automated regression test added for the send.vue paths; the
component has too many service-client dependencies for a focused
mount test. Covered in manual QA.)

### Low — Race-window doc correction

`phase-7.md` and the residual-risks section of this file are updated
to clarify that the scheduler's race is with the IMMEDIATE-kick poll
(zero-delay on token-add), not only the 30s polling tick. The race
still favors `setTrustAllow` in practice (PXE latency &gt; trust
write) but the documentation now matches the source.

### Nit (dismissed — false positive)

Codex flagged that the P10 restructure dropped the
`journal-detail-error-kind` testid. Grep confirms NO source-tree
consumers exist; the only hit is the stale built file at
`dist/chrome/assets/_id_-DZI4_a19.js` (regenerated on every build).
The new testids `journal-detail-context` + `journal-detail-error-kind-tag`
are what's referenced by tests and downstream automation.
