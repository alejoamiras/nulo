# Codex audit transcript — proverless-network-stabilization

Two codex touchpoints in the `/blueprint deep` flow (a third — the final fresh-context pass —
appends below when complete). Paths rewritten repo-relative per the committed-artifact rule.

## Round 1 — independent plan draft (Plan B), session `019eccfb-7ef6-7821-baf1-0124a1ac5f0d`

Codex drafted a full independent plan. Key independent contributions that survived consolidation:

- **Caught the brief's `protocolTimeout` error** (it's already `300_000` at `tests/e2e/fixtures/extension.ts:52`) → "set protocolTimeout" is not a credible Mode-2 fix.
- **`waitForSendTxActiveStage` is a helper-CONTRACT bug**, not only a DOM race: it's global/unscoped and treats `succeeded` as success → a journal wait can satisfy before the intended tx is observably in flight. Split the contract; deprecate the helper.
- The **journal has no stage history** → "assert ordered sequence post-hoc" is unavailable; don't widen the stub.
- The **proof-gate is already a typed injected seam** (`ProofGate`/`NOOP_PROOF_GATE`); keep the single seam.
- **A constrained-container runner already exists** (`packages/extension/scripts/e2e/docker-ci-like.sh`); reuse it. Flagged the **runner-shape conflict** (brief said 2-core; repo's docker note says ~4 vCPU — verify).
- **`SPONSORED_FPC_SALT`** appears unused by the network flow (runtime hardcodes salt 0); remove from the required gate.
- Make-required: zero-flake is not literally provable; require **zero retries consumed** in the acceptance soak + an **admin override for platform incidents** (≠ quarantine).

## Round 2 — contradiction-check + audit of the consolidated plan (resume of the same session)

**Verdict: `reject`** — blocking:
1. **Phase 2's "request-scoped journal helper" is impossible with the current schema** — concurrent same-session txs share `sessionId`; no per-request key exists. (The missed flaw.)
2. **The "fail-closed" filter still leaves real bypass paths** — shared workspace packages (`@nulo/wallet-core`, `@nulo/extension-messaging`, `@nulo/wallet-crypto`) the extension depends on, and `patches/**` (root-declared patched deps), are not covered.
3. **The live retry policy is unresolved + unenforced** — "zero retries consumed" is stated but no phase changes the gate off `retry:2` or enforces a failure rule.

Additional findings: Phase 3's gate proves only "didn't repro under this load shape," not "Class B fixed"; phase order should put safety-pinning first; bigger CI trust surface ignored (`setup-aztec` `curl|bash`, float-pinned `dorny/paths-filter@v4` + `actions/checkout@v6` in the trusted pre-gate jobs); keep `probe=1` off the required path.

**Disposition (all addressed in the audit-hardened plan):**
- Blocking 1 → **D2/D12**: reframed to **session-scoped COUNTING** (the concurrency assertions need counts, not per-record identity); correlation key deferred until a test needs it.
- Blocking 2 → **D7**: TRUE fail-closed inversion incl. `wallet-core`/`wallet-crypto`/`extension-messaging` + `patches/**` + root lockfiles.
- Blocking 3 → **D9**: enforceable zero-retry soak rule + live `retry:1` config implemented in Phase 5/6.
- Phase-3 gate → **D14**: real-runner soak required (container necessary-not-sufficient).
- Order → **D11**: safety → Class A → instrument → Class B → triage → soak → ship → require.
- Trust surface → **D13**: SHA-pin pre-gate actions; `curl|bash` + `probe=1` + `disable_accelerator` var documented in Security.

## Round 3 — final fresh-context pass, session `019ecd1d-0072-71c0-8ec1-d0cd11c895cc`

A NEW codex session (no anchoring) re-evaluated the audit-hardened plan with the full decision trail.

**Verdict: `conditional approve`** — 3 conditions:
1. **Phase 3's gate referenced a Phase-5 artifact** — it required `network-e2e-soak.yml`, introduced only in Phase 5; the dispatchable `pr-network-e2e.yml` can't target/repeat a single file. A `/loop` couldn't satisfy Phase 3 honestly. → **Folded (D15):** soak workflow built in Phase 2.
2. **The watchdog could false-red legitimate tests** — the plan referenced the 300s budget, but `hookTimeout:300_000` is fixture-setup only; `authwit-lifecycle` legitimately runs to `timeout:1_200_000` with `360_000` waits. A fixed ~300s wall-clock would kill it. → **Folded (D3):** progress-based no-progress stall detector (or derived from each test's declared timeout), not a fixed wall-clock.
3. **The gate's own workflow/composite-actions are mutable in the PR under review** — SHA-pinning third-party actions doesn't stop a PR editing `.github/workflows/**` to weaken the check reviewing it. → **Folded (D16):** required review on `.github/workflows/**` + `.github/actions/**` before the flip.

**Confirmed sound (codex explicitly stress-tested these):** the session-scoped counting helper (D2/D12) is sufficient — fixtures are per-test fresh (`extension.ts:470`) and the approval-boundary test creates no prior `dapp_execute` traffic before the two-click snapshot (`concurrent-sendtx-approve.test.ts:62`); the fail-closed inversion closes the shared-dep + `patches/**` bypasses; D7, D8, D13 sound.

**Residual notes (non-blocking, folded):** before/after memory-cap is supporting evidence, not causal proof (the soak's repeated green is the proof — Phase 3 gate softened); session-counting is not a blanket future substitute for per-record identity (captured in D12 + Assumptions); `setup-aztec` `curl|bash` + `vars.NULO_E2E_DISABLE_ACCELERATOR` remain documented residual trust surfaces.

All 3 conditions are incorporated, so the plan carries no unaddressed high-severity finding into the approval gate.
