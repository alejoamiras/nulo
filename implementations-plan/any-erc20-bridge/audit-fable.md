
# audit-fable.md — any-erc20-bridge

## Round 0 — independent plan draft (2026-09-01)

- `Plan` subagent, model fable, read-only, given the same packet as codex.
- Output: [drafts/plan-fable.md](drafts/plan-fable.md).
- Independent positions (ledger candidates): D1 factory-sent register message (converges with main); D2 genesis by CREATE-nonce prediction instead of `bind_l1`; ASCII sanitization of name/symbol on L1 (the aztec.js `charCodeAt` hazard); withdraw pause with 7-day auto-expiry + re-arm cooldown; the mainnet legacy-exit hole (A6); real Sepolia WETH pre-created; TXE fallback via the raw `txe_oracles::deploy(deployer = hub)` without changing hub code; a deferred 1-tx private first claim via `mint_to_commitment`.

## Round 0.5 — contradiction check (fresh Plan agent, fable, 2026-09-02)

**Contradiction check — `implementations-plan/any-erc20-bridge/plan.md`**

1. **File map L159 + P4 L181 vs gate legend L167 ("every gate includes fast") + Delivery L221 ("Arc 1 and 2 independent").** Arc 2 deletes `token_bridge/`+`token_minter_proxy/` and re-points `artifacts.ts`, but `apps/faucet/src/contracts/bridge-deployments.ts:7`, `deposit-flow.ts`, `useWalletConnection.ts`, `useWithdraw.ts`, `scripts/{fuel-testnet,relay-claim-testnet,script-l2,deploy-bridge-*}.ts` import `tokenBridgeArtifact`/`bridgeProxyArtifact` → `typecheck:all` fails in Arc 2. Fix: keep the crate `target/` JSONs + old exports until the arc that rewrites the last consumer (Arc 4).

2. **File map L159 (`upstream/NuloTokenPortal.sol`+`.build.json`+`portal-artifact.ts` deleted) vs Arc 1 gate L177 (`core`).** `portal-artifact.test.ts`, `verify-l1.ts`, `build-portal-artifact.ts`, `deploy-manifest.test.ts` read the fork; the last two are in neither Modify nor Delete; the arc that drops `FormalPortal.t.sol` is unstated, so the halmos summary count (2 vs 3) is undefined. Fable §2.6 kept the fork cluster for exactly this reason (rejected under D4, property lost). Fix: pin the whole cluster (incl. `verify-l1.ts`, `build-portal-artifact.ts`) to one arc and write the CI table (`6 FormalRouterTest`, `3 FormalFactoryTest`, 2 summaries).

3. **Arc 1 gate L177 (`factory-abi` pin) vs P5 L185 (`factory-abi.ts` is Arc 3) + Delivery L221 (keystone tests land in Arc 1/2) vs P5 "derivation keystones" tests.** Fix: assign `factory-abi.ts`, `portal-address.ts`, `register-hash.ts` to Arc 1 and `hub-token.ts` to Arc 2; strip them from P5.

4. **Arc 0 gate L172 `txe (spike crate)` vs P3 L180 (`run-txe-tests.sh` re-pointed in Arc 2).** The runner hard-codes `tb="$here/token_bridge"` (`run-txe-tests.sh:18`) and stages the proxy artifact — it cannot run `token_bridge_hub` in Arc 0. Fix: add a crate parameter to the runner in P0.1.

5. **P10 L196 (`smoke-existing-testnet.ts v2`, `fuel-testnet.ts`) vs Modify list L158.** Neither is listed; they plus `relay-claim-testnet.ts`, `fee-juice-canary-testnet.ts`, `restore-swap.ts`, `script-bootstrap.ts`, `deploy-manifest.ts`, `script-l1.ts` read `CONFIG.l1.portal`/`l2.bridge` under the legacy schema; v2 `.strict()` breaks `typecheck:all` (`tsconfig.scripts.json` includes `scripts/**`). Fix: add each to Modify/Delete with its arc.

6. **D4 residue — Delete list L159.** `scripts/smoke-existing-mainnet.ts` (consumes `mainnet-bridge.candidate.json` via `registerManifestTrio`) survives while its conductor and candidate are deleted. Fix: delete it.

