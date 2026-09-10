# Phase 6 — the Permit2 fields and the hostile token list (arc 3)

## What landed

- `fixtures/l1-wallet.ts` records every Permit2 permit as signed (`permits()`); `pages/journal.ts`
  `depositCalldata(pub, txHash)` decodes the router call (`bridge` / `bridgeWithFuel`) with viem.
- `deposit-token.spec.ts` cell 1 and `deposit-token-gas.spec.ts` cell 13: exactly one permit,
  spender = the router, the ERC-20 and the whole amount, deadline after the signing time, nonce
  and deadline equal to the deposit calldata's.
- `tokens-hostile.spec.ts` 34b (its own file: the hostile list is a worker option, served by the
  egress fence from `fixtures/token-list-hostile.json`): malformed entries dropped one by one, a
  no-contract address fails closed on selection, a duplicate symbol stays its own tile. The
  assertions wait for the list's surviving tile before snapshotting the keys.

## Gate (retry 0)

| Command | SHA (tree) | Result |
|---|---|---|
| `bun run e2e:tools -- --shard=1/2` ∥ `--shard=2/2` (own sandboxes, retry 0) | `1d5c7d18` | shard 1: 33 passed, 1 failed (cell 40); shard 2: 28 passed, 3 failed (24c, 24b, viewports) — 61/65; the four failures were test-side (below) |
| the Phase 6 files (`deposit-token`, `deposit-token-gas`, `tokens-hostile`) | `1d5c7d18` | all green inside the sharded run above (cells 1, 13, 34b ✓); unchanged since |
