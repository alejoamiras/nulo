import { PRIVATE_FPC_ADDRESS, feeJuiceAddress } from "@nulo/bridge-core"

/** The canonical L2 FeeJuice protocol contract (identical on every network). */
const FEE_JUICE_L2 = AztecAddress.fromStringUnsafe(feeJuiceAddress)
/** The Wonderland PrivateFPC L2 address (pinned from the installed artifact). The wallet auto-registers
 *  it when a tx USES it as fee payer (`fpc/service.ts`), but the no-fuel-claim gate reads its
 *  `balance_of` BEFORE any such tx, and 5.0.1's registerContract conformance (dev #288) stops the read's
 *  on-the-fly Contract.at() from registering the artifact — so the tools app now pre-registers it at connect
 *  (`useWalletConnection` + `@/contracts/private-fpc`) and it is IN `contracts` (registerable). */
const PRIVATE_FPC_L2 = AztecAddress.fromStringUnsafe(PRIVATE_FPC_ADDRESS)
import { AztecAddress } from "@aztec/aztec.js/addresses"
import { STANDARD_AUTH_REGISTRY_ADDRESS } from "@aztec/standard-contracts/auth-registry/constants"

/**
 * Build the wallet-sdk capability manifest for the faucet.
 *
 * Scope is tight:
 *  - `accounts.canCreateAuthWit: false` (Dripper has no auth guards).
 *  - `contracts` lists [DRIPPER, NULO, OLUN]. SponsoredFPC stays OUT of
 *    `contracts` (we don't `wallet.registerContract` it) but its sponsor
 *    call must be in `transaction.scope` because Nulo enforces every
 *    `exec.calls` entry against the granted tx scope.
 *  - `simulation.utilities.scope` - `#[external("utility")]` functions only.
 *    `balance_of_private` lives here.
 *  - `simulation.transactions.scope` - `#[external("public")] #[view]`
 *    functions are routed through public_dispatch as tx-shaped
 *    simulations, even when they don't write state. `balance_of_public`
 *    lives here. Mis-scoping surfaces as "Function artifact not found".
 *  - `transaction.scope` - actual sendTx calls + the SponsoredFPC's
 *    sponsor_unconditionally so the embedded sponsor call passes scope
 *    enforcement.
 *
 * No wildcard scopes.
 */

export interface FaucetManifestInput {
	readonly dripperAddress: AztecAddress
	readonly usdcAddress: AztecAddress
	readonly ethAddress: AztecAddress
	readonly sponsoredFpcAddress: AztecAddress
	readonly appUrl?: string
}

interface ScopedFunction {
	contract: AztecAddress
	function: string
}

interface AccountsCapability {
	type: "accounts"
	canGet: true
	canCreateAuthWit: boolean
}

interface ContractsCapability {
	type: "contracts"
	contracts: ReadonlyArray<AztecAddress>
	canRegister: true
	canGetMetadata: true
}

interface SimulationCapability {
	type: "simulation"
	utilities: { scope: ReadonlyArray<ScopedFunction> }
	transactions: { scope: ReadonlyArray<ScopedFunction> }
}

interface TransactionCapability {
	type: "transaction"
	scope: ReadonlyArray<ScopedFunction>
}

export interface AppManifest {
	version: "1.0"
	metadata: { name: string; version: string; description: string; url: string }
	capabilities: ReadonlyArray<AccountsCapability | ContractsCapability | SimulationCapability | TransactionCapability>
}