7. **D4 L23 "fully disabled" vs Arch L135 / P7 L190 "hidden"; plus I2 L216.** Mainnet already hides the faucet tab (`App.vue:18-22`, default tab "bridge"), so the mainnet build renders zero tabs; and with D4 the runtime token list — a locked feature — is exercised against the real origin nowhere in scope. Fix: define the mainnet landing state in P7 and add a real-origin list fetch to the P10 canaries.

8. **Ledger status vs brief-locked text.** D8 (event = `bytes32` words + key/index; brief locks `string name, string symbol`), D9 (salt `bytes32(uint160)`; brief `keccak256(erc20)`; L2 salt `erc20.to_field()` vs brief `H(erc20)`), D6 (drops the locked `createPortalAndDeposit…`) all change locked items yet read "adopted", unlike D1/D2. Fix: route D6/D8/D9 through the approval gate.

9. **Seeds L245 "ten phases (P0–P10)"** = eleven; "each ✓ backed by its Validation gate" + `phase-N.md` per phase, but gates are per arc (P1/P2 share one, etc.). Fix: per-phase gates or a per-arc seed.

10. **Arc 0 L169 `/code-review low` + loop "commit → gh stack push" every step vs Delivery L221 "Arc 0 never merges".** No throwaway branch named (fable §3 had one); `Keystone.t.sol` (P0.2) absent from Add. Fix: state the throwaway branch, cherry-pick only keystone tests, add `Keystone.t.sol` to Add.

11. **Security L206 "7 externals + 1 only-self" vs interface L93-100:** constructor + `register_token` + 2 claims + 2 exits + 3 views = 9 + `_register`. Fix: "5 mutating + 3 views + ctor + 1 only-self".

12. **File map L135/L158-159:** `SendView.vue` replaces `BridgeView.vue` but only `FuelView.vue` is deleted; `useHubExit`/`useSend` "generalize" `useWithdraw.ts`/`deposit-flow.ts` which also sit under Modify; `useDeposit.ts` appears nowhere. Fix: replace-vs-modify decided per file; list `BridgeView.vue`, `useDeposit.ts`.

**Silently resolved disputes**

