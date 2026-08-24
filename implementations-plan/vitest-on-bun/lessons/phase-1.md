# Phase 1 — Flip + full matrix at one commit + real-runner dispatch — lessons

## Flip commits (one per workspace, in order)

`6d7e87b1` landing · `f29ef4ca` wallet-bridge · `fbcb0563` wallet-sdk-schema-patch · `535338b7` aztec-runtime · `1774d789` wallet-core · `2d3aa181` wallet-crypto · `e4c99717` extension-messaging · `aa5a0d1b` extension (`test` + `test:components`) · `eda75588` design · `96e69a7a` bridge-core · `8625af47` faucet (`test` + `test:e2e` jsdom smoke). Every `test` script is now `bun --bun vitest run…`; extension `test:e2e`/`test:e2e:all`, root `test:e2e:*`, `agent.sh` untouched.

## `test:watch` decision — stays on Node (all three)

Smoke per package (Bun): `setsid bun --bun vitest --reporter=dot`, 20 s boot, append a line to a test file, 15 s, SIGINT the group, check for survivors.

| Package | boot + initial run | rerun observed after the edit | leader after SIGINT | orphans |
|---|---|---|---|---|
| design | ✓ 37 files | no | dead | 0 |
| faucet | ✓ | no | dead | 0 |
| bridge-core | ✓ | no | dead | **1 `bun` process survived** (killed by the smoke) |

Control (Node, design, identical script): also "no rerun observed" — so the rerun detection is a weakness of the smoke (append-a-line + 15 s + dot reporter), not evidence against Bun. The **orphan on bridge-core is Bun-specific** (Node control: 0; design/faucet on Bun: 0). Ruling per plan.md (flip `test:watch` ONLY behind a passing smoke): not passing → the three `test:watch` scripts stay `vitest` (Node). Revisit in a later arc with a smoke that drives a rerun deterministically (e.g. vitest's interactive `r`) and repeats the SIGINT check ≥3×.

## Matrix commit

`8625af47` (HEAD after the last flip; tree clean). Evidence below is bound to it.

## Clean-install attestation

(filled by the matrix run)

## Soak matrix — 12 suites × {Node reference, Bun candidate} × 30 runs, retry-0, sequential

(filled by the matrix run; comparator stdout preserved verbatim)

## `bun run test:all` ×5 under Bun (the concurrent CI shape)

(filled by the matrix run)

## Real-runner dispatch bound to the matrix commit

(filled after the push + `gh workflow run pr-quick.yml`)
