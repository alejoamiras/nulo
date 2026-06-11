# swap-fuel — fable audit transcripts

Round 1 = independent competing plan ([draft-fable.md](draft-fable.md)) — adopted as the consolidation skeleton.

## Round 2 — contradiction-check of the consolidated plan (fresh agent; verdict: fail → fixed)

1. [CONTRADICTION] The consumed-latch defeats its own survivability claim. plan.md says the sponsored ladder "prevents infinite-retry stranding... makes it survivable", but the ladder's ONLY trigger is `fuel.consumed`, persisted when OUR claim tx reads included. Three paths consume/invalidate the FJ message without setting the latch: (a) crash in the window between claim-tx inclusion and the consumed-persist (this persist is inherently post-inclusion, cannot be journal-first); (b) third-party claim trigger (finding 2); (c) unconsumed-but-insufficient FJ after a fee spike. In all three the simulate-gate fails forever, consumed stays false, ladder never fires — stranded state the recovery line doesn't cover (it only re-reads `fuel.received`). Fix: persist the claim txhash journal-first and treat persistent simulate-failure plus receipt/on-chain message-consumption probe as a ladder trigger. Partially resurrects codex's rescue-UX Ask. Hole originates in fable D6; consolidation re-asserted the guarantee.

2. [RESURRECT] L3 rejects main's seal-the-secret as "not a bearer credential" — correct for theft, incomplete for griefing: leaked secret+leafIndex lets a third party trigger `claim_and_end_setup` before the user's claim; FJ lands in the user's balance, but the self-paying fjwc claim then simulate-fails with consumed=false → stranded per finding 1, breaking the L7 bootstrap. Sealing is still the wrong fix (secret must be plaintext at claim time), but "tampering makes claims revert, never redirects funds" understates this vector; the ledger should record it plus finding 1's mitigation.

3. [GATE-GAP] The UI-phase gate dropped fable's explicit "fjwc payment selection, consumed-fallback" test pins. The riskiest claim-tail logic — claim-builder swap and consumed latch — had no required test in the consolidated gate.

4. [GATE-GAP] The P2 gate dropped main's cast probe of "router's portal/fuelSwap wiring". Etherscan verify covers constructor args only; a mis-set post-deploy swapTarget would surface first in live validation.

5. [SILENT-RESOLVE] Minor: L7's "true zero-gas bootstrap" dropped fable's caveat that the fresh account is deployed via sponsored FPC first. Overstatement only.

6. [OK] Checked traps: no approve leg anywhere — allowance-assert matches stepper SIGN keys; FUEL latch field `fuel.received` exists in the P3 schema; L2 evidence-gate honestly preserves codex's depth concern as an Ask; L4 rejection recorded and outcome-compatible with codex's real point; P4's wallet-bridge change gated by wallet-bridge tests + dispatcher pins, not manual smoke alone; L13's dissolved P0 probes all relocated.

contradiction-check: fail (blocking: finding 1 ladder-reachability hole; finding 3 missing claim-tail test pins in the UI gate)

### Resolution (consolidation revision)
- Finding 1 → ledger **L14**: `fuel.claimAttempt` latched journal-first before every fjwc wallet call (+ txhash on return); second ladder trigger = persistent fjwc simulate-failure + standalone-FJ-claim consumption probe. All three stranded paths reach the sponsored fallback.
- Finding 2 → Security section records the griefing vector + L14 probe as its detection; L3 stands (plaintext), precision added.
- Finding 3 → P6 gate now REQUIRES the fjwc-selection + ladder pins.
- Finding 4 → P2 gate adds cast wiring probes (swapTarget, portals, owner).
- Finding 5 → L7 reworded: fjwc bootstraps the CLAIM tx; account deployment rides the sponsored FPC.

## Round 3 — double audit (FRESH hostile agent; verdict: conditional approve → conditions adopted)

[HIGH] L14 consumption probe overclaims "covers all three stranded paths": a consumed message and a not-yet-PXE-synced message throw the IDENTICAL "no message found" error (the repo's own bridge-form-stepper lesson); the differential only works if token and FJ messages share PXE-sync visibility — they are different leaves, and the PRIVATE variant compares a claim_private sim against a claim_public sim (different sync paths; correlation unproven). Failure mode: false-positive → premature sponsored ladder + orphaned (recipient-bound) FJ. Condition: prove the correlation or downgrade the claim with a non-destructive fallback.
[MED] L1 hardening sufficient for the FJ side but not the floor's sanity: minFuelOutput is the SIGNED value; a compromised frontend can sign a dust floor (exact-input swap converts the slice regardless). State the trust boundary. (NOTE: its companion claim "the full AZLO slice is always consumed regardless" was WRONG — codex's CRITICAL shows a hostile target need not pull the slice; the L1 token-delta require closes it.)
[MED] Permissionless V4 pool-init front-run: attacker pre-initializes AZLO/WETH at a garbage price; the seed helper no-ops on initialize-if-exists → liquidity seeded at the wrong price. Add P2 pre/post-seed price+currency assertions.
[MED] P4 scope field-diff erodes least-privilege: simulation scope is NESTED (transactions/utilities/privateEvents), grants union monotonically, no revocation surface — fatigue-driven creep. Honour the STOP-and-surface guard.
Assumption-attack: all Facts cites verified accurate. Inference unsafe: "live ETH/FJ pool retains usable liquidity" gated only against pinned fork state — re-probe live at P2. Ask to surface: P2 partial-failure/idempotency recovery.
Modularity: [MED] wrong MIN_FUEL_FJ calibration propagates invisibly until P7; [LOW] P1's gate can't catch P2's adversarial pool-init.

conditional approve (with conditions: prove/downgrade the L14 probe claim with non-destructive fallback; P2 price assertions; P2 partial-failure runbook; honour the P4 STOP guard)

### Resolution (revision 3)
- L14 → v2: the differential-simulation probe is GONE (with it, the private-variant correlation question); triggers are positive-evidence only (receipt inclusion / public-FJ balance ≥ received); no-evidence = wait; fallback non-destructive by construction.
- Pool-init front-run → P2 pre-seed assert (uninitialized or within tolerance; abort otherwise) + post-seed sqrtPrice/ordering assertion.
- Partial failure → P2 idempotent deploy-only/seed-only env modes + runbook in deployments.md.
- P4 → nested-scope honesty note, delta-prominent consent copy requirement, hard STOP guard; FJ balance_of_public utility scope added (L14 v2 needs it).
- Frontend-trust boundary stated in Security (mitigation deferred to the CSP/harden arc).
- MIN_FUEL_FJ propagation → P6 pin: floor read from config, not hardcoded.
