# Faucet-Bridge — frontend integration plan

**Goal:** integrate the bridge into the **faucet app** (`packages/faucet`) as a tabbed Faucet|Bridge shell, **testnet-validated**, at faucet quality. The standalone `bridge-app` was a throwaway test harness (proved the logic) — superseded by this. The bridge LOGIC (`bridge-core`) is proven (sandbox 4-flow + real-V4/Permit2 fork + **live-testnet deposit**); this work is the UI + wallet layer only.

## Why the pivot
The standalone `bridge-app` is a bare scaffold — unreadable UX, no real wallet, missing fonts. The faucet already has the design system, readable UX, and the Aztec wallet. P5 always intended this ("rename faucet → bridge-frontend, tabbed"). Reuse the faucet's quality instead of rebuilding it.

## Recon (faucet today)
- Aztec-only: `src/composables/useWalletConnection.ts` + `src/components/WalletPanel.vue` (L2 Aztec wallet via `@aztec/wallet-sdk` / `@aztec/wallets`).
- Single `src/App.vue`, no router. Uses `@nulo/design`.
- **No L1 (Ethereum) wallet, no wagmi/viem** — that's the new piece.

## Architecture
- **L1 (Sepolia):** wagmi v2 + viem, **injected connector (Rabby/MetaMask)** → `depositToAztecPublic` + L1 txs. New.
- **L2 (Aztec testnet):** reuse the faucet's `useWalletConnection` → `claim_public` etc. Real proofs (`proverEnabled:true`) → claim wait ~minutes; the block-countdown bar shows it.
- **Flows:** `bridge-core` (`runDeposit` / `consumeWithdrawal` / `runSwapBridge` / fee-juice), wired to the dual-wallet, against the **testnet** (deployed addresses in `lessons/phase-testnet-deposit.md`; `deposit-testnet.ts` is the reference).
- **Design:** `@nulo/design` — readable, fonts loading (no OTS errors).

## Phases
- **F1 — Tabbed Faucet|Bridge shell.** `App.vue` → tabbed (`ref<'faucet'|'bridge'>`, hostname default); faucet tab unchanged; `@nulo/design`.
- **F2 — L1 wallet (wagmi v2 + viem).** Add wagmi v2 + viem; injected (Rabby/MetaMask) connector + connect UI; Sepolia chain; CSP `connect-src` += L1 RPC.
- **F3 — L2 wallet (reuse).** Reuse `useWalletConnection` for the bridge's L2 side.
- **F4 — Deposit flow (testnet).** `runDeposit` (mint → approve → `depositToAztecPublic` [L1 wagmi] → poll `claim_public` [L2 Aztec]) vs testnet; block-countdown bar (`status.ts`); recovery (persist secret). Drive GREEN via Playwright-MCP (snapshot: connected wallet + bar + L2 balance).
- **F5 — UX polish.** Faucet-quality: design tokens, contrast, fonts, loading/error/success states. Exit gate: readable + at par with the faucet.
- **F6 — Withdraw + swap flows.** `consumeWithdrawal` (withdraw) + `runSwapBridge` (swap) through the UI, testnet (withdraw needs `provenTimeoutSec` for the testnet's epoch lag).
- **F7 — Gates.** `bun run audit:vue` green; `/code-review max --fix`; codex post-impl audit.

## Discipline
- **TESTNET only** (the wired `PRIVATE_KEY` for scripts / the user's Rabby in-browser). NEVER mainnet/release.
- Commit unsigned (1Password down) via `git -c commit.gpgsign=false`; push via the gh HTTPS credential.
- `/codex xhigh` on non-trivial decisions (dual-wallet arch, in-browser real-proving UX, design); log in `lessons/`.
