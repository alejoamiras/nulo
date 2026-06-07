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

## Codex architecture review (session `019ea3f9-bd99-7113-9339-feeabf11b7a1`)
**Verdict:** the dual-wallet split is viable; **reusing the faucet Aztec session as-is is NOT** (the manifest is faucet-scoped — verified in `capabilities.ts`: `canCreateAuthWit:false`, `contracts=[Dripper,USDC,ETH]`, tx-scope=`[drip,sponsor]`). Model **two independent wallet sessions + a resumable bridge-job system** (folded into F3 + F4). Endorsed: wagmi(L1)+wallet-sdk(L2) coexistence in one Vue app, `bridge-core` being framework-agnostic, testnet-only staged scope. Browser proving is testnet-grade UX (CPU/memory/tab-suspension) — the faucet's wallet already runs the PXE off-page (MessagePort), which mitigates main-thread freezes; if proving ever moves into the page, use a worker + the existing COOP/COEP. Full transcript: the codex RESPONSE_FILE for this session.

## Phases
- **F1 — Tabbed Faucet|Bridge shell.** `App.vue` → tabbed (`ref<'faucet'|'bridge'>`, hostname default); faucet tab unchanged; `@nulo/design`.
- **F2 — L1 wallet (wagmi v2 + viem).** Add wagmi v2 + viem; injected (Rabby/MetaMask) connector + connect UI; Sepolia chain; CSP `connect-src` += L1 RPC.
- **F3 — L2 wallet (GENERALIZE, not reuse-as-is — codex finding, verified).** The faucet manifest (`capabilities.ts`) is faucet-scoped (`canCreateAuthWit:false`, `contracts=[Dripper,USDC,ETH]`, tx-scope=`[drip,sponsor]`) → fails the bridge's authwit withdraw + bridge contract calls. Generalize `useWalletConnection` → `useAztecWalletSession(manifest)`; build a **bridge manifest**: `canCreateAuthWit:true` (exit_to_l1 burn authwit), `contracts=[bridge,token,proxy]`, tx-scope=`[claim_public/private, exit_to_l1_public/private, sponsor]`, sim-scope=`[balance_of_public/private]`. Faucet tab keeps the faucet manifest. Pin the bridge manifest shape in a test (mirror the faucet manifest test).
- **F4 — Deposit flow (testnet) + job/recovery model (codex finding).** `runDeposit` (mint → approve → `depositToAztecPublic` [L1 wagmi] → poll `claim_public` [L2 Aztec]) vs testnet; block-countdown bar (`status.ts`). **Bind each job to {L1 chainId+addr, Aztec addr, token, amount, privacy} at creation; guard account changes** (recovery key is L1-signature-derived — `recovery-crypto.ts` — an L1-acct change breaks decryption; an L2-acct change misroutes private claims). **Recovery = a first-class "Pending claims" queue** (not just hooks): on reload, detect pending jobs → reconnect same L1 acct → re-sign recovery msg → reconnect Aztec acct → resume claim; add export/import of the encrypted blob. Drive GREEN via Playwright-MCP (snapshot: connected wallets + bar + L2 balance).
- **F5 — UX polish.** Faucet-quality: design tokens, contrast, fonts, loading/error/success states. Exit gate: readable + at par with the faucet.
- **F6 — Withdraw + swap flows.** `consumeWithdrawal` (withdraw) + `runSwapBridge` (swap) through the UI, testnet (withdraw needs `provenTimeoutSec` for the testnet's epoch lag).
- **F7 — Gates.** `bun run audit:vue` green; `/code-review max --fix`; codex post-impl audit.

## Discipline
- **TESTNET only** (the wired `PRIVATE_KEY` for scripts / the user's Rabby in-browser). NEVER mainnet/release.
- Commit unsigned (1Password down) via `git -c commit.gpgsign=false`; push via the gh HTTPS credential.
- `/codex xhigh` on non-trivial decisions (dual-wallet arch, in-browser real-proving UX, design); log in `lessons/`.
