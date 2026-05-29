# v3 phase 4 — network e2e for parallel popups

## What landed

- `concurrent-sendtx-approve.test.ts` (standard SHA-1 matrix) — the approval
  boundary. Fire two sendTx, approve popup #1, assert popup #2 opens *while T1
  is still active* (≥2 records same session, exactly one `queued`, ≥1 active,
  none terminal). Deterministic discriminator vs pre-v3 (where popup #2 only
  opened after T1 terminalized). Polls the journal until T1 claims (sub-second
  gap between mutex-enqueue and claim). Abandons T1 mid-prove + rejects popup #2
  to stay cheap; reaped at teardown.
- `concurrent-sendtx-confirm.test.ts` (dedicated heavy job) — both approved,
  both prove sequentially, both confirm. Doubles as the mutex no-double-spend
  pin: both transfers draw the same public balance, so two `ok` results prove
  serialization holds.
- CI: `confirm` excluded from the matrix + run in a new
  `network-e2e-heavy-concurrent` job (own runner, separate prover queue from
  fee-methods). `approve` stays in the matrix.

## Local validation (full sweep + targeted re-runs)

Verdict: **green**. Per-run results (darwin arm64, machine under load):

| run | result |
|---|---|
| E1 concurrent-sendtx-approve (standalone) | 1/1 pass |
| E2 concurrent-sendtx-confirm (standalone = heavy job) | 1/1 pass |
| shard 1/5, 3/5 | 10/10 pass each |
| shard 2/5 | 9 pass, 1 fail (contacts-sender — unrelated flake, see below) |
| shard 4/5, 5/5 (re-run) | 9/9 and 8 pass + 1 expected skip |

The two tests that exercise the v3 change end-to-end (E1, E2) both pass. The
matrix re-runs cover the existing-test regression surface (incl. the
`executeAztecSendTx` / `executeNoFromSendTx` paths).

## Infra lessons (NOT code bugs — environment)

1. **Sequential sandbox sweeps exhaust a loaded machine.** Running 6
   `e2e:agent` sandboxes back-to-back, while the box also ran unrelated aztec
   work + MCP servers + a `gh run watch`, made shards 4/5's aztec node miss its
   90s health check ("did not become healthy within 90000ms", "Block hash not
   found", "Timeout awaiting isMined"). They **skipped all tests and still
   exited 0** — `E2E_REQUIRE_SETUP=1` does NOT convert a node-health-timeout
   into a loud failure (only deploy failures). So a "PASS" with `N skipped`
   where `N` == the shard's whole file count is a silent infra failure, not a
   real pass. Always check the per-shard `Test Files … passed` vs `skipped`.
2. **agent.sh teardown leaks faucet vites.** After the sweep, 4 orphaned
   `packages/faucet/.../vite` processes were still running (one per incompletely
   torn-down run). They compound the resource pressure in (1). Reaping them
   (`pgrep -f 'nulo-1/packages/faucet' | xargs kill`) between runs + after, and
   the shards came up clean. Worth a follow-up to make the agent's
   global-teardown kill the faucet child explicitly.
3. **For a reliable local sweep on a busy machine: run shards one at a time,
   reap faucets between, and re-run any shard that reports all-skipped.** CI
   doesn't hit this — each shard is its own dedicated runner with no contention.

## The one non-pass

`contacts-sender.test.ts > delete-confirm … unregister-sender toggle` failed in
shard 2 (TimeoutError on a `clickByTestId` → `waitForFunction`, retried ×2).
Unrelated to this change (contacts management, no sendTx/execution/interaction
code path). Confirmed a load-induced flake by a clean standalone re-run.
