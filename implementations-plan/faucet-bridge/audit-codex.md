# Codex audit — Faucet→Bridge plan (Round 1)

**Model family:** codex (xhigh, read-only). **Session:** `019e9d73-dabb-7e52-b818-f5d229c97c65`.
Paths rewritten repo-relative / `[holonym]` / `[wonderland-fee]` / `[aztec-packages]` per artifact hygiene. Raw transcript in the session's CODEX_DIR (chat only).

## Verdict
**conditional approve** — conditions: (1) lock one FPC salt/address policy + assert before any deposit; (2) move export/import recovery validation ahead of Phase 6; (3) add an early bridge-frontend runtime spike for Wonderland + viem + `additionalScopes`; (4) make Phase 1 a real go/no-go on FeeAssetHandler access + fixed mint economics; (5) explicitly decide whether the atomic router is public-only or also preserves token-side privacy.

## Critical
- **FPC address derivation underspecified but unrecoverable if wrong.** Nulo's wallet service auto-derives the protocol PrivateFPC at `salt = Fr.zero(), deployer = AztecAddress.ZERO` (`packages/extension/src/wallet/services/fpc/service.ts:86`); the e2e fixture states salt "MUST be Fr.zero()" to match discovery (`packages/extension/tests/e2e/fixtures/aztec.ts:354`). Wonderland's helper accepts arbitrary salts (`[wonderland-fee] src/ts/utils/deploy.ts:14`). **Fix:** publish ONE salt constant, derive the pinned address from it everywhere, assert at startup, block any L1 deposit if the derived address mismatches.

## High
- **Secret-loss mitigation sequenced too late.** Plan says secret loss permanently locks L1 funds (Security) but the first real Sepolia→Aztec round-trip is Phase 6 while "prominent manual secret export" is deferred to Phase 10. **Fix:** make export/import + a destructive recovery test part of the Phase 6 exit gate.
- **Wonderland integration is NOT a verified fact in this repo.** Plan's Ask A names npm `@wonderland/aztec-fee-payment@4.2.0-aztecnr-rc.2`, but Nulo currently pins a prerelease GitHub tarball installing as `4.2.0-prerelease.215fd08` (`packages/extension/package.json:63`). The repo already carries a raw-artifact vite alias workaround (`packages/extension/vite.config.ts:48`) + a fixture comment documenting top-level import failure from version drift (`packages/extension/tests/e2e/fixtures/aztec.ts:348`). **Fix:** Phase 0.5 browser/runtime spike, then pin the exact source you ship. **(Implication: the extension is ALREADY a Wonderland consumer — mirror its integration, don't integrate fresh.)**
- **`bun why viem` is not a sufficient gate.** Aztec packages import `viem` directly (`@aztec/aztec.js/src/ethereum/portal_manager.ts:19`) while repo code imports `@aztec/viem` (`packages/extension/tests/e2e/fixtures/aztec-private-fpc-bridge.ts:26`); both specifier paths are physically installed with the SAME package identity (the alias). **Fix:** require a real browser build/smoke test with the chosen L1 stack; enforce one specifier path via aliasing + lint.
- **PrivateFPC needs exact `additionalScopes` plumbing, not just manifest functions.** Wonderland docs require `additionalScopes: [fpc.address]` (`[wonderland-fee] src/ts/README.md:44`); Nulo's fixture requires it for `mint` (`packages/extension/tests/e2e/fixtures/aztec.ts:403`); the extension threads scopes through simulate/prove/send (`packages/extension/src/wallet/services/execution/service.ts:1605`). **Fix:** define the full scope matrix early, prove end-to-end before UI.
- **Swap/liquidity inference materially weaker than stated.** L1 assets are infinite-mint but the FeeJuice side is operator-seeded real protocol liquidity → grief-drainable; direct FeeJuice minting is FIXED-SIZE, not arbitrary (`packages/extension/tests/e2e/fixtures/aztec-private-fpc-bridge.ts:75`, `@aztec/aztec.js/src/ethereum/portal_manager.ts:161`). `minFuelOutput` protects users from price movement, NOT operator liquidity/liveness. **Fix:** Phase-1 go/no-go on handler access + reseed economics; treat swap as optional until proven.

## Medium
- **Hookless-route not implemented in the reference swap.** `_validateRoute` only checks first input + last output (`[holonym] l1-contracts/src/UniswapFuelSwap.sol:226`) — no `hooks == address(0)` or hop-continuity. **Fix:** mandatory contract edits, not a "verify" note.
- **"Near-verbatim minus baggage" overstated on the cross-chain boundary.** Holonym hashes `amountAfterFee` + withdraws by `_l2BlockNumber` (`[holonym] l1-contracts/src/TokenPortal.sol:157`); canonical 4.2.0 uses GROSS + `_epoch` (`@aztec/l1-artifacts/dest/TokenPortalAbi.js:3098`); upstream private-exit shape also differs (`[aztec-packages] .../token_bridge_contract/src/main.nr:116`). **Fix:** treat portal/bridge as FRESH code with explicit ABI reconciliation.
- **Atomic-router privacy scope internally inconsistent.** Phase 2 keeps `depositToAztecPrivate` + `claim_public/private`, but Phase 8 drops `isPrivate`. In Holonym, `isPrivate` is witness-bound AND branch-selecting (`[holonym] SwapBridgeRouter.sol:84,277,315`). **Fix:** explicitly choose public-only atomic swap for v1, OR keep token-side privacy in the router witness + params.
- **Private fuel sequenced behind Uniswap for no technical reason.** PrivateFPC depends on direct FeeJuice + wallet/runtime behavior, not the swap router. **Fix:** move private fuel immediately after direct public FeeJuice.

