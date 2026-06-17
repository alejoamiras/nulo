# plan-main (independent draft — main agent)

Implementation plan for the 8 bridge-security findings. Routes fixed (see brief.md). Two PRs; PR A ships first (no redeploy), PR B is the contract migration + live cutover.

## PR A — independent fixes (no redeploy)

### Phase A1 — F-005: `runSwapBridge` fail-closed for private fuel (JS)
In `packages/bridge-core/src/flows.ts:runSwapBridge`, before signing (before line ~256), add: `if (p.isPrivate) { if (!p.fuelSecret) throw new Error("private fuel requires a derived fuelSecret"); if (p.fuelRecipient !== PRIVATE_FPC_ADDRESS) throw new Error("private fuel must target the PrivateFPC"); }`. Import `PRIVATE_FPC_ADDRESS` from the bridge-core keystone. Remove the silent `?? Fr.random()` reliance for the private path (keep it for public).
**Validation gate:** `bun run --cwd packages/bridge-core typecheck && bun run --cwd packages/bridge-core test` — add a vitest case: private + missing secret throws; private + wrong recipient throws; public + omitted secret still uses random (unchanged). Exit 0, new tests green. Layers: typecheck + unit.

### Phase A2 — F-007: verify recovery-hook secret handling + document (no contract change)
Audit `RecoveryHooks.onSecret/onSecrets` consumers (`flows.ts:46-64,236-239,263-268`, `useDeposit.ts`) — confirm the plaintext secret is only ever sealed (AES-GCM) at rest and never `log()`/URL/plaintext-stored. Add a TSDoc contract on the hook types ("MUST NOT persist/log the plaintext secret"). Add a note to `packages/bridge-core/README.md` + an entry referencing recipient-commitment as backlog.
**Validation gate:** `bun run --cwd packages/bridge-core test` + a grep-style unit/CI assertion that no `console.*`/log path receives the secret hex; manual confirmation in the lessons file. Layers: unit + manual review.

### Phase A3 — F-003: contract tests in the Quality gate + WitnessHash assertEq
First make the suites green locally: `forge test` (bridge-evm) + `nargo test` (bridge-aztec). Flip `packages/bridge-evm/test/WitnessHash.t.sol` from `console.log` to `assertEq` against the pinned witness hash (bidirectional pin). Then add paths-guarded steps to the Quality workflow (`.github/workflows/_lint-and-typecheck.yml` or its caller): a `changes` filter on `packages/bridge-evm/**` + `packages/bridge-aztec/**`; when hit, install Foundry + the aztec/nargo rc.2 toolchain and run `forge test` + `nargo test`; gate `Quality / Status` on them. Skip cleanly (emit pass) when the bridge dirs are untouched so non-contract PRs aren't slowed.
**Validation gate:** `bun run lint:actions` (actionlint) green; locally `forge test` + `nargo test` green; the new Quality steps are reached only on a bridge-touching diff (verify the paths-filter logic). Layers: lint/actions + the contract unit suites. *This phase must land before PR B so the migration is CI-gated.*

## PR B — contracts + live migration