export function buildFaucetManifest(input: FaucetManifestInput): AppManifest {
	const { dripperAddress, usdcAddress, ethAddress, sponsoredFpcAddress } = input
	return {
		version: "1.0",
		metadata: {
			name: "nulo-tools",
			version: "0.1.0",
			description: "Test NULO + OLUN on Aztec alpha-testnet - Nulo",
			url: input.appUrl ?? defaultUrl(),
		},
		capabilities: [
			{ type: "accounts", canGet: true, canCreateAuthWit: false },
			{
				type: "contracts",
				contracts: [dripperAddress, usdcAddress, ethAddress],
				canRegister: true,
				canGetMetadata: true,
			},
			{
				type: "simulation",
				utilities: {
					scope: [
						{ contract: usdcAddress, function: "balance_of_private" },
						{ contract: ethAddress, function: "balance_of_private" },
					],
				},
				transactions: {
					scope: [
						{ contract: usdcAddress, function: "balance_of_public" },
						{ contract: ethAddress, function: "balance_of_public" },
					],
				},
			},
			{
				type: "transaction",
				scope: [
					{ contract: dripperAddress, function: "drip_to_public" },
					{ contract: dripperAddress, function: "drip_to_private" },
					{ contract: sponsoredFpcAddress, function: "sponsor_unconditionally" },
				],
			},
		],
	}
}

export interface BridgeManifestInput {
	readonly bridgeAddress: AztecAddress
	readonly tokenAddress: AztecAddress
	readonly proxyAddress: AztecAddress
	readonly sponsoredFpcAddress: AztecAddress
	readonly appUrl?: string
}

/**
 * Build the wallet-sdk capability manifest for the Bridge tab. Wider than the faucet's:
 *  - `accounts.canCreateAuthWit: true` - `exit_to_l1` needs a public burn auth-wit.
 *  - `contracts` = [bridge, token, proxy] (token_bridge, the bridged token, the minter proxy).
 *  - `transaction.scope` covers claim + exit (both privacies), the token burns the exit auth-wit
 *    drives, and the SponsoredFPC sponsor call (Nulo enforces every `exec.calls` entry vs scope).
 *  - `simulation` scopes the token balance reads.
 *
 * Scope is refined in F4 once the flows run through the app (a missing entry surfaces as
 * "Function artifact not found").
 */
export function buildBridgeManifest(input: BridgeManifestInput): AppManifest {
	const { bridgeAddress, tokenAddress, proxyAddress, sponsoredFpcAddress } = input
	return {
		version: "1.0",
		metadata: {
			name: "nulo-bridge",
			version: "0.1.0",
			description: "Bridge assets between Ethereum (L1) and Aztec (L2) - Nulo",
			url: input.appUrl ?? defaultUrl(),
		},
		capabilities: [
			{ type: "accounts", canGet: true, canCreateAuthWit: true },
			{
				type: "contracts",
				contracts: [bridgeAddress, tokenAddress, proxyAddress],
				canRegister: true,
				canGetMetadata: true,
			},
			{
				type: "simulation",
				utilities: { scope: [{ contract: tokenAddress, function: "balance_of_private" }] },
				// The fuel claim (canonical FeeJuice, a protocol contract) must be simulatable: the
				// engine's claim gate dry-runs the token claim WITH the embedded fjwc fee payment.
				transactions: {
					scope: [
						{ contract: tokenAddress, function: "balance_of_public" },
						{ contract: FEE_JUICE_L2, function: "claim_and_end_setup" },
						// The standalone/sponsored gas claim uses plain `claim` (an app-phase call may not
						// end setup — the sponsored fee payment already does).
						{ contract: FEE_JUICE_L2, function: "claim" },
					],
				},
			},
			{
				type: "transaction",
				scope: [
					{ contract: bridgeAddress, function: "claim_public" },
					{ contract: bridgeAddress, function: "claim_private" },
					{ contract: bridgeAddress, function: "exit_to_l1_public" },
					{ contract: bridgeAddress, function: "exit_to_l1_private" },
					{ contract: tokenAddress, function: "burn_public" },
					{ contract: tokenAddress, function: "burn_private" },
					{ contract: sponsoredFpcAddress, function: "sponsor_unconditionally" },
					// The gas claim riding inside a fueled deposit's claim tx (fjwc embedded payment).
					{ contract: FEE_JUICE_L2, function: "claim_and_end_setup" },
					// The standalone/sponsored gas claim (app-phase — see the simulation scope note).
					{ contract: FEE_JUICE_L2, function: "claim" },
				],
			},
		],
	}
}

