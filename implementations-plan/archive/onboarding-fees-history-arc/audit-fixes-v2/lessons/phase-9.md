# P9 lessons — B2 categorical label helper

## Outcome

`feat(journal-state): categorical failure label helper for tx detail page` —
69/69 tests pass in `journal-state.test.ts` (+9 new P9 pins).

## What shipped

`packages/extension/src/utils/journal-state.ts`:

- New exported type `CategoricalFailureLabel = { label: string; context: string }`.
- New exported pure helper `categoricalLabel(op: OperationRecord)` that
  maps `op.error?.kind` to a user-friendly category + one-line
  explanation. Consumes ONLY wallet-controlled fields (`op.error?.kind`).
  NEVER reads `op.subtitle` (dApp-controlled).

Category table:

| kind | label | context |
|---|---|---|
| user_rejected | "You rejected" | "You stopped this transaction." |
| popup_bound | "Popup closed early" | "The popup closed before this transaction could finish." |
| simulation / prover / stuck_proving / stuck_queued | "Stopped before broadcast" | "Your wallet caught this before reaching the network. Often balance, fees, or invalid call." |
| sw_restart_post_prove / stale_on_resume | "Interrupted mid-flight" | "The wallet restarted before confirming this. Transaction may still be on-chain — check the explorer." |
| network | "Network error" | "Couldn't reach the network. The transaction may not have been submitted." |
| transfer / dapp_execute | "Reported by app" | "The connected app reported an error." |
| anything else / unknown | "Error" | "Something went wrong with this transaction." |

The "Stopped before broadcast" vs "Interrupted mid-flight" split is the
B2 deliverable: simulation-vs-on-chain failure distinction surfaced
through "before broadcast" vs "after broadcast" framing. Pending user
sign-off on the copy table at P13 manual QA.

## Tests (+9 new P9 pins)

`packages/extension/src/utils/journal-state.test.ts`:

- Pin every category bucket (user_rejected, popup_bound, simulation
  group, sw_restart group, network, transfer/dapp_execute group,
  unknown).
- **Sanitize-invariance pin**: build an op with
  `subtitle: "http://evil.example/danger"` + a valid error.kind →
  assert the returned label + context strings NEVER contain "evil"
  or "http". Proves the helper is dApp-input-independent.

## Files

- `packages/extension/src/utils/journal-state.ts` (+~50 lines).
- `packages/extension/src/utils/journal-state.test.ts` (+9 cases).

## Open items

- Copy review: user sign-off pre-squash on the label + context
  strings (tracked in P13 manual QA).
- P10 consumes this helper in the journal/[id].vue restructure.
