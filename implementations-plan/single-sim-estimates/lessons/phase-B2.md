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
  `MAX_TX_DA_GAS` / `MAX_PROCESSABLE_L2_GAS`) — the L2 leg landed with the codex fixes
  (b6065a3), mirroring upstream `get_gas_limits.ts`.
  Measured-over-cap ⇒ throw ("cannot be included"); auto-derived padded limits clamp to cap
  (padding is headroom, not need); dApp customLimits/teardown over cap ⇒ THROW, never
  silently capped (Ask 2); 0-teardown stays 0; absent cap (defensive) ⇒ historical behavior.
- Per-path forwarding pins: fj / fjwc / embedded / fpc two-pass / fpc fast path each proven
  to forward their build's retained cap (tight-cap throw). The "send" transfer path rides the
  same strategies. NO_FROM initially relied on capped-by-construction fallback settings, but
  the executor's NO_FROM path DOES call finalize with dApp custom limits — it now forwards
  the retained txsLimits too (codex M-NO_FROM, fixed in b6065a3).

## Gate result: PASS

`bun run test` 3922 passed (+19 over A2) · lint clean · typecheck:all clean. Sim-count end
state: dApp Sponsored 2→1 (no-authwit), dApp fj 2→1, dApp PrivateFPC 3→2, authwit-bearing
ops validated 2, intent-authwit + fjwc + embedded unchanged classic.

## Post-impl codex audit — resolutions (session 019fecae…, transcripts in the run's CODEX_DIR)

- **Cleared after fixes (b6065a3)**: fpc custom-limit assert; NO_FROM clamp coverage; L2
  protocol cap (`MAX_PROCESSABLE_L2_GAS`); the Ask-1 standalone inner-hash class now has a
  REAL adversarial fixture (folded estimate succeeds / classic validated fails, contrast-pinned).
- **Held against codex (position restated, not capitulated)**: for INITIALIZATION-WRAPPED
  builds the fold now runs a validated (unstubbed) first sim — codex called the resulting
  first-tx authwit-op estimate failure a regression vs "classic stubbed discovery". But
  classic discovery stubbing the DEPLOYING account is precisely what B1's structural
  exclusion forbids (same substituted-constructor concern), and shipped production fails this
  case identically (the stub never engaged). Current behavior = shipped behavior for a
  vanishingly rare case (an account's first-ever tx being a delegated authwit dApp op), and
  it is the only B1-compliant option without new measurement. Revisit only with a dedicated
  measurement of stub-vs-real constructor effect parity.
- **RESOLVED — gate deviation discharged**: the owner pointed at the canonical clone's
  Sepolia signer; the fragmented-note canary ran for real (recursion across notes forced,
  tx mined — plan.md Phase A2 + lessons/phase-B1.md). Codex's final pass lifted its verdict
  to CONDITIONAL APPROVE (no runtime blocker) on this basis.
