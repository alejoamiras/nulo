# M2 implementation plans

> **M2.3 status (2026-04-22)**: COMPLETE — d/a/b/c shipped. Cut version 0.12.0. M2.3-d closed the real profile-switch read/write race (bounded registry fetch + reader counting + writer-FIFO drain + 5-min force-release). M2.3-a lifted per-chain state into `ChainRuntime`/`ChainRuntimeRegistry` keyed by (profileId, chainId) — also fixed a latent double-init bug by moving getOrInit inside `guard.read`. M2.3-b put artifact resolution behind an `ArtifactRegistry` with explicit policy + pinning + config.onUpdate subscription. M2.3-c hoisted the 20 `ensureOffscreenRunning` calls into the offscreen `ServiceClient` transport base via a template-method + hook. See per-sub-PR audit-diffs where they deviate from the plan.
>
> **M2.2 status (2026-04-22)**: COMPLETE — a/c/e/d/b/f shipped. M2.2-g (parallel-run verification gate) skipped — the original design assumed a strangler-fig split, but the actual implementation was drop-in (each sub-PR replaced the god-service method in place), so there's no legacy pipeline to compare against. See `2/plan.md` for the full rationale. Golden fixtures remain an optional quality-of-life follow-up.
>
> **Next up**: M2.4 (worker-heavy services) or jump to M3 (package extraction). M3 is now unblocked since M2.2 + M2.3 both shipped; M2.4 is off the M3 critical path.


Implementation plans for the remaining M2 god-service splits. Drafted post-M2.1 on `plan/m2-implementation-plans` branch. Each plan is **audited by codex (xhigh effort) + a general-purpose review agent** before execution.

Entry state: `master` at `2249dd7` (0.11.23). M2.1 (ProfileService split) + M2.5 (shared CAIP module) + M2.6 (crypto vectors) shipped. Remaining sub-milestones:

| Sub-milestone | Plan file | Sub-PRs | Est. |
|---|---|---|---|
| **M2.2** | [`2/plan.md`](./2/plan.md) | 7 — OperationPlanner, FeeStrategy×4, ContractResolver, TxRequestBuilder, AuthwitDiscoverer, ExecutionCoordinator, parallel-run verification | 3-5 weeks |
| **M2.3** | [`3/plan.md`](./3/plan.md) | 4 — ChainRuntime, ArtifactRegistry, PxeProcessSupervisor, ReadWriteGuard-finish | 2 weeks |
| **M2.4** | [`4/plan.md`](./4/plan.md) | 3 — TokenBalanceService split, NodeFactory port, WindowManager service | 2 weeks |

Every sub-PR has detailed scope, interfaces, tests, and risks in its plan doc. Plans match the M2.1-e depth — they're meant to be picked up months later without re-doing planning work.

## Cross-sub-milestone dependencies

A handful of cross-cuts shape execution order:

1. **`ContractResolver` (M2.2-c)** sits above `PxeServiceClient.getContractArtifact`. **`ArtifactRegistry` (M2.3-b)** rewires PxeServiceClient internals to use a policy-driven resolver. Landing order is flexible — they don't touch the same API. Recommendation: **M2.2-c first** so ContractResolver gains benefits from the current behavior, M2.3-b follows.

2. **`PxeProcessSupervisor` (M2.3-c)** modifies the `ServiceClient` transport base. **Any new client created during M2.2-f or M2.4 picks up the change automatically** — no extra work. Land M2.3-c before M2.4 if possible so WindowManager's client gets the default.

3. **`WindowManager` (M2.4-c)** preserves the contract expected by **`PasskeyRecoveryCoordinator` (M2.1-c)**. No coordinator change required.

4. **`ReadWriteGuard` finish (M2.3-d)** is the only M2 piece that materially fixes correctness **today** (profile-switch races in PxeService). Every other sub-PR is a testability / structure improvement. Consider **priority-bumping M2.3-d** to early-arc execution if profile-switch stability is a QA pain point.

## Recommended execution order

**M2.2 is on the critical path to M3** (`@nulo/aztec-runtime` extraction). M2.3 and M2.4 are testability gains off the critical path. We start M2.2 while context is fresh.

**Within M2.2**: both audits flagged a dependency cycle — `FeeStrategy` depends on `TxRequestBuilder` depends on `AuthwitDiscoverer`. Order: `a || c → e → d → b → f → g`.

**Within M2.3**: `d` (ReadWriteGuard finish) MUST ship before `a/b/c` because a/b/c consume the guard; shipping them on a broken guard means any regression in the window is ambiguously "race or refactor". This is intra-M2.3 ordering — it does NOT mean d must be the first thing in the M2 arc.

| Slot | Sub-PR | Reason |
|---|---|---|
| 1 | **M2.2-a** ‖ **M2.2-c** | OperationPlanner + ContractResolver in parallel (independent, no shared files). Smallest M2.2 pieces, confirm the pattern. |
| 2 | **M2.2-e** | AuthwitDiscoverer. Depends on c. |
| 3 | **M2.2-d** | TxRequestBuilder (standard + NoFrom). Depends on c and e. |
| 4 | **M2.2-b** | FeeStrategy × 4. Depends on d. Biggest single piece (1w). |
| 5 | **M2.2-f** | ExecutionCoordinator. Depends on everything above. |
| 6 | **M2.2-g** | Parallel-run + golden-fixture verification. Cutover gate. TxExecutionRequest-only diffing. 1-1.5w. |
| 7 | **M2.3-d** | Finish ReadWriteGuard (correctness fix). 3d. Good palate-cleanser between M2.2 and the rest of M2.3. |
| 8 | **M2.3-c** | Hoist ensureOffscreenRunning. 2d. |
| 9 | **M2.3-a** | ChainRuntime (keyed by profileId+chainId). |
| 10 | **M2.3-b** | ArtifactRegistry. |
| 11 | **M2.4-c** | WindowManager (injectable). Unblocks unit tests on Passkey + DappInteraction. |
| 12 | **M2.4-b** | NodeFactory port. Unblocks NetworkService unit tests. |
| 13 | **M2.4-a** | TokenBalanceService split. Best AFTER M2.2-f so BalanceProjector consumes the stable ExecutionServiceClient. |

**Total remaining M2 work:** 7-9 weeks.

**Note on M2.3-d priority**: the audits recommend "d before a/b/c within M2.3". They do NOT recommend "d before the entire M2 arc". The profile-switch race is real but narrow; it hasn't surfaced in user QA. Slotting M2.3-d after M2.2 is the honest placement — critical-path work first.

## What follows M2

M3 (package extraction) depends on M2 completion because extractions like `@nulo/aztec-runtime` need the post-M2.2 surface. M2.6 golden vectors (shipped) run on every package boundary change.

Any deviation from the per-plan specs during execution should be captured in an `audit-diff.md` next to the plan, so future-you can see why the plan and the code diverged.