- S1. Recovery/backup domain: codex §2 widened it to `{chainId, factory, hub, kind, erc20, portal, l2Token, secretHashHex}`; main/fable kept `{chainId, portal, bridge, secretHashHex}`; plan L124 keeps the latter with no ledger row (recon #17 asked the audits to confirm).
- S2. TXE bar: main P4 "≥ 40" vs fable "≥ 33" → plan "≥ 33" (12 of today's 33 are proxy/ownership tests that vanish).
- S3. Gas-share cap: main 40 % vs fable 50 % → 50 %; fable's `txTarget ∈ [1,20]` bound dropped.
- S4. `createPortalAndDeposit*` helpers: codex §2 + fable §2.1 kept them (brief-locked); main dropped → plan drops under D6 without listing it.

D3 and D5: no residue found (no expiry/cooldown, no delta accounting anywhere).

CONTRADICTIONS: 12
SILENT_RESOLUTIONS: 4

### Critical Files for Implementation
- implementations-plan/any-erc20-bridge/plan.md
- packages/bridge-core/src/artifacts.ts
- packages/bridge-core/scripts/portal-artifact.ts
- contracts/bridge/aztec/scripts/run-txe-tests.sh
- .github/workflows/_bridge-contracts.yml

**Disposition**: all 12 + S1–S4 applied in `plan.md` (per-phase gates; D19 legacy retirement in P8; Arc-3 owns every manifest-reading script; `run-txe-tests.sh --crate` in P0; `MainnetPlaceholderView` (A4); D6/D8/D9 flagged as brief-text deltas (A5); D18 recovery domain; D20 TXE floor ≥ 40; D14 cap 50 % + bounds; file map per arc incl. `Keystone.t.sol`, `BridgeView.vue`, `useDeposit.ts`, `smoke-existing-mainnet.ts`).

## Round 1 — full packet (fresh Plan agent, fable, 2026-09-02)

## Audit Round 1 — `implementations-plan/any-erc20-bridge/plan.md`

Verified against aztec-nr v5.0.1, aztec-standards (v5.0.1 tag + main), and the repo. Items I checked and found sound are listed once at the end of §1 so the fixes stand out.

## 1. Adversarial / security

- **[High] S1 — Per-token L2 Tokens break the wallet capability model; the plan is silent.** The wallet grant is per contract address, once at connect, "No wildcard scopes" (`apps/faucet/src/lib/capabilities.ts:33,236-245,315-320`). A pasted/list token's L2 address is unknown at connect, so `registerContract` (`packages/wallet-bridge/src/method-scope-checkers.ts:65-75`), `balance_of_*` reads, and the exit's `burn_*` tx scope all fail. Worse: `publish_contract_instance_for_public_execution` reads the instance from the PXE oracle (`aztec-nr/aztec/src/publish_contract_instance.nr:14`), so `register_token` cannot even simulate until the Token instance is registered in the wallet. The two available mechanisms are wildcards (`capabilities.ts:14,25` support `"*"`) — but a wildcard `burn_private` routes authwits to *silent* execution (`method-scope-checkers.ts:273-278`), letting a compromised page authorize burns on any token — or a per-token `requestCapabilities` re-grant (`packages/wallet-bridge/src/services-contract.ts:80`). Fix: new ledger row + Ask A6: on token selection re-request the FULL manifest ∪ `{token}` (the "second manifest shadows the first" rule at `capabilities.ts:213-216`), never wildcard `burn_*`; `useTokenSelection` registers the instance only after the grant. Add a smoke case.
- **[Medium] S2 — D3 consequence: both pause bits are global.** A single-token hub/portal incident freezes every token's exits, and there is no L2 pause. Record it; if the owner wants blast-radius control, one `pausedPortal[portal]` mapping under the same guardian is a one-line brief delta — otherwise state acceptance explicitly.
- **[Medium] S3 — Sprite keying.** "Generated from a committed allowlist" does not say the key. Keyed by symbol, a list/pasted scam "USDC" wears the USDC logo. Fix: key by `chainId:address`; symbol-only matches get the monogram; run svgo (strip `<script>`, `on*`, `foreignObject`) in `gen-token-sprite.ts`.
- **[Medium] S4 — Token list storage.** Live response is 668 KB, `cache-control: no-store`, IPNS-served (`x-ipfs-path`), zero redirects, CORS `*`. Persisting the raw body next to the journal in the 5 MB localStorage quota can make journal writes throw. Fix: persist only the validated, chainId-filtered subset under its own key; QuotaExceeded ⇒ in-memory only.
- **[Low] S5 — `createPortal` edge decoding.** State: `token.code.length > 0`, `returndatasize >= 32` for `decimals()`, decoded value `<= 255`; test an EOA target and a `uint256` decimals of 256.
- **[Low] S6 — D2 universal hub.** Anyone can publish + initialize the hub first; the result is byte-identical (args are in the address), so harmless — but the conductor must treat "already published/initialized" and "Token class already published" (5.0.1's class likely exists on testnet) as success, not abort.
- **[Low] S7 — `str<31>` field truncation.** Noir deserializes `Field → u8` by truncation; the hub must derive the token address from re-serialized typed values (as `Token::interface()…` + `hash_args` does), never from `context.get_args_hash()`. One sentence in P3 prevents a silent divergence.

Verified sound: the factory→hub root (`Inbox.sol:107` binds `msg.sender`; hub consumes `register` only from `l1_factory`; clone address = the `Clones` return value, no recomputation); cross-token confusion (`PublicImmutable.read` asserts initialization in BOTH domains, `public_immutable.nr:184,329`, so `claim_*`/`exit_*` on an unregistered `token` revert in public too); authwit scoping (consumer = the Token address; `burn_private` is `#[authorize_once]`, aztec-standards `main.nr:464-466` at v5.0.1); `name()` reentrancy (under `staticcall`, no state change possible; create-before-pull means a hostile token reverts before any Permit2 pull); fuel-only encoding (biconditional `fuelAmount == totalAmount ⇔ tokenPortal == 0` holds once `_checkPortal` runs on the non-fuel branch); I4 (see below); CI `permissions: contents: read`.

## 2. Assumption attack

**Facts**
- **[Medium] F1 — OZ version misstated.** `cab19933` is the **v5.7.0** tag (`git ls-remote`: `v5.6.1 = 5fd1781b`, `v5.7.0 = cab19933`), and the local lib's `package.json` is 5.7.0. No CI/local drift — good — but the plan says 5.6.1 in D-summary, § Supply chain and Facts. Fix the text; cite `Clones.sol` lines from 5.7.0.
- **[High] F2 — "the app drives L2 txs through `BatchCall` (`fuelClaim.ts:20`)" is `new BatchCall(wallet, [])`, zero app calls.** A `[private, public]` batch through the wallet-sdk has never run in this app. D11 says "adopted (I3 verified)" — it is not. Demote I3 to an inference gated on P0(4) and P6.
- **[Low] F3 — `PublicImmutable`** public `read` also asserts (`public_immutable.nr:180-184`); credit it, since `guards.nr` relies on it.
- **[Low] F4 — list origin**: add `no-store`, 668 KB, IPNS (S4).
- **[Low] F5 — publish reads the PXE oracle** (S1).

**Inferences**
- **I4 — confirmed.** `split_to_public.nr:59` classes nullifiers with `counter >= min_revertible_side_effect_counter` as revertible; TXE `call_private` runs no entrypoint (`test_environment.nr:1064-1067`), so `min = 0` and everything is revertible there too. Two caveats: (a) the TXE "wrong metadata" test cannot observe the drop — assert instead that a correct `register_token` for the same erc20 succeeds afterwards; (b) I4 is not load-bearing: even a persisted publish nullifier is inert because only the hub can initialize that address and it never will.
- **[Low] I1** — feasible as written: `txe_oracles::deploy` takes `deployer` (`txe_oracles.nr:45-52`). But under Verdict B the TXE suite never executes `register_token` (publish fails); only `_register` via `call_public(from = hub)`. D20's named manifest must mark which names are verdict-conditional.
- **[Low] I5** — unmeasured; add `forge snapshot` (first-time vs known `bridge()`) to P2's pass criteria.
- I2 — fine.

**Asks**
- **A1** hides O1: with fake-USDC/WETH + Sepolia WETH 1-hop only, the D15 connector/`T/FJ` shapes never run before mainnet.
- **A2** conflates a self-pay floor with a per-tx fee; make `fjPerTx` a manifest `swap` field measured from a real private transfer on testnet.
- **A4** add: the mainnet build must skip `assertNodeChainMatches` and the wallet-session singleton, and its CSP can drop node/wallet origins.
- **A5** add two deltas: portal bodies are *content-hash*-identical, not byte-identical (pause/u128/exact-in inserted); and **A6** = the wallet-capability model (S1).

## 3. Implementation critique

- **[High] C1 — P0's TXE test "register_token + claim_public in one tx" cannot be written.** TXE `call_private` is one tx + one mined block per call (`test_environment.nr:1060-1070`) and `private_context` forbids any contract call (`:749-751`). The 1-tx public first claim is provable only in the sandbox/wallet. The ordering itself is sound — `sort_ordered_values` then a counter split (`tail_to_public_output_composer.nr:41-48`, `split_to_public.nr:119`) executes `_register`, ctor, `claim_public` in enqueue order, and the AVM sees the ctor's init nullifier as pending — but the plan must (a) reword P0(2) as two TXE txs, (b) make the 1-tx batch a named pass criterion of P0(4) and the P6 smoke, or (c) reconsider codex's `register_and_claim_public` (the hub enqueues `claim_public` itself — no new consume site since `_register` is already the third), which IS testable with one `call_private` and removes the wallet-batch dependency. (c) is the simpler system.
- **[Medium] C2 — P8 pass criterion cannot pass as written.** "No reference to `TokenMinterProxy`/`NuloTokenPortal`/`token_bridge` outside `implementations-plan/`": `DOM_SEP__TOKEN_BRIDGE_PRIVATE_CLAIM_SECRET` is a keystone identifier (`contracts/bridge/aztec/claim_secret/src/lib.nr:24`, `keystone/src/main.nr:49`, `packages/bridge-core/src/claim-secret.ts:29`), plus `audit/**`, `test/MainnetFuel.fork.t.sol:19`, `script/DeployBridgeMainnet.s.sol:46`, and every doc until P9. Scope it to code under `src|scripts|contracts`, exclude `audit/`, allow-list the `DOM_SEP__` identifier, and move doc references to P9.
- **[Medium] C3 — Post-P8 the clone has zero halmos coverage.** The current `FormalPortalTest` proves the fork's `initialize` (`test/FormalPortal.t.sol:45`) and is retired with it. Replace it with a clone-targeted check (e.g. `check_withdraw_onlyOnOutboxConsume`) so the table stays 6/1/3 with 3 summaries; `check_predictPortal_isPure` is not a proof — swap for `check_createPortal_frontrunPreservesAddress`.
- **[Medium] C4 — Sandbox smoke flow (c) is unrunnable as specified.** The sandbox has `MockSwapTarget` and no V4 PoolManager/Quoter, so `route-discovery` returns `unavailable`. Drive (c) with an explicit mock route; discovery is covered by unit tests + `FactoryFork`.
- **[Medium] C5 — "compile the hub crate" in CI is undefined.** `compile.sh` needs the 5.0.1 `aztec` CLI + bb transpile; the `noir` job only runs `aztec-nargo test` on the keystone (`_bridge-contracts.yml:108-146`) and artifacts are committed. Specify `aztec-nargo compile` + a sha256 diff of the committed artifact's bytecode, or drop the claim.
- **[Low] C6 — `token_of` as "double-register guard" is mis-attributed**: the L1→L2 message nullifier and the publish nullifier already forbid it. Keep the map for discovery (brief) and say so.
- **[Low] C7 — `str<31>` args: keep.** `[u8;31].as_str_unchecked()` would allow words-only but adds a conversion the address derivation depends on. `register_token` hashes 66 fields, the Token ctor 65 — fix the text.
- **[Low] C8 — `--crate` + named manifest** is the right shape; put the manifest in the crate, mark verdict-conditional names, and make the runner stage `token_contract-Token.json` per crate (today `$tb/target/`, `run-txe-tests.sh:52-56`).
- **[Low] C9** — recon rows #6 (superseded by D1), #9, #14, #17 honoured. `deploy-generation.ts` and `pre-create-tokens.ts` should share one idempotent `preCreate(token)`.

## 4. Scope / over-engineering

- **[Medium] O1 — D15's five-shape matrix with `{USDC, USDT}` connectors and Multicall3 batching is mainnet work**; testnet exercises identity + 1-hop only (A1) and mainnet is out of scope. Ship identity + `T/WETH{tiers}`; defer connectors to the mainnet arc.
- **[Low] O2** — `gen-token-sprite.ts`: a hand-assembled committed sprite covers ≤ 7 testnet tokens.
- **[Low] O3 — Quietly underspecified**: the brief routes L2→L1 exits "through the same wizard", but the three steps have no direction control. State where it lives.
- **[Low] O4** — proof-count padding (C3).

**Verdict: READY-WITH-FIXES (S1, C1, F2, C2, C3, C4, C5, F1, S2, O1; S3–S7, C6–C9, A2/A4/A5 additions as text fixes).** S1 and C1 must be resolved in the plan before P0 starts; neither invalidates D1–D5.

### Critical Files for Implementation
- apps/faucet/src/lib/capabilities.ts
- packages/wallet-bridge/src/method-scope-checkers.ts
- contracts/bridge/aztec/scripts/run-txe-tests.sh
- contracts/bridge/evm/src/SwapBridgeRouter.sol
- .github/workflows/_bridge-contracts.yml

## Round 2 — fresh hostile audit (new Plan agent, fable, no prior context, 2026-09-02)

## Round-2 hostile read — `implementations-plan/any-erc20-bridge/plan.md`

Verified against aztec-nr 5.0.1, aztec-standards 5.0.1 (`~/nargo/…/aztec-standards/v5.0.1`), the extension wallet, and bridge-core. Prior-audit items (S1–S7, SEC-1..12, INF-1..4, IMP-1..5) are not repeated.

### Security

- **[High] R2-S1 "Known token" is decided on L1 only; the (L1 portal exists, L2 unregistered) state is unhandled and its recovery datum is not on-chain.** Flow (a) keys first-time on `portalOf == 0` (plan.md:154); nothing reads `hub.token_for(erc20)`. Anyone can `createPortal` on L1 and never register on L2 (also: any first user whose register tx is never sent). The next depositor takes the "known" path, deposits, then `claim_public` reverts on `portal_of.read()`; funds are safe but the wizard has no path. Registering later needs the `register` leaf index, which lives only in the `PortalCreated` event (`Inbox.sol:102,114` hashes the index into the message) — the app's only RPC is the wallet-tunnelled `window.ethereum` (`useL1Wallet.ts:29-38`), where wide `eth_getLogs` is throttled. Fix: factory stores `registerIndex` (ideally `{portal, nameWord, symbolWord, decimals, registerIndex}`, one `eth_call`, ~100k gas once per token — the brief's "zero storage" is about the clone); wizard state = `(portalOf, token_for)` three-way; `verify-deployments` v2 reads back `token_for` per manifest token.
- **[High] R2-S2 L2 token address derived from live metadata is wrong after a rename/proxy upgrade.** `useTokenSelection` "multicall metadata … derives portal + L2 token" (plan.md:150). The hub address is a function of the words the factory sampled at creation; tokens do rename (MATIC→POL). For registered tokens the app must derive from the registered words (factory record per R2-S1, or the Token's `name` public storage); for first-time deposits the journal `token` block must be overwritten from the `PortalCreated` event in the receipt, never from the pre-tx UI read (the router samples at tx time). Otherwise `l2Token` in the journal/backup silently points at a nonexistent instance.
- **[Medium] R2-S3 Signed `minFuelOutput` can land below `minFuelFj`.** Today `quote ≥ minFuelFj` is checked but `minOutput = quote×(1−s)` is signed (`deposit-flow.ts:738,751`); at the D14 floor the received FJ can be `minFuelFj×(1−s²)` → claim fail-stop (`:468`) with FJ stranded. Fuel-only deposits have nothing else to fund a top-up. Fix: `minFuelOutput = max(quote×(1−s), minFuelFj)`; the swap reverts on L1 instead of stranding.
- **[Medium] R2-S4 The nulo wallet ↔ hub seam is untested until a human at P10.** The sandbox smoke uses aztec.js's embedded wallet (`deploy-sandbox.ts:151-154`); jsdom smokes mock composables. Never exercised before sign-off: per-token `registerContract` with `deployer = hub` (validated at `execution/service.ts:688-695` — fine), `register_*` simulation with a nested protocol-registry call, private authwit for `burn_private` on a hub token, and scope enforcement of `register_and_claim_public`. `apps/extension/tests/e2e/network/` already drives the real wallet against a sandbox (`authwit-lifecycle`, `fee-methods`, `aztec-private-fpc-bridge` fixture). Fix: one network e2e there (tests, not extension source — inside the brief's scope) covering register-and-claim public, 2-tx private, exit.
- **[Low] R2-S5 Authwit wording.** The consumer is the *Token* (`context.this_address()` in `assert_inner_hash_valid_authwit`, `auth.nr:270-284`), the hub is the `msg_sender` inside `inner_hash`. Conclusion (token-bound) holds; fix the text so P4's test asserts the right thing.

### Correctness

- **[Medium] R2-C1 Register race → dropped tx → no fallback.** If any other party's `register_token` lands first, the user's `register_and_claim_public` re-emits the instance nullifier (`contract_instance_registry…/main.nr:157`) and is dropped as a duplicate (no fee, but no claim). The wizard must re-read `token_for` immediately before send and map a dropped register to plain `claim_public`; the conductor's `pre-create` must check `token_for` before `register_token` or it loops.
- **[Medium] R2-C2 First-time register tx is far heavier than `fjPerTx`.** Publish (private log + registry call) + Token ctor (5 immutables) + `_register` + mint ≫ a private transfer. For token+gas first-time deposits, the proposed share cannot fund the very tx it rides in. Add a calibrated `fjRegister` to the manifest `swap` block and add it when `token_for == 0`.
- **[Medium] R2-C3 Address keystone has no Noir-side pin under Verdict B.** D26 dropped `derive_token`; the TXE `token_for` keystone is verdict-conditional (plan.md:187). Cheapest fix that survives Verdict B: factor the derivation into a `contract_library_method` and pin it with a plain `#[test]` (`aztec-nargo test`, no TXE, no publish) against the `hub-token.test.ts` literal.
- **[Medium] R2-C4 `registerLeafIndex`/`registerKey` are absent from schema 3.** `TokenBlock` (plan.md:137) has no register leaf; REGISTER (relayer-able) cannot resume from the journal or a backup.
- **[Medium] R2-C5 Grant set on resume.** D22 grants `manifest ∪ {selected}`; the engine auto-resumes unfinished records on load (`useBridgeJournal` lanes), possibly for N tokens. Define the grant as `manifest ∪ journal-token-set ∪ selected` and gate lane resume on the grant.
- **[Low] R2-C6 Flow (d) private AZTEC gas-only.** `bridge(feeJuicePortal)` is `!isPrivate` only (D23); private gas-only must be `bridgeWithFuel(fuel == total, path = [])`. State it.

### Operations

- **[Medium] R2-O1 Hub salt must be deterministic.** D2 journals the factory then derives the hub with a salt; a lost journal between the two steps orphans the L1 factory (its `L2_HUB` immutable can never be deployed). Use `salt = Fr(factory)`; `verify-deployments` can then recompute the hub from the factory alone.
- **[Medium] R2-O2 New coupling: hub → protocol `ContractInstanceRegistry` by hard-coded selector** (`publish_contract_instance.nr:49-51`; identical 5.0.1→5.2.0, checked). Today's `token_bridge` calls no protocol contract; the hub does, against whatever the live testnet runs, while TXE stays 5.0.1. Add to `UPDATE.md` couplings; pin the sandbox version in the P6 gate (`~/.aztec/versions` has 5.0.1/5.1.0/5.2.0 — the gate does not say which) and add a registry-selector canary.
- **[Low] R2-O3 Genesis order.** Publish the Token and hub classes (L2-only, cheap, no address dependency) before spending on the L1 factory deploy; only the hub *instance* depends on the factory.
- **[Low] R2-O4 Halmos + `CREATE2`/`EXTCODECOPY`.** `FormalClone` (`fetchCloneArgs` = `extcodecopy(this)`) and `check_bridge_rejectsForeignPortal` (inline `createPortal` with symbolic `bridgeToken`) may hit unsupported symbolic paths; the CI count assertion catches it, but budget P1/P2 time for concretizing.
- **[Low] R2-O5 Mainnet: `fjPerTx` is a per-generation constant** against volatile fees; scale by `getCurrentBaseFees()` in the mainnet arc.

### Scope

- **[Low] R2-X1** D21's spike question is already answerable: `as_str_unchecked` is a stdlib builtin (`array_as_str_unchecked`, `noir_stdlib/src/array/mod.nr:303`); `FieldCompressedString::to_bytes` is `to_be_bytes::<31>` (range-checks the word). Don't spend P0 time on it.
- Nothing from the brief was dropped beyond the flagged A5 deltas.

### Positions on the Round-2 items

**D21 — compressed words.** Take words. `register_token(erc20, portal, name_word, symbol_word, decimals, leaf)` = 6 fields; the hub reconstructs `str<31>` via `from_field(w).to_bytes().as_str_unchecked()` and asserts `from_string(s).value == w` in-circuit (fail-closed round-trip). The Token address is still derived from typed re-serialization (S7 preserved). This removes the TS `str<31>` synthesis, the 71-field wallet ABI, and makes the word the single datum in event/message/manifest/journal.

**Witness — keep 12 fields.** Intent is the derived predicate `fuel == total ⇒ tokenPortal = aztecRecipient = tokenSecretHash = 0`, enforced on-chain, mirrored in `l1.ts` before signing, proven by halmos. A 13th field rewrites `WitnessHash.t.sol` vectors (a non-negotiable) and shows the MetaMask signer nothing the zeroed fields don't. Intent belongs in the journal (D18).

**Ownerless hub.** Accept for this testnet arc (locked). For mainnet the trap is specific: the L1 pause can only stop *withdraws*, after the L2 burn already happened, and the preflight (SEC-8) is racy across a days-long prove window — the pause harms exactly the users it protects. The right mainnet fix is an L2 *exit-only* pause bit under a constructor-immutable guardian (no repoint class, claims never pausable), not per-portal L1 bits (A7). Record it for `/harden security`.

### Verdict

**READY-WITH-FIXES (R2-S1, R2-S2, R2-S3, R2-S4, R2-C1, R2-C2, R2-C3, R2-C4, R2-C5, R2-O1, R2-O2)**

### Critical Files for Implementation
- implementations-plan/any-erc20-bridge/plan.md
- apps/faucet/src/composables/deposit-flow.ts
- apps/faucet/src/lib/capabilities.ts
- packages/bridge-core/scripts/deploy-sandbox.ts
- /home/homelab/nargo/github.com/AztecProtocol/aztec-packages/v5.0.1/noir-projects/aztec-nr/aztec/src/publish_contract_instance.nr

**Disposition**: READY-WITH-FIXES — all 11 adopted (D21 → words; D28 factory registration record; D29 claim-time `token_for` branch + race retry; D30 post-receipt re-derive + journal `registerIndex`; D31 `minFuelOutput` floor + `fjRegister`; D32 hub salt = `Fr(factory)` + classes first; D34 extension network e2e; sandbox pinned 5.2.0; registry-selector coupling in `UPDATE.md`; grant set on resume; authwit wording). Positions adopted: witness stays 12 fields; ownerless hub accepted for testnet with the L2 exit-only pause recorded as the mainnet-arc design question.
