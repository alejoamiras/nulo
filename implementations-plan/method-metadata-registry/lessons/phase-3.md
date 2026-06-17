# Phase 3 — Latent-inconsistency lane + add-a-method proof

## Outcome — ✓ (2026-06-15, commit `8a23b43`)
- **No latent inconsistency surfaced.** The bug-pin discipline (pin-old → fix → pin-new → AUDIT marker → ledger) went UNUSED — exactly as the 18-method matrix predicted (both audits agreed it was internally consistent, and Phase-2 parity held exact through the literal deletion). No snapshot deltas, no `fix(wallet-bridge):` commits, no behavior change.
- Added the metadata-scoped add-a-method proof (2 tests): one descriptor row → capability+scope+kind all derive; a registry missing a dispatchable method is detectable.
- **149 wallet-bridge tests**; `typecheck:all` + `lint` green.

## Notes
- This is the honest outcome the plan called for ("most likely a documented no-op"). The value of arming the discipline was insurance against a derivation surprise; none occurred.
- D8 non-example (`registerToken` lacking a scope-checker) held — not "fixed"; carried as a descriptor `note`.
- biome `noDelete` info on the meta-proof test → rewrote with `Object.fromEntries(... .filter(...))` instead of `delete`.

## Next (Phase 4)
- Live validation: `bun run test:e2e` (smoke) + `bun run e2e:agent` (network). Prove a dApp sendTx/simulateTx routes, a scope-violating call is rejected, grantPublicAuthwit scope-checks, and the exempt getChainInfo path works — all through the now-derived capability/scope/routing maps.
