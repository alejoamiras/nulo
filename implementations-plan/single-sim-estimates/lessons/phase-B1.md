# Phase B1 — Real testnet gas-delta measurement

Disposable script: `packages/bridge-core/scripts/gas-delta-testnet.local.ts` (git-excluded via
`.git/info/exclude`; never committed). Owner-provided throwaway master + drpc RPC in the
gitignored `packages/bridge-core/.env` — **key is burned after this arc** (it was disclosed in
the chat transcript).

## Finding 0 (pre-measurement, HIGH severity): the wallet's stub override never engages

While replicating the wallet's stubbed-discovery sim for the measurement harness, the mechanism
turned out to be a silent no-op — three independent defects stack:

1. **Mis-shaped constructor args** — `packages/aztec-runtime/src/pxe/service.ts:463` builds
   `new SimulationOverrides({ ...(overrides?.contracts ?? {}), ...contracts })`. The upstream
   constructor (`@aztec/stdlib` `simulated_tx.js`) expects `{ publicStorage?, contracts? }`; the
   per-address entries land at the TOP level, so `overrides.contracts` is `undefined` and
   upstream PXE (`pxe.js #getSimulatorForTx` reads `overrides?.contracts`) sees no override.
2. **Unregistered stub class** — even with the shape fixed, the entry's `artifact` field is
   ignored by upstream (`AnchoredContractData` serves `override.instance` and resolves function
   artifacts from the CLASS STORE by `currentContractClassId`); nothing in Nulo's PXE registers
   the stub class, so lookups would come back empty.
3. **Incoherent instance** — the entry's instance is derived from the stub artifact with a
   RANDOM salt, so `instance.address` ≠ the overridden address key. Upstream's own mechanism
   (EmbeddedWallet `buildAccountOverrides`) keeps the REAL instance and swaps only
   `currentContractClassId` to the pre-registered stub class id (`initStubClasses`).

**Why it's latent**: discovery sims of NON-authwit ops behave identically stubbed or not (the
account's `verify_private_authwit` is never invoked), and no e2e exercises discovery against an
authwit-REQUIRING op (`authwit-variants` covers explicit `createAuthWit`, not estimate-time
discovery). A delegated dApp op (e.g. AMM swap) would abort estimation today: the unstubbed
Schnorr `verify_private_authwit` hits the `getAuthWitness` oracle, which throws pre-result
(fee-estimation-speedup arc, verified fact).

**Consequences for this plan**: the folded single-sim modes (A2/B2) must build the override the
upstream way (real instance + swapped class id + registered stub class), and the fix doubles as
a REAL bug fix for discovery. Measurement mode taxonomy: `V` validated (wallet's sizing sim
today), `D` byte-replica of the broken Nulo stub (expected: behaves exactly like V, and FAILS
on the delegated shape — live proof of the bug), `S` fixed stub (upstream mechanism — the
A2/B2 candidate).

## Stage 0 — owner key import + funding check (2026-08-10)

- Derivation cross-check: master → `poseidon2Hash([master, chainId=0x…, type=0, index])` →
  `deriveNuloAccountKeys` → `createSchnorrAccount(secretKey, Fr.ZERO, signingKey)` matches the
  extension's frozen derivation (index 0 = `0x24f21cb8…`, holds the owner's fuel).
- idx0: undeployed, NULO 0/0, **PrivateFPC private-FJ credit = 491143860518012000000
  (~491.14 FJ)** → funded shapes RUNNABLE (private fee juice is the thing PrivateFPC P2
  actually asserts on). idx1/idx2: empty.
- Token/Dripper/SponsoredFPC/PrivateFPC instances rebuilt from committed metadata all
  address-assert clean against testnet.
- Funding route for token shapes WITHOUT any L1 key: the faucet's Dripper
  (`drip_to_private`/`drip_to_public`) is permissionless and mints to the caller; sponsored
  fees. Setup = deploy idx0 (sponsored) → self-drips → private transfer idx0→idx1.

