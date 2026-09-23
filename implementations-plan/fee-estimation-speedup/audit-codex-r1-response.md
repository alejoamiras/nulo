reject (with blocking findings: the FPC one-pass collapse is invalid for PrivateFPC, and real-fee discovery silently widens the authwit-signing surface).

## Critical

- **Fact F1 — Pass 1 is not redundant.** `GasSettings.forEstimation` deliberately installs above-protocol gas limits (`node_modules/@aztec/stdlib/src/gas/gas_settings.ts:129-156`). PrivateFPC’s `pay_fee()` reads that envelope through `get_max_gas_cost` and deducts the full maximum (`node_modules/@alejoamiras/private-fee-juice/target/private_contract-PrivateFPC.json:6665`). Today Pass 1 measures the app, then installs a bounded envelope before simulating PrivateFPC (`fee/fpc-strategy.ts:48-76`). Outline A instead executes `pay_fee` under the huge estimation envelope, potentially exhausting balance, selecting extra notes/recursion, or reverting. This invalidates the claimed send `2→1` correctness and inference 4. Keeping JS handler `maxFee` unused is irrelevant; the Noir contract reads transaction gas settings.

- **Inference I2/I3 — Real-payload discovery creates a new signing capability.** User-added Sponsored FPCs need only expose the right zero-argument ABI (`fpc/service.ts:231-256`; `fpc/handlers/default-sponsored-fpc-handler.ts:8-15`). Such a contract can emit a `CallAuthorizationRequest`. Today the FJ discovery build excludes that call, and the later unstubbed FPC sim fails for lack of an authwit. The fold stubs it, converts its effect into `add_private_authwit` (`authwit-discoverer.ts:77-123`), then calls `account.createAuthWit` automatically (`tx-request-builder.ts:161-199`). A malicious/custom sponsor can therefore obtain an implicit authorization that was previously denied. Fixture equality does not test this negative-security property. Require a dedicated Ask: fee-payload effects must be rejected or explicitly approved; do not call them “superset-faithful.” The wallet-sdk least-privilege model likewise treats authwit creation as a distinct permission.

## High

- **Ask A1 — Split FPC semantics.** Preserve two-pass estimation for PrivateFPC. Collapse only canonical SponsoredFPC after proving its call is gas-envelope-independent; custom FPCs need the conservative path. The owner must either relax “all `fpc` send 2→1” or approve a handler/type-specific target.

- **Fact F2 — The reuse fingerprint is incomplete as specified.** “Action graph + fee settings” omits effective `FeeOptions`: dApp gas limits, teardown limits, max fees, priority fees and padding are normalized at `operation-planner.ts:225-243` and alter the built request. Hash the complete normalized build input, including execution mode, not merely `FeeSettings`. `call.args` is `unknown[]` (`packages/wallet-bridge/src/action.ts:37-54`), so an action-kind switch alone does not provide canonical nested encoding. Define and reject unsupported canonical value types.

- **Fact F3 — A generalized entry must preserve post-send bookkeeping.** `BuiltStandardTx` includes `txCalls` and `pendingPublicAuthwits` (`tx-request-builder.ts:69-81`); successful dApp sends record those grants only after broadcast (`dapp-send-executor.ts:449-470`). A reuse hit that stores only transfer-like fields silently loses activity data or auth-registry reconciliation. Cache those values, but never cache profile-bound `node`/`pxe`/`account` handles.

- **Ask A2 — Add chain-identity revalidation.** The inherited ladder checks profile, endpoint URL, base fee and pending hashes (`transfer-estimate-reuse.ts:162-220`) but reuse bypasses `buildStandard`’s live-chain assertion (`tx-request-builder.ts:119-124`). A same-URL endpoint can drift to another chain/version. Snapshot and re-fetch `l1ChainId`/`rollupVersion`, failing closed. Keep the same-batch pending-set test; sequential recording should make op1 invalidate op2.

## Medium

- **Inference I1 is actually a verified fact, but is irrelevant.** At pinned 5.0.1, `skipTxValidation` only controls the node validation performed after simulation/gas construction (`node_modules/@aztec/pxe/src/pxe.ts:1271-1293`); it is gas-neutral. Outline A nevertheless always runs sim B, so this inference justifies no optimization.

- **Ask A3 — Cancellation needs an actual resource contract.** Caller-minted tokens plus “cleanup on completion” do not bound many queued, non-preemptible simulations. Reject duplicate tokens, key entries by profile/session, impose per-profile/global active limits, and make cleanup ownership-safe. Otherwise collision can replace another controller, while refires can grow the registry and PXE queue. Cancellation also cannot save a sim already waiting inside `withPxeWrite` (`pxe/service.ts:831-855`), so PR A overstates its speed value.

- **Implementation boundary:** `FeeStrategyContext.discovery` makes every fee strategy aware of a dApp-only concern, while extending `SimulateTxFn` with transport-specific stub fields impersonates upstream opts. Prefer a pipeline orchestrator around strategies and a typed simulation request/separate stub argument. Keep `estimateId` in an extension-local approval envelope; adding popup metadata to public `packages/wallet-bridge` `Operation` leaks an internal protocol detail.

## Low

- **Fact F10 is misstated.** Current official gh-stack documentation says **private preview**, requiring repository enablement—not public preview. Phase 0 should test enablement before planning native stacks. [GitHub gh-stack documentation](https://github.github.com/gh-stack/getting-started/quick-start/)

## A vs B

Choose A’s validated unstubbed sizing stance, but reject A as written. B is materially worse: it repeats the PrivateFPC envelope bug, trusts stub-account gas plus an unproven 10% pad, changes embedded/FJWC budget semantics, and concentrates every strategy’s risk in one PR. Upstream precedent warrants measurement, not wholesale parity.

Revised order: debug deletion; reuse with complete validation/bookkeeping; discovery fold onto the existing app-only FPC first pass; then measured, Sponsored-only collapse. Keep PrivateFPC two-pass.

## What looks right

- Delete `[SYNC-DEBUG]` RPCs.
- Keep sim B until measured.
- Preserve mutation discipline and NO_FROM/embedded exclusions.
- Single-shot, fail-closed reuse inside the execution slot.
- Unit sim-count pins plus prover-on network canaries.