# Phase 1 — Q17 resolver seam completion

## Landed

- `contract-resolver.ts`: standalone `findFunctionByName` / `findFunctionBySelector` (frozen lookup order: `functions[]` then `nonDispatchPublicFunctions[]`) + `ensureContractsRegistered` method with per-site `onRegister`/`onSkip` hooks.
- Conversions: `tx-request-builder.ts` (name lookup, selector loops, BOTH register prologues), `authwit-discoverer.ts` (name + selector), `helpers/batched-view-simulation.ts` (deleted its local duplicate helpers + register loop; test stub borrows the real prototype method), `service.ts` executeUtility region (name lookup only).
- Deliberately NOT converted: `service.ts`'s single-contract register variant with its double-fetch quirk — deferred to P6 with a pin (plan D-deferral; the audits' "don't smuggle behavior changes" rule).
- `contract-resolver.test.ts` +8 tests: frozen-order pins (functions[] wins name collisions), selector fall-through, registration with hooks. Selector derivation stubbed (Barretenberg WASM not booted in unit env — `vi.mock` partial of `@aztec/stdlib/abi`, lookup logic is order/equality not hashing).

## Gates

- lint: 0 errors. typecheck: clean. Unit suite: 2,283 pass (then 2,288 after P2 landed on top).
- Codex parity review (session `019eb7eb-...`): **parity confirmed, no findings** — lookup order, frozen error strings at call sites, registration semantics, encoded-call backfill mutation all verified; dropped pre-loop count log line confirmed assertion-free.
- e2e:agent (×10 multiplier, bundle-stamped): **66/69 — exact baseline profile match**. Sole failure investigated below.

## The concurrent-sendtx-confirm investigation (the bulk of this phase's time)

Symptom: `concurrent-sendtx-confirm` failed locally on EVERY main-worktree run (baseline clean tree, P1 tree ×2, isolated idle run), while green in CI.

Evidence chain:
1. Throwaway diagnostic (instrumented test, reverted): r1 ok; **r2 = "AVM simulation failed: Attempted to emit duplicate siloed nullifier 0x…"** (attempts 1+3) / "Invalid tx: Existing nullifier" (attempt 2). T2 collides with T1's nullifier.
2. Stale-install discovery en route: the branch worktree was missing `@nulo/design` + `@nulo/bridge-core` workspace links (dev's bridge arc landed after the last `bun install`). Fixed; faucet dev-server errors disappeared; test still failed → not the cause, but a reminder: **`bun install` after every dev merge**.
3. Discrimination matrix:
   | Tree | Worktree | Result |
   |---|---|---|
   | dev @ `e9d698f` | fresh | PASS |
   | branch tip (P0+P1+P2) | fresh | **PASS** |
   | baseline/P1/P2 trees | main (stale state) | FAIL ×4 (12 retry-executions) |
4. The `e9d698f..f308431` window (bridge UX PRs #80/#81) touches only faucet/bridge-core/design, **zero lockfile delta** — could not affect the wallet build. Combined with (3): the branch is exonerated; the MAIN WORKTREE ENVIRONMENT was the cause.
5. Culprit state: `packages/extension/wallet_data_0x322813fd…` (the e2e EmbeddedWallet's persistent PXE store, 184K) + stale `.e2e-state`, surviving across sandbox lifetimes. Purged; post-purge main-worktree validation: see gate addendum below.

## Gate policy addendum (supersedes part of phase-0 policy)

- **Purge `packages/extension/.e2e-state` and `wallet_data_*` before every phase-gate e2e run.** Stale embedded-wallet PXE state across sandbox lifetimes produces deterministic duplicate-nullifier failures in the concurrent suite that look like wallet regressions.
- The phase-0 "load + gas-envelope flake" attribution for this test was WRONG (kept for the record): the real local failure was environmental state. CI remains authoritative for the concurrent heavy job either way.
- Follow-up candidate for dev (out of arc): e2e harness should isolate/clean the embedded-wallet data dir per run (it already isolates ports; the wallet_data dir escaped that design).

## Deviations

- Phase ordering note: P2 was implemented and committed while P1's gate e2e was still queued (stacked-checkpoint discipline maintained — separate commits; P1's parity reviewed pre-P2; the tip fresh-worktree PASS covers P0+P1+P2 cumulatively for the investigated test).

LESSONS_FILE=implementations-plan/execution-decomposition/lessons/phase-1.md