## Setup executed on testnet (all sponsored, all mined)

- idx0 was already INITIALIZED on-chain (Nulo first-tx flow from the owner's fueling) though
  never publicly deployed — `getContract` is the wrong probe; the init-nullifier witness is the
  right one (matches `NuloAccount.requiresInitialization`). The premature deploy attempt was
  rejected with `Existing nullifier` — itself a nice consistency proof.
- Drips via the permissionless Dripper: NULO private 1000 → idx0, public 1000 → idx0, private
  transfer 250 → idx1. Plus a fresh **upstream Token ("MEAS") + Crowdfunding** pair deployed
  (universal salt `0xb1`) as the delegated-authwit rig: `donate()` pulls the donor's tokens via
  `transfer_in_private` with `msg.sender = crowdfunding ≠ from = donor` — the canonical
  discovery shape. MEAS token: `0x04b353b30b…`, Crowdfunding: `0x00cb906a27…`.

## Sim matrix — 2 clean interleaved rounds (proverless PXE, live testnet)

Modes: V = validated sizing sim (wallet today), D = byte-replica of Nulo's broken stub,
S = fixed stub (upstream classId-swap — the A2/B2 candidate). Timings are RPC-dominated
(remote drpc; the wall-clock case for the fold rests on the arc-1 sim-count telemetry, not
these absolute numbers).

| shape | payment | V gas (da/l2) | S gas (da/l2) | delta | effects V/S | D outcome |
|---|---|---|---|---|---|---|
| 1 private transfer | Sponsored | 2592/557600 | 2592/557600 | **0.00%** | 0/0 | == V (no authwit → indistinguishable) |
| 2 public transfer | Sponsored | 448/672515 | 448/672515 | **0.00%** | 0/0 | — |
| 3 delegated (Crowdfunding.donate) | Sponsored | 3744/889387 (witness granted) | 3744/889387 (no witness) | **0.00%** | **1/1** | **FAILS: "Unknown auth witness for message hash 0x1deb…"** |
| 5 private transfer | PrivateFPC (real credit) | 3200/585300 | 3200/585300 | **0.00%** | 0/0 | — |
| 5b P1-current app-only (context) | PREEXISTING_FEE_JUICE | 2592/557600 | — | — | 0 | — |

- Teardown gas = 0 on every shape (neither FPC uses teardown). B2's clamp math must keep
  0-teardown as 0, not "pad it up".
- Gas totals are NOTE-SET dependent: after canary spends consolidated idx0's notes, shape 1
  re-measured at 1440/527400 — **in BOTH modes, still byte-identical**. That is the structural
  reason fidelity holds: Aztec prices private execution by SIDE EFFECTS (notes/nullifiers/logs),
  not constraints; the stub only removes constraints (signature/authwit verification). Delta is
  zero BY CONSTRUCTION as long as the effect sets match — which the arm-fidelity check pins.
- Shape 3 arm-fidelity: S (no witness) emits exactly the CallAuthorizationRequest that V
  (witness granted) also emits — effect sets identical, gas identical. **Note: the VALIDATED
  sim emits the effect too** (Noir emits it unconditionally) — the A2 extractor must dedup
  against already-granted witnesses, exactly the planned F-4 + dedup rule.
- Shape 3 D-mode is the live confirmation of Finding 0: the real `verify_private_authwit` ran
  (authwit oracle throw), i.e. production discovery is broken for authwit-requiring dApp ops.
- Shape 4 (undeployed first-tx) is EXCLUDED from folding by structure, not measurement:
  stubbing the deploying account would rewrite constructor effects — the fold must never
  apply to initialization-wrapped requests.

## Inclusion canaries — REAL txs, gas limits from the STUB estimate only (×1.05 pad, worst-min-fees ×2)

| canary | stub estimate | result |
|---|---|---|
| Sponsored private transfer | da=1440 l2=527400 | **MINED** (~16s to inclusion; repeated 3× across runs) |
| PrivateFPC private transfer (fee from the real 491-FJ credit) | da=2048 l2=555100 | **MINED** (~15s) |

Fragmented-note PrivateFPC canary: **DONE (follow-up run, owner-provided Sepolia signer)** —
three portal deposits claimed as separate notes (1.55 / 7.58 / 7.90 FJ) at freshly initialized
idx1; the stub-estimated canary committed an 11.26 FJ envelope (> the 7.90 max note ⇒ the
FPC's `recurse_subtract_balance_internal` HAD to span notes) and **MINED**; credit moved
exactly by the envelope (17.03 → 5.78 FJ).

## Operational gotchas (recorded for the A2/B2 e2e work)

- The pxe-level harness bypasses `EmbeddedWallet.simulateTx`, which is what drives PXE note
  syncing — sims run right after your own tx mines fail with `Nullifier read request … unknown
  nullifier` until a utility sim (balance read) resyncs the note DB. In-wallet code paths sync
  properly; this is a harness-only trap, but the SAME error class will appear in any future
  disposable script that calls `pxe.simulateTx` raw.
- The drpc LB intermittently serves lagging nodes right after new blocks ("Block hash … not
  found … possibly a reorg", empty json-rpc bodies). Retry-with-resync absorbs it.

## Checkpoints

- **B2/free checkpoint (sponsored + fee-juice folds): PASS** — stub-fidelity delta 0.00%
  (< 1% auto-adopt threshold) across both rounds and a state change; sponsored inclusion
  canary mined on stub-derived limits.
- **A2/funded checkpoint (PrivateFPC folds): PASS** — delta 0.00% on the P2 envelope shape
  against the real credit; PrivateFPC canary mined on stub-derived limits, fee paid from the
  owner's private fee-juice credit.

Both checkpoints auto-adopt per the approved plan (rev 3.2, Ask 3: "<1% ⇒ adopt").

## Fragmented-note canary — operational lessons (follow-up run)

- **The faucet's swap-fuel route is DOWN in production**: the v4 quoter reverts
  `UnexpectedRevertBytes(NotEnoughLiquidity)` on the AZLO/WETH hop at every size — the pool
  is drained. Found live while attempting the fueled bridge; needs a re-seed (own arc). The
  canary pivoted to DIRECT FeeJuicePortal deposits (fuel.ts primitives) using the signer's
  leftover FJ-ERC20.
- **A bare `PrivateFPC.mint` can never land**: mint PROVES the bridge claim by reading the
  nullifier `FeeJuice.claim` emits — the two must run together (the package README's
  cold-start shape). The symptom of the missing claim leg is a PERMANENT
  "Nullifier read request at index 0 … unknown nullifier" that masquerades as message-sync
  lag. Same-tx nullifier reads work: a sponsored `BatchCall([FeeJuice.claim, fpc.mint])`
  banks the exact deposit as one note.
- An account that has only ever RECEIVED is uninitialized — its first outgoing tx needs the
  init wrap (sponsored self-paid deploy first, or the claim fails on the init-nullifier read).
- Private-claim salts are the SOLE recovery input — persist BEFORE the L1 deposit. One 1.55 FJ
  deposit was stranded by a crashed run pre-persistence (recovered: the claim later succeeded
  from the persisted record on the rerun; net loss zero).
- Estimating a PrivateFPC-paid tx for a small-credit account MUST bound the request envelope
  (the plan's "Pass 1 is load-bearing" fact, felt live): under `forEstimation` limits pay_fee
  subtracts ~23 FJ in-sim → "Balance too low" against any credit smaller than that.
- Bun kills the process on unhandled background-sync rejections (drpc reorg-view blips) — a
  long-running script needs a `process.on("unhandledRejection")` survivor.
