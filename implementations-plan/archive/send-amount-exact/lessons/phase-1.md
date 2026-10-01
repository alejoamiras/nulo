# Phase 1 · Red in the browser

- `data-testid="fee-estimate"` sits on `FeeCostReadout.vue`'s landed-estimate row; nothing drawn
  changes.
- `tests/e2e/network/send-amount-exact.test.ts` is written as the plan's P1 says. Its two waits
  (`waitForEstimateAndConfirm`, `waitForAmount`) throw with what the page showed, so a refused
  amount reads as one instead of a bare timeout.
- The extension's `typecheck` covers `src/` only, so the spec was also checked with a throwaway
  tsconfig (deleted after the run): its only errors are the two every network spec shows there
  (`inject`'s key and the fixture name), the same as `send-amount-clamp.test.ts`.
- **Gate.** `bun run lint` exit 0 (after `biome format` wrapped one `waitForFunction` call);
  `bun run typecheck:all` exit 0.
- **Red run**, Chrome, on the unfixed code, retry 0:
  `NODE_OPTIONS=--dns-result-order=ipv4first NULO_E2E_PROVERLESS=1 NULO_E2E_RETRY=0 bun run e2e:agent tests/e2e/network/send-amount-exact.test.ts`
  → exit 1, 1 test run, 1 failed, 0 skipped (229 s). It failed where the plan expected, the typed
  step's estimate wait:
  `Error: no estimate with Confirm on: {"amount":"1,234,567.12345679","confirmDisabled":true}`,
  caused by `TimeoutError: Waiting failed: 120000ms exceeded`. So in Chrome filling the
  destination does leave the amount field (inference 3): dev's float blur rewrote the amount to 8
  places, the validator refused the grouped string, and the estimate never landed.
