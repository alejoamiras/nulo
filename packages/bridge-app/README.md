# @nulo/bridge-app (Vite + Vue)

The unified Faucet + Bridge frontend. Tabbed shell; the Bridge tab drives the L1↔L2 flows via
`@nulo/bridge-core`. Built with the full aztec stack (in-browser PXE) — the bridging code is
lazy-imported and `import.meta.env.DEV`-gated, so the well-known sandbox key + the aztec stack
stay out of the production bundle.

## Structure

- `src/lib/sandbox.ts` — the sandbox **dual-wallet**: L1 viem (anvil account0) + an in-browser
  L2 PXE (`EmbeddedWallet`, prover off). Reads `public/sandbox.json` (addresses + the run's RPC
  ports, written by `bridge-core/scripts/deploy-sandbox.ts`) and `public/token_bridge.json`.
  Wires `deposit()` → `bridge-core`'s `runDeposit` + the recovery hooks (localStorage). Cached so
  the PXE builds once per session.
- `src/App.vue` — the tabbed shell + deposit form + the stage-driven loading bar. testids:
  `deposit-amount` / `deposit-private` / `deposit-submit` / `deposit-status` / `deposit-success` /
  `deposit-error`.
- `tests/e2e/` — Playwright specs.

## Scripts

- `bun run dev` / `bun run build` / `bun run typecheck`.
- `bun run test:e2e` — Playwright. (The bundled chromium fails to launch on some machines with
  `spawn -88`; drive via the Playwright **MCP** browser instead.)

## Status

- ✅ Tabbed shell + deposit form + loading bar; sandbox dual-wallet; `bun run audit:vue` clean.
- ✅ **deposit-public driven GREEN through the app via Playwright** (in-browser dual-wallet,
  `deposit-success` snapshot captured).
- ⏳ Pending (sandbox-gated): the withdraw + swap UI (calling `bridge-core`'s `consumeWithdrawal`
  / `runSwapBridge`) + their L2 claims, the deposit-private app drive, real-wallet (MetaMask +
  Nulo) dual-wallet, and the faucet-tab port.

## Local sandbox e2e — gotchas (hard-won)

The aztec sandbox must be started as `aztec start --local-network --sequencer.minTxsPerBlock 0`.
The empty-block flag is **required**: claim retries are simulations (no txs), so without it the
sequencer never mints a block, the L1→L2 inbox never advances, and `claim_*` retries forever. A
freshly-started sandbox is also reorg-unstable in its early blocks (a settled one is stable), and
the deploy PXE store must be cleared per instance (`rm -rf packages/bridge-core/pxe_data_*
wallet_data_*`). Full detail: `implementations-plan/faucet-bridge/lessons/phase-5-frontend-e2e.md`.
