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
- **Generation landed (run 3, 10.1 min, exit 0)** — journal
  `packages/bridge-core/deploy-journal/testnet-generation.jsonl`:
  - `UniswapFuelSwap` `0x43857b88e2f625c873c051834fc51558801c4bb3` (run 1)
  - `PortalFactory` `0xcb00b6b713f6170e1a42cb8ff933866e46945edc` (impl `0x3ffbd5a0…aaad2`),
    `SwapBridgeRouter` `0x218e782b748ce61d5c5d48d92dfbe55396353816`,
    `TokenBridgeHub` `0x0c1e649c332328319a8c559dbbe7a7290dc91a2487c05372e82c13c8c0715a7f`
    (Token class `0x0225da0f…ef2cf`, already published on the network; hub class published by us);
    readbacks ✓ (`factory.L2_HUB`, router `FACTORY/FEE_ASSET/permit2/feeJuicePortal/swapTarget`,
    `hub.token_for(0) == 0`). Guardian L1 = the signer; guardian L2 = the deployer account.
  - USDC → portal `0xd97917c37294a073b90e0e6a9ded8345f1fdb757`, L2 `0x00242d87…6502`, registered,
    USDC/WETH pool seeded (fee 3000 / tick 60, price within tolerance).
  - USDT → portal `0x3896dfb982a66ef992020e0fc8066956a3e694bd`, L2 `0x14c11c3c…ed96`, registered,
    USDT/WETH pool seeded.
  - `apps/tools/public/testnet-bridge.candidate.json` written (schema 2, walletChainId 1816023401,
    `fjPerTx`/`fjRegister` = `0` placeholders — the live file is v1, nothing to carry).
  - `verify-l1 --strict` on the candidate: **passed** (bindings, both tokens' portal derivation +
    frozen registration + live metadata, three masked runtime code hashes).
  - Spend after the deploy: 0.5136 ETH by the tool's tally (+ ≈0.0035 for the run-1 swap target).
  - `BRIDGE_MANIFEST=public/testnet-bridge.candidate.json verify:deployments`: hub + both L2 tokens
    re-derive to the committed addresses.
- **Smoke run 1 died at the first claim** — `smoke-existing`'s USDC public deposit landed (leaf
  63287296, 1 USDC to a throwaway account, abandoned) and the immediate hub claim simulated into
  `Tried to consume nonexistent L1-to-L2 message` — the message was not in the L2 tree yet, which
  is exactly what `claimTokensUntilSynced` exists to wait out, but its predicate knew only wordings
  no 5.x node emits (`L1 to L2 message.*not found` never matches `No L1 to L2 message found`), and
  it DID retry `No non-nullified …`, the already-consumed case (30 min of waiting for nothing). The
  sandbox never surfaced it: its smoke forces a block before every claim. Fix-forward `d8dea004`:
  the app's classification (`nonexistent L1-to-L2 message` · `l1_to_l2_msg_exists` ·
  `message not in state` · `(?<!non-nullified )No L1 to L2 message found`), consumed surfaces at
  once; unit-pinned with both live wordings. Intent rebuilt → `9da0f5b1`.
- **Smoke run 2 — green.** `smoke-existing`: USDC public (leaf 63292416) + private (63294464),
  USDT public (63297536) + private (63299584), each claimed via the hub after its message synced
  (`✅ CANDIDATE smoke PASSED — 2 tokens bridged public + private … 12.3m`). `smoke-swap`: 1 USDC
  fueled send → quote 40.93 FJ (floor 39.70) → token leaf 63302657 / fuel leaf 63302656 → the
  self-paying hub claim landed (`✅ FUELED smoke PASSED … 3.5m`, FJ gained 38.334 of 40.930).
- **Calibration** (`fees.json` in the session scratchpad, outside the repo): the self-paid
  `claim_public` (tx `0x2ce6bdf3…0104`, block 67877) cost `transactionFee = 2595637213604538218`
  FJ-wei (= the FJ delta exactly). No registering sample is producible on this node (see the FPC
  gate above), so the runbook fallback: sandbox register excess `9936986600000` × the fee ratio
  `2595637213604538218 / 14821340800000 = 175 128.4` = `1740248237868576233` → a synthesized
  `register_and_claim_public` sample of `4335885451473114451`. `calibrate` wrote
  **`fjPerTx = 3114764656325445862`** (3.1148 FJ) and **`fjRegister = 2088297885442291480`**
  (2.0883 FJ); `minFuelFj` stays `29580299742031535464`. Follow-up: replace `fjRegister` with a
  real registering sample once the private-FPC lane is unblocked (`pre-create --no-register
  --seed-pool --token <third>` + `fuel-testnet --token <third>`).
- `verify --candidate`: strict verify-l1 + hub initialization readback green; digest
  `a27da4727a75fc7c35893d72cf1bbda68d386a296b3aec7494a0d2f43802ca9a` recorded → intent committed
  `0d85fbb7`.
