# swap-fuel — codex audit transcripts

Codex session: `019eb8a4-967c-7f72-8ef5-76f471b1fe44` (xhigh, read-only). Round 1 = independent competing plan ([draft-codex.md](draft-codex.md)).

## Round 2 — contradiction-check of the consolidated plan (verdict: fail → fixed)

1. [CONTRADICTION] `L9` is marked adopted in the ledger, but the implementation path is still optional later. The ledger says scope-delta re-consent is **ADOPTED** (`implementations-plan/swap-fuel/plan.md:38`), yet P4 still says “field-diff extension … OR … manual-reconnect fallback” (`implementations-plan/swap-fuel/plan.md:72-77`), and Ask 1 reopens the choice (`implementations-plan/swap-fuel/plan.md:141-142`). In the winning draft this was still explicitly an Ask, not a resolved decision (`implementations-plan/swap-fuel/draft-fable.md:79-82`). Consolidation promoted it to adopted without actually resolving it.

2. [CONTRADICTION] `minFuelFj` is written into live config before the plan says it will be calibrated. P2 persists `l1.fuel.minFuelFj` in `testnet-bridge.json` (`implementations-plan/swap-fuel/plan.md:61`), P5 enforces a `MIN_FUEL_FJ` floor in submit validation (`implementations-plan/swap-fuel/plan.md:82`), but P6 says `MIN_FUEL_FJ` is calibrated only after the live headless run (`implementations-plan/swap-fuel/plan.md:89-90`). P2’s gate checks only Etherscan + quoter sanity (`implementations-plan/swap-fuel/plan.md:62`), so it cannot catch a bad pre-calibration floor. This ordering bug is also present in the winning draft (`implementations-plan/swap-fuel/draft-fable.md:77,84-85`), and consolidation left it unresolved.

3. [OK] I do **not** re-argue the overruled budget position. The consolidated plan keeps the evidence gate and explicitly bounds the failure mode to availability-only: live ETH/FJ pool probe in P1 (`implementations-plan/swap-fuel/plan.md:54-55`), no-top-up default in L2 (`implementations-plan/swap-fuel/plan.md:31`), and whole-tx revert / no user-fund loss under quote collapse (`implementations-plan/swap-fuel/plan.md:107-108`). That is materially defensible, matching the winning draft’s D4 stance (`implementations-plan/swap-fuel/draft-fable.md:36-38`).

4. [OK] I do **not** re-argue the overruled “fuel phase is narration” position. The adopted fact-latched phase is coherent with the journal architecture: `FUEL` anchors on persisted `rec.fuel.received` (`implementations-plan/swap-fuel/plan.md:33,83-85`), which is the same persisted fact the winning draft argued for (`implementations-plan/swap-fuel/draft-fable.md:73-75`).

5. [OK] The highlighted “verified facts” are source-backed, not silent inventions: router slippage gap (`packages/bridge-evm/src/SwapBridgeRouter.sol:189-195`), Permit2 allowance override (`packages/bridge-evm/src/MintableERC20.sol:46-50`), live ETH/FJ pool note (`packages/bridge-evm/test/DeployBridge.fork.t.sol:68-72`), and fjwc chain (`packages/wallet-bridge/src/operation.ts:59-63`, `packages/extension/src/wallet/services/execution/utils/fee-detection.ts:8-13`, `packages/extension/src/wallet/services/execution/operation-planner.ts:226-231`).

contradiction-check: fail (blocking: L9 adopted-vs-optional unresolved; P2/P6 `minFuelFj` ordering)
## Round 3 — double audit of the revised plan (verdict: reject → fixed)

