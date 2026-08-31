# Phase 3 — network e2e

## The spec

`tests/e2e/network/default-token-seeding.test.ts` drives the production shape of
the bug on a hermetic sandbox:

1. `registeredExtensionPerTest` — fresh profile, first account on the Testnet chain.
2. `seedSandboxDefaultToken(page, …)` writes the per-run token into
   `nulo:e2e:token-seeds` **before** the trigger. The seeder reads its list once
   per pass, so a later write is simply missed.
3. `switchToLocalNetwork(page)` — Local Network has no accounts, so the switch
   fires `onActiveNetworkChanged` first (seeder runs, finds no account) and only
   then `network-switch.ts` creates the chain's first account. Same ordering as
   fresh-profile bootstrap, in one UI action.
4. Assert `[data-testid="tokens-card"] [data-testid="token-symbol"][data-symbol="TST"]`
   with **no** `importToken`, plus `outcome: "seeded"` in the marker blob so the
   row is proven to come from the seeder rather than a stray import.

## Run 1 failed on my own bug — `contract.instance` is not the accessor

```
[e2e-setup] Failed to deploy test contracts:
  TypeError: Cannot read properties of undefined (reading 'currentContractClassId')
```

I had `deployTestToken` return `contract.instance.currentContractClassId`. The
deployed contract object from `TokenContract.deployWithOpts(...).send(...)` has
no `.instance`. The working pattern was already in the same file at
`fixtures/aztec.ts:236`: fetch the instance from the node.

Fix: `deployTestToken` returns the address again (original signature restored),
and a new `getContractClassId(node, address)` does the node lookup.
`global-setup.ts` already had `node` in scope from `createTestWallet`.

Worth noting the harness behaved correctly: `E2E_REQUIRE_SETUP=1` turned a
deploy failure into a hard abort instead of a pass-by-skip.

## Stale-lockfile guard (not in the plan, found while wiring)

`global-setup.ts:641` reuses a lockfile's `deployedConfig` instead of
redeploying. A lock written before this change has no `tokenClassId`, so a
reused sandbox would have fed the spec `undefined`. The reuse branch now
requires `tokenClassId` and otherwise falls through to a redeploy.

## Validation gate — PASS (both directions)

**Green, with the fix:**

```
bun run e2e:agent tests/e2e/network/default-token-seeding.test.ts
[e2e:agent] bundle contains the e2e token-seed source ✓
Test Files  1 passed (1)
EXIT=0
```

The propagation grep firing before the tests is itself the Phase 2 guard working
end to end — a dropped flag would have failed here instead of silently sending
the suite back to the live seed list.

**Red, without the fix** (`this.accounts.onAccountAdded.add(...)` commented out,
restored from a backup copy immediately after):

```
TimeoutError: Waiting failed: 120000ms exceeded
Test Files  1 failed (1)
EXIT=1
```

The token never appears, which is exactly the reported bug. The spec is proven
to bite rather than merely pass.

Both tmux sessions killed and `bun run e2e:reap` run afterwards — no orphaned
sandbox, node, or data dir left behind.
