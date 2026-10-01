# P2 lessons — method label "Claim Fee Juice" (D1)

## Outcome

`fix(tx-enrichment): humanize claim_and_end_setup as "Claim Fee Juice"` —
36/36 tests pass in `tx-enrichment.test.ts` (+1 new pin).

## What shipped

`packages/extension/src/utils/tx-enrichment.ts:14-30` — one allowlist
entry appended to `METHOD_LABELS`:

```ts
claim_and_end_setup: "Claim Fee Juice",
```

`humanizeMethodName` already routes through `METHOD_LABELS` first; the
addition is purely additive. `getMethodLabel` (used by the capability
popup) returns `null` for unknowns, so no side-effect on trust-
sensitive surfaces.

## Tests

`packages/extension/src/utils/tx-enrichment.test.ts:39-44` — one
regression pin under the existing
`humanizeMethodName — fallback when no label exists` describe block.

## Files

- `packages/extension/src/utils/tx-enrichment.ts` (+1 line)
- `packages/extension/src/utils/tx-enrichment.test.ts` (+6 lines)

## Open items

None.
