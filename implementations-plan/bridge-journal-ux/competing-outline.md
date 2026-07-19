# bridge-journal-ux — competing outline (B): derive-at-render + resume-as-redo

The cheapest-path alternative to the main plan, for the audits to weigh.

## Thesis
Don't persist new failure state and don't build in-place RESUME. Instead:

1. **Derive the leg at render time**: the card already knows `depositTxHash`/`leafIndex`/
   `claimTxHash`. Add ONE probe: when a pending deposit record has no `depositTxHash`, the card
   fires a read-only allowance check (`allowance(owner, portal) >= amount`) and, if an approve is
   found sufficient, renders "Approval confirmed — nothing was deposited; no funds moved." No new
   record fields, no migration surface, nothing new persisted.
2. **Resume-as-redo**: instead of re-entering the dead record, the card's RESUME button discards
   the record and pre-fills a fresh form submission with the same amount/privacy — one click, new
   record, the already-set allowance makes it skip the approve prompt. The dead record's secret is
   abandoned (it was never bound on-chain — provably safe for the pre-deposit shape).

## Why it might win
- ~1/4 the code of the main plan: no journal shape change, no flow re-entry machinery, no
  permit re-sign path for fueled tokens (a fresh submission re-signs naturally).
- Zero hostile-journal surface added: RESUME never feeds old journal fields into on-chain writes —
  the fresh submission regenerates everything.
- The derive-at-render allowance probe is the honest source of truth (chain state, not a
  persisted claim about what happened).

## Why it might lose
- The dead card can't say WHICH leg died without persisted state — the allowance probe only
  covers the approve shape; a wallet-rejected deposit vs a timeout look identical.
- Discard-and-redo loses the record's audit trail (createdAt, the death) — the journal stops
  being a truthful history.
- Render-time chain probes on every card visit add RPC load + a loading state where the main
  plan reads a local field.
- For fueled tokens, "redo" re-quotes the route — the user may get a different fuel quote than
  the dead attempt (surprising, though arguably more correct).

## Phases (if chosen)
1. Allowance probe + honest pre-deposit copy on the card.
2. RESUME-as-redo wiring (discard + prefill + submit), fuel then token.
3. Rig smoke gate.
