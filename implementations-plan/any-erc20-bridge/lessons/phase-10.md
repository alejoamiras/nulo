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
pool seeded; then `fuel-testnet.ts --token EURC PRIVATE_RUNS=1` — **green in 7.8 min**: the public
lane landed as **`register+claim`** (`register_and_claim_public`, fee **4.621 FJ** — the real
registering sample; EURC is now a registered, ordinary third token), the private lane a plain
`claim_private` through the FPC (fee 2.845 FJ, exact ceiling 7.10 FJ at that moment). Printed:
`minFuelFj` 4× = 28.41 FJ (< 29.58, floor stands), `fjPerTx` sample 2.845 FJ, `fjRegister` hint
**1.776 FJ** (register+claim − plain). Because the public lane registered EURC first, the private
lane did NOT exercise the sponsor-paid `register_token` path — a fourth token with
`PUBLIC_RUNS=0` (`d6588bb9`) does that.

**GBPC — the seam, live.** Fourth seed token `0x177EaD2a677858e376941390548FcF01A6ebeFCa` (tx
`0x7ce5738d…9fa85`, nonce 5363; it sat pending for minutes because I let it sign concurrently with
the EURC canary from the same key — the runbook's "serialize the deployer" rule, relearned — and my
retry mined a duplicate, unused token at nonce 5364). Pre-created without registration → portal
`0x12c3db4596443e4c211bfe7c9c3d316ce57ad85d`, pool seeded. `fuel-testnet.ts --token GBPC
PUBLIC_RUNS=0 PRIVATE_RUNS=1`: three L2 transactions in order — the throwaway account's deploy
(sponsor, `0x2e5b67d1…d646`), **`register_token` paid by the sponsor (`0x2f31…9c3b`, 5.32 FJ)**,
two "claim not ready" waits while the message synced, then **`claim_private` paid by the bridged
fuel through the FPC (`0x139bcd59…1449`, 2.98 FJ)**. The outcome path printed `claim` because the
retry after the waits found the token registered (codex's "registerTxHash is lost on a throw after
the registration" — cosmetic here; the registration and the claim both landed). Ceiling 7.44 FJ;
printed `minFuelFj` 4× = **29.77 FJ > 29.58** — with three live private ceilings (6.60 / 7.10 /
7.44) that is the full calibration, so the floor is RAISED to `29773418555864000000`
(`MIN_FUEL_FJ` in `deploy-generation.ts`).

**Recalibration** with every paid claim the validators landed (seven plain samples across both
lanes, worst 2.98 FJ; the EURC `register_and_claim_public` 4.62 FJ): `fjPerTx` 3.578 FJ,
`fjRegister` 1.967 FJ (the calibrator's worst-registering minus worst-plain, now measured rather
than scaled from the sandbox). Candidate rebuilt from the journal with four tokens (USDC, USDT,
EURC, GBPC — the last two registered by their first claims), the new floor and these budgets →
`verify --candidate` (strict verify-l1 on all four tokens + hub readback green, digest
`ba7ced36…`) → **promoted `f24539dc`** (first attempt died on a DNS blip before any write;
the retry landed). Live-file canaries: `verify:l1 --strict` ✓, `verify:deployments` ✓ (hub + four
L2 tokens re-derive). Gates at `f24539dc`: `bun run test:all` exit 0, `bun run lint` exit 0;
pushed (`gh stack push`, PR #540).

Codex round 3 (resume on `1de456c0..f24539dc`): the ChatGPT backend answered 404 on both attempts
(`turn.failed`, `codex login status` fine) — codex is down; the owner said to wait for it. The
verification prompt is written (session scratchpad, `codex-p10-fresh-verify.md`, self-contained
for a fresh session) and ran once the service returned.

Codex round 3 (fresh session `01a067d9-8bb6-7d51-b6f8-024b4b3d0e92`, `codex-vTD5Lw2i`, on
`33d92abf..f24539dc`): "Verdict: fixes are sound against the installed wallet-sdk 5.2 behavior,
but one medium recovery-state bug remains." — `deposit-flow.ts:646 · medium`: the app's
`claimAttempt` latch (`fee.onAttempt` in `useSend.ts`) fired BEFORE `claimViaHub`, which now runs
the sponsored `register_token` first, so a registration that fails (a rejected prompt, a revert)
spends no fuel yet reads as a pending private fuel claim for the 15-minute stale window. VERIFIED;
fix `4ed9cdbf`: `SendOpts.onClaimSend` — `claimViaHub` fires it once, right before the claim's own
transaction (after any registration; never on a registration that throws), stripped from sends and
simulations with the other seam key; `useSend` passes `fee.onAttempt` through it. Pinned in
`hub-l2.test.ts` (ordering across all three claim shapes, the throw case, the stripping). Gates:
bridge-core 429, tools 1086, typecheck 0.

Codex round 4 (resumed): "Verdict: the latch placement and wallet-option stripping are correct,
but the exactly-once callback contract has one race hole." — `hub-l2.ts:144 · low`: a lost public
registration race fired `onClaimSend` before `register_and_claim_public` and again before the
fallback plain claim. Fixed `780803dd`: one call before the try (both transactions are the same
attempt), the lost-race case pinned (`register_and_claim_public → claim_public`, one callback).
Lint 0; `test:all` at `f6c34d1e` exit 0 (the previous top); re-run at `780803dd`: recorded below.
Codex round 5 (resumed): "Verdict: `780803dd` correctly makes the public lost-race fallback one
logical attempt while preserving wallet-option stripping. no new material findings." — the live
arc's fix loop has converged (rounds 1–5, one fresh session after the outage).

## CI on the promoted manifest, and the preview for the sign-off

PR #540 went red on both `Build Tools` jobs (testnet + mainnet → `quality-status`): the tools
app's jsdom smoke (`tests/e2e/tools-smoke.test.ts`, run inside the build gate) lost 3 of 8 cases.
Until P10 the shipped testnet manifest was a placeholder (`bridge: null`), so the smoke never met
the hub; with the live bridge block, connect-time `registerHubContracts` re-derives the hub and
every manifest token through the smoke's gutted `getContractInstanceFromInstantiationParams`
mock (`0x0`), the instantiation check rightly refuses it, the connection wedges in `error`, and
drip/disconnect cascade. Fix `984dcc60` (test-only): the hub and hub-token instances are pre-baked
in the smoke like every other contract module there; 20/20 locally. `dev` has not moved since the
rebase base (`4df5eae5`), so the stack is current.

**Preview for the wallet-seam walk**: Cloudflare Pages builds the tools app per PR branch with the
testnet values — the project's Pages subdomain is the legacy `nulo-faucet.pages.dev`:
`https://any-erc20-bridge-docs.nulo-faucet.pages.dev` (branch alias; per-commit
`https://<deploy-id>.nulo-faucet.pages.dev`). Verified serving the promoted manifest: schema 2,
walletChainId 1816023401, hub `0x0c1e649c…`, USDC/USDT/EURC/GBPC, `fjPerTx` 3.578 FJ,
`build.json` `manifestDigest` `ba7ced36…` = the intent's candidate digest, `buildId 0.1.0+984dcc60`.

Round 2 (resumed, on `1de456c0`): "close" — one wallet-boundary miss, one policy point, one known
gap, one nit.
- MEDIUM `useSend.ts` `probeHubClaim` simulated with the seam key still in the options (the
  wallet's option parser spreads unknown keys) — VERIFIED; fixed `bcca8f31`: `claimSendOpts`
  (exported from `hub-l2.ts`, tested) strips it for the simulation as for the send.
- MEDIUM "make `registerFee` mandatory when the private token is unregistered" — NOT adopted:
  reusable fees (the sponsor, an account's own Fee Juice) legitimately pay both transactions, and
  every script/sandbox caller relies on that; the app's fuel lane always sets the seam. The
  invariant is stated on the type.
- MEDIUM the validator pre-deploys the account, so the first-ever-account initialization shape
  the 2.0M limit reserves headroom for stays unmeasured — the same KNOWN GAP `fuelClaim.ts`
  documents for the direct lane; follow-up: an extension-driven e2e or a fresh undeployed-account
  FPC claim.
- LOW the manifest test now compares the `privateFpc` triple to the descriptor's exact values.

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

## Owner walk of the Pages preview → the UX arc (2026-09-03)

The owner walked the preview before signing off and sent the wizard back: the step chips, the paste
box, the provenance chips, the "First time for this token" label, the mint card, the MAX button, the
change/done toggle on the gas card, the "out of the gas you are buying" fee line, the gas-only
"Token arrives = 0" line, and RUN IN BACKGROUND landing on a populated step 3. Two of those were
not copy: USDC (registered) showed the first-time path on a plain Ethereum wallet, and the
"network fee" was the whole gas budget captioned as a fee.

A design canvas (four mint variants) was approved with no changes; the mint decision moved to
variant B (a testnet-only strip, the flow otherwise identical on both networks). The arc is
[send-wizard-ux](../../send-wizard-ux/plan.md), branch `any-erc20-bridge/ux` above the stack, four
commits (token step, amount step, review, wizard). Findings while building it:

- **The first-time false positive was the wallet seam.** `useTokenSelection` only read the hub's
  `token_for` through the connected Aztec wallet, so without one every registered token read as
  portal-only. The binding is now read from the node's public storage: `token_of` is a
  `Map<EthAddress, PublicImmutable<AztecAddress>>` at slot 9 of the hub artifact's `storageLayout`,
  the entry's own slot holds the address (`WithHash` packs the value first), zero means unbound.
  `hubBindingAt(node, hub, erc20)` in bridge-core; no wallet, no simulate.
- **A token-only send is never sponsored.** `gateNoFuelClaim` reads the recipient's public and
  private Fee Juice and STOPS with "No gas (Fee Juice) to claim this no-fuel bridge" when both are
  zero — on every network, not only mainnet. The review said "paid by the sponsor". It now says
  "paid from the gas you already hold on Aztec", and the amount step reads the same two balances
  (`useGasHeld`) and blocks Token alone while both are known to be zero, before any Ethereum
  signature. Unknown (no account, unreadable) blocks nothing; the claim's gate fails closed.
- **The fee is one transaction, not the budget.** The review's Fee line is `fjPerTx` (plus
  `fjRegister` for an unregistered token), stated as the first of the N transactions the bought
  gas covers; the gas leg itself moved to the Arrives line.
- **`deriveStorageSlotInMap` is async in 5.2.** The Promise typed through to
  `getPublicStorageAt` until awaited.
- The Pages preview for the sign-off is the PR's own; the five-item checklist below is unchanged.

**`/code-review medium --fix` on the arc** (a fresh adversarial reviewer over the branch diff, one
file at a time): 1 HIGH, 5 MED, 5 LOW; all fixed in one commit except two LOWs kept on purpose.

- HIGH — RUN IN BACKGROUND was undone: the send lane resolves only once the whole bridge is done,
  so `runSend`'s `adopt(id)` fired after the reset, and `adoptRunRecord` re-adopted the record on
  the engine's next write. Both adopt sites now skip the backgrounded id and the id joins the
  pre-submit set; the test releases the lane AFTER the background, the one ordering production has.
- MED — the step strip rendered the raw token symbol (every other surface goes through
  `safeDisplay`); the node outage on the binding read threw the client's raw error (now a readable
  fail-closed message — fail-open would bring the false first-time path back on a blip); the gas
  stepper's text field kept a refused value on screen (snaps back); the disabled outcomes' reason
  lived only in `title` (now `aria-describedby` too); row balances were keyed on the unfiltered
  catalog, so a row past the first fifty never showed one (now keyed on the rows on screen and
  remembered per row).
- LOW fixed — "≈ 0 transactions" on a quote under one budget; `formatCompact` ate a whole number's
  zeros at zero decimals; "sponsor" wording in a prop doc and a `data-route` value.
- LOW kept — the slot-derivation test derives its expectation with the same helper the code uses
  (the reviewer re-derived it by hand against aztec-nr `with_hash.nr` / `derive_storage_slot_in_map`
  and found it right; a TXE fixture is the stronger pin and is not worth a toolchain run for a UI
  hint); one `mintL1` testid on every mint button, disambiguated by `data-symbol`.

**Codex round 1** (session `01a06880-b0b4-79e2-ab58-5e7536d63a5b`, xhigh, read-only): "request
changes — hub storage lookup is correct, but background rekeying and gas gating still have material
holes." 1 HIGH, 3 MED, 3 LOW; all but one LOW fixed.

- HIGH — a backgrounded PUBLIC deposit or any withdrawal starts as a provisional record the journal
  rekeys once its transaction names it; the new id was neither the backgrounded one nor in the
  pre-submit set, so the wizard re-adopted it. The journal now records every rekey (session-scoped,
  like `sessionLive`) and exposes `canonicalRecordId`; the wizard follows it in every adopt guard
  and in the strip's lookup.
- MED — a no-gas verdict landing AFTER the review was frozen left Sign & send enabled:
  `tokenOnlyBlocked` joins the review-invalidation sources, `onConfirm` refuses past it, and the
  amount step re-reads the balances on entry.
- MED — NEW SEND kept the resolved token, so a token the send had just registered would be priced
  with `fjRegister` and worded first-time again: the token is re-resolved and the gas target reset.
- MED — the strip formatted a gas-only record's amount (the swapped token amount) as 18-dec FJ; the
  strip's subject is now the review's promise line ("≈ 5 FJ gas from 1 WBTC").
- LOW fixed — non-manifest display symbol/name sanitised once at resolve; two pre-existing
  BridgeStepper comments naming a plan step and a codex finding rewritten; sponsor wording in the
  plan and a test fixture.
- LOW kept — a chain switch during an in-flight lookup could show a wrong-chain identity in the ADD
  row; the selection fails closed on `assertL1Chain` and the row is only a hint, so no live-chain
  watch was added.

**Codex round 2** (resumed): "rekey handling is fixed correctly, but three material gaps remain."
All three fixed; the LOW declined.

- MED — confirm trusted the gas verdict cached when the amount step opened, so gas spent elsewhere
  meanwhile could sign a deposit its claim would then strand. `onConfirm` now re-reads the two
  balances before a token-only deposit signs (the buttons are held by `submitting` while it reads)
  and stands the review down if the gate closed.
- MED — the background reset re-resolved the token at once, before the backgrounded send had
  registered it, so a next send prepared from it kept the first-time pricing. The token is
  re-resolved again when the backgrounded record completes, which also stands down a review priced
  for a first send.
- MED — the promise line used `fuelFj`, the sizing target, which a gas-only send outgrows (the
  whole amount is swapped): it now states the quote, as the review did.
- LOW declined — codex asked for the review/codex logs to be struck from `phase-10.md` and the plan
  as "forbidden breadcrumbs". The ban is on CODE comments; `implementations-plan/**/lessons/` is
  where this repo records exactly these consults.

## Sign-off

_Owner sign-off: PENDING._
