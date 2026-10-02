# Phase 5 lessons — smoke roundtrip (Fix 1) — diagnostics landed; flake OPEN (owner)

## Status: control-flow confirmed, trigger uninstrumented, bound NOT raised

The route-to-general after import submit is gated on `isLogined`, which the bootstrap
flips only AFTER the RPC-bound `syncTransactions` (`useProfileBootstrap.ts:78-87`). On
the smoke build the seeded ACTIVE network is the public Testnet (hardcoded drpc URL in
`network/service.ts` seeds — no env override exists). When that RPC degrades from CI,
the 90s wait times out on all vitest retries (6 CI reds, cross-branch, evening-clustered,
≥1 month old). All within-constraint fixes require product-source changes, which this
arc FROZE on audit orders:

1. **Env fast-fail RPC** (preferred candidate): a `VITE_NULO_E2E_TESTNET_RPC_URL`
   override in the seeds (same never-ships pattern as `VITE_LOCAL_NETWORK_RPC_URL` and
   `VITE_NULO_E2E_DEFAULT_NET`), pointed by the smoke workflow at a closed local port —
   connection-refused fails in ms (the 60s abort envelope is for HANGING requests), so
   bootstrap settles fast either way. ONE line of product source + one workflow line —
   but product source nonetheless. Must also verify a failed `syncTransactions` doesn't
   reject the bootstrap into a worse state.
2. **Product route-decouple**: flip `isLogined` before the RPC-bound sync. Behavior
   change, bigger blast radius.
3. **Budget exception**: adopt the shared 300s driver envelope — still loses to a
   >5min RPC outage (the 8-11 00:19 red survived attempts 1 AND 2, ~26 min apart... 
   attempt-level data shows sustained degradation windows exist), so it narrows, not
   closes, the flake.

**Owner decision required — recorded in the final report.** Until then the test keeps
its 90s bound and got DIAGNOSTICS: a 200ms-poll route-trajectory recorder armed before
submit + a parked-state dump on timeout (trace, profile-row count, activeAccount-pointer
presence, body snippet, ms-since-submit). The next CI red will name its stalled leg
instead of parking silently.

## Gate evidence (2026-08-11)

Armed CI-faithful build + FULL smoke suite solo: 23 passed / 1 designed skip (24 files),
79 tests, exit 0 — the diagnostics don't regress the pass path. Lint + typecheck clean.
