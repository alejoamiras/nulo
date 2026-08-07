# Phase 3 — Canonical-Sponsored FPC fast path

## What shipped

- `FpcStrategy` split into `buildAndEstimateSponsoredFastPath` (single build(EXTERNAL, payload-included, inert `Fr.ZERO` maxFee) + single sim + FPC-fidelity `finalizeGasLimits(node, txReq, sim, padding, baseFees)`) and `buildAndEstimateTwoPass` (verbatim shipped choreography, incl. the Phase-2 between-pass cancel check).
- Discriminator is entirely wallet-side: `fpc.infoData?.type === DefaultSponsoredFpc && infoData.isProtocol === true && op.fee.gasLimits/teardownGasLimits unset`. `isProtocol` is the FPC service's existing read-time decoration (pinned canonical address per the row's own chain) — no new protocol-address plumbing needed, and a cold cache decorates `false` ⇒ safe two-pass. Optional chaining doubles as the undecorated/legacy-shape guard.
- New structural pins: SIM-COUNT (build×1 EXTERNAL + sim×1), old-vs-new gas-slot sentinel shape (identical composition to the two-pass output), and four negative-eligibility pins (custom limits / non-protocol / PrivateFPC / undecorated ⇒ build×2).

## Gotchas

- `vi.fn(async () => x)` infers `[]` args — indexing `.mock.calls[0]?.[1]` is a TS2493 error under typecheck (vitest run doesn't catch it). Use the file's `(mock.calls[0] as unknown[])[1]` idiom. Caught by `typecheck:all`, not by the test run — always run both.

## Gate result: PASS

- `bun run --cwd apps/extension vitest run src/wallet/services/execution/fee` → 32/32.
- `bun run lint` exit 0 · `bun run typecheck:all` 13/13 · `bun run test` 3785 passed.
- **Milestone network e2e (prover-ON canary pair)**: `bun run e2e:agent tests/e2e/network/transfers.test.ts tests/e2e/network/tx-sendTx-default.test.ts` → 2 files / 2 tests passed in 206 s — a real Sponsored-FPC-paid transfer confirmed on-chain and a dApp execute-window tx with a real proof accepted by the node, both riding the new single-pass estimate.