### Phase B1 — F-001: forked TokenPortal with an init-once guard (compiles in Foundry)
Create `packages/bridge-evm/src/NuloTokenPortal.sol`: copy the canonical body, add `error AlreadyInitialized();` + `if (address(registry) != address(0)) revert AlreadyInitialized();` as line 1 of `initialize`. **Compile fix (the hard part):** the canonical portal's real `@aztec` `IRollup`/`IInbox`/`IOutbox` imports drag in `FeeLib→BlobLib` (missing `@aztec-blob-lib` remapping) and out-of-allowed-dir files. Resolution: keep the **content-hash-critical** deps REAL (`@aztec/.../crypto/Hash.sol`, `DataStructures.sol`, `TimeLib`/`Epoch` — these define `sha256ToField` + the actor/message structs; reimplementing them would risk content-hash drift → strand) but replace the heavy messaging-interface imports with **minimal local interfaces** (`IRegistry.getCanonicalRollup()→address`, `IRollup.getOutbox()/getInbox()→address`/`getVersion()→uint256`, `IInbox.sendL2Message(L2Actor,bytes32,bytes32)→(bytes32,uint256)`, `IOutbox.consume(L2ToL1Msg,Epoch,uint256,bytes32[])`). That severs the FeeLib/BlobLib chain (it entered via the real interface imports) while preserving byte-identical content hashes. If `Hash.sol`/`DataStructures` themselves still pull BlobLib, fall back to adding the `@aztec-blob-lib` remapping + `fs_permissions` for those leaf libs only.
**Validation gate:** `forge test` compiles `NuloTokenPortal`; a new `NuloTokenPortal.t.sol` proves init-once (deploy → init → second init reverts `AlreadyInitialized`); **`ContentHash.t.sol` still passes** (proving the fork's `sha256ToField` content hashes are byte-identical to canonical — no strand). Layers: contract unit + the cross-chain content-hash pin.

### Phase B2 — F-001: atomic deploy+init factory + read-back asserts
`packages/bridge-evm/src/NuloTokenPortalFactory.sol`: `create(registry, underlying, l2Bridge)` deploys `NuloTokenPortal` + calls `initialize` in the SAME tx, then `require` the three getters equal the args, returns the address. Closes the deploy→init front-run window (F-001's temporal half).
**Validation gate:** `forge test` — factory deploys+inits atomically; getters match; a post-create external `initialize` reverts. Layers: contract unit.

### Phase B3 — F-002: immutable single-minter proxy + deploy-ordering
Rewrite `token_minter_proxy`: remove `set_minter` + `owner` mint-granting. Deploy-ordering circular dep (proxy needs bridge, bridge needs proxy) resolved via a **one-time lockable `set_bridge`**: constructor sets `owner=deployer`; `set_bridge(bridge)` (owner-only) sets `can_mint[bridge]=true` and flips a `bridge_locked` immutable-after flag; once locked, `set_bridge` reverts forever and there is no other path to add a minter or mint via the owner. (CREATE2/salted-address precompute is rejected: the bridge's Aztec address derives from its constructor args which include the proxy address → mutually circular, so precompute doesn't break the cycle; the one-time lock does, and is functionally immutable-single-minter after bootstrap.) Deploy order: proxy → bridge(proxy) → `proxy.set_bridge(bridge)` (locks).
**L2 minter-authority transfer (RISK — verify):** the AZLO token's minter currently = old proxy. Confirm whether the token's minter is mutable (admin/owner re-point) or fixed-at-deploy. If mutable → transfer to new proxy. **If immutable → the migration must ALSO redeploy the token** (re-point `l2.token` + the faucet's AZLO drip + re-seed pools) — larger blast radius; surfaced as an Ask.
**Validation gate:** `nargo test` — bridge can mint via proxy; `set_bridge` locks (second call reverts); no non-bridge minter; no owner-mint; `bun run --cwd packages/bridge-core deploy:sandbox` wires the new order green. Layers: Noir unit + sandbox deploy.

### Phase B4 — F-004 + F-006: swapTarget in the witness, minOutput floor
`SwapBridgeRouter.sol`: add `address swapTarget` as the 12th `BridgeWitness` field — update `BRIDGE_WITNESS_TYPEHASH` (:52), `BRIDGE_WITNESS_TYPE_STRING` (:55), the `BridgeWitness` struct (:113), `_hashBridgeWitness` (:325), and bind `address(swapTarget)` at both call sites (:167, :251). `UniswapFuelSwap.sol:swap`: add `require(minOutput > 0, "UniswapFuelSwap: zero minOutput")`. JS mirror: `@nulo/bridge-core` `bridgeWitnessPermitTypedData` (l1.ts) adds the field; `runSwapBridge` passes the router's current `swapTarget`.
**Validation gate:** `forge test` — new test: a signature bound to swapTarget A reverts when executed after `setSwapTarget(B)`; `WitnessHash.t.sol` (assertEq, now 12 fields) passes; `RouteValidation`/`SwapBridgeRouter` suites green. `bun run --cwd packages/bridge-core test` — the JS witness hash matches the Solidity typehash (cross-pin in l1.test.ts). Layers: contract unit + JS unit + cross-pin.

### Phase B5 — deploy-script updates + Sepolia-fork migration dry-run
Update `deploy-bridge-testnet.ts`: deploy the forked portal via the factory (atomic), the new proxy + bridge + `set_bridge` lock + token-minter transfer, the new router (swapTarget-binding) + swap (minOutput guard). Re-pin the forked portal's keccak in `verify-l1.ts` (bytecode changed). A **fork dry-run**: run the full migration against a Sepolia fork (`vm.createSelectFork`), then assert: new portal re-init reverts; new proxy single-minter; an end-to-end deposit→claim works; `verify:l1` matches the new pin.
**Validation gate:** the fork dry-run forge test passes end-to-end; `bun run --cwd packages/bridge-core verify:l1` green against the new pin; `forge test` + `nargo test` all green. Layers: contract unit + Sepolia-fork integration. *Hard gate before any live action.*

### Phase B6 — LIVE testnet cutover (irreversible; gated on B5 green)
Run the migration against live Sepolia (deployer key via `vm.envUint`/`process.env` — never printed). Sequence: deploy new stack → **read back every address/config on-chain and abort on any mismatch** → re-point `packages/faucet/public/testnet-bridge.json` (`l1.portal`, `l2.proxy`, `l2.bridge`, + `l2.token` if the token was redeployed) + faucet config → `bun run audit:vue` → live smoke deposit/claim. Rollback = restore the old addresses in `testnet-bridge.json` (old stack still functions, just vulnerable). Old portal abandoned (residual testnet funds left, per decision).
**Validation gate:** on-chain read-back matches intended config; `bun run audit:vue` green; a live deposit→claim round-trips; the F-001 PoC (expectRevert form, Phase B7) passes against the NEW live portal. Layers: live-network e2e.

### Phase B7 — F-001 regression: flip the PoC
Move `audit/.../poc/PortalReinit.t.sol` → `packages/bridge-evm/test/PortalReinit.t.sol`, flip to `vm.expectRevert(NuloTokenPortal.AlreadyInitialized.selector)` on the second `initialize` (against a freshly-deployed forked portal, and/or a fork against the new live portal).
**Validation gate:** `forge test --match-path test/PortalReinit.t.sol` green (re-init now reverts). Layers: contract unit + (optional) live-fork.

### Phase B8 — F-008: documented no-op
No code change. Record in the lessons file that `UniswapFuelSwap.sweep` lacks `nonReentrant` is an accepted latent (no accounted state). (Listed for completeness; nothing to validate.)

### Phase B9 — post-impl re-audit
`/harden security` on the new surface (forked portal + factory + new proxy/bridge + router/swap + migration scripts). Address high/critical.
**Validation gate:** harden report produced; no unaddressed high/critical. Layers: audit.

## Security & Adversarial Considerations
- **Deploy→init front-run (F-001 temporal half):** closed by the atomic factory (B2) + the init-once guard (B1); even a front-run init can't be overwritten and the factory's read-back aborts a hijacked deploy.
- **Reorg of the deploy/init:** verify config after finality; the dry-run + on-chain read-back guard against a reorged/partial deploy.
- **Content-hash drift from the fork → strand:** the #1 fork risk. Mitigated by keeping canonical `Hash`/`DataStructures`, and by `ContentHash.t.sol` + the keystone running in CI (F-003) — a drift fails CI.
- **Deployer key (least privilege):** testnet key, env-only, never logged/printed; the live cutover is the only phase that touches it; abort conditions prevent a bad deploy from being wired.
- **Cutover half-state:** the app could point at a half-migrated stack — mitigated by deploying+verifying the FULL new stack before re-pointing `testnet-bridge.json`, and atomic config swap + post-swap smoke.
- **Abandoned old portal:** stays exploitable with residual testnet funds (accepted, per decision); ensure NOTHING in the app still references it post-cutover (grep).
- **swapTarget binding (F-004):** the new witness field must match the JS mirror exactly or every bridge DoS's — covered by the cross-pin gate (B4).

## Assumptions
**Facts** (verified): routes + file locations (brief.md, audit); the live portal is re-init-able (PoC verified); proxy owner is immutable (audit); deploy re-points `testnet-bridge.json` `{l1.portal, l2.proxy, l2.bridge}`; tooling (forge/nargo/vitest/verify:l1/audit:vue).
**Inferences** (attack these): `forge test` is currently green because tests use `MockTokenPortal` (so F-003 CI wiring won't immediately red on the portal compile); the minimal-interface fork compiles AND preserves byte-identical content hashes; redeploying the router/swap needs no V4 pool re-seed (pools key on token addresses, not the caller).
**Asks** (user must decide): (1) Is the L2 AZLO token's minter mutable? If not, the migration also redeploys the token (re-point `l2.token` + faucet drip + re-seed pools — bigger). (2) The F-002 route as built is "constructor + one-time-lockable `set_bridge`" (functionally immutable-single-minter after bootstrap) rather than pure-constructor, forced by the deploy-ordering circularity — acceptable? (3) Run the live cutover (B6) fully autonomously, or pause for you to execute/supervise that one irreversible phase?
