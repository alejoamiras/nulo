# Phase 10 — Testnet deploy + owner sign-off (Arc 5)

**Status: IN PROGRESS — the owner authorized the live arc on 2026-09-03** ("copy it, and you are
authorized to deploy. Including the seed tokens."). The `packages/bridge-core/.env` came from the
canonical clone (six keys; nothing was created). The sign-off remains a live wallet-seam walk.

## Live log (2026-09-03)

- Pre-flight: node `5.2.0-nightly.20260815`, identity `11155111/1821665230` (walletChainId
  `1816023401`), L1 addresses byte-equal to the committed `aztec-5.0.0-stable` baseline → no reset,
  `NO_RESET_BASELINE` holds. Signer `0xFcc2238319aC360e985f1736aBB3df6251DAF6F5` at 6.3989 ETH,
  nonce 5276 before the arc. forge 1.7.1, `~/.aztec/versions/5.2.0` installed.
- **Seed tokens deployed** (`scripts/deploy-seed-tokens.ts`, new: `MintableERC20`, 6 decimals,
  cap 1,000,000 whole/tx — the sandbox's shape, so the manifest's `maxWholePerTx` is true on chain;
  the v1 `TestUsdc` `0x032E…2448` has a 1,000 cap and stays v1's):
  - `USDC` `0x8648424f0eae2368555d080c948b622d992651fc` (tx `0xf8d39341…3178b073`)
  - `USDT` `0x8badb545be5d79f28d516844bf1713cc7a3f238f` (tx `0x254cb898…779687b6`)
  Both sort below WETH `0xfff9…`; read back `symbol`/`decimals=6`/`maxMintPerTx=1e12` on Sepolia.
  `SEED_TOKENS=0x8648424f0eae2368555d080c948b622d992651fc,0x8badb545be5d79f28d516844bf1713cc7a3f238f`
- Intent built at `ad2c0320` and committed; `verify` green; `deploy --dry-run` green (L2 deployer
  `0x1a12051c0f347210d0d8bd062ec81f9e1adb9b211f458b2e678331eb925a9191`, sponsored-FPC-paid).
- **Deploy run 1 died at the class publication** — `UniswapFuelSwap` landed at
  `0x43857b88e2f625c873c051834fc51558801c4bb3` (journalled), then `publishContractClass(Token)` was
  rejected with `Invalid tx: Existing nullifier`: the aztec-standards Token class is already
  published on the shared testnet (the sandbox is a fresh chain, so the rehearsal never saw this),
  and `publishIfAbsent`'s no-op regex knew only the `already|duplicate nullifier|Nullifier already
  exists` wordings. Fix-forward `68136c3b`: ask `node.getContractClass(id)` first, and recognise
  `Existing nullifier` when a publication still loses the race (unit-pinned). Intent rebuilt at
  `68136c3b` (the tool refuses a verify after a deploy-relevant source change) → `7d55994f`; the
  rebuilt baseline is 6.3932 ETH, so the arc's true spend = 6.3967 − final (swap target ≈ 0.0035 ETH
  is outside the tool's tally).
- **Deploy run 2 died before the journal** — at `deployAccountIfAbsent`: run 1's account deploy
  HAD landed (tx `0x117f443d…fcee83`, block 67829, checkpointed, 0.99 FJ sponsored), but an account
  deploy publishes no instance, so `node.getContract(from)` answers null forever and the helper
  re-sent the deploy into `Existing nullifier`. Every conductor re-run of a deployer account had
  this latent (the smokes use fresh accounts; the sandbox never re-runs). Fix-forward `4c7f8bba`:
  the served-instance fast path stays, then the account's siloed initialization nullifier
  (`computeSiloedPrivateInitializationNullifier(from, instance.initializationHash)` — the wallet's
  own `requiresInitialization` check) is asked of the node. Unit-pinned; intent rebuilt → `bef44fbc`.
- Deploy run 3: resumed from the journal (swap target adopted, account detected, `Token class
  already published` — the diagnosis confirmed).
- **PrivateFPC gate is RED on this node** (`check-fpc-version.ts --mode require-deployed`: node
  `5.2.0-nightly.20260815` is not in the descriptor's compat list `[5.0.0, 5.0.1]`). Pre-existing
  and owner-ruled: the 5.2.0 JS-line plan's Ask 1 (2026-08-26) chose to LEAVE the testnet map
  as-is, knowing the gate exact-matches the rotating nightly string. Consequence here:
  `fuel-testnet.ts` runs that gate inline before any broadcast, so the heavy validator, its
  `PRIVATE_RUNS=1` settle-canary and the third-token registering sample cannot run on this node.
  Calibration therefore uses `smoke-swap`'s self-paid `claim_public` (the one paid plain claim
  the candidate smokes produce) and the runbook's fallback for `fjRegister`: the sandbox's measured
  register EXCESS scaled by the ratio of the two networks' `claim_public` samples. The private-FPC
  fuel lane on 5.2.0-nightly stays unproven — an owner call (re-curate the compat list → re-canary),
  not this arc's.

## Pre-flight the agent completed

- The stack (#536–#540, stack #541) is rebased on `dev` `4df5eae5` with every gate green per commit
  (`lessons/rebase-onto-dev.md`); the loops converged (arcs 1–5, the cross-arc pass, the rebase
  verification).
- The runbook is `.claude/skills/aztec-update/SKILL.md` § Branch B — steps 3–4 and 8–9 are this
  phase; steps 1–2, 6–7, 10 do not apply (no reset: the testnet identity `11155111/1821665230` is
  unchanged, so `NO_RESET_BASELINE` holds and `live-intent build` runs as-is).
- The sandbox rehearsal (Branch B step 3) on the rebased chain: see "Sandbox rehearsal" below.
- `TOKEN_LIST_LIVE=1` real-origin canary: green (and it caught the list going multi-chain — `lessons/phase-9.md`).
- The seed tokens (`SEED_TOKENS`) must be the committed fake-USDC / fake-USDT `MintableERC20`
  addresses on Sepolia, each sorting below WETH (`token < 0xfff9…`) — record them here before the
  run; `--dry-run` validates only their shape.

## Owner runbook (in order; every command from the repo root)

1. `packages/bridge-core/.env`: `PRIVATE_KEY` (the plan-pinned testnet signer — the conductor
   refuses any other), `SEPOLIA_RPC_URL`, `BRIDGE_DEPLOYER_SECRET_TESTNET` (≥ 16 chars; the SAME
   value on every re-run — it derives the L2 deployer; pre-fund that account's fee juice or let the
   sponsored FPC pay its deploy). The guardian: the conductor records the L1 signer as `guardianL1`
   and the L2 deployer as `guardianL2` (the dedicated recorded testnet guardian — note both
   addresses below).
2. `bun packages/bridge-core/scripts/live-intent.ts build implementations-plan/any-erc20-bridge/lessons/intent.json`
   → commit the intent.
3. `SEED_TOKENS=<fakeUSDC>,<fakeUSDT> bun run --cwd packages/bridge-core deploy:generation deploy --dry-run`
   then the same without `--dry-run` (~15 min of real proofs; journalled — a crash is re-run with
   the SAME command; read the journal's last line against the chain first).
4. `bun packages/bridge-core/scripts/live-intent.ts verify <intent>` (no `--candidate`), then the
   candidate smokes: `smoke-existing-testnet.ts --config apps/tools/public/testnet-bridge.candidate.json`,
   `smoke-swap-existing-testnet.ts --config …`, `fuel-testnet.ts --config …`.
5. Calibrate (`fees.json` OUTSIDE the repo; a registering sample needs
   `pre-create --no-register --seed-pool --token <third mintable>` + `fuel-testnet.ts --token <third>`):
   `bun run --cwd packages/bridge-core deploy:generation calibrate --config <candidate> --samples <path>/fees.json`.
6. `live-intent.ts verify <intent> --candidate <candidate>` → **commit the intent** →
   `live-intent.ts promote <intent> --bridge-only` → commit `apps/tools/public/testnet-bridge.json`.
7. Canaries: `verify:l1 --config apps/tools/public/testnet-bridge.json --strict` ·
   `BRIDGE_MANIFEST=public/testnet-bridge.json bun run --cwd apps/tools verify:deployments` ·
   `fuel-testnet.ts` with `PRIVATE_RUNS=1` · `fee-juice-canary-testnet.ts` · `drip-canary-testnet.ts`.
8. Deploy `testnet.tools.nulo.sh` (Cloudflare Pages builds from the PR branch as a preview; the
   production site follows `main`, not `dev` — the promoted manifest reaches it at the next promote).

## Wallet-seam checklist (D34) — owner, live

- [ ] register-and-claim public of a PASTED token: one grant prompt at Sign & send, one claim.
- [ ] the 2-tx private first claim: `register_token` then `claim_private`, auto-continue, two prompts.
- [ ] gas-only: the swapped slice arrives as Fee Juice and pays its own claim.
- [ ] an exit: the burn authwit prompt, burn before finish, the L1 consume.
- [ ] a paused-exit rejection: `set_exits_paused(true)` from the testnet guardian, the preflight
      refuses before any burn, unpause.

## Sandbox rehearsal (agent, post-rebase)

`bun run --cwd packages/bridge-core deploy:sandbox --smoke` on the rebased chain (`8737bc83`), the
5.2.0 JS line, an OWNED local network: **all 16 flows ✅, 6.5 min, exit 0** — (a) public claim,
(b) private claim + relayed claim + wrong-recipient rejection, (c) token+gas self-paying claim,
(d) gas-only into the FeeJuicePortal, (e) public + private exits through the Outbox, (f1) relayer-first
registration, (f2) two concurrent first-time deposits, (f3) portal-only token registering on its first
claim, (f4) routeless refusal before signing, (g) tampered registration rejected under sponsored /
fee-juice-with-claim / private-FPC, (h) guardian pause blocks exits and not claims. Calibration
identical to the P6 run: `fjPerTx=17785608960000`, `fjRegister=11924383920000` (local fee schedule —
the testnet numbers come from step 5). The conductor path (`generation.ts`, `deploy-manifest.ts`,
`deploy-sandbox.ts`, the hub-l2 / send-flow modules) is therefore proven on the post-rebase tree
with dev's journal ports in place.

## Sign-off

_Owner sign-off: PENDING._
