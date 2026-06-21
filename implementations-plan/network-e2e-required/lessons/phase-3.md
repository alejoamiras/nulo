# Phase 3 — Measure F1 (capture-first) — ROOT CAUSE FOUND + VERIFIED

**Status: DONE.** Root cause classified + independently verified. (Fix = Phase 4.)

## The measurement overturned the plan's premise
The plan assumed F1 = "authwits page empty at revoke" (buckets A/B/C/D). The
capture (`dumpAuthwitMeasurement`, test-side) REFUTES that. iter-1 `[authwit-measure]`
at the revoke step (all 3 soak iterations failed identically, run 27716251879):
- `nulo:core:auth-registry@1`+`@2`: TWO authwit rows present, both
  `account: 0x16a6…263e`, with the granted hashes. **Page not empty.**
- `nulo:core:accounts`: the active "Account" is `0x16a6…263e` with **chainId 0**,
  which is the LEGITIMATE Local Network chainId (`network/service.ts:91`; the
  playground passes Fr.ZERO = chainId 0). So the read key (active account) MATCHES
  the write key — **bucket A refuted.** (The `0x0f78…cc86` chainId-4138294185
  "Account" is a different-network account — a red herring.)
- DOM: cards present, revoke-all clickable, `settingsAction` COMPLETED.
- Failure is the NEXT step: `G2 consume` returns `'ok'`, test expects `'error'`
  → `AssertionError: expected 'ok' to be 'error'`. **A revoked public authwit is
  still consumable** — a real security bug.

## Root cause (verified) — swapped storage-slot constants
`src/wallet/utils/auth-registry.ts` had the two AuthRegistry storage-slot
constants SWAPPED:
- was `APPROVED_ACTIONS_SLOT = 1`, `REJECT_ALL_SLOT = 2`.
- **Upstream `AuthRegistry` `#[storage]` declares `reject_all` FIRST (slot 1) then
  `approved_actions` SECOND (slot 2)** — verified directly from the contract source
  embedded in `node_modules/@aztec/noir-contracts.js/artifacts/auth_registry_contract-AuthRegistry.json`
  `file_map` (`reject_all: Map<…>` then `approved_actions: Map<Field, …>`).

Mechanism: `isAuthwitConsumable` derived its slot from the WRONG constant → read
a meaningless slot → effectively always returned not-consumable. So
`revokeAuthwits`'s `waitForOnChainState(() => every authwit not consumable)` check
passed on the FIRST poll (the slot read never reflected reality) and returned
immediately — before the revoke tx mined. `waitForTx` only confirms *submitted*,
so the fast (proverless) follow-up consume raced the not-yet-mined revoke →
consume succeeded. (`waitForOnChainState` also silently proceed-on-timeout —
a latent compounding bug.) `isAuthRegistryEnabled` read the wrong slot too.

## Codex consult (fork — authorized by the loop)
Session `019ed742-544e-7372-ab68-f99420f0ba0e` (`/var/folders/.../codex-KtoU4X3e`).
Verdict: the slot swap is THE bug (NOT a hash mismatch, NOT page-empty);
`set_authorized(hash,false)` IS the correct public-authwit revoke; the chainId-0
measurement is a red herring; this is a wallet bug (the consume doesn't re-grant);
and `waitForOnChainState` should throw, not silently proceed. I INDEPENDENTLY
verified the slot order against the artifact source before acting (codex is
advisory). My own prior hash-divergence hypothesis was WRONG — codex caught it.

## Fix (Phase 4, this branch)
1. Swap the constants → `REJECT_ALL_SLOT = 1`, `APPROVED_ACTIONS_SLOT = 2`
   (`auth-registry.ts`, with a WHY comment citing the contract).
2. `waitForOnChainState` THROWS on timeout (`service.ts`) — never treat an
   unverifiable security mutation as success.
3. Regression: `src/wallet/utils/auth-registry.test.ts` pins the read slots
   (BB-free; mocks `deriveStorageSlotInMap`, asserts the map-slot constant). 3/3.

LESSONS_FILE=implementations-plan/network-e2e-required/lessons/phase-3.md
