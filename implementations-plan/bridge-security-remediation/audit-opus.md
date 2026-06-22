# Opus (Fable-substitute) audit trail — bridge-security-remediation

Opus 4.8 `Plan` subagents across the deep-blueprint rounds (fresh context each round).

## Round 1 — independent plan draft
Caught that **cross-chain atomicity is unattainable** the naive way (portal init needs the L2 bridge address; the bridge needs the L1 portal address) → proposed deploy-then-init + init-once guard + read-back-abort. Independently confirmed the immutable token → token redeploy. Pinned the compile taint to exactly `IRollup.sol:16,18` → minimal-interface fork. Identified `pr-quick.yml` as the real CI orchestrator.

## Round 2 — contradiction-check (verdicts)
- **disagree**: flip the compile primary to l1-artifacts-root staging; keep the shim test-only; spelled out the `getCanonicalRollup()→IHaveVersion` double-cast and the `IOutbox.consume` vs `IInbox.consume` distinction (a stubbed `IOutbox` breaks the WITHDRAW path).
- **agree, holes**: CREATE2 cycle-break sound, but `predict()`/`deployAndInit()` must share ONE forked `initCodeHash` (assert `predict==CREATE2(forkedInitCodeHash)` before any L2 deploy); retry-collision squats `predict(salt)` → bump per attempt or require-empty-code.
- **B6 ordering bug**: the plan swapped the config then validated; must validate (build/test) against the candidate BEFORE the terminal swap.
- Confirmed the salt hex/decimal identity (independently) and that the F-004 threat is overstated (router already binds floor).

## Round 3 — double audit (FRESH hostile). Verdict: **reject**
The decisive blocking find both rounds had missed: **the CREATE2 factory cannot embed the real-interface portal.** Proven by compile attempt — the full body compiles only in the l1-contracts root (solc 0.8.30); a factory living with the `bridge-evm` test artifacts can only `new` the minimal-interface **shim**, so the atomic deploy would put stubbed withdraw/outbox bytecode into the live cutover, and no gate proves otherwise. Resolution (brief-sanctioned): drop CREATE2 → single deploy-then-init of the l1-root-compiled real-interface portal. Plus blocking: B3 deadlocks its own gate (removes `set_minter` but its gate runs `deploy-sandbox --smoke` which calls `set_minter`); B5's fork "new portal refuses re-init" is unrunnable before the portal exists on-chain; `deposit-testnet --use-existing` is a rewrite, not a flag; `placePortalSource` hash-pins the canonical artifact so it rejects the fork (verify target + solc 0.8.30↔0.8.28 undesigned). Fact correction: the Token artifact's "13 fns" doesn't list `mint_to_public` (routes via `public_dispatch`) — the no-minter-setter conclusion holds; "scripts take `--config`" is a B4 deliverable, not a fact.

## Disposition
Both Round-3 rejects converged → the CREATE2 keystone was removed and the plan re-architected to deploy-then-init real-interface + guard + read-back-abort; B3 now updates the sandbox/deposit wiring; the fork re-init assertion moved to B-canary/B6; a `smoke-existing-testnet.ts` replaces the `--use-existing` flag; `placePortalSource` reworked for the fork. The irreversible/product Asks were taken to the user and decided. Final fresh-context codex verdict recorded at the gate.
