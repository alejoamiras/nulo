# Phase 0 — Feasibility spike

Goal: de-risk the seam before any CI churn. 0a = proverless mines through the
full extension path; 0b = the barrier holds/releases/times-out and preserves
cancel semantics; decide D1.

## D1 decision → Approach 2 (gate at the offscreen `proveTx` boundary)

Chosen during wiring, grounded in the code (not guessed):

- `execution-coordinator.ts:152-170` `proveAndSend` is a FROZEN sequence:
  `checkCancelled → journal(proving) → prove → checkCancelled(:160) → … → send`.
  The post-prove `checkCancelled` at `:160` is what `cancel-mid-prove` pins.
- A gate awaited inside `PxeService.proveTx` (`service.ts`, offscreen) holds
  AFTER the SW has journaled `proving` and BEFORE `pxe.proveTx` returns. So it
  replaces prove *duration* while the SW's existing pre/post `checkCancelled`
  pair is untouched — **no new cancel checkpoint** (satisfies D13 by
  construction). The production `execution-coordinator` is not modified at all.
- Approach 1 (stub `PrivateKernelProver`) was rejected for the spike: createPXE
  passes the injected prover as the `proofCreator` and the execution prover
  calls `simulate*` on it, so a1 would need a real WASM-backed delegate
  (audit I2's MV3 risk). Approach 2 needs no delegate.

Prove-entered marker (D13): the journal already carries
`progress: { stage: "proving", enteredProveAt }` (set at coordinator `:156`,
before the gate). That existing field is the marker — no new instrumentation
in the runtime.

## Quality bar (user directive: "very pretty and lovely, not a monkey patch")

Built as first-class injected collaborators, mirroring the `AcceleratorProver`
+ `onPhase` seam:
- `ProofGate` interface + `NOOP_PROOF_GATE` in `@nulo/aztec-runtime` (chrome-free),
  threaded `PxeOffscreenDeps.proofGate → PxeService`.
- `ProductionPxeFactory { proverless }` for the proverEnabled:false build.
- `ChromeStorageProofGate` + double-opt-in `e2e/config.ts` in the extension
  shell, constructed strictly inside `if (E2E_PROVERLESS)` (source-structure
  invariant) so DCE strips it from prod.

## Results

### Code gates (✓)
- `bun run typecheck:all` → all 12 packages exit 0.
- `bun run lint` → exit 0.
- Gate unit tests (`chrome-storage-proof-gate.test.ts`) → 4/4 pass:
  instant-by-default, hold→release, **safety-timeout-loud** (covers 0b's
  timeout requirement at unit level), and the check-then-subscribe race.
- Existing pxe tests (service/chain-runtime) → green after constructor changes
  (backward-compatible optional params).

### Prod-guard validation (✓ — the security-critical axis, cheaply de-risked)
Two standalone builds:
- **Proverless build** (`VITE_NULO_E2E_PROVERLESS=1 + _CONFIRM=1`): stamp
  `NULO_E2E_PROVERLESS_BUILD_STAMP` PRESENT, gate key `nulo:e2e:proof-gate`
  PRESENT. ✓
- **Production build** (no flags): stamp ABSENT, gate key ABSENT,
  `ChromeStorageProofGate` class ABSENT. DCE (layer 2) + double-opt-in
  (layer 1) confirmed; the negative grep (layer 3) has nothing to catch
  because DCE already removed everything. ✓

### On-chain validation (0a / 0b)
- 0a via `transfers.test.ts`: **stalls — but NOT a proverless fault.** Diagnosed (journal+logs dumped to `/tmp/spike-result.json`): the wallet **send form crashes** before any tx is created — `AmountCard.handleAmountInput` calls `purgeNumber(model.value)` (`AmountCard.vue:33`) with NO null guard (unlike the guarded `:91`/`:105`), and `model.value` is null when the e2e helper dispatches the synthetic `input` event → `TypeError: Cannot read properties of null (reading 'replace')` (`amount.ts:43`). The journal stays EMPTY (`progression: ["t=0.0s []"]`); the tx is never built. This is a pre-existing UI null-gap, structurally UPSTREAM of proving (proverEnabled:false only affects the offscreen `proveTx` step, after simulate/submit). `transfers` passes in CI, so the send form works there — this is a local input-timing artifact. **`transfers` is therefore a poor LOCAL 0a probe** (depends on the fragile wallet send form, which also has a real latent NPE worth a separate fix).
  - **Pivot:** validate the proverless tx path via a **dApp `sendTx`** flow (playground → execute popup), which bypasses AmountCard entirely — exactly what the canaries + `cancel-mid-prove` use, and what 0a's "dApp sendTx mined" item requires.
- 0a (dApp `sendTx` mined; `multi-account-from` ×3 → D7): _running (pivoted spike)_.
- 0b (barrier hold/release end-to-end + semantics through the offscreen): _pending_.

### Side-finding (out of arc scope, logged for a follow-up)
`AmountCard.vue:33` `purgeNumber(model.value)` is a latent NPE when `model.value` is null (the input handler fires before the model is a string). Trivially fixable (`model.value ?? ""`). Not fixing here (no scope beyond plan.md); CI is unaffected (transfers green there). Worth a standalone `fix(send):` PR.

LESSONS_FILE=implementations-plan/e2e-proverless-stub/lessons/phase-0.md
