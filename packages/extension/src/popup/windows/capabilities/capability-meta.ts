export type CapabilityRisk = "low" | "medium" | "high"

export interface CapabilityInfo {
	label: string
	description: string
	risk: CapabilityRisk
}

/**
 * Static UI metadata for the capability types the wallet recognises.
 * Keep this in sync with @nulo/wallet-bridge's `Capability` union; new
 * types fall back to the generic shape returned by `getCapabilityInfo`.
 */
export const CAPABILITY_LABELS: Record<string, CapabilityInfo> = {
	accounts: {
		label: "Share your accounts",
		description: "The dApp can see your account addresses and aliases",
		risk: "medium",
	},
	contracts: {
		label: "Register and query contracts",
		description: "Register contract instances and read contract metadata",
		risk: "low",
	},
	contractClasses: {
		label: "Query contract classes",
		description: "Read contract class metadata from the network",
		risk: "low",
	},
	simulation: {
		label: "Simulate transactions",
		description: "Run transaction simulations without sending them",
		risk: "medium",
	},
	transaction: {
		label: "Send transactions",
		description: "Submit transactions to the network on your behalf",
		risk: "high",
	},
	data: {
		label: "Access private data",
		description: "Read private notes and events from your account",
		risk: "high",
	},
}

export function getCapabilityInfo(type: string): CapabilityInfo {
	return CAPABILITY_LABELS[type] ?? { label: type, description: `Capability: ${type}`, risk: "medium" }
}
