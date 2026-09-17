# Phase 4 — docs + browser validation

## What landed

- `packages/extension-messaging/README.md`: file-map rows for `port-registry.ts` and the harness; the
  "port reconnects are silent" invariant became the three failure contracts (far-end close →
  reconnect + plain `Error("Client disconnected")`; send on a torn-down port → `RpcDisconnectedError`;
  failed open → `RpcConnectError`, nothing retries, `connect()` never rejects).
- `implementations-plan/index.md` and the old plan's status line.

## Order of the gates

The codex post-implementation loop ran BEFORE the browser gates, not after: another agent's e2e loop
was loading the host (load ≈ 9–12 on 12 cores) when smoke first finished, the network suite is known
to mass-fail under host load, and codex is light locally. It also meant the browser gates ran on the
final tree — round 1 changed runtime code (`connect()`'s catch), which would otherwise have forced a
second pass anyway.

## Local runs

| gate | tree | result |
|---|---|---|
| smoke (`build:chrome` with CI's e2e flags, then `test:e2e`) | `7b125716` (pre-loop) | exit 0 — 32 files passed / 1 skipped, 123 tests passed / 6 skipped |
| `bun run typecheck` · `bun run test:all` · `bun run lint` | `47fa916e` (final) | all exit 0 — extension 506 files / 6270 tests, messaging 13 / 229 |
| smoke, repeated on the final tree | `47fa916e` | exit 0 — 32 files passed / 1 skipped, 123 tests passed / 6 skipped |
| network shard 1/2 | `47fa916e` | exit 0 — 42 files passed / 1 skipped, 52 tests passed / 2 skipped |
| network shard 2/2 | `47fa916e` | exit 0 — 41 files passed / 1 skipped, 58 tests passed / 1 skipped |

Both shards were green on the first run; no flake, no re-run.

## How the network shards were run

`NULO_E2E_PROVERLESS=1 bun run e2e:agent --shard=N/2` with `--exclude` for the six files CI runs in
dedicated lanes (`fee-methods`, `selfpay-phase`, `concurrent-sendtx-confirm`, `transfers`,
`tx-sendTx-default`, `frozen-account-canary`) — the same partition as `pr-extension-network-e2e.yml`'s
proverless pool, split two ways instead of CI's matrix. Those six need lane-specific setup (a barrier,
a real prover) that a plain local shard does not give them; the PR's CI runs them, including the
prover-ON canary. Shards ran sequentially, each owning its own anvil + sandbox + playground.

Shard 1 started while another agent's e2e loop still held the host at load ≈ 8 of 12 cores (it
peaked at 27 during sandbox boot) and passed anyway; waiting for a silent host was not an option
because that loop never paused for longer than a minute.

## Gate

smoke exit 0 · both network shards exit 0 · `bun run lint` exit 0 — all on `47fa916e`.
