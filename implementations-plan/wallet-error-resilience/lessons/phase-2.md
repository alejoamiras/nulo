# Phase 2 — resync-and-retry once on the stale-anchor family (offscreen side)

**Status:** ✓ gate green — aztec-runtime 237 passed / 2 env-skipped · real-PXE test 2/2 against a reorged sandbox (control reproduced the failure, helper recovered with a moved anchor) · `typecheck:all` exit 0 · `lint` exit 0 · extension-messaging 217/217.

## What shipped
- `packages/aztec-runtime/src/pxe/stale-anchor.ts`: `isStaleAnchorMessage` + `withStaleAnchorRetry` (op → on stale: `sync()` → one retry; second stale → `PxeStaleAnchorError` with the constant per-label message, `details.{op, phase: "sync"|"op", cause}`; a non-stale failure from `op` or `sync()` propagates untouched).
- `service.ts`: `proveTx`, `simulateTx`, `executeUtility`, `profileTx` run their `pxe.<op>()` through `retryOnceOnStaleAnchor` inside the existing `withPxeWrite` callback (chain write guard held across the resync + retry). Zod parsing moved ahead of the wrapped call so a retry never re-parses. The info line goes through `logInfo` — the SW log ring drops debug unless dev mode is on, and the Phase 4 canary reads that ring.
- Origin-trusted key recovery: `PxeStoreKeyMissingError` (`PXE_STORE_KEY_MISSING`) in extension-messaging; `chain-runtime.ts` is the only throw site; `client.ts` keys the re-provision on `instanceof`, not on message text. `PXE_STORE_KEY_MISSING` now aliases the class's `CODE` so `logOpFailure`'s debug demotion is unchanged.
- `stale-anchor.sources.test.ts` pins the two installed strings; `UPDATE.md` carries the node-side one.

## The real test found a second node wording
The plan (and the owner's log) had the world-state wording, `Block hash … not found when resolving query. If the node API has been queried with anchor block hash possibly a reorg has occurred.` The sandbox produced a second one on the helper case's contract lookup: `Reference block "0x…" not found when querying contract 0x…. If the node API has been queried with an anchor block hash, possibly a reorg has occurred.` Both live in `@aztec/aztec-node` (`node_world_state_queries.js:265` and `:699` of the pinned 5.2.0 toolchain). The predicate now keys on their shared tail, `possibly a reorg has occurred`, instead of the first half + `reorg`; the generic transient miss (`Block not found for N when resolving query.`) still does not match. This is precisely the class of miss the owner's "verify on the arc" condition was for.

## How the sandbox reproduces the failure (and what it does not prove)
- `anvil_reorg` exists on the pinned toolchain's anvil (1.4.1, not the 1.7.1 the plan cited — positional params `[depth, txBlockPairs]`). A reorg past the L1 block that published the tip makes the node log `world_state Chain pruned to block N-1`, restore the pruned txs to pending, and later re-propose the same block number with a new hash.
- The test PXE runs with `autoSync: false`. With it on, the single-node sandbox never reproduces the failure: the PXE's pre-op sync sees the prune and re-anchors before the query. Production hits the race between that sync and the query (a prune, or a load-balanced endpoint answering from two nodes); the test freezes the "synced before" half and issues the "queried after" half itself. What it proves: the node rejects the stale hash with the real diagnostic, and `sync()` + one retry recovers on a moved anchor. What it does not prove: that autoSync-on production PXE hits the window — the owner's log already did. The Phase 4 canary runs through the real extension with autoSync on and is expected to need the same framing.
- One reorg per file, shared by both cases in order: each L1 reorg costs the local network an L2 block it only regrows on demand (no txs → no blocks — `SEQ_MIN_TX_PER_BLOCK=0` does not make the sandbox tick on its own), and a sandbox reorged down to genesis has nothing left to prune. The guard `anchorNumber < 1` fails loudly instead of hanging.
- The op is the account's `lookup_validity` utility (what the SDK calls), fed a real Schnorr authwit; `sync_state` is rejected outside PXE-internal use, and the initializerless test accounts need the `constructor` utility run once (the SDK simulates it right after registering) before any utility works.
- `@aztec/pxe/server` + LMDB on real disk (`~/.cache/nulo-e2e/…`), not `ProductionPxeFactory`: the production factory opens an OPFS store that only exists in a browser. The helper is store-agnostic.

## Attempts / dead ends
1. Registered the initial account as a plain schnorr account → address mismatch; the local network ships initializerless accounts (immutables hash in the address, no deployment tx).
2. `executeUtility(sync_state)` → "Forbidden `sync_state` invocation".
3. `lookup_validity` without the constructor utility → "Public key was not stored in the PXE"; without an authwit → "Unknown auth witness".
4. Waiting for the chain to grow two blocks before reorging → the sandbox produces no blocks without txs; dropped in favour of reorging the tip's own publish block (found via `eth_getLogs` on the rollup address).
5. A reorg per case exhausted the sandbox (anchor reached genesis after four runs); collapsed to one shared reorg.
- Sandbox for the run: booted by hand from the pinned toolchain with the e2e setup's flags (scratch scripts, not committed); torn down after the gate. The plan's gate command runs as written once `scripts/e2e/agent.sh`'s URLs are in the environment.

## Carry-forward
- Phase 4's canary must read the SW ring for `stale anchor on` at info level (already what the helper emits) and will most likely need the same "cannot reproduce with autoSync on" framing; carry the real test here as the recovery evidence and document the canary honestly.
- The node-side string is only checkable against `~/.aztec/versions/<pin>/node_modules/@aztec/aztec-node`; the `aztec-update` skill should grep it (UPDATE.md now says so).
