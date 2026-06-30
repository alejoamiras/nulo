/**
 * Pre-baked capability manifests for the bundle picker.
 *
 * Each entry exercises a different scope variation so the same playground
 * can drive cap-request-basic / partial / scoped / etc. tests by just
 * changing the bundle id before clicking pg-btn-requestCapabilities.
 *
 * Test driver fills `?tokenAddress=0x...` so scope-restricted bundles can
 * pin to a real deployed contract.
 *
 * Manifest shape follows the canonical wallet-sdk `AppCapabilitiesSchema`:
 * `{ version: "1.0", metadata: { name, version, url? }, capabilities: [...] }`.
 * Request-side `accounts` capabilities use `canGet`/`canCreateAuthWit` only —
 * the `accounts: [...]` field is granted-side, not request-side.
 */

export type BundleId =
	| "basic"
	| "basic-noUtilities"
	| "basic-readOnly"
	| "accounts"
	| "accounts-noAuthWit"
	| "transaction"
	| "transaction-scoped"
	| "data"
	| "data-scopedEvents"
	| "contractClasses"
	| "full"

export type AppCapabilitiesManifest = {
	version: "1.0"
	metadata: { name: string; version: string; url?: string }
	capabilities: unknown[]
}

const MANIFEST_METADATA: AppCapabilitiesManifest["metadata"] = {
	// Aligned with APP_ID in lib/wallet.ts so discovery + manifest agree on identity.
	name: "nulo-playground",
	version: "0.1.0",
	url: typeof window !== "undefined" ? window.location.origin : undefined,
}

function getTokenAddress(): string {
	if (typeof window === "undefined") return "0x0"
	return new URL(window.location.href).searchParams.get("tokenAddress") ?? "0x0"
}

function buildCapabilities(id: BundleId): unknown[] {
	const tokenAddress = getTokenAddress()
	switch (id) {
		case "basic":
			return [
				{ type: "contracts", contracts: "*", canRegister: true, canGetMetadata: true },
				{ type: "simulation", transactions: { scope: "*" }, utilities: { scope: "*" } },
			]
		case "basic-noUtilities":
			return [
				{ type: "contracts", contracts: "*", canRegister: true, canGetMetadata: true },
				{ type: "simulation", transactions: { scope: "*" } },
			]
		case "basic-readOnly":
			return [{ type: "contracts", contracts: "*", canRegister: false, canGetMetadata: true }]
		case "accounts":
			return [
				{ type: "accounts", canGet: true, canCreateAuthWit: true },
				{ type: "contracts", contracts: "*", canRegister: true, canGetMetadata: true },
				{ type: "simulation", transactions: { scope: "*" }, utilities: { scope: "*" } },
			]
		case "accounts-noAuthWit":
			return [
				{ type: "accounts", canGet: true, canCreateAuthWit: false },
				{ type: "simulation", transactions: { scope: "*" }, utilities: { scope: "*" } },
			]
		case "transaction":
			return [
				{ type: "accounts", canGet: true, canCreateAuthWit: true },
				{ type: "transaction", scope: "*" },
				{ type: "simulation", transactions: { scope: "*" }, utilities: { scope: "*" } },
			]
		case "transaction-scoped":
			return [
				{ type: "accounts", canGet: true, canCreateAuthWit: true },
				{ type: "transaction", scope: [{ contract: tokenAddress, function: "transfer_public_to_public" }] },
				{ type: "simulation", transactions: { scope: "*" }, utilities: { scope: "*" } },
			]
		case "data":
			return [
				{ type: "data", addressBook: true, privateEvents: { contracts: "*" } },
				{ type: "contracts", contracts: "*", canRegister: true, canGetMetadata: true },
			]
		case "data-scopedEvents":
			return [
				{ type: "data", addressBook: true, privateEvents: { contracts: [tokenAddress] } },
				{ type: "contracts", contracts: "*", canRegister: true, canGetMetadata: true },
			]
		case "contractClasses":
			return [
				{ type: "contracts", contracts: "*", canRegister: true, canGetMetadata: true },
				{ type: "contractClasses", classes: "*", canGetMetadata: true },
			]
		case "full":
			return [
				{ type: "accounts", canGet: true, canCreateAuthWit: true },
				{ type: "contracts", contracts: "*", canRegister: true, canGetMetadata: true },
				{ type: "contractClasses", classes: "*", canGetMetadata: true },
				{ type: "simulation", transactions: { scope: "*" }, utilities: { scope: "*" } },
				{ type: "transaction", scope: "*" },
				{ type: "data", addressBook: true, privateEvents: { contracts: "*" } },
			]
		default:
			throw new Error(`Unknown bundle id: ${id satisfies never}`)
	}
}

export function buildManifest(id: BundleId): AppCapabilitiesManifest {
	return {
		version: "1.0",
		metadata: MANIFEST_METADATA,
		capabilities: buildCapabilities(id),
	}
}
