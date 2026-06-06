# Phase 4 — `@nulo/bridge-core` (framework-agnostic L1<->L2 TS)

**Status:** IN PROGRESS. Started early — P2 contracts are authored + the recon addresses are known, and P4 is `[∥ P5]` + live-net-independent for the pure layer.

## Done
- ✅ Package scaffold (`@nulo/bridge-core`; `tsc --noEmit` + vitest; no runtime deps yet — the pure layer needs none).
- ✅ `progress.ts` — the improved loading-bar model (the reference bridge's weak point: a bar that lies about ETA). Block-based path (L2->L1: proven-vs-needed → genuine "N blocks remaining (~M min)") + time-based fallback (L1->L2: elapsed/maxWait, capped at `PROGRESS_CAP=0.95` so it never reads "done" before the message is consumable). 8 unit tests (block mid/ready/singular/cap/ETA, time proportional/overrun/indeterminate). typecheck + lint green.

- ✅ `recovery.ts` — no-server resume schema: deposit + withdrawal records in two localStorage keys, via an injected `KV` interface (DOM-free → unit-testable). Claim secret held as an opaque `encryptedSecret` blob (R2: bearer credential for private transfers). `upsert`/`update`/`remove`/`find` + corrupt-JSON tolerance + bigint-as-string amounts. 9 unit tests.
- ✅ `recovery-crypto.ts` — seal/open the claim secret reusing `@nulo/wallet-crypto` PBKDF2+AES-GCM, keyed off a deterministic L1 signature (`recoveryKeyFromSignature` → `EncryptionKey.fromPassword(sig)`: same sig ⇒ same key, re-derivable cross-session/device — the no-server resume guarantee; relies on RFC-6979 deterministic signing). 4 tests (round-trip, re-derivable cross-decrypt, wrong-key rejection, random-IV). **21 bridge-core tests total.** Gotchas: bridge-core's `tsc` follows wallet-crypto source → needs `@types/node` + `types:["node"]` (it uses `Buffer`); wallet-crypto uses `self.crypto` → a `self=globalThis` test shim (no jsdom needed).

- ✅ `content-hash.ts` — pure-TS L1↔L2 content hashes (the THIRD keystone toolchain). `sha256ToField = uint256(sha256(data)) >> 8` (verified against the keystone vectors → it's "0x00 + first 31 bytes of the digest"); selectors hardcoded as `keccak256(sig)[:4]` (`mint_to_public bc6a9bd3`, `mint_to_private 8b3af5e8`, `withdraw 69328dec`); no aztec.js. 3 tests asserting byte-equality with the SAME fixed vectors as the Solidity (`ContentHash.t.sol`) + Noir (`keystone`) tests → the cross-chain content-hash is now pinned across **all three toolchains**. **24 bridge-core tests.**

**Pure layer is COMPLETE** (progress, recovery, recovery-crypto, content-hash).

## Integration — UNBLOCKED (sandbox live, no wagmi, deps wired)
- ✅ Node-layer deps in bridge-core: `@aztec/aztec.js` + `@aztec/accounts` + `@aztec/foundation` + the viem fork (`npm:@aztec/viem@2.38.2`). **No wagmi** — the faucet is pure aztec.js; the bridge does L1 with viem directly (corrected an earlier wrong assumption).
- ✅ **Sandbox L1 deploy LIVE** (`scripts/deploy-sandbox.ts`): `anvil_setCode` Permit2 (runtime bytecode fetched from Sepolia, since a fresh sandbox lacks it) + deploy MintableERC20 / MockSwapTarget / SwapBridgeRouter, verified against the running sandbox. feeJuice/portal read from `node_getNodeInfo`. See `research/recon-sandbox.md`.

## L2 deploy plan (next — the aztec.js half)
API (from Holonym `bridge-script/index-testnet.ts`):
- Portal: `deployL1Contract(l1Client, TokenPortalAbi, TokenPortalBytecode, [])` (abi/bytecode from `@aztec/l1-artifacts`), then `portal.initialize(registry, l1Token, l2Bridge)`.
- L2 instances: `getContractInstanceFromInstantiationParams(artifact, { salt, deployer, constructorArgs })`.
- **Nulo vs Holonym**: aztec-standards `Token` (not `@aztec/noir-contracts.js/Token`) + Nulo's `token_minter_proxy` as the single minter (so faucet Dripper + bridge mint the SAME asset) + Nulo's attestation-stripped `token_bridge(minter_proxy, portal)` (from `bridge-aztec`, not noir-contracts TokenBridge). Add the bridge to the minter-proxy allow-list.
- Fund `MockSwapTarget` with sandbox feeJuice (`0xa513…` is a TestERC20: `mint`/`addMinter`, else `anvil_setStorageAt`).
- Deployer: an aztec.js account funded via the sandbox (`getInitialTestAccounts`).
- Reference closest to bridge-core's node layer: Holonym `bridge-sdk/src/l1.ts`.

## Config (from recon)
feeJuice `0x762c…` · feeJuicePortal `0xd336…` · registry `0xa0bf…` · feeAssetHandler `0x5602…` (mintAmount 1000 FJ). See `research/recon-testnet.md`.