- **`promote --bridge-only` is BLOCKED by the same FPC gate** (`live-intent.ts` runs
  `check-fpc-version --mode require-deployed` inline before the live write). Evidence for the owner's
  ruling: the pinned FPC `0x1a6d21ce…1bc0` is deployed with `original == current ==
  0x032bc73c22b1d0ab26cce0c99d7ab71f0078962f9a92b060cc9c5cb87e4cfb08`, which is exactly the class the
  installed `@alejoamiras/private-fee-juice` 5.0.1 artifact computes — the compat-list string is
  the gate's only red component; the rollup did not reset, and every 5.0.1-compiled Noir contract
  this arc touched (hub, Token, the private claims) executed on this node. Owner options:
  (a) append `"5.2.0-nightly.20260815"` to `compatibleNodeVersions[d5a2453c…]` in
  `packages/bridge-core/src/private-fpc-canonical.json` (a curated ruling by the descriptor's own
  policy) → `promote` → `fuel-testnet.ts` `PRIVATE_RUNS=1` as the re-canary; (b) hold the promotion.
  Never hand-copy the candidate.
- **Owner ruling (2026-09-03, in chat: "I vouch for that")** → `5.2.0-nightly.20260815` appended to
  the descriptor's compat entry (`71ef45ef`); `private-fuel.test.ts` 9/9; the gate green
  (compat + identity + digest + live class). Intent rebuilt at `71ef45ef` → digest re-recorded
  (same `a27da472…`, the candidate was untouched) → **`promote --bridge-only` landed**
  (`417a00ba`, receipt beside the intent; the faucet file byte-pinned unchanged). The receipt writer
  used to hardcode the 5.0.1 arc's lessons dir and overwrote that arc's receipt — restored, and the
  path now derives from the intent.
- Gate-independent canaries (candidate): **fee-juice direct lane ✓** (16 FJ deposit at leaf
  63311872 → self-paid claim landed 14.7287 FJ, fee 1.2713 FJ, 3.6 min) · **drip ✓** (1e9 NULO
  units to a fresh account, 0.5 min). Live-file canaries after promotion: `verify:l1 --strict` ✓,
  `verify:deployments` ✓.
- **Re-promotion**: the tools manifest test (`bridge-generation.test.ts`) pins `privateFpc.address`
  on every shipped manifest and the conductor wrote the candidate without the block the placeholder
  carried. Fix `512f31e1` (`privateFpcBlock()` from the pinned address + the descriptor's
  version/digest); the conductor re-run resumed everything from the journal (no broadcast) and
  rewrote the candidate with the block and the budgets carried from the live file; intent rebuilt,
  digest `deb70e43…` recorded (`a0ea1ad8`), promoted again (`2f2d1107`); test 8/8, strict verify-l1
  and verify:deployments green on the live file.
- **Fuel canary run 1 failed on its own default**: `FUEL_SLICE` = 0.25 USDC quotes 10.19 FJ on the
  new pools, under the 29.58 FJ `minFuelFj` floor, so the router's floor guard reverted
  (`UniswapFuelSwap: insufficient output`) before anything moved — correct behaviour; the old v1
  pool priced 0.25 USDC above the floor. Re-run with `FUEL_SLICE_UNITS=1000000` (1 USDC → 40.66 FJ):
  public lane ✓, private-FPC run recorded below. Follow-up: derive the script's default slice from
  the floor and the live quote instead of a fixed quarter unit.
- The conductor's `deploy-journal/testnet-generation.jsonl` stays local (untracked, allowlisted):
  its run-3 `candidate-written` line carries this machine's absolute path (fixed for future runs in
  `609fa305`), and the brand/path hook refuses it. Every address it holds is recorded above.
- **Fuel canary, private-FPC lane (the settle canary) — a real app bug found live.** Run 2
  (1 USDC → 40.397 FJ bridged) was refused by the FPC: `Amount too low to cover gas cost`. Run 3
  (3 USDC → 117.34 FJ) settled — actual claim fee **1.786 FJ** (≈909,600 L2 gas at
  `feePerL2Gas` 1.96e12, DA fee 0), public lane 2.585 FJ — so the script's derived "getFeeLimit ≈
  3.06 FJ" could not explain a 40 FJ rejection. Root cause: `@aztec/wallet-sdk` 5.2.0
  `base_wallet.js:218` fills `gasLimits ?? maxTxGasLimits` (the node's `txsLimits.gas`: 6,540,000
  L2 / 117,668 DA), and the PrivateFPC asserts `amount >= Σ gasLimit·maxFee` (the LIMIT, no refund):
  6.54M × (predicted-worst × 1.5 ≈ 6.2e12) ≈ 40.5 FJ — exactly where the 1 USDC run fell short.
  The app's direct Fee Juice lane (`fuelClaim.ts`) already documents and handles this with explicit
  `PRIVATE_CLAIM_GAS`; the hub's private-FPC claim (`deposit-flow.ts` `privateFpcFee`) and the
  validator declared no limits. The sandbox's fee schedule (6.54M × its fee ≈ 0.00007 FJ) could never
  show it, and the manifest floor `minFuelFj` = 29.58 FJ was BELOW the live ceiling — a user
  bridging exactly the floor would have had a private fuel claim the FPC refuses until fees drop.
  Fix `f25ddbd7`: `PRIVATE_HUB_CLAIM_GAS = { daGas: 100_000, l2Gas: 2_000_000 }` (2.2× the landed
  claim) + `privateFpcFeeLimit` in `private-fuel.ts`; the app declares the limits and `stop`s a
  bridged amount under the committed ceiling before the FPC can reject it (`deposit-flow.test.ts`
  16/16, `private-fuel.test.ts` 11/11, tools 1086, bridge-core 427); the validator declares the same
  limits and prints the exact ceiling (`Σ limit·committed fee`) instead of a used-gas ratio. Ceiling
  at today's fees ≈ 12.4 FJ → floor/ceiling ≈ 2.4×; the runbook's 4× policy would put `minFuelFj` at
  ≈50 FJ — left for the owner (a one-sample number may only raise the floor; raising it re-runs the
  candidate → verify → promote cycle since the conductor writes the constant).
