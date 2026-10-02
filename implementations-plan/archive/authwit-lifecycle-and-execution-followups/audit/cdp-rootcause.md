# CDP / protocolTimeout root-cause audit (subagent verdict)

VERDICT: env-gating was the correct call; protocolTimeout is the wrong lever.

Key findings:
- `protocolTimeout` is ALREADY 300_000 (extension.ts:52), not the 180s default
  I assumed. The lifecycle test polls with `waitForPgResult` at 360_000 — an
  INVERSION: the 300s protocol safety-net fires BEFORE the test's own 360s
  patience. (Fix the inversion: bump protocolTimeout to ≥420s OR drop test
  budgets — needed for ANY path that runs these tests.)
- Proving runs in the OFFSCREEN document (separate MV3 renderer + bb.js Web
  Workers), NOT the polled playground page. So the page's main thread isn't
  blocked; the real failure is WASM proving saturating ALL cores on a shared
  shard, delaying CDP round-trips + blowing wall-clock across 10 serial proofs.
  Raising protocolTimeout is a band-aid the repo itself documents as such.
- Repo's PROVEN pattern for heavy tests: DEDICATED ISOLATED JOBS (fee-methods,
  concurrent-confirm are pulled from the SHA-1 shard matrix via `exclude_files`
  and run ALONE) + native accelerator proving (CI-only Linux x86_64 binary,
  NOT available on local macOS → local falls to slow WASM).
- CRITICAL: post-env-gate (commit 00b6886), the authwit tests `skipIf(
  !authwitE2eEnabled)` and `RUN_AUTHWIT_E2E` is set NOWHERE in CI → they SKIP
  on the standing PR matrix. The shard-1 failure I diagnosed was the PRE-GATE
  run. Current state: authwit tests no longer touch PR CI.

RECOMMENDATION: keep env-gated (correct as shipped). For real CI automation,
replicate the dedicated-heavy-job pattern: exclude_files + a new
`network-e2e-heavy-authwit` job with RUN_AUTHWIT_E2E=1 + accelerator (concrete
steps in the transcript). The behavioral coverage is also unit-covered by the
popup tests (ChangeAuthwitsRegistryPopup / RevokeAuthwitsPopup) + the
dispatcher reachability/scope pins.
