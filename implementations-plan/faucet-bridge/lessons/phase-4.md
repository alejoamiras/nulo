# Phase 4 — `@nulo/bridge-core` (framework-agnostic L1<->L2 TS)

**Status:** IN PROGRESS. Started early — P2 contracts are authored + the recon addresses are known, and P4 is `[∥ P5]` + live-net-independent for the pure layer.

## Done
- ✅ Package scaffold (`@nulo/bridge-core`; `tsc --noEmit` + vitest; no runtime deps yet — the pure layer needs none).
- ✅ `progress.ts` — the improved loading-bar model (the reference bridge's weak point: a bar that lies about ETA). Block-based path (L2->L1: proven-vs-needed → genuine "N blocks remaining (~M min)") + time-based fallback (L1->L2: elapsed/maxWait, capped at `PROGRESS_CAP=0.95` so it never reads "done" before the message is consumable). 8 unit tests (block mid/ready/singular/cap/ETA, time proportional/overrun/indeterminate). typecheck + lint green.

- ✅ `recovery.ts` — no-server resume schema: deposit + withdrawal records in two localStorage keys, via an injected `KV` interface (DOM-free → unit-testable). Claim secret held as an opaque `encryptedSecret` blob (R2: bearer credential for private transfers). `upsert`/`update`/`remove`/`find` + corrupt-JSON tolerance + bigint-as-string amounts. 9 unit tests.
- ✅ `recovery-crypto.ts` — seal/open the claim secret reusing `@nulo/wallet-crypto` PBKDF2+AES-GCM, keyed off a deterministic L1 signature (`recoveryKeyFromSignature` → `EncryptionKey.fromPassword(sig)`: same sig ⇒ same key, re-derivable cross-session/device — the no-server resume guarantee; relies on RFC-6979 deterministic signing). 4 tests (round-trip, re-derivable cross-decrypt, wrong-key rejection, random-IV). **21 bridge-core tests total.** Gotchas: bridge-core's `tsc` follows wallet-crypto source → needs `@types/node` + `types:["node"]` (it uses `Buffer`); wallet-crypto uses `self.crypto` → a `self=globalThis` test shim (no jsdom needed).

## Next (authoring; pure parts unit-testable, node-touching parts integration-only)
- `l1.ts` / `l2.ts` / `status.ts` / `fee-juice.ts` — viem + aztec.js. Need `@aztec/aztec.js` + `@wonderland/aztec-fee-payment` deps (mirror the extension's integration — GitHub tarball + vite alias + `additionalScopes`, per `research/recon-testnet.md` + the codex R2 findings). Pure helpers (encode, leaf-index brute-force selection, content-hash) unit-testable; node-touching (poll/claim/deposit) are integration-only (need a node or a mock).

## Config (from recon)
feeJuice `0x762c…` · feeJuicePortal `0xd336…` · registry `0xa0bf…` · feeAssetHandler `0x5602…` (mintAmount 1000 FJ). See `research/recon-testnet.md`.