export interface CombinedManifestInput {
	/** The faucet tokens (Dripper/NULO/OLUN) — testnet-only. Omit ALL three on mainnet: the grant then
	 *  covers the Bridge + fuel (public + private) but NOT the faucet, matching the mainnet UI (no
	 *  faucet tab). The bridge + PrivateFPC + FEE_JUICE + auth-registry grants are always present, so
	 *  private-fuel-paid bridge claims work on both networks (DP6). */
	readonly dripperAddress?: AztecAddress
	readonly usdcAddress?: AztecAddress
	readonly ethAddress?: AztecAddress
	readonly bridgeAddress: AztecAddress
	readonly tokenAddress: AztecAddress
	readonly proxyAddress: AztecAddress
	readonly sponsoredFpcAddress: AztecAddress
	readonly appUrl?: string
}

/**
 * Build ONE manifest covering the Bridge + fuel, and — when the faucet tokens are supplied (testnet)
 * — the Faucet too. The tabs are the same origin = the same app to the wallet, which keys the grant
 * per-app, so two separate manifests collide (the second connect's grant shadows the first, and
 * registerContract for the missing contracts hits a scope violation). One complete manifest, requested
 * once, fixes that. On mainnet the faucet tokens are omitted (no faucet), but the PrivateFPC +
 * FEE_JUICE + auth-registry grants stay so private fuel + private-fuel-paid claims work (DP6).
 * `canCreateAuthWit: true` because the bridge's `exit_to_l1` needs a public burn auth-wit.
 */
