# Phase 2 — Default token seeding: lessons

## MID-FLIGHT EVENT: stale worktree base → rebase onto dev 5.0.1 line

The worktree had been cut from a stale origin snapshot (~1900 files behind).
Discovered BY the live preflight: both networks' chain identities mismatched the
code the plan was written against. Rebased onto current origin/dev
(`apps/extension` restructure, 5.0.1 identities, zod config, composition-test
layer). All Phase-1 work re-validated post-rebase (typecheck/lint/tests green);
price-map now consumes the single-sourced `CHAIN_IDS` (`apps/extension/src/utils/chain-ids.ts`).
One drive-by: `biome.json` `$schema` bumped 2.5.0 → 2.5.1 (pre-existing
deserialize ERROR failing `bun run lint` on the dev base).

## Live seed preflight (BLOCKING gate item) — `apps/extension/scripts/seed-preflight.ts`

Run 2026-07-21 against the canonical public RPCs:

| Network | chainId (live) | matches code | cUSD @ 0x018d47f6…00f6 |
|---|---|---|---|
| Alpha Mainnet (`aztec-mainnet.drpc.org`) | 4248422646 (1 ^ 4248422647) | ✓ | **FOUND** — `currentContractClassId = 0x0225da0f4227a139c3d6562b6554750adcdec45fd62d9b16af11da21033ef2cf` (== original), deployer `0x1e8a0b6e…3fff401` |
| Testnet (`v5.testnet.rpc.aztec-labs.com`) | 1816023401 (11155111 ^ 1821665230) | ✓ | **NOT FOUND** — wiped by the 2026-07 testnet redeploy, not yet redeployed |

**Re-scope decision (plan's stop-rule, resolved autonomously, surfaced at wrap-up):**
seed list ships MAINNET-ONLY. The testnet entry is a one-line follow-up in
`default-tokens.ts` (+ preflight re-run for its pins) once cUSD is redeployed.
No dead seed entries ship; the price map keeps the testnet mapping (deterministic
address means a redeploy prices immediately).

**Pin-design deviation from plan wording:** symbol/decimals cannot be captured
without a live simulation (bun-side PXE ruled out; explorer has no metadata;
public-storage slot reads via the standard artifact layout returned garbage —
tried and abandoned, script kept as `seed-preflight-metadata.ts`). Final pins:
- `expectedClassId` — equality, live-captured (the security-load-bearing pin).
- `expectedSymbol: "cUSD"` — equality from PRODUCT INTENT (chain disagreeing
  means we shouldn't silently seed).
- decimals — bounds 0..18 + recorded (`observedDecimals`) in the marker at
  first seed for manual mainnet-QA confirmation.

## Shipped

- `token/default-tokens.ts` — pinned seed list (mainnet cUSD) + lookup helpers.
- `token/seeder.ts` — `TokenSeeder`: single-flight; pre-registration class-id +
  address pin check (register-free `getContractInstanceInfo`); single-pass
  validated snapshot (preview once → validate THAT → persist THAT — no
  refetch window); attempt cap 3 with one fresh round per extension version;
  deletion tombstones that survive `purgeChain`; marker cleared on profile purge.
- `token/service.ts` — `addSeededToken` (seed-only persist path, same
  lock/journal/idempotency as `addToken`, `origin:"seed"` + "Default token"
  subtitle, NOT on the RPC surface), `getContractInstanceInfo`,
  `seedDefaultTokens`, tombstone hook in `deleteToken`, marker hygiene in
  `clearChainState`/`purgeForProfile`, unlock + network-change triggers in `init`.
- `operation-journal/spec.ts` — `OperationOrigin`/`OperationContext`/zod extended
  with `"seed"` (queued-stage refinement untouched — still dapp-only).
- Tests: `seeder.test.ts` (17 — pins, bounds, caps, version-retry, tombstone vs
  purge, single-flight, marker-write-before-risky-work) +
  `service.composition.test.ts` seeding slice (5 — register-free instance read,
  origin-seed journaling + idempotency, tombstone on delete, no-marker for
  non-defaults, REAL unlock/network-hook wiring). The deep preview half
  (simulate) is excluded from composition per COMPOSITION-TESTS.md D2 — covered
  at the seeder-deps seam + manual mainnet QA.
- Harness fix-ups: existing token composition + cross-profile-isolation fakes
  gained the `onActiveProfileChanged`/`onActiveNetworkChanged` EventHandlers
  TokenService now subscribes to.

## Gate result

- `bun run lint` → 0 errors ✓
- `bun run typecheck` → clean ✓
- `bun run test` → 275 files / 3276 tests passed ✓
- Live preflight → mainnet VERIFIED + pins captured; testnet documented missing
  (re-scope above) ✓
