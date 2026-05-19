/**
 * Capability + scope types for the wallet-sdk protocol layer.
 *
 * These types describe the permissions a dApp has been granted (or
 * rejected) within a `DappSession`. They belong to the dispatcher +
 * scope-enforcement layer, so they live in `@nulo/wallet-bridge`.
 * `@/wallet/services/dapp-session/spec.ts` re-exports from here.
 */

/** A contract + function pattern used in scope definitions. */
export type ScopePattern = { contract: string; function: string }

/** A scope is either unrestricted ("*") or a list of allowed contract/function patterns. */
export type Scope = "*" | ScopePattern[]

export type AccountsCapability = {
	type: "accounts"
	canGet?: boolean
	canCreateAuthWit?: boolean
	accounts: { alias: string; item: unknown }[]
}

export type ContractsCapability = {
	type: "contracts"
	contracts: "*" | string[]
	canRegister?: boolean
	canGetMetadata?: boolean
}

export type ContractClassesCapability = {
	type: "contractClasses"
	classes: "*" | string[]
	canGetMetadata?: boolean
}

export type SimulationCapability = {
	type: "simulation"
	transactions?: { scope: Scope }
	utilities?: { scope: Scope }
}

export type TransactionCapability = {
	type: "transaction"
	scope: Scope
}

export type DataCapability = {
	type: "data"
	addressBook?: boolean
	privateEvents?: { contracts: "*" | string[] }
}

export type Capability =
	| AccountsCapability
	| ContractsCapability
	| ContractClassesCapability
	| SimulationCapability
	| TransactionCapability
	| DataCapability

export type GrantedCapabilityRecord = {
	capability: Capability
	grantedAt: number
}

export type RejectedCapabilityRecord = {
	capabilityType: string
	rejectedAt: number
}
