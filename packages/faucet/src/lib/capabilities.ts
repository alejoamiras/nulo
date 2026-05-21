import type { AztecAddress } from "@aztec/aztec.js/addresses"

/**
 * Build the wallet-sdk capability manifest for the faucet.
 *
 * Scope is tight per plan-v2 §5:
 *  - `accounts.canCreateAuthWit: false` (Dripper has no auth guards).
 *  - `contracts` lists ONLY [DRIPPER, USDC, ETH]. NOT SponsoredFPC —
 *    Nulo's dispatcher materializes the embedded `feePayer` path
 *    internally (codex audit r2 fix; see useFaucetDrip).
 *  - `simulation.utilities.scope` is restricted to the 4 balance reads
 *    we issue via `wallet.executeUtility`.
 *  - `transaction.scope` is the 2 Dripper functions we send.
 *
 * No wildcard scopes.
 */

export interface FaucetManifestInput {
	readonly dripperAddress: AztecAddress
	readonly usdcAddress: AztecAddress
	readonly ethAddress: AztecAddress
	readonly appUrl?: string
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
	utilities: { scope: ReadonlyArray<{ contract: AztecAddress; function: string }> }
}

interface TransactionCapability {
	type: "transaction"
	scope: ReadonlyArray<{ contract: AztecAddress; function: string }>
}

export interface FaucetManifest {
	version: "1.0"
	metadata: { name: string; version: string; description: string; url: string }
	capabilities: ReadonlyArray<AccountsCapability | ContractsCapability | SimulationCapability | TransactionCapability>
}

export function buildFaucetManifest(input: FaucetManifestInput): FaucetManifest {
	const { dripperAddress, usdcAddress, ethAddress } = input
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
						{ contract: usdcAddress, function: "balance_of_public" },
						{ contract: ethAddress, function: "balance_of_private" },
						{ contract: ethAddress, function: "balance_of_public" },
					],
				},
			},
			{
				type: "transaction",
				scope: [
					{ contract: dripperAddress, function: "drip_to_public" },
					{ contract: dripperAddress, function: "drip_to_private" },
				],
			},
		],
	}
}

function defaultUrl(): string {
	if (typeof window === "undefined") return "https://localhost"
	return window.location.origin
}
