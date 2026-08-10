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

## Post-merge-review: init-wrap fold bug (caught by the delegated-authwit e2e)

Writing tx-sendTx-delegated-authwit.test.ts (folded discovery through the real extension)
surfaced a genuine bug the 3900 unit tests + B1 + 3 codex rounds all missed, because none
put a DISCOVERED delegated authwit through the product:

- **Bug**: the init-wrap guard (added for codex round 1) lived in probedFirstSimOpts and
  downgraded the folded FIRST sim to validated for init-wrapped (first-tx) builds. That broke
  authwit DISCOVERY on a first tx (no stub ⇒ real verify throws before emitting the effect),
  (no stub ⇒ the real verify throws before the effect is emitted). (CORRECTION, per codex
  re-review: there was NO pre-existing plain-first-tx gas bug — the old guard took the
  VALIDATED sim for init-wrapped, so plain first-tx already used real-constructor gas. The
  forced validated re-sim is the necessary COMPENSATION for now always stubbing discovery,
  not a repair of a prior underestimate.)
- **Fix (44686f0)**: separate the two concerns the guard conflated. probedFirstSimOpts always
  STUBS when a probe is present (discovery works fine on undeployed accounts — the delegated
  inner hash is about the token call, not the account constructor, which is why classic
  discovery always stubbed them). A new isInitWrapped(built) (origin ≠ account, RPC-free)
  FORCES a validated sizing re-sim for init-wrapped builds regardless of effects — never trust
  stub-constructor gas. Deployed accounts keep the 1-sim win.
- **On-chain coverage of the fix**: tx-sendTx-default already sends an undeployed account's
  FIRST tx through the fold, so it exercises the forced validated re-sim (green in the full
  suite). The delegated-discovery-on-init-wrap path is testnet-only (B1 shape 3).
- **Why the delegated e2e is env-gated skip locally**: Crowdfunding calls the canonical
  PublicChecks standard contract, which the local native sandbox does not genesis-seed
  (publishing post-genesis is a documented collision; no runtime helper is exposed). Real
  testnet has it (B1 ran there). Gated behind NULO_E2E_STANDARD_CONTRACTS=1.
- **Sim counts** (codex re-review): deployed no-effects = 1; deployed + effects = 2; init-wrapped
  fast-path/fj = 2 (stub discovery + validated sizing); init-wrapped two-pass PrivateFPC = **3**
  (stub discovery + validated PREEXISTING sizing + validated EXTERNAL). All pinned in
  strategies-structural.test.ts. The added init-wrap re-sim now checks ctx.signal (cancellation
  parity across all three strategies).
- **Residual coverage gap (accepted)**: the exact first-tx-delegated-on-a-standard-contract-network
  conjunction is only exercised by the env-gated e2e (NULO_E2E_STANDARD_CONTRACTS=1); locally
  blocked by the missing PublicChecks. Mechanics verified sound by codex (ensureContractRegistered
  installs the real instance before the override; init wrapper orders [constructor, entrypoint] so
  the consumer's nested call reaches an initialized account).
- codex verified the derivation was correct (consumer=token, nonce=0 deterministic) and
  correctly steered the diagnosis to "the proved request isn't the validated one" — which
  led to the init-wrap routing, not a hash bug.
