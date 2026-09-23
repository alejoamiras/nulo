# Phase 4 — the frozen-account canary on Firefox

## What landed

`tests/e2e/network/frozen-account-canary.test.ts` runs on both browsers: `describe.skipIf(isFirefox)(CHROME_ONLY.canary, …)`
is a plain `describe`, the restart helper is `restartBackground` (the browser, not Chrome, is what may have reaped
an idle background), stage 5 is worded as a background restart, and the header's run instructions name both
browsers. The recon held: the spec already closes every extension page before `stopBackground` and wakes the
successor with a fresh popup, so nothing else had to change. No new pin was introduced, so there is no mutation
check to record: the un-skip's own evidence is the Firefox count below (`2 passed`, none skipped — the old
`skipIf` printed the same two as skipped).

## Gate (prover-ON: native `presto-server` 1.1.1, bb 5.2.0, `VITE_NULO_PRESTO_REQUIRED=1`, `--retry=0`, alone)

- `cd ROOT && bun run lint` → exit 0; `cd EXT && bun run test -- scripts/e2e` → 6 files, 89 tests, green.
- **Chrome** → `Test Files 1 passed (1)`, `Tests 2 passed (2)`, 0 skipped; the canary named in the output
  (`✓ frozen-account canary — derive, ctor-deploy with real proof, authwit consume, SW-restart re-derive 58883ms`);
  vitest `Duration 109.89s`; step wall clock (sandbox up → down) 1 min 57 s.
- **Firefox** → `Test Files 1 passed (1)`, `Tests 2 passed (2)`, 0 skipped; the canary named
  (`… 77171ms`); vitest `Duration 128.19s`; step wall clock 2 min 15 s.
- All fifteen `[frozen-canary]` step lines printed on both browsers, `terminating the background` included — the
  Firefox kill was a real `stopBackground` (no "already stopped it" warning), and the successor came up under the
  recovery popup.
- Presto: 6 `Received /prove request`, 6 `Proving succeeded`, 0 failures — three per browser (the grant, the
  authwit consume, the post-restart send), split by timestamp between the two legs.

The aztec node prints `[aztec-node] Error: Address already in use (os error 98)` at boot on every leg and then
serves normally; noise, recorded in Phase 2 already.
