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
- **F1 ✅ — Tabbed Faucet|Bridge shell.** `App.vue` → tabbed (`ref<'faucet'|'bridge'>`, hostname default); faucet content → `views/FaucetView.vue` verbatim; `views/BridgeView.vue` placeholder; `v-show` keeps both mounted (two independent wallet sessions). 123 faucet tests green + build ✓. `LESSONS_FILE=implementations-plan/faucet-bridge/lessons/phase-f1.md`.
- **F2 ✅ — L1 wallet (thin canonical-viem composable; wagmi DROPPED).** `useL1Wallet` (`createWalletClient(custom(window.ethereum))` + account/chain events + switch-to-Sepolia) + `L1WalletPanel`. wagmi hit the `@aztec/viem`-fork hoisting conflict (`@wagmi/core` imports `viem/tempo`, the fork lacks it; bun has no scoped overrides — codex `019ea43d` confirmed) → dropped for canonical viem. F4 boundary to bridge-core = primitives only. biome + tsc + 123 tests + build green. `LESSONS_FILE=implementations-plan/faucet-bridge/lessons/phase-f2.md`.
- **F3 ✅ — L2 wallet session generalized + bridge manifest.** Extracted `createAztecWalletSession(config)` (the faucet's module-level singleton → a reusable factory keyed by `{appId, buildManifest, registerContracts}`); `useWalletConnection` is now a thin faucet wrapper with an identical public API (faucet + tests untouched). `buildBridgeManifest` (`canCreateAuthWit:true`, `contracts=[bridge,token,proxy]`, claim/exit/burn/sponsor scope) + 5 mirrored tests. **128 tests + tsc + lint green.** The bridge's USE of the factory (`useBridgeWallet` + the testnet addresses) moves to F4 (needs the persistent deploy). `LESSONS_FILE=implementations-plan/faucet-bridge/lessons/phase-f3.md`.
- **F4 🟡 — Deposit flow (testnet): UI + logic BUILT, manual end-to-end test pending.** Persistent testnet deploy (the bridge's own USDC+portal on L1, proxy+token+bridge on L2; config in `testnet-bridge.json`). `useDeposit` — faucet-side orchestration (L1 `useL1Wallet` mint/approve/`depositToAztecPublic` → L2 `useBridgeWallet` poll `claim_public`; primitives boundary, no viem types crossed; secret persisted pre-deposit for recovery). `DepositCard` (amount + stage progress bar) + `BridgeWalletPanel` (L2 connect, verify-emoji) + `L1WalletPanel` in `BridgeView` — renders faucet-quality (Playwright snapshot). lint + tsc + 128 tests + build green, 0 console errors. **The GREEN-through-the-app proof = the user's manual deposit** (Rabby + Aztec wallet, real client-side proofs — headless Playwright can't drive it). Full pending-claims queue + export/import + the precise blocks-remaining countdown → folded into F5/F6 (the withdraw's proven-epoch wait makes the countdown meaningful). `LESSONS_FILE=implementations-plan/faucet-bridge/lessons/phase-f4.md`.
- **F5 — UX polish.** Faucet-quality: design tokens, contrast, fonts, loading/error/success states. Exit gate: readable + at par with the faucet.
- **F6 — Withdraw + swap flows.** `consumeWithdrawal` (withdraw) + `runSwapBridge` (swap) through the UI, testnet (withdraw needs `provenTimeoutSec` for the testnet's epoch lag).
- **F7 — Gates.** `bun run audit:vue` green; `/code-review max --fix`; codex post-impl audit.

## Discipline
- **TESTNET only** (the wired `PRIVATE_KEY` for scripts / the user's Rabby in-browser). NEVER mainnet/release.
- Commit unsigned (1Password down) via `git -c commit.gpgsign=false`; push via the gh HTTPS credential.
- `/codex xhigh` on non-trivial decisions (dual-wallet arch, in-browser real-proving UX, design); log in `lessons/`.
