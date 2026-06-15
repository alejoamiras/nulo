/**
 * Maps wallet-sdk method names to required capability types.
 *
 * Used by `enforceCapability()` in the dispatcher to check whether a dApp
 * has been granted the capability needed for a given method call.
 *
 * Exempt methods (getChainInfo, requestCapabilities, batch) do not require
 * any capability grant — they are either meta-protocol or infrastructure.
 */

// `CapabilityType` is defined in `./method-descriptors` (the registry that is the
// single source of truth) so the dependency seam stays one-directional. Imported
// for local use + re-exported to preserve the public `@nulo/wallet-bridge` path.
import type { CapabilityType } from "./method-descriptors"
export type { CapabilityType }

/** Methods that never require a capability check.
 *  F-003: getAccounts removed. Previously exempted, which made the
 *  `accounts.canGet` sub-grant decorative. The scope-enforcement layer's
 *  checkGetAccounts now enforces canGet=true per the audit's recommended fix.
 */
const EXEMPT_METHODS = new Set(["getChainInfo", "requestCapabilities", "batch"])

/** Maps each wallet-sdk method name to its required capability type. */
const METHOD_CAPABILITY_MAP: Record<string, CapabilityType> = {
	// accounts
	createAuthWit: "accounts",
	registerToken: "accounts",
	// Wallet-local registration probe - gated by the contracts grant (need-to-know address list).
	isTokenRegistered: "contracts",
	getAccounts: "accounts", // F-003: was exempt; now requires accounts.canGet=true

	// contracts
	registerContract: "contracts",
	getContractMetadata: "contracts",

	// contractClasses
	getContractClassMetadata: "contractClasses",

	// simulation
	simulateTx: "simulation",
	executeUtility: "simulation",
	profileTx: "simulation",

	// transaction
	sendTx: "transaction",
	// Granting a public authwit authorizes a FUTURE token spend by the named
	// caller — at least as powerful as sending that call — so it requires the
	// `transaction` capability and is scope-checked by checkGrantPublicAuthwit.
	// WITHOUT this entry, enforceCapability returns [] and the scope-enforcement
	// block is skipped entirely: the gate would be dead code (audit F1).
	grantPublicAuthwit: "transaction",

	// data
	getPrivateEvents: "data",
	getAddressBook: "data",
	registerSender: "data",
}

/**
 * Get the capability type required for a wallet-sdk method.
 * Returns `null` for exempt or unknown methods.
 */
export function getRequiredCapability(method: string): CapabilityType | null {
	return METHOD_CAPABILITY_MAP[method] ?? null
}

/**
 * Check if a method is exempt from capability enforcement.
 */
export function isCapabilityExempt(method: string): boolean {
	return EXEMPT_METHODS.has(method)
}