export function buildCombinedManifest(input: CombinedManifestInput): AppManifest {
	const { dripperAddress, usdcAddress, ethAddress, bridgeAddress, tokenAddress, proxyAddress, sponsoredFpcAddress } = input
	// All three faucet tokens present ⇒ include the faucet grants; none ⇒ bridge+fuel only (mainnet).
	const faucet = dripperAddress && usdcAddress && ethAddress ? { dripper: dripperAddress, usdc: usdcAddress, eth: ethAddress } : null
	return {
		version: "1.0",
		metadata: {
			name: "nulo-tools",
			version: "0.1.0",
			description: faucet ? "Faucet + Bridge on Aztec - Nulo" : "Bridge on Aztec - Nulo",
			url: input.appUrl ?? defaultUrl(),
		},
		capabilities: [
			{ type: "accounts", canGet: true, canCreateAuthWit: true },
			{
				type: "contracts",
				contracts: [
					bridgeAddress,
					tokenAddress,
					proxyAddress,
					PRIVATE_FPC_L2,
					...(faucet ? [faucet.dripper, faucet.usdc, faucet.eth] : []),
				],
				canRegister: true,
				canGetMetadata: true,
			},
			{
				type: "simulation",
				utilities: {
					scope: [
						...(faucet
							? [
									{ contract: faucet.usdc, function: "balance_of_private" },
									{ contract: faucet.eth, function: "balance_of_private" },
								]
							: []),
						{ contract: tokenAddress, function: "balance_of_private" },
						// No-fuel claim fee source: read the user's PRIVATE Fee Juice held at the PrivateFPC
						// (abi_utility) to decide whether a no-fuel claim can self-pay from it.
						{ contract: PRIVATE_FPC_L2, function: "balance_of" },
					],
				},
				// The bridge tx methods are simulatable too (a prompt-free PXE dry-run). The deposit gates
				// its claim PROMPT on a successful claim_public SIMULATION - PXE-aware, since the simulate
				// reverts (l1_to_l2_msg_exists) until the wallet's own PXE can consume the message, which
				// lags the node's checkpoint. Simulations are read-only, so widening this scope is safe;
				// the actual send is still gated by the (separate) transaction scope.
				transactions: {
					scope: [
						...(faucet
							? [
									{ contract: faucet.usdc, function: "balance_of_public" },
									{ contract: faucet.eth, function: "balance_of_public" },
								]
							: []),
						{ contract: tokenAddress, function: "balance_of_public" },
						{ contract: bridgeAddress, function: "claim_public" },
						{ contract: bridgeAddress, function: "claim_private" },
						{ contract: bridgeAddress, function: "exit_to_l1_public" },
						{ contract: bridgeAddress, function: "exit_to_l1_private" },
						{ contract: tokenAddress, function: "burn_public" },
						{ contract: tokenAddress, function: "burn_private" },
						{ contract: sponsoredFpcAddress, function: "sponsor_unconditionally" },
						{ contract: STANDARD_AUTH_REGISTRY_ADDRESS, function: "set_authorized" },
						{ contract: FEE_JUICE_L2, function: "claim_and_end_setup" },
						// Private fuel (gas-follows-token): the 2-call cold-start payment — FeeJuice.claim
						// then PrivateFPC.mint_and_pay_fee — run verbatim by the wallet's EXTERNAL path.
						// Simulatable so the private claim can be simulate-gated like the public fjwc one.
						{ contract: FEE_JUICE_L2, function: "claim" },
						{ contract: PRIVATE_FPC_L2, function: "mint_and_pay_fee" },
						// No-fuel claim paid from EXISTING private FJ: PrivateFPC.pay_fee. Simulatable so the
						// no-fuel claim can be simulate-gated (with the FPC payment) like the fuel paths.
						{ contract: PRIVATE_FPC_L2, function: "pay_fee" },
						// No-fuel cold-check: read the account's public Fee Juice balance (private FJ is read via
						// PrivateFPC.balance_of in the utilities scope above).
						{ contract: FEE_JUICE_L2, function: "balance_of_public" },
					],
				},
			},
			{
				type: "transaction",
				scope: [
					...(faucet
						? [
								{ contract: faucet.dripper, function: "drip_to_public" },
								{ contract: faucet.dripper, function: "drip_to_private" },
							]
						: []),
					{ contract: FEE_JUICE_L2, function: "claim_and_end_setup" },
					// Private fuel: FeeJuice.claim + PrivateFPC.mint_and_pay_fee (the public path uses
					// claim_and_end_setup above; the private path claims then ends setup via the FPC).
					{ contract: FEE_JUICE_L2, function: "claim" },
					{ contract: PRIVATE_FPC_L2, function: "mint_and_pay_fee" },
					// No-fuel claim self-paying from the user's existing private FJ balance at the FPC.
					{ contract: PRIVATE_FPC_L2, function: "pay_fee" },
					{ contract: bridgeAddress, function: "claim_public" },
					{ contract: bridgeAddress, function: "claim_private" },
					{ contract: bridgeAddress, function: "exit_to_l1_public" },
					{ contract: bridgeAddress, function: "exit_to_l1_private" },
					{ contract: tokenAddress, function: "burn_public" },
					{ contract: tokenAddress, function: "burn_private" },
					{ contract: sponsoredFpcAddress, function: "sponsor_unconditionally" },
					// exit_to_l1 needs a PUBLIC burn auth-wit, which lands on-chain as set_authorized on the
					// standard auth registry (STANDARD_AUTH_REGISTRY_ADDRESS — derived from the artifact in 5.0,
					// no longer protocol slot 0x..01). Without this the
					// withdraw's auth-wit sendTx hits a transaction-scope violation.
					{ contract: STANDARD_AUTH_REGISTRY_ADDRESS, function: "set_authorized" },
				],
			},
		],
	}
}

function defaultUrl(): string {
	if (typeof window === "undefined") return "https://localhost"
	return window.location.origin
}
