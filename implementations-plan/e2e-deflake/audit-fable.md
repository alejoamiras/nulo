# audit-fable.md — fable audits

## Round 2 — post-implementation review (fresh context, max effort, 2026-08-12)

Attacked every new wait against the product code it observes. Verdict: no false-PASS
holes in the final tree; findings (ALL APPLIED same-session):

- **Med — `resetProfile`'s `navigateByHash` sat OUTSIDE the try**: the characterized
  race can land between the hash-set and the equality poll → uncaught throw, no retry,
  no nav-trace dump, leaked trace interval. → Moved inside the try; recorder re-armed
  per call (fixes the frozen-trace nit too).
- **Med — `waitForFreshBalanceRow` refresh starvation**: no ambient re-sync exists and
  failed batches are dropped, so `maxRefreshes=5` burns out ~60s in, leaving a 90–150s
  dead tail → false-FAIL (a flake REINTRODUCTION with good diagnostics). → Default now
  spans the budget at envelope pacing (`ceil(timeoutMs / 15s)`).
- Confirmed the two codex-round-4 fixes (fork `general|auth` + proceed-on-unobserved;
  token-bound freshness + boundary-matched symbol-scoped card assert) — independently
  attacked the proceed-downgrade for false-PASS: a phantom partial restore still fails
  at the convergence step (the (account,token) join finds no rows); a retained profile
  that fully re-syncs is designed recovery. Both landed.
- **Low — `security-reset` 30s ceiling** converts diagnostic paths into generic vitest
  timeouts (per-test fixture launch+registration counts INSIDE the budget; worst-case
  inner waits alone exceed 30s). → 60s ceiling (headroom for diagnostics, not a wait).
- **Low — `register-token` sweep miss**: bare `clickByTestId(execute-confirm-btn)`
  bypassed the standardized approvable gate/diagnostics. → routed through
  `approveExecute`.
- **Nit — telemetry cwd anchor**: `.e2e-state` via `process.cwd()` can land outside
  gitignore/artifact globs on direct vitest invocations. → NOT changed (all blessed
  entry points set cwd; noted for a future tidy).
- Attacked-and-sound: `waitForProfilePurged` ("airtight" — verified 3-phase tombstone
  lifecycle leaves no all-absent in-flight state), hostile-storage parsing, the
  approvable predicate's two signals, the setup-aztec preflight (cache semantics can't
  poison; composite `bash -e` makes the asserts real), SKILL.md factual consistency,
  every helper call-site contract.

# Round 1 — plan audit (Plan-agent, 2026-08-11)

Reviewer: independent top-tier Claude subagent (Plan role, model fable), fresh context,
full packet (adversarial/security + assumption-attack + implementation-critique + recon
cross-check). Verified load-bearing claims against sources, including the live aztec
5.0.1 installer script.

## Verdict

**conditional approve** — conditions:

- **C1 (High)**: add an `internal-bin` toolchain assertion (`test -x .../internal-bin/forge`
  and `anvil`, on both cache-hit and fresh-install paths) to `setup-aztec` in the SAME PR
  as the foundry-toolchain deletion, so a future aztec-installer regression fails loudly at
  setup instead of mid-L1-deploy.
- **C2 (High)**: Fix 1's 90s→300s is NOT a signal change as drafted (terminal predicate
  unchanged — "80% sophistry, 20% legitimate dedup"). Either surface it to the owner as an
  explicit budget-change Ask, or restructure signal-first: wait storage-first on the
  import-completion fact (`nulo:ui:activeAccount` pointer write, or profile row), THEN
  assert the route with a short budget — implementer must verify pointer-write-before-route
  ordering including the `/popup/auth` branch.
- **C3 (Med)**: Fix 4 must keep one scoped UI render assertion after row convergence (the
  tests must keep proving projection→render) AND state the refresh bound explicitly
  (≤N refreshes within the existing total budget) — otherwise the spam respawns.
- **C4 (Med)**: write the certification run-counting rules down BEFORE Phase 6: a
  `labeled`-event run counts if fully green; each of the 3 runs must be a distinct trigger
  event; a superseded/cancelled run is void (not red); zero re-run-button uses; any red
  restarts the count at zero.

## Key findings (beyond the conditions)

- **Foundry deletion argument survives attack**: the live aztec 5.0.1 installer's
  `install_foundry` is unconditional, version-pinned, retry-wrapped, lands in
  `internal-bin`; `FOUNDRY_DIR` export is dead. The `~/.foundry` "fallback" is NOT a
  safety net — a version-mismatched forge silently taking over KILLS the L1 deploy
  (the `--batch` signature); deletion converts a silent-wrong-version hazard into a
  loud failure. (Gap → C1.)
- **Fact misattribution (Low)**: the driver's 300s rationale is "30s bounded recovery +
  slow-runner restore + margin" — the "node-client 60s abort × backoff" rationale belongs
  to `waitForActiveAccount`'s 240s. The plan borrowed the wrong wait's docs for Fix 1's
  root-cause story; whether the ROUTE leg (vs the account leg) transits RPC is an
  inference. 3×90s-failures prove 90s structurally short; they do not prove 300s
  sufficient.
- **Fix 2 corroboration confounded (Med)**: `security-reset.test.ts` uses a fresh
  per-test browser fixture — "same wait, never flaked" is not a clean control. If the
  mechanism stays unreproduced, ledger entry 2 must read "de-spam + hardened, mechanism
  unconfirmed — WATCH" (at ~11% historical rate, 3 greens ≈ only ~70% confidence for this
  entry). [Superseded in part: the flake DID reproduce locally, solo, first attempt —
  instrumented diagnosis in lessons/phase-2.md.]
- **Fix 5**: tombstone-absence alone is ambiguous (also true before deletion starts, and
  after a pre-tombstone rejection) — the combined predicate (tombstone AND owned-row
  clearance) is non-optional; capture the profile id pre-click. `security-reset.test.ts`
  has a 30s file-level test timeout the sweep must fit inside or consciously adjust.
- **Fix 3 verified sound**: native `disabled` aggregates all gates; `pointerEvents`
  clause necessary (`.loading`/`.disabled` are CSS-only for non-button tags); NOT waiting
  on `estimatingOps` is the correct honesty call; 60s/120s budgets properly
  precedent-grounded; the `"fj"|"fpc"` mismatch is real.
- **Gate integrity verified**: retry counts, required checks, skip predicates untouched.
  Fix 2's retry-once is acceptable (conditioned on re-asserting the route; value is
  diagnostics). Fix 3 is a genuinely NEW signal, not a raise.
- **Scaffold leakage**: none (zero product files in the change map); strike the vestigial
  "if product data-* added" language from the Architecture preamble + Phase 4 gate.

## What looks right (per the auditor)

- The ledger's evidence work (attempt-level mining, source-echo trap avoided, exit-86
  disproven, non-flakes recorded).
- Fix 5's inversion (observe the purge, then the route) — "the cleanest root-cause fix
  in the plan"; the ReadWriteGuard reader-drain coupling is a real systems insight.
- Timeout-on-failure diagnostics everywhere — future reds get cheaper even where a
  theory is wrong.
- Fixture-first over product-emitted readiness: correct; recon's reuse table honored.
