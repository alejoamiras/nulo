# Phase B2 — fj fold + admission clamp

## fj probed fold (`feat(execution)` a398600)

- `FeeJuiceStrategy` probe-aware via the shared `probedFirstSimOpts` helper (extracted to
  `fee-strategy.ts`; `FpcStrategy` refactored onto it — one source for the stub option set).
- No effects ⇒ ONE stubbed sim (dApp fj estimate 2→1). Effects ⇒ discovered pushed after
  originals, VALIDATED rebuild (PREEXISTING again) + re-sim; finalize reads the second sim.
- Estimator fold routing extended to `fj`; `fjwc` (claim-coupled setup) and `embedded`
  (dApp-budget semantics) stay classic — pinned per kind. The estimator's classic inertness
  pins moved to `fjwc` settings so their meaning is unchanged.
- The sponsored 1-sim fold itself landed in A2 (kind-level routing pulled the fast path in);
  B2's sponsored line-item collapsed into that commit.
- Executor-level pins updated to the folded choreography for fj confirm/estimate paths (the
  B1 canary is the end-to-end proof: stub-estimate → real prove+send → mined). A new fjwc
  executor pin keeps the classic discovered-splice surface covered.

## Admission clamp (`feat(gas)` e2191e2 — own commit per plan)

- `BuiltStandardTx.txsLimits` (+ NO_FROM variant): per-tx admission cap snapshotted from the
  SAME `getNodeInfo()` the build chain-asserted — finalize never refetches (zero new RPCs;
  no flipped-endpoint clamp basis).
- `finalizeGasLimits` (+`txsLimits?` param): cap = min(node txsLimits, protocol
  `MAX_TX_DA_GAS` on DA; no protocol L2 per-tx constant exists — node-advertised only).
  Measured-over-cap ⇒ throw ("cannot be included"); auto-derived padded limits clamp to cap
  (padding is headroom, not need); dApp customLimits/teardown over cap ⇒ THROW, never
  silently capped (Ask 2); 0-teardown stays 0; absent cap (defensive) ⇒ historical behavior.
- Per-path forwarding pins: fj / fjwc / embedded / fpc two-pass / fpc fast path each proven
  to forward their build's retained cap (tight-cap throw). The "send" transfer path rides the
  same strategies; NO_FROM never reaches finalize — its `GasSettings.fallback` uses txsLimits
  as the limits directly (capped by construction, noted in the builder).

## Gate result: PASS

`bun run test` 3922 passed (+19 over A2) · lint clean · typecheck:all clean. Sim-count end
state: dApp Sponsored 2→1 (no-authwit), dApp fj 2→1, dApp PrivateFPC 3→2, authwit-bearing
ops validated 2, intent-authwit + fjwc + embedded unchanged classic.
