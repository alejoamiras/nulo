# Phase 4 — the gate in CI

## Placement

- `selfpay-phase.test.ts` → the existing heavy runner (`Run / heavy / fee-methods + selfpay-phase`,
  `pr-network-e2e.yml`), `retry: "0"`, proverless like the other fee flows, excluded from the
  shard pool; `sim-from-selfpay.test.ts` → the shard pool (auto-discovered, never excluded).
- `scripts/ci-cd/behavior-gating.test.ts` pins: selfpay-phase in a dedicated `test_files` job at
  retry 0 and proverless; sim-from-selfpay absent from `exclude_files`; the pool at retry 0; both
  spec files present. The existing exclusions-equal-dedicated pin covers the mirror.
- `bun run lint:actions` exit 0; `bun run test:ci-gating` — 84 pass, 0 fail.

## `dev` branch protection (read-only `gh api`, 2026-09-05)

```json
{"checks":[{"app_id":15368,"context":"network-e2e-status"},
           {"app_id":15368,"context":"quality-status"},
           {"app_id":15368,"context":"smoke-e2e-status"}],
 "strict":false}
```

`network-e2e-status` is required on `dev`, and the heavy job is in its `needs` + result loop —
a red `selfpay-phase` blocks a merge.

## Proof run

`workflow_dispatch` of `pr-network-e2e.yml` on this branch's commit `b6f3949a` (the Phase 4
commit; the two later commits are docs only): run 33997790992 —
https://github.com/alejoamiras/nulo/actions/runs/33997790992



### Run 33997790992 (`workflow_dispatch`, commit `b6f3949a`, pre-rebase)

| job | result | wall-time |
|---|---|---|
| Run / heavy / fee-methods + selfpay-phase | **success** | 7 min 25 s (23:07:31 → 23:14:56), retry 0, proverless |
| Run / heavy / concurrent-confirm | success | |
| Run / canary / real-proving | success | |
| Run / shard 1/5, 2/5, 3/5, 5/5 | success | |
| Run / shard 4/5 | failure — `wallet-locked-mid-session`: "Expected no popup but 1 new popup target(s) appeared: …#/popup/auth" | |
| `network-e2e-status` | failure (shard 4) | |

Shard 4's red is the locked-session flake dev root-caused in #548 (`122149ad`), merged AFTER
this branch's base `898a3b99`; the file is untouched by this branch. The branch is now rebased
onto that commit; the PR's own `network-e2e-status` is the clean proof. The gate itself —
`selfpay-phase` on the heavy runner at retry 0 — passed first time on a GitHub runner.

### PR #549 (`pull_request`, rebased HEAD `de8e48fc`) — all required gates green

| check | result |
|---|---|
| `quality-status` | pass |
| `smoke-e2e-status` | pass |
| `network-e2e-status` | **pass** — all five shards (shard 4 included, on the #548 fix), both heavy jobs, the canary |
| `Run / heavy / fee-methods + selfpay-phase` | pass, retry 0 — the second green on a GitHub runner |

`LESSONS_FILE=implementations-plan/self-pay-setup-fix/lessons/phase-4.md`
