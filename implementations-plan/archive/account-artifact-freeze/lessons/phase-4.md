# Phase 4 — Dedicated frozen-account execution canary

## What shipped

- `apps/extension/tests/e2e/network/frozen-account-canary.test.ts` — the per-bump execution gate,
  five explicit stages, zero ok-or-error tolerances:
  1. Reveal the profile master via the wallet UI → re-derive BOTH accounts test-side through the
     ACTUAL frozen path (`NuloAccount.new` on the vendored artifact + descriptor) → set-equality
     with the wallet's granted addresses.
  2. `getNullifierMembershipWitness` on the live node → both init nullifiers ABSENT.
  3. First tx as A = grant public authwit (frozen ctor + `set_authorized` via the multicall
     deploy path) → result `ok` → mined → A's init nullifier PRESENT (node ACCEPTED the frozen
     constructor).
  4. Authwit-CONSUMING tx as named caller B (B's own frozen ctor rides along) → `ok` → mined →
     B's init nullifier PRESENT.
  5. SW kill (CDP `Runtime.terminateExecution`) → unlock recovery → active address intact →
     playground reconnect → post-restart sendTx as A → `ok` → mined. The background rebuilds the
     account from the seed on this path and hard-throws on drift, so the ok pins re-derivation
     AND execution of the re-derived account.
- Bind-to-procedure: `aztec-update` skill now carries the canary as a MANDATORY prover-ON step in
  Phase 1 + Branch A delivery ("a red canary BLOCKS the bump; hold the line — new major is the
  deliberate alternative"), plus a "frozen account surface (never bumped)" block. `UPDATE.md`
  coupling entry added. The CI `extension-network` path filter already covers aztec-runtime
  source + manifests + `bun.lock` (verified in the plan's final audit), so deps-only bumps run
  the network suite; the skill step makes the canary's green a named requirement.

## Native-proving run setup (homelab, Linux x86_64)

- Downloaded `accelerator-server` v1.0.6 from the pinned GitHub release; extracted-binary sha256
  verified equal to the CI pin in `_network-e2e.yml`
  (`995d13a4d877c06ccdb457de3c54ac13f85a8ceb6f3b3ddf13aecbb026b8c3d3`).
- Started with `ACCEL_ALLOW_ALL=1 RUST_LOG=info` on `127.0.0.1:59833` (the headless CI contract —
  the extension origin isn't knowable pre-launch); `/health` reported
  `{"status":"ok","bb_available":true,"version":"1.0.6"}` before the run.

## Debugging arc (4 runs to green — each fix evidence-driven)

1. **Run 1** (fail at consume): `sendTx` (NO_WAIT) resolves to `TxSendResultImmediate`
   (`{ txHash, ... }`), not the bare hash string `grantPublicAuthwit` returns — the naive
   `String(resultJson)` gave `[object Object]`. Fixed with a two-shape `txHashOf` (anything else
   is a hard error). Also: vitest's config-level retry re-ran the whole scenario (fresh fixture
   each time — addresses differed per attempt); pinned `retry: 0` — a bump gate must not mask
   single-shot failures. Bonus evidence: stages 1–3 passed 3/3 times.
2. **Run 2** (fail at final leg, popup timeout): post-restart, the playground's account select
   was empty — `connect` alone yields `accounts=[]` BY DESIGN (the playground populates from
   `requestCapabilities`, not `getAccounts`), so the acting-account switch no-oped and the sendTx
   fell into the `from=recipient` fallback → no execute popup.
3. **Run 3** (fail at my new select-population wait — which correctly surfaced run 2's root
   cause earlier): fixed by re-requesting the already-granted `transaction` bundle after
   reconnect — the dispatcher early-returns on the empty delta (NO popup, pinned by
   cap-request-repeat-noPopup) and the granted accounts repopulate the select. Also added the
   `nulo:liveness` wait post-SW-kill (sw-restart-network precedent) + a dApp-side-error sentinel
   so a pre-popup handler failure surfaces ITS error instead of an opaque popup timeout.
4. **Run 4: GREEN.** `CANARY4_EXIT=0`, `Test Files 1 passed`, `Tests 2 passed (2)`, 107.8s wall.

Note: vitest's default reporter suppresses the per-test `[frozen-canary]` console stream on a
PASSING run (it was visible in failing runs 1–3) — don't read silent stdout as "didn't run"; the
summary + exit code + accelerator log are the ground truth.

## Validation gate

Targeted `bun run e2e:agent tests/e2e/network/frozen-account-canary.test.ts` at current pins:
**exit 0, 1 file passed, 2/2 tests passed** (transcript). **Native proving confirmed**:
accelerator-server (v1.0.6, SHA-verified) logged exactly THREE `Received /prove request` entries
inside run 4's window (20:08:08 / 20:08:21 / 20:08:33 for the grant, consume, and post-restart
txs); no WASM fallback. Every stage assertion is exact — node-side init-nullifier ABSENT→PRESENT
flips, `ok` + mined for all three txs, address-set equality for the frozen re-derivation, and the
post-restart tx as the re-derivation execution proof.