**Adversarial**
- **[CRITICAL]** The adopted L1 hardening is insufficient against a hostile owner-set `swapTarget`. The plan says post-fix residual risk is only DoS or “economically-pointless substitution” (`implementations-plan/swap-fuel/plan.md:30,111-116`), but the router never proves the fuel slice was actually spent. It only approves `fuelAmount`, checks FeeJuice balance delta, then deposits only `bridgeAmount`, leaving any unspent `fuelAmount` of AZLO sitting in the router and owner-sweepable (`packages/bridge-evm/src/SwapBridgeRouter.sol:189-216,276-291`). An evil target can prefund `fuelReceived >= minFuelOutput` from elsewhere and keep the user’s AZLO slice stranded. `UniswapFuelSwap` spends the input honestly today (`packages/bridge-evm/src/UniswapFuelSwap.sol:101-109`), but the whole point of `setSwapTarget` is that this can change. This is a real theft path, not availability-only.
- **[HIGH]** L14’s consumption probe is not proven sound against PXE lag. The repo’s current message gate intentionally treats simulate as laggy and matches both “not yet synced” and “message gone” in the same classifier (`packages/faucet/src/composables/useBridgeJournal.ts:37-38,542-600,708-711`). The plan’s new rule “standalone FJ claim says gone while token claim simulates fine ⇒ fuel gone” (`implementations-plan/swap-fuel/plan.md:43,89,117`) assumes the wallet can observe token and FJ message availability independently and reliably. The repo does not establish that. A premature sponsored fallback could complete the token claim while leaving the FJ message unclaimed, violating the product promise “lands with gas.”
- **[MED]** P2 has an operational partial-failure gap. The plan deploys and seeds in one live script (`implementations-plan/swap-fuel/plan.md:59-65`) but does not require rerun-safe resume inputs or an idempotent “deploy-only / seed-only” split. If deploy succeeds and seeding or config finalization fails, you can strand multiple owner-trusted routers on Sepolia.

**Assumption attack**
- **Facts**
  - **[HIGH]** “Availability-only” under thin pools is misstated in the ledger/security section because the owner-settable-target path above can strand/sweep user AZLO, not just cause quote collapse (`implementations-plan/swap-fuel/plan.md:31,112`).
- **Inferences**
  - **[MED]** “FeeJuice needs no `contracts` registration” remains a live inference (`implementations-plan/swap-fuel/plan.md:139`) and is only manually gated. Fine for testnet, not something to treat as settled architecture.
  - **[HIGH]** “fjwc works when the main call is token claim” is still an unproven behavior dependency (`implementations-plan/swap-fuel/plan.md:143`) and now carries the whole L14 ladder.
- **Asks**
  - **[MED]** The owner-model ask is too soft. It should explicitly surface that the owner can recover any stranded AZLO left in the router under swap-target bugs, not just “stay deploy EOA vs multisig” (`implementations-plan/swap-fuel/plan.md:146-148`).

**Modularity / architecture**
- **[MED]** The ladder couples wallet-specific simulate semantics, journal persistence, and claim retry policy across `useDeposit.ts` and the journal engine (`implementations-plan/swap-fuel/plan.md:87-93`). This wants a small pure claim-state helper with pinned inputs/outputs, otherwise the hardest failure path is also the least unit-testable.

reject (with blocking findings: owner-settable-target theft path remains after the planned router fix; L14 consumption probe is not soundly distinguished from PXE lag)
### Resolution (revision 3)
- CRITICAL → L1 gained require (b): router token-balance delta across the swap == fuelAmount (slice actually consumed); P1 unit pin "prefunding target without pulling AZLO reverts". L2's "availability-only" reworded as conditioned on the fix.
- HIGH → L14 v2: positive-evidence triggers only (claimTxHash receipt inclusion; public-FJ balance probe); simulate-failure never infers consumption; no-evidence ⇒ wait.
- MEDs → P2 idempotent deploy-only/seed-only split + runbook; Ask 3 reworded (owner sweep powers explicit); pure `fuel-claim-state.ts` helper with truth-table pins (P6).

## Round 4 — FINAL fresh-context gate (NEW session; verdict: reject → L14 v3 → re-verdict pending)

- [CRITICAL] L14’s “`balance_of_public(FeeJuice, user) >= fuel.received` while token unclaimed” is not positive evidence for **this record**. It false-positives if the user already has public FJ, or receives unrelated FJ later, yet P6’s `decideFuelClaim` only takes aggregate `fjBalance`/`fuelReceived` and no baseline or provenance ([plan.md](implementations-plan/swap-fuel/plan.md:43), [plan.md](implementations-plan/swap-fuel/plan.md:91)). Result: premature sponsored fallback can still orphan the current FJ message. This is the main fresh miss.

- [HIGH] The owner trust surface is understated. After the L1 hardening, a malicious owner-set `swapTarget` still need not honor the signed route economically; it can ignore route intent, consume the AZLO slice, return only `minFuelOutput`, and keep the spread. That is bounded value extraction, not “economically-pointless substitution” ([plan.md](implementations-plan/swap-fuel/plan.md:30), [plan.md](implementations-plan/swap-fuel/plan.md:114), [SwapBridgeRouter.sol](packages/bridge-evm/src/SwapBridgeRouter.sol:142), [SwapBridgeRouter.sol](packages/bridge-evm/src/SwapBridgeRouter.sol:190)).

