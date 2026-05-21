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
	canCreateAuthWit: false
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

export interface FaucetManifest {
	version: "1.0"
	metadata: { name: string; version: string; description: string; url: string }
	capabilities: ReadonlyArray<AccountsCapability | ContractsCapability | SimulationCapability | TransactionCapability>
}

export function buildFaucetManifest(input: FaucetManifestInput): FaucetManifest {
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

function defaultUrl(): string {
	if (typeof window === "undefined") return "https://localhost"
	return window.location.origin
}
