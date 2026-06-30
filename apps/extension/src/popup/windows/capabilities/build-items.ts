/**
 * Pure logic for the capabilities-popup card list.
 *
 * Builds the `UICapability[]` the popup renders by mapping the
 * dispatcher's `delta` + `existingGrants` arrays through
 * `getCapabilityInfo` and tagging each entry with its UI state
 * (selected, re-requested, granted). Kept outside the SFC so the
 * security-critical default-OFF invariant for unknown capability
 * types is unit-testable without standing up the popup runtime.
 */
import type { Capability } from "@nulo/wallet-bridge"
import { getCapabilityInfo, getSafeDisplay, type CapabilityRisk } from "@/wallet/services/dapp-session/capability-meta"

export type UICapabilityItem = {
	capability: Capability
	label: string
	description: string
	isNew: boolean
	isUnknown: boolean
	selected: boolean
	risk: CapabilityRisk
	reRequested: boolean
}

export function buildCapabilityItems(
	delta: Capability[],
	existingGrants: Capability[],
	reRequestedTypes: ReadonlySet<string>,
): UICapabilityItem[] {
	const items: UICapabilityItem[] = []

	for (const cap of delta) {
		// `accounts` is rendered as the dedicated account picker section,
		// not as a card in the delta list (popup orchestration owns that
		// split). Skip it here.
		if (cap.type === "accounts") continue

		// getSafeDisplay returns the constant "Unknown permission" + warning
		// description for any unrecognized type so the dApp-controlled
		// cap.type string never lands as a visible label. The risk value
		// still comes from getCapabilityInfo so unknowns get the "high" bias.
		const safe = getSafeDisplay(cap.type)
		const risk = getCapabilityInfo(cap.type).risk
		items.push({
			capability: cap,
			label: safe.label,
			description: safe.description,
			isNew: true,
			isUnknown: safe.isUnknown,
			// Default-OFF for unknown capability types. Forces a deliberate
			// click before the cap can be added to the session grant list.
			// Mitigates the persistence-by-accident path codex flagged: an
			// approved unknown grant is persisted in DappSession.capabilityGrants
			// and a later wallet version that adds support for that type would
			// honor it retroactively. Recognized caps default ON as before.
			selected: !safe.isUnknown,
			risk,
			reRequested: reRequestedTypes.has(cap.type),
		})
	}

	for (const cap of existingGrants) {
		const safe = getSafeDisplay(cap.type)
		const risk = getCapabilityInfo(cap.type).risk
		items.push({
			capability: cap,
			label: safe.label,
			description: safe.description,
			isNew: false,
			isUnknown: safe.isUnknown,
			selected: true,
			risk,
			reRequested: false,
		})
	}

	return items
}
