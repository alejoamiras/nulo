# Codex audit — round 1 (plan)

**Model:** gpt-5.6-sol · **Effort:** xhigh · **Sandbox:** read-only
**Session:** `019f9155-c94b-7720-8a2e-b4341ae8ea0a`

## Verdict

> `reject` (with blocking findings: mainnet target integrity is not single-sourced, required
> router/fee paths are missing, and the stated gates can pass a broken manifest)

## Findings

**1. Critical — the alias design cannot provide the claimed single source.**
`apps/faucet/vite.config.ts:9,31-62` imports testnet constants while **Node** evaluates the config;
Vite aliases only affect the *application* module graph. A `mergeConfig` wrapper can select the
mainnet manifest while `build.json` stays testnet. Also `packages/bridge-core/src/candidate-schema.ts:31-85`
contains **no L1 chain ID or rollup version**, so the promised "manifest vs node" assertion is
impossible as specified. → Use a **config factory**: each wrapper imports one typed target object and
passes it to both a virtual app module and `buildMetaPlugin(target)`. Put target identity + manifest
digest in `build.json`.

**2. Critical — mainnet's required router does not exist in the deployment scope.**
Both token deposits (`useDeposit.ts:954-968`) and **direct fee-juice deposits** (`useFuel.ts:156-162`)
require `SwapBridgeRouter` + Permit2 + swap target. Phase 5 deploys only portal + L2 trio while
calling direct Fuel "decoupled". With no mainnet `l1.fuel`, **both buttons throw before depositing**.
→ Disabling swap-fuel must hide quoting only; either deploy a bridge-only router or add direct-portal
paths.

**3. Critical — other mainnet UI money paths still assume testnet infrastructure.**
Withdrawals always use SponsoredFPC (`useWithdraw.ts:219-223`) — unavailable on mainnet.
`App.vue:75-77` exposes the Faucet tab unconditionally; `useWalletConnection.ts:13-48` requests and
registers testnet Dripper/NULO/OLUN; `capabilities.ts:215-229` builds a combined faucet manifest.
→ Dead faucet behavior, excessive capabilities, failed mainnet withdrawals. Mainnet needs
target-specific capabilities/registration and a preexisting-Fee-Juice withdrawal payment.

**4. High — Phase 3 does not test the new approval branch.**
`MintableERC20.sol:46-49` always reports infinite Permit2 allowance, so the canary never calls the
approval fallback. A 6-decimal fixture proves arithmetic, not real-USDC integration. Circle USDC is
proxy-upgradable, pausable, blacklistable (its `approve` does return `bool`). → Deploy a test token
**without** the allowance override and assert an approval tx actually lands.

**5. High — validation can pass a wrong bridge.**
`verify-deployments.ts:145-150` only checks a bridge when `BRIDGE_MANIFEST` is set (the plan's
commands omit it). `verify-live.ts:47-72` checks build ID + wallet chain ID, **not addresses,
decimals, or manifest digest**. Phase 2 merely builds, never proving the startup assertion fires.
`verify-l1.ts:121-128` verifies every token as `MintableERC20`, so it **cannot verify official USDC**.
→ Require target-explicit manifest validation, live portal/token/router readbacks, L1/L2 decimal
equality, and a target-specific browser boot test.

**6. High — fee funding and key recovery are unsafe/incomplete.**
The bridge deployer L2 account is generated **randomly in memory** (`deploy-bridge-testnet.ts:225-230`),
and the journal records only salts/addresses (`deploy-manifest.ts:80-126`). Phase 4 therefore cannot
pre-fund a stable address, and a crash **loses control of funded Fee Juice**. In Aztec 5.0.1 "balance
payment" is *omission* of a payment method (`@aztec/wallet-sdk base_wallet.ts:280-316`); "non-zero
balance" doesn't prove enough reserve for six worst-case txs. → Persist a network-specific L2
secret/salt securely and pre-budget the entire sequence.

