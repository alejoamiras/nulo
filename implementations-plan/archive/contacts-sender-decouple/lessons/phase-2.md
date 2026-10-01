# Phase 2 — Copy corrections

## What shipped
- `RecentActivityView.vue` token empty state: "Add contacts to send and receive {symbol}." →
  "Send or receive {symbol} to see activity here." (A1-approved copy; receiving needs no setup).
- `useContactImportExport.ts`: "Import competed successfully" → "Import completed successfully".
- `ImportContactsPopup.vue`: banner now counts — "N sender(s) will be registered on <network>."
  (`hasIncomingSenders` boolean → `incomingSenderCount`); sender additions are a stated, counted
  consequence.
- Advanced senders page reframed to the niche it now is:
  - delete-confirm description → "Only affects tokens using legacy address-derived delivery —
    standard transfers are still detected automatically"
  - empty state → "Standard transfers are detected automatically. Add a sender only for tokens
    using legacy address-derived delivery."

## Sweep
`grep -rn -i "detect incoming|detecting incoming|Register as sender|incoming private transfers|receive private transactions" apps/extension/src` (non-test) → **zero hits** after the edits
(Phase 1 had already removed the toggle-carried copy; the two Advanced-surface strings above were
the only survivors and are now niche-framed).

## Gotcha
Biome's formatter rejected the long empty-state line in `senders/index.vue`; fixed via
`biome check --write` on that file (wrapped the confirm description assignment).

## Validation gate (plan Phase 2)
- `bun run lint` → exit 0
- `bun run typecheck` → exit 0
- `bun run test` → 3173 passed | 7 todo
- Sweep output pasted above (clean)