- **Fuel canary run 4 (fixed code, `PRIVATE_RUNS=1`, 1 USDC slice) — green, the settle canary.**
  Public lane: 38.62 FJ bridged (token leaf 63380481 / fuel leaf 63380480), claim fee 2.606 FJ.
  Private-FPC lane: 38.37 FJ bridged (leaves 63383553 / 63383552) — the amount the FPC refused in
  run 2 — **claim settled**, fee 1.762 FJ, exact committed ceiling 6.598 FJ. `✅ 2 fueled runs
  SETTLED in 7.0m`. Printed `minFuelFj calibration: 26.39 FJ` (4× the ceiling) < the live floor
  29.58 FJ, so the floor stands (a one-sample number may only raise it). `fjPerTx` sample 2.606 FJ
  ×1.2 = 3.127 FJ vs the promoted 3.115 FJ (+0.4 %, inside the margin) — not worth a re-promotion;
  fold into the next calibration.

## Codex review of the live fix-forwards (session `01a067a0-d197-7733-b88a-b078790910bc`)

Round 1 (fresh session, xhigh, read-only, on `f25ddbd7`): "request changes" — two highs, three
mediums, one low; the init-nullifier and message-classification fixes clean.
- HIGH `hub-l2.ts` `firstPrivateClaim` — VERIFIED REAL: the app's ladder hands ONE `fee.opts` to
  `claimViaHub`, which paid `register_token` AND the claim with it; a mint-and-pay fee spends the
  bridged Fee Juice message once, so a fueled private first claim on an unregistered token could
  never claim (registration consumed the message). Neither the sandbox (its private flows ran on
  registered tokens) nor the smokes (pre-created = registered) could see it. Fix `1de456c0`: a
  `registerFee` seam in `SendOpts` — `splitRegisterFee` gives the registration `registerFee` and the
  claim `fee`, stripped before the wallet; the app's ladder and the validator set it to the sponsor
  on the private-fuel lane. Codex's alternative (mint-and-pay for the registration, then the FPC
  balance for the claim) was rejected: registration is public-effect anyway and the sponsor lane
  exists, and it keeps ONE FPC ceiling instead of two.
- HIGH `private-fuel.ts` limit sizing + "margin costs nothing" — VERIFIED: the FPC's Noir (in the
  artifact's `file_map`) credits `amount − max_gas_cost` and refunds nothing, so limit and padding
  are Fee Juice the claimer forfeits. The comment now says so; 2.0M kept (init-shape headroom, and
  a first claim on an unregistered token cannot be simulated at all — the derived token's
  constructor is enqueued).
- MEDIUM ×1.5 padding — dropped in the app's private lane and the validator (`RELIABILITY_PAD`
  default 1): predicted-worst only, the direct lane's policy; retries re-price.
- MEDIUM floor 29.58 vs 4× — left to the owner (runbook: a one-sample number may only raise; the
  settle canary's 4× = 26.39 FJ is under it). Codex's note: sum both transactions when
  registration is required.
- MEDIUM `generation.ts` — the nullifier rejection is trusted only once `node.getContractClass(id)`
  serves the class; a phantom rejection throws and journals nothing (tested).
- LOW `bridge-generation.test.ts` — the full `privateFpc` triple is pinned.
Gates after the round: bridge-core 428, tools 1086, lint 0, typecheck 0.

Live validation of the seam (also the runbook's registering-sample path): third seed token
**EURC** `0xc10bcb5a0519934e68b489a3a89ee28af8624d24` (tx `0x23b9e385…2a02`), pre-created on the
candidate WITHOUT hub registration → portal `0x1b7806120b80f674719ae7e1be0cc039cc10ae34`, EURC/WETH
pool seeded; then `fuel-testnet.ts --token EURC PRIVATE_RUNS=1`: recorded below.

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
