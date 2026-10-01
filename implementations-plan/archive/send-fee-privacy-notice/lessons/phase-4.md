# Phase 4 — e2e

- **Scope widened on the owner's instruction** ("add all the necessary e2e tests… QA is of the upmost
  priority"): one network test became three, one per funding shape (no gas / public gas only / both).
  The public-gas-only shape makes the *defaulted* fallback reachable end to end, which the plan's I3
  had written off as unit-only.
- **Attempt 1 — 2 red, neither a product bug.**
  1. `feeJuiceReadyExtension` had no consumer and had rotted: its `forceBlock` passed an
     `AztecAddress` object where `mintPublicTokens` wants a string (`str.startsWith is not a
     function`, swallowed by the `.catch` and logged ~30×), so no block was ever forced, the anchor
     never covered the L1→L2 message, and the claim failed `No L1 to L2 message found`. Fixed to the
     same call shape `feeJuiceImportedExtension` uses. A fixture nobody runs is a fixture nobody knows
     is broken.
  2. `page.waitForFunction(fn, {}, SEL)`: `patchPagePolling` recognises the options argument by a
     `timeout`/`polling` key; a bare `{}` has neither, so the wrapper splices its own options in and
     `{}` becomes the page function's first argument. Presence-waits timed out — and the
     absence-wait in the other test would have passed **vacuously**. Every wait now carries
     `{ timeout }`. Written into the `e2e-testing` skill; a grep found no other caller in the trap.
- **Attempt 2 — 1 red, again the test.** On a fresh popup with a saved Fee Juice pick, the trigger
  previews that pick while balances load, and a preview pays nothing, so the row is (correctly)
  absent. `waitForFee` resolved on the preview and the row assertion raced it. The reopen step now
  waits for the row itself. Also in the skill.
- **Attempt 3 — green.** The gate command, retry 0, proverless: 4 files / 11 tests, exit 0, 487 s wall
  for the whole command. New tests: no gas 3.0 s · public gas only 64.8 s · both gases 28.0 s (I5: ~96 s
  added to the `fee-methods` shard, plus the `feeJuiceReady` fixture's bridge+claim, now actually paid).
- **Smoke** (`send-fee-privacy.test.ts`, retry 0, armed build): exit 0, 26 s. Settled state logged:
  `{"method":null,"notice":false,"explained":true,"takeover":false}` — hold with the reason shown,
  never the public payer, and no "you have no gas" takeover on balances nobody read.
- **I6:** `selectFeeMethod` has two callers outside `fee-methods` (`fixtures/popups.ts`, the dApp
  execute window — no origin, legacy behaviour); both `tx-sendTx-*` files green.
- **I9 canary:** `transfers.test.ts` green — a default-reliant Send on an unfunded account still gets
  the sponsor.
- **Screenshots** come from the network test itself (`NULO_E2E_SHOT_DIR`, opt-in, off in CI):
  `notice-private-private.png`, `notice-private-public.png` in this plan folder.
- Prover-ON run of `fee-methods.test.ts` (informational): see the line appended below.
