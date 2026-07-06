# Phase 5 — faucet single-path UI + salt-v2 reader

**Status: ◑ IN PROGRESS. The core recipient-committed bridge-only deposit path is done + green; fuel-only, bridge-steps, and the flows.ts direct-path deletion remain.**

## Done (committed d49bb00, 349b2b4 — 423 faucet tests green, typecheck + lint clean)

- `apps/faucet/src/contracts/bridge-deployments.ts` — `BRIDGE_ROUTER`/`BRIDGE_PERMIT2`/`BRIDGE_SWAP_TARGET` promoted to required bridge config (C7); `PRIVATE_CLAIM_MODE`/`SUPPORTS_SALT_V2` reader (L9 interlock).
- `packages/bridge-core/src/index.ts` — re-exports `./claim-secret` (so the faucet can import `deriveTokenClaimSecret`).
- `apps/faucet/src/composables/useDeposit.ts`:
  - **The shared secret setup** (the ~line-637 block, used by BOTH the fuel + non-fuel branches): private deposits now compute `committedSecret = deriveTokenClaimSecret(salt, recipient)` and commit `computeSecretHash(committedSecret)`; the stored/claimed value (`secret`) IS the salt. Because the claim side already passes the record's stored secret as `claim_private`'s 3rd arg, **the claim needed no change** — it now passes the salt and the circuit re-derives. This one change covers the fueled-private token leg too.
  - **L9 salt-v2 interlock**: refuses a private deposit unless `SUPPORTS_SALT_V2` (manifest declares `privateClaimMode: "salt-v2"`).
  - **Non-fuel branch rewired** from `approve` + `depositToAztec{Public,Private}` to a Permit2 witness (fuel fields zeroed, `tokenSecretHash = id`) → `router.bridge()`, reading the leaf/key from the router `Bridge` event. Removed the now-unused `InboxAbi`/`TokenPortalAbi` import.

## Key design insight

The salt threads through the EXISTING `secret` field of the record/sealed-envelope/claim. For private, that field holds the `claim_salt` (not a random preimage); the L1-committed `secretHash` is over the derived secret. So the deposit-side computation is the only real change — the seal, journal, recovery, and claim machinery are untouched.

## Remaining (next loop firings)

1. **`useFuel.ts`** (fuel-only tab): rewire `approve(FeeJuicePortal)` + `FeeJuicePortal.depositToAztecPublic` → one-time `approve(Permit2, max)` + a Permit2 witness → `router.bridge(tokenPortal = FUEL_PORTAL, bridgeToken = FUEL_ASSET, isPrivate = false)`. Keep `parseFeeJuiceDeposit` for the leaf/received (C9 — parse the FJ portal event, not the router `Bridge` event). NOTE: the fee-asset approve is via the `useL1FeeAsset` composable whose spender is the portal — switching it to Permit2 needs a composable tweak.
2. **`bridge-steps.ts`**: SIGN-everywhere for token records; fuel records get a conditional one-time APPROVE + SIGN; bump new deposit records to `schema: 3`.
3. **`flows.ts` direct-path DELETION** (the deferred Phase 3 piece): delete `runDeposit`/`depositPublic`/`depositPrivate`; update `deposit-testnet.ts`/`fuel-testnet.ts`/`smoke-existing-testnet.ts` + `flows.test.ts`; run the no-direct-write grep + the 5-site `claim_private` stale-semantics grep (C2/M1).
4. **Client-pin test** (tokenPortal/token/router/permit2 come only from the manifest — codex cond. 4).

## Gate — partial

`bun run test:faucet` 423 passed · `bun run --cwd apps/faucet typecheck` clean · `bun run lint` clean. Full Phase 5 gate (`bun run audit:faucet` incl. build + verify:deployments) runs once fuel-only + steps land.