**7. High — theft remains credible (challenges the plan's risk framing).**
CF Access protects the UI, **not** the public portal/router contracts. `BridgeForm.vue:112-119`
enforces only wallet balance, not the stated <$5 cap, and the copied Permit2 pattern approves
`uint256.max` (`useFuel.ts:176-184`). Portal TVL and team-wallet balances may exceed $5. → A
compromised build or an authorized-user mistake is a real theft path, not merely misconfiguration.
Enforce the cap in the transaction builder and minimize approval amounts.

## Looks fine

Two build artifacts / two Pages projects; parameterizing rather than copy-forking the deploy script;
deriving decimals; disabling USDC swap-fuel; candidate-first promotion; fresh portal/L2 deployments.
Frozen dependencies, no new runtime packages.

## Assumptions attack

- **Facts:** F1–F6, F8, F10 check out. **F7 misleading** — arbitrary `"mainnet"` parses, but the
  schema lacks chain identity and requires test-token-only `maxWholePerTx` plus `feeAssetHandler`.
  **F9** — the numbers exist, but "live-verified" is only a source comment.
- **Inferences:** **I1 false** for Node-side build metadata. **I2** mechanically supported but no
  payment-method class is needed; stable identity + total-fee budgeting missing. **I3** contingent;
  `_headers` has no per-target generation mechanism. **I4 false**. **I5 false** — portal
  initialization (`NuloTokenPortal.sol:49-61`) and proxy token/bridge bindings
  (`token_minter_proxy/src/main.nr:31-43`) are one-shot → fresh portal + L2 trio required.
- **Asks:** A1 needs exact signer, network-specific env names, funding ceiling, custody. A2 must
  decide the required **bridge-only router**, not merely swap UI. A3 must include HTTP/WS origins,
  per-target `_headers`, CF Access credentials. A4 must cover outstanding journals/deposits and
  legacy bridge visibility. **New asks:** pinned official-USDC address/code identity; mainnet faucet
  removal; L2 deployer recovery; router ownership; executable <$5 enforcement.

---

# Codex audit — round 2 (plan v2)

**Session:** fresh (see scratchpad trailer). Verdict below.

> `reject` (blocking: mainnet private-fuel remains testnet-pinned; the plain-token testnet cutover is
> incomplete; build/address gates still admit coherent wrong deployments)

**Disagreement note:** the independent Claude reviewer gave `conditional approve` on the same v2.
Codex is stricter and surfaced **two Criticals the other reviewer missed** — both verified real.

## v1-finding verification
- F1 fixed (core + optional swap validates router-only; `requiredPools` moved behind `swap`).
- F2/F4 fixed (a normal ERC20 starts at zero allowance → genuinely exercises `approve(Permit2, max)`; update BOTH `useDeposit.ts:823` and `:960`).
- **F3 not-fixed** — the startup assertion is manifest-vs-node, not **target-vs-manifest-vs-node**, and v2 never explicitly removes the `?chainId=` override (`chain-info.ts:22-28`).
- F6 fixed (5.0.1 builds the account-deploy multicall before `claim_and_end_setup`).
- **codex#3 not-fixed** — faucet/sponsored registration handled, but the **private fee path stays testnet-specific**.
- codex#5 fixed (skip MintableERC20 source-verify for reused proxy USDC, provided identity pinned independently).

## NEW findings
- **CRITICAL — mainnet defaults into a testnet-pinned private-money path.** `FuelForm.vue:36`
  defaults to private; `private-fpc-canonical.json:9-17` pins testnet identity; `check-fpc-version.ts:212-217`
  **rejects mainnet**. Phase 5 has no `privateFuel` feature/deploy/compat gate → a user can deposit
  toward an unusable FPC and **strand the claim** (fund loss). [central coupling: the extension's
  Alpha default fee method is Private Fee Juice, so private-fuel is not optional for the goal.]
- **CRITICAL — v2 never performs its stated testnet cutover.** Phase 6 deploys the plain token only
  as *rehearsal*; Phase 8 promotes mainnet only → the live testnet bridge stays on AZLO. And
  `MintTestUsdc.vue:39` calls `mint()`, which a plain OZ ERC20 lacks → `features.testMint` is
  **contract capability, not pure policy** (D9 conflated them). Need a permissionless-mint test ERC20
  WITHOUT the auto-Permit2-allowance, a discriminated token source, and an explicit testnet promotion
  + legacy-AZLO/journal plan.
- **HIGH — schema migration not backward-compatible.** More flat-access consumers than fable's NEW-1:
  `deploy-manifest.ts:30-47`, `live-intent.ts:350-375`, `promotion.ts:32-40`, `verify-l1.ts:138-163`.
  Strict parse breaks all at once → explicit atomic migration phase + compat test.
- **HIGH — counterfeit USDC / wrong router wiring can pass.** `reuse-token.ts:27-49` checks metadata
  + only an already-known manifest address; a same-name 6-dec token passes on FIRST deploy. Pin
  Circle's canonical USDC address + verify proxy/code identity. Read back router `permit2`/portal/
  `swapTarget`/owner, not just source-verify.
- **HIGH — CI verification is opt-in.** `_build-faucet.yml:35-42` doesn't set `BRIDGE_MANIFEST` →
  `verify-deployments.ts:145-149` skips bridge verification → a correctly-labelled build can ship the
  wrong manifest. Each target must select an exact manifest + compare digest + chain/address readbacks.
- **MEDIUM — "swap disabled" is only UI policy.** `bridgeWithFuel` stays publicly callable
  (`SwapBridgeRouter.sol:152-241`); owner can change `swapTarget` (`:142-147`). Specify a
  provably-reverting swapTarget + ownership/renunciation. Require low-balance wallets + post-smoke
  revocation (CF Access doesn't protect public contracts).

## Assumptions attack
- **Facts:** 1–9 code-supported. **Fact 10 only describes old MintableERC20** — can't justify the plain token (mint conflict).
- **Inferences:** I-a false without an explicit migration. I-b requires disabling/proving private FPC. I-c proves constructor acceptance, not safety. I-d needs live `UNDERLYING`/chain/portal readbacks.
- **Asks:** A3–A7 insufficient. Add **A8** canonical USDC/proxy identity; **A9** private-FPC mainnet decision; **A10** inert `swapTarget` + router ownership/renunciation; **A11** network-separated deployer secret + journaled deployer address + full-sequence fee budget. A4 and A6 must be resolved BEFORE execution.

---

# Codex audit — round 3 / FINAL fresh pass (plan v3)

**Session:** `019f91d5-584b-7251-aa80-168ccbf29ba6` · fresh context (not a resume).

> `conditional approve` (conditions: migrate EVERY flat fuel consumer atomically; resolve legacy
> AZLO records before cutover; discriminate token source in the schema; smoke BEFORE router-owner
> renunciation)

Both round-2 Criticals confirmed closed. All conditions are concrete plan edits, not redesigns —
verified against the code and folded into v3-final below.

## Round-2 finding verification
- Private-fuel Critical — **fixed** (DP6 deploys the deterministic artifact/salt-derived address both
  `planPrivateFuelDeposit` and the extension use). Condition: manifest `privateFpc.address` MUST equal
  that derivation, not merely be schema-valid.
- Testnet-cutover Critical — **partly fixed** (DP7 satisfies `mint()` + zero initial Permit2
  allowance; Phase 6 promotes). Gap → A4 (below).
- Atomic-schema HIGH — **NOT fixed**: the "exhaustive" consumer list is incomplete (NEW-1).
- Counterfeit/wiring HIGH — **fixed** (Circle `0xA0b8…48` verified against Circle's official list;
  canonical address + portal/router/code readbacks sufficient).
- CI opt-in HIGH — **fixed in design**, provided the checked digest is the one emitted in the built artifact.
- Swap-policy MEDIUM — **fixed proportionately** (`bridge()` never touches `swapTarget`; a reverting
  target makes `bridgeWithFuel` atomically revert). Verify runtime hash/revert, not equality alone.
- Fable conditions — **met** (nonzero/equality; 7-tx budget; live manifest + verify-l1 migration).

## NEW findings (all verified real, all folded into v3-final)
- **NEW-1 HIGH — missed migration consumers.** `verify-deployments.ts:68` (inline flat type),
  `deploy-bridge-testnet.ts:393` (`...priorFuel` carry-forward), `fuel-testnet.ts:57`,
  `smoke-swap-existing-testnet.ts:49` all read flat `l1.fuel.*`. The live-parse test passes while
  verification reports missing router fields / deploy corrupts the new shape / canaries get
  `undefined`. → Phase 3 migrates ALL of them; gate becomes a grep-completeness check for every
  `.l1.fuel`/`.l1?.fuel` access, not just "live manifest parses."
- **NEW-2 HIGH — A4 is fund-recovery, not naming.** `useBridgeJournal.ts:300` `deploymentMatches`
  binds TOKEN records to the live `L1_PORTAL`/`BRIDGE`; `useBridgeBackup.ts:113` `restoreFile`
  refuses restoring a non-matching portal/bridge. Re-pointing testnet strands any in-flight AZLO
  token deposit. (Fee-juice records bind to the canonical FeeJuicePortal → survive a re-point.) →
  A4 is a BLOCKER: Phase 6 drains/settles in-flight AZLO token records (or ships a legacy recovery
  route) BEFORE cutover.
- **NEW-3 MEDIUM — token identity structurally ambiguous.** `candidate-schema.ts:39` requires
  test-only `maxWholePerTx`, no source discriminant → mainnet manifest must lie. → add a token
  `source` discriminant (`permissionless-mint` | `circle-proxy`); `maxWholePerTx` conditional on the
  mint variant.
- **NEW-4 MEDIUM — renounce ordered before the only real smoke.** `live-intent.ts:372` hard-fails
  once `owner()` ≠ signer; plan renounced in Phase 8 pre-smoke. → renounce becomes the LAST action of
  Phase 9 (after the smoke) + verify `owner()==0`; live-intent's owner check runs pre-renounce only.
- **NEW-5 MEDIUM — residual signed-witness theft path.** `SwapBridgeRouter.sol:244` accepts
  caller-supplied token portals; a compromised UI can induce a signed deposit to a malicious portal.
  DP8 doesn't stop this → low-balance burner wallets are an explicit control, not prose; residual
  acknowledged.

## Assumptions attack (final)
- **Facts:** all 10 check out. Fact 1 gains "portal is witness-bound but caller-selected" (NEW-5).
  PrivateFPC deploy is technically optional for private-only *execution*, but a concrete deterministic
  identity is mandatory for the extension's `check-fpc-version` + claim path → DP6 not contradictory.
- **Inferences:** I-a false (NEW-1); I-b needs the inert router-only shape + BOTH approval branches;
  I-c true only with bytecode/revert proof; I-d contingent on live class/`UNDERLYING`/rollup/canary.
- **Asks:** A3's host already exists at `network/service.ts:84` → resolve CSP origin (`lb.drpc.live`)
  by Phase 4. **A4 blocks promotion** (NEW-2). A6/A7 may defer ONLY behind a hard gate: without
  authenticated verify-live OR a **hostname↔target assertion**, a coherent testnet build at the
  mainnet hostname passes target↔manifest↔node. → add the hostname↔target assertion (Phase 4).

---

# Codex audit — round 4 / POST-IMPLEMENTATION (Phases 1–5 code)

**Session:** `019f94b3-3023-7821-ac1c-f74654c37de2` · fresh context, read the real diff (`dev...HEAD`).

> `blocking` — 4 HIGH, **no CRITICAL**. Verdict on the money path itself: clean ("the Permit2
> fallback uses the correct token, spender, amount, max approval, and receipt ordering in both legs";
> the define/build/CSP machinery "coherent").

## Findings → resolution (fixes in `05d604a`)
- **HIGH-1 — mainnet capability grant omitted the PrivateFPC** (`useWalletConnection.ts` chose
  `buildBridgeManifest`, which lacks the FPC + `balance_of`/`mint_and_pay_fee`/`pay_fee` scopes,
  while FPC registration is unconditional → scope-enforcing wallet rejects mainnet connect; private
  fuel breaks). **FIXED**: `buildCombinedManifest` parameterized — faucet tokens optional; mainnet
  omits them but keeps bridge + PrivateFPC + FEE_JUICE + auth-registry + private-fuel scopes;
  `buildBridgeManifest` branch dropped; mainnet-shape test added.
- **HIGH-2 — prod honoured `VITE_AZTEC_NODE_URL`** (a stale CF override could repoint a real-money
  build at the wrong Aztec node → deposit lands on L1, claim polls the wrong node). **FIXED** per
  codex's stated remediation: the override is dev/e2e-only; prod always uses the committed
  per-target node.
- **HIGH-3 — deploy scripts emitted no chain identity** (a freshly-promoted candidate would fail the
  startup assertion → app offline incl. pending claims). **FIXED**: `deploy-bridge-testnet` reads
  `l1ChainId`/`rollupVersion` from the node (reset-safe) and emits `l1ChainId`/`walletChainId` +
  `token.source`; `CandidateManifest` type extended.
- **HIGH-4 — `verify-l1` unconditional `maxWholePerTx`/Sepolia/MintableERC20 verify breaks on a
  `circle-proxy` manifest.** **DEFERRED → Phase 7** (verify-l1 is a deploy-time script gate; its
  network-parameterization + reused-USDC skip is exactly Phase 7's listed scope). Tracked.

## Explicitly cleared by the audit
Permit2 approve fallback (token/spender/amount/ordering, both legs); vite target/manifest defines
agree with the Node-side target; placeholder mainnet build fails closed; CI two-target matrix +
digest + mainnet dRPC CSP coherent.
