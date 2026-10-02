# P1 phase 4 — originKey-forwarding tests (P1 complete)

**Done.** Pinned the `originKey` threading end-to-end:
- `dispatcher.test.ts`: `dispatch("sendTx")` forwards `originKey=ctx.origin` to
  `execute` — plus a case proving `originKey` is set even with NO FIFO hooks
  (a dApp can't bypass the per-origin cap by arriving without baton hooks).
- `dapp-interaction/service.test.ts`: `originKey` rides the hooks bag through to
  `executeOperations` on both the popup (`approveInteraction`) and silent paths.

**Coverage rationale:** the cap-reject → `TooManyPendingError` + journal
terminalization is covered by the mutex cap unit tests (reject beyond N) + the
error-envelope test (-32005). A full saturated-lane integration test (8+
concurrent sendTx) is disproportionate, and the network e2e doesn't naturally hit
the cap, so it's not added — the pieces + the codex-audited wiring suffice.

**P1 COMPLETE:** dual cap (mutex) + `TooManyPendingError`/-32005 +
`acquireExecutionSlot` wiring + `originKey` threading — all unit-tested, codex
"ship-it" on the mutex+error before wiring.

**Validation:** wallet-bridge 82 · dapp-interaction 3 · lint ✓ (full suite next).
**Next:** P2 spike — one private-call NO_FROM confirming 3× end-to-end.