## Low
- **Owner powers broad.** Router `sweep` + swap-adapter `sweep` are unrestricted owner-only. Fine for testnet; **fix:** document separate operator keys now; timelock/role-split if it leaves testnet.
- **"Live faucet implies net is 4.2.0" is not evidence.** The faucet's chain pin is local config (`packages/faucet/src/lib/chain-info.ts:21`). **Fix:** Phase 1 is the only source of truth; strip the implication language.

## Assumption attack
- **Facts:** (a) Wonderland package/version claim wrong for repo state (prerelease tarball, not npm rc.2). (b) "Router+swap reusable near-verbatim minus isPrivate" overstated — isPrivate is witness-bound + flow-selecting; swap validator lacks hook/hop checks.
- **Inferences:** (a) thin-liquidity "acceptable" unsafe — ignores pool depletion + fixed mint packet. (b) viem dedupe solvable by `bun why` unsafe — runtime mixes `viem` + `@aztec/viem` specifiers. (c) clean-portal interop with stripped bridge is an ask, not a fact.
- **Asks:** (1) the one true FPC salt/address policy? (2) atomic swap public-only or preserve private token deposits? (3) exact Phase-6 FeeJuice UX if handler mint is fixed-size? (4) operator runbook for FJ pool reseed + FPC public-balance upkeep?

## Contradictions
- Security "secret loss permanent" vs live deposits in Phase 6 with export deferred to Phase 10.
- Research recommends `@wagmi/vue` + `viem/chains` vs Phase 4 "NO direct stock-viem dep" — not simultaneously true without stronger aliasing than `bun why`.
- Phase 8 removes `isPrivate` vs earlier phases preserving private token bridge semantics.
- Ledger leaves `_validateRoute` hooks question open; code answer is "no, not enforced."

## Divergent planner notes
- Insert a **Phase 0.5 runtime spike** before contract work: L1 wallet stack, Wonderland import mode, browser poseidon2, `additionalScopes`, fixed FPC address derivation — in the REAL bridge frontend.
- Order: **direct public FeeJuice → private FeeJuice → swap** (surfaces runtime/capability risk earlier; stops Uniswap masking PrivateFPC failures).
- Force a **privacy-scope decision** now (public-only atomic router vs token-side privacy in the router witness/UI).
- Treat **swap as optional** until live economics proven; the direct fee path is the stable product, the pool-based "buy fuel with USDC" is a testnet demo.

---

# Codex R2 — resumed self-critique (same session)

Run against the REVISED plan. Paths repo-relative / `[holonym]` / `[wonderland-fee]` / `[aztec-packages]`.

**Retractions (R1 over-assertions walked back):**
- The "dual-viem identity" risk was over-asserted: viem IS aliased to `@aztec/viem` (`bun.lock:350,2446`) and both manifests identify as `@aztec/viem`. A browser smoke test is still needed, but "dual viem" was not evidenced. (Already corrected in the R1 fold-in.)
- poseidon/COOP-COEP overstated as an open risk — already plumbed in `packages/faucet/public/_headers`. Belongs in P0.5, not a top-tier unknown. (Already downgraded.)

**Misses (new, second-order):**
- **Private claim secrets are THEFT-capable bearer credentials.** Private content-hash omits the recipient (`[aztec-packages] token_portal_content_hash_lib/src/lib.nr:30`), and `claim_private` lets the claimer choose any recipient (`[aztec-packages] token_bridge_contract/src/main.nr:92`). So an exported/leaked private claim secret = stolen funds, not merely locked. Plan's Security frames it only as "permanent lock."
- **`additionalScopes` is a permission surface, not just plumbing.** Execution consumes caller-supplied `additionalScopes` through simulate/prove/send (`packages/extension/src/wallet/services/execution/service.ts:1605,1733,1839`); enforcement checks call targets (`packages/wallet-bridge/src/scope-enforcement.ts:90`). Capability UX/copy needs hardening.
- **Fixed FeeJuice packet vs gas ceiling.** `PrivateFPC.mint_and_pay_fee` hard-reverts if `amount < max_gas_cost` (`[wonderland-fee] src/nr/private_contract/src/main.nr:100`); fixed-size mint packets may be insufficient under fee spikes / heavier calls.

**New problems from the revisions:**
- FULL PARITY (`isPrivate`) resolves the old contradiction but raises export/copy-mistake severity (private-token + private-fuel both hinge on theft-capable secrets).
- P0.5 says "prove the path runs" but should require the EXACT wallet execution mode the bridge uses (`executeNoFromSendTx` discovers with `scopes: additionalScopes`, omits account — `execution/service.ts:1853`).
- Reusing `@nulo/wallet-crypto` is right, but its README drifts from code (README 250k PBKDF2 vs 600k in `encryption-key.ts:2`) → freeze the bridge recovery blob format explicitly, don't inherit by osmosis.

**Conditions check:** all 5 R1 conditions RESOLVED by the revisions (FPC salt/assert, secret-export-before-P6, P0.5 spike, P1 go/no-go, atomic-router privacy = explicit FULL PARITY).

**Verdict:** **conditional approve** — new conditions: (1) treat private claim secrets/export files as theft-capable bearer secrets in UX + security copy; (2) make P0.5 exercise the EXACT wallet execution/capability path incl. `additionalScopes`; (3) add a hard gas-sufficiency rule for the fixed FeeJuice packet (UI disables/reroutes flows that can't cover current max gas); (4) freeze the bridge recovery blob format instead of inheriting `@nulo/wallet-crypto`'s extension assumptions.
