# Phase 4 — `@nulo/bridge-core` (framework-agnostic L1<->L2 TS)

**Status:** IN PROGRESS. Started early — P2 contracts are authored + the recon addresses are known, and P4 is `[∥ P5]` + live-net-independent for the pure layer.

## Done
- ✅ Package scaffold (`@nulo/bridge-core`; `tsc --noEmit` + vitest; no runtime deps yet — the pure layer needs none).
- ✅ `progress.ts` — the improved loading-bar model (the reference bridge's weak point: a bar that lies about ETA). Block-based path (L2->L1: proven-vs-needed → genuine "N blocks remaining (~M min)") + time-based fallback (L1->L2: elapsed/maxWait, capped at `PROGRESS_CAP=0.95` so it never reads "done" before the message is consumable). 8 unit tests (block mid/ready/singular/cap/ETA, time proportional/overrun/indeterminate). typecheck + lint green.

## Next (authoring; pure parts unit-testable, node-touching parts integration-only)
- `recovery.ts` — localStorage two-array schema; **reuse `@nulo/wallet-crypto`** PBKDF2+AES-GCM (R2: don't roll own) keyed off an **L1-signature-derived** key (R2: wallet-crypto's `EncryptionKey` is password-based today → needs the sig-key path / a small wrapper). The encrypt/decrypt round-trip is unit-testable.
- `l1.ts` / `l2.ts` / `status.ts` / `fee-juice.ts` — viem + aztec.js. Need `@aztec/aztec.js` + `@wonderland/aztec-fee-payment` deps (mirror the extension's integration — GitHub tarball + vite alias + `additionalScopes`, per `research/recon-testnet.md` + the codex R2 findings). Pure helpers (encode, leaf-index brute-force selection, content-hash) unit-testable; node-touching (poll/claim/deposit) are integration-only (need a node or a mock).

## Config (from recon)
feeJuice `0x762c…` · feeJuicePortal `0xd336…` · registry `0xa0bf…` · feeAssetHandler `0x5602…` (mintAmount 1000 FJ). See `research/recon-testnet.md`.
