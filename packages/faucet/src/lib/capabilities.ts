import type { AztecAddress } from "@aztec/aztec.js/addresses"

/**
 * Build the wallet-sdk capability manifest for the faucet.
 *
 * Scope is tight:
 *  - `accounts.canCreateAuthWit: false` (Dripper has no auth guards).
 *  - `contracts` lists [DRIPPER, USDC, ETH]. SponsoredFPC stays OUT of
 *    `contracts` (we don't `wallet.registerContract` it) but its sponsor
 *    call must be in `transaction.scope` because Nulo enforces every
 *    `exec.calls` entry against the granted tx scope.
 *  - `simulation.utilities.scope` — `#[external("utility")]` functions only.
 *    `balance_of_private` lives here.
 *  - `simulation.transactions.scope` — `#[external("public")] #[view]`
 *    functions are routed through public_dispatch as tx-shaped
 *    simulations, even when they don't write state. `balance_of_public`
 *    lives here. Mis-scoping surfaces as "Function artifact not found".
 *  - `transaction.scope` — actual sendTx calls + the SponsoredFPC's
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
			name: "nulo-faucet",
			version: "0.1.0",
			description: "Test USDC + ETH on Aztec alpha-testnet — Nulo",
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
 *  - `accounts.canCreateAuthWit: true` — `exit_to_l1` needs a public burn auth-wit.
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
			description: "Bridge assets between Ethereum (L1) and Aztec (L2) — Nulo",
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
				transactions: { scope: [{ contract: tokenAddress, function: "balance_of_public" }] },
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
				],
			},
		],
	}
}

export interface CombinedManifestInput {
	readonly dripperAddress: AztecAddress
	readonly usdcAddress: AztecAddress
	readonly ethAddress: AztecAddress
	readonly bridgeAddress: AztecAddress
	readonly tokenAddress: AztecAddress
	readonly proxyAddress: AztecAddress
	readonly sponsoredFpcAddress: AztecAddress
	readonly appUrl?: string
}

/**
 * Build ONE manifest covering both the Faucet and the Bridge. The two tabs are the same origin =
 * the same app to the wallet, which keys the capability grant per-app — so two separate manifests
 * collide (the second connect's grant shadows the first, and registerContract for the missing
 * contracts hits a scope violation). One complete manifest, requested once, fixes that: connect on
 * either tab and both work, with no second wallet prompt. `canCreateAuthWit: true` because the
 * bridge's `exit_to_l1` needs a public burn auth-wit (the faucet simply never creates one).
 */
export function buildCombinedManifest(input: CombinedManifestInput): AppManifest {
	const { dripperAddress, usdcAddress, ethAddress, bridgeAddress, tokenAddress, proxyAddress, sponsoredFpcAddress } = input
	return {
		version: "1.0",
		metadata: {
			name: "nulo-faucet",
			version: "0.1.0",
			description: "Faucet + Bridge on Aztec alpha-testnet — Nulo",
			url: input.appUrl ?? defaultUrl(),
		},
		capabilities: [
			{ type: "accounts", canGet: true, canCreateAuthWit: true },
			{
				type: "contracts",
				contracts: [dripperAddress, usdcAddress, ethAddress, bridgeAddress, tokenAddress, proxyAddress],
				canRegister: true,
				canGetMetadata: true,
			},
			{
				type: "simulation",
				utilities: {
					scope: [
						{ contract: usdcAddress, function: "balance_of_private" },
						{ contract: ethAddress, function: "balance_of_private" },
						{ contract: tokenAddress, function: "balance_of_private" },
					],
				},
				// The bridge tx methods are simulatable too (a prompt-free PXE dry-run). The deposit gates
				// its claim PROMPT on a successful claim_public SIMULATION — PXE-aware, since the simulate
				// reverts (l1_to_l2_msg_exists) until the wallet's own PXE can consume the message, which
				// lags the node's checkpoint. Simulations are read-only, so widening this scope is safe;
				// the actual send is still gated by the (separate) transaction scope.
				transactions: {
					scope: [
						{ contract: usdcAddress, function: "balance_of_public" },
						{ contract: ethAddress, function: "balance_of_public" },
						{ contract: tokenAddress, function: "balance_of_public" },
						{ contract: bridgeAddress, function: "claim_public" },
						{ contract: bridgeAddress, function: "claim_private" },
						{ contract: bridgeAddress, function: "exit_to_l1_public" },
						{ contract: bridgeAddress, function: "exit_to_l1_private" },
						{ contract: tokenAddress, function: "burn_public" },
						{ contract: tokenAddress, function: "burn_private" },
						{ contract: sponsoredFpcAddress, function: "sponsor_unconditionally" },
					],
				},
			},
			{
				type: "transaction",
				scope: [
					{ contract: dripperAddress, function: "drip_to_public" },
					{ contract: dripperAddress, function: "drip_to_private" },
					{ contract: bridgeAddress, function: "claim_public" },
					{ contract: bridgeAddress, function: "claim_private" },
					{ contract: bridgeAddress, function: "exit_to_l1_public" },
					{ contract: bridgeAddress, function: "exit_to_l1_private" },
					{ contract: tokenAddress, function: "burn_public" },
					{ contract: tokenAddress, function: "burn_private" },
					{ contract: sponsoredFpcAddress, function: "sponsor_unconditionally" },
				],
			},
		],
	}
}

function defaultUrl(): string {
	if (typeof window === "undefined") return "https://localhost"
	return window.location.origin
}
