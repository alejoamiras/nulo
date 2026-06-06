# Phase 4 — `@nulo/bridge-core` (framework-agnostic L1<->L2 TS)

**Status:** IN PROGRESS. Started early — P2 contracts are authored + the recon addresses are known, and P4 is `[∥ P5]` + live-net-independent for the pure layer.

## Done
- ✅ Package scaffold (`@nulo/bridge-core`; `tsc --noEmit` + vitest; no runtime deps yet — the pure layer needs none).
- ✅ `progress.ts` — the improved loading-bar model (the reference bridge's weak point: a bar that lies about ETA). Block-based path (L2->L1: proven-vs-needed → genuine "N blocks remaining (~M min)") + time-based fallback (L1->L2: elapsed/maxWait, capped at `PROGRESS_CAP=0.95` so it never reads "done" before the message is consumable). 8 unit tests (block mid/ready/singular/cap/ETA, time proportional/overrun/indeterminate). typecheck + lint green.

- ✅ `recovery.ts` — no-server resume schema: deposit + withdrawal records in two localStorage keys, via an injected `KV` interface (DOM-free → unit-testable). Claim secret held as an opaque `encryptedSecret` blob (R2: bearer credential for private transfers). `upsert`/`update`/`remove`/`find` + corrupt-JSON tolerance + bigint-as-string amounts. 9 unit tests.
- ✅ `recovery-crypto.ts` — seal/open the claim secret reusing `@nulo/wallet-crypto` PBKDF2+AES-GCM, keyed off a deterministic L1 signature (`recoveryKeyFromSignature` → `EncryptionKey.fromPassword(sig)`: same sig ⇒ same key, re-derivable cross-session/device — the no-server resume guarantee; relies on RFC-6979 deterministic signing). 4 tests (round-trip, re-derivable cross-decrypt, wrong-key rejection, random-IV). **21 bridge-core tests total.** Gotchas: bridge-core's `tsc` follows wallet-crypto source → needs `@types/node` + `types:["node"]` (it uses `Buffer`); wallet-crypto uses `self.crypto` → a `self=globalThis` test shim (no jsdom needed).

- ✅ `content-hash.ts` — pure-TS L1↔L2 content hashes (the THIRD keystone toolchain). `sha256ToField = uint256(sha256(data)) >> 8` (verified against the keystone vectors → it's "0x00 + first 31 bytes of the digest"); selectors hardcoded as `keccak256(sig)[:4]` (`mint_to_public bc6a9bd3`, `mint_to_private 8b3af5e8`, `withdraw 69328dec`); no aztec.js. 3 tests asserting byte-equality with the SAME fixed vectors as the Solidity (`ContentHash.t.sol`) + Noir (`keystone`) tests → the cross-chain content-hash is now pinned across **all three toolchains**. **24 bridge-core tests.**

**Pure layer is COMPLETE** (progress, recovery, recovery-crypto, content-hash). Everything below needs aztec.js + the `@aztec/viem` fork + a node/mock — i.e. the P0.5 browser spike + operator infra.

## Next (integration-shaped; needs the P0.5 spike / a node — not headless-validatable)
- `l1.ts` / `l2.ts` / `status.ts` / `fee-juice.ts` — viem + aztec.js. Need `@aztec/aztec.js` + `@wonderland/aztec-fee-payment` deps (mirror the extension's integration — GitHub tarball + vite alias + `additionalScopes`, per `research/recon-testnet.md` + the codex R2 findings). Pure helpers (encode, leaf-index brute-force selection, content-hash) unit-testable; node-touching (poll/claim/deposit) are integration-only (need a node or a mock).

## Config (from recon)
feeJuice `0x762c…` · feeJuicePortal `0xd336…` · registry `0xa0bf…` · feeAssetHandler `0x5602…` (mintAmount 1000 FJ). See `research/recon-testnet.md`.