- Assumption attack:
  - [HIGH][Facts] “fuel already landed is monotone truth” is misstated; public FJ balance is aggregate, not message-specific ([plan.md](implementations-plan/swap-fuel/plan.md:43)).
  - [HIGH][Inferences] “fjwc graceful degradation” is unsafe as written because the contingency depends on that unsound balance probe ([plan.md](implementations-plan/swap-fuel/plan.md:148)).
  - [MED][Asks] Missing ask: explicit human acceptance of frontend/config trust over `testnet-bridge.json` and of owner ability to skim down to the signed floor, not just set target/sweep dust ([plan.md](implementations-plan/swap-fuel/plan.md:65), [plan.md](implementations-plan/swap-fuel/plan.md:153)).

- Ledger / executability:
  - [HIGH] L3 + L14 do not cohere until third-party-trigger detection is record-specific.
  - [MED] The documented rejections are sound final calls, including rejecting the differential-simulation probe; the unsound part is the replacement.
  - [HIGH] P6 is under-specified: an autonomous agent cannot implement `decideFuelClaim` soundly from the stated inputs without inventing a missing per-record baseline/provenance rule.

reject (with blocking findings: L14’s balance-probe trigger is not record-specific and P6 cannot implement the recovery ladder soundly without unstated state/provenance rules)
### Resolution (L14 v3)
- CRITICAL → the balance probe is WITHDRAWN. v3 triggers are per-record only: own claimTxHash receipt inclusion; fee-insufficiency (fuel.received vs current min fee × margin) ⇒ sponsored + standalone FJ claim; leaked-secret edge = explicit user "Claim without fuel" action after N persistent failures (no automation). Optional non-load-bearing P3 stretch: message-nullifier probe if the pinned aztec.js exposes the helper.
- HIGH owner-skim → stated plainly in Security: bounded extraction ≤ the signed slippage spread; the bound IS the slippage parameter.
- HIGH P6 under-spec → decideFuelClaim inputs fully specified { attempt, receiptStatus, fuelReceived, currentMinFee, persistentFailureCount, userOverride }; truth-table pins include "user already holding FJ changes nothing".
- MED missing ask → Ask 3 widened to owner + frontend/config trust acceptance.

## Round 5 — final-gate re-verdict on v3

Yes on the three prior blockers. v3 closes the orphaning path (aggregate-balance inference gone; remaining automated triggers record-specific; ambiguous states stay at wait — no premature fallback can orphan an unconsumed FJ message). Leaked-secret edge acceptable as manual-only for testnet (requires compromise of material already inside the local trust boundary; the manual action is non-destructive — the right place to stop automating). P6 implementable by an autonomous agent without inventing rules.

conditional approve (with conditions: align the stale Security leaked-secret bullet to L14 v3/manual-only semantics) — condition addressed in the same commit (Security bullet aligned).

## Round 6-9 — post-implementation audit (session 019ebcc3)

R6 (post-impl, net diff + code-review summary): REJECT — HIGH consumed@PROPOSED (dropped tx + unreachable node strands retry); HIGH standalone fire-and-forget strands fuel silently after completion.
R7 (re-verify first fix): REJECT — the fix moved the PROPOSED-latch onto standaloneClaimed (false-negative) and the happy fjwc path never persists consumed (false-positive button).
R8 (DESIGN reassess, not code — the loop's stop-after-3-misses): "design flawed" → one refinement: latch consumed on ANY included receipt (success OR app-reverted), not success-only; inclusion-gate standaloneClaimed.
R9 (implementation confirm): "conditional approve (with conditions: accept the conservative false-positive CLAIM YOUR GAS cases, or add retry/polling for exactness)". No hide-while-unclaimed hole found.

### Resolution
- consumed: NO PROPOSED-latch anywhere; `reconcileFuelConsumed(id)` promotes it from an INCLUDED receipt on `fuel.claimTxHash` (covers happy fjwc + included-reverted fjwc; a dropped fjwc stays unsettled → recovery surfaces). Card runs it on completed fueled records (no button flash).
- standaloneClaimed: inclusion-gated via `waitForFuelInclusion`; dropped/timeout leaves it unset → re-offered.
- Self-settle (f86aeeb): an already-consumed standalone claim (isMsgNotReady) settles instead of erroring → the residual false-positive resolves cleanly on click. The condition is met; dangerous direction (hide-while-stranded) is closed.
