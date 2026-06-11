# Fable audit transcript - token-identity

## Round 1 - dual audit (Plan subagent, model fable, max effort)

Verdict: **reject** - all blockers folded same-round (T6-T9, D2/D3/D5 rewrites). Outline: redeploy ("the alias cannot deliver the 18-dec ask at all"). Condensed findings (paths repo-relative):

- **CRITICAL-1**: a per-token grant cannot transit the protocol as drafted - `WalletSchema.requestCapabilities` validates against `AppCapabilitiesSchema`, a CLOSED Zod discriminated union in `strip` mode: new capability types are rejected dApp-side, new fields on `accounts` silently stripped; scope-checkers fail open on missing lists, so "need-to-know" would degenerate to any-app-probes-any-token. FIX (folded): gate via the EXISTING `contracts` capability - the faucet manifest already lists token addresses under `contracts.contracts`, `checkGetContractMetadata` is the per-address checker shape to mirror, and the popup already renders contracts lists.
- **HIGH-1**: grant-upgrade dead end - re-consent delta is TYPE-only for non-accounts capabilities (`wallet-sdk-capability-field-diff` limitation): new addresses under an already-granted type never re-prompt/backfill. FIX (folded): APP_ID bump with the redeploy (T8).
- **HIGH-2**: the capability popup is a closed v-if chain - any NEW grant shape renders nothing (consent theater). Resolved by the contracts-capability redesign (already rendered).
- **HIGH-3**: `MINT_AMOUNT = 100_000_000n` (useL1Usdc) is a 6-dec literal a 1e6 grep misses - mints 1e-10 AZLO at 18 dec; the lossy parse at BridgeForm.vue:83 confirmed; seven Number(x)/1e6 display sites verified.
- **MEDIUM-1**: the schema-patch reachability pin imports only the extension copy - faucet/playground drift invisible (copies comment-divergent today). FIX: 3-copy content-equality test (T9).
- **MEDIUM-2**: the proposed `formatAmount` would duplicate the existing decimals-parameterized `formatBigInt` - only `parseAmount` is new.
- **MINOR**: deploy-bridge-testnet.ts hardcodes 6 three times, no symmetry assert (folded into P1); MintableERC20 cap auto-scales; seal-trust survives redeploy (keyed chainId+addr+provider); journal stale-deployment path verified; SponsoredFPC canonical-salt-derived, unaffected.
- Assumption attack: registry lookup VERIFIED (`TokenService.getTokens` sync); playground patch copy VERIFIED (no faucet-style manifest there); MintableERC20 VERIFIED; the ETH drip is ALREADY 18-dec (OLUN like-for-like); silent Asks surfaced: deployer env/funds, BridgeAddToken.vue exists, popup UI work (resolved by redesign).
