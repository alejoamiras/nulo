# P7 · Red in the browser for both fits

`send-amount-exact.test.ts` gains the fit checks as `expect.soft`, so one run reports all of them.
"Cannot scroll" is read by setting the input's `scrollLeft` to 1e6 and reading back how far it
went, then restoring it: it works the same in Chrome and Firefox (the two runs below agree to the
pixel), and does not depend on whether a browser reports an input's text overflow in
`scrollWidth`.

## Red, on `dd74c6cd` plus the spec (no fit in the tree)

`NODE_OPTIONS=--dns-result-order=ipv4first NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 bun run e2e:agent
tests/e2e/network/send-amount-exact.test.ts`, then with `NULO_E2E_BROWSER=firefox`.

| Browser | Exit | Time | Failed checks |
|---|---|---|---|
| Chrome | 1 | 149 s | typed at rest `hidden` 262 px at 40 px; Max at rest `hidden` 261 px; the review's amount line overflows by 147 px at 30 px |
| Firefox | 1 | 185 s | the same three, the same numbers |

The checks expected to pass on this code passed in both: with focus after Max the field is at
40 px, and `send-amount-meta` did not move between focus and rest (no type changes yet). The
estimate, Confirm, the exact values and the corner all passed, so each red is a fit and nothing
else. Chrome's log shows `[aztec-node] Error: Address already in use (os error 98)` once during
boot; the node came up anyway and the run went on. Its cause was not looked into.

`bun run e2e:reap`: nothing to reap. ✓
