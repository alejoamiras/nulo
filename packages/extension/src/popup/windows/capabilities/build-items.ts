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
import { getCapabilityInfo, isKnownCapability, type CapabilityRisk } from "@/wallet/services/dapp-session/capability-meta"

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

		const info = getCapabilityInfo(cap.type)
		const isUnknown = !isKnownCapability(cap.type)
		items.push({
			capability: cap,
			// Unknown types render a CONSTANT head label so the dApp-controlled
			// cap.type string can't masquerade as a friendly permission name
			// (a dApp could send `type: "Read public data only — recommended"`
			// and the popup would otherwise paint that as the head text). The
			// raw sanitized type still appears in the detail panel for
			// forensic clarity.
			label: isUnknown ? "Unknown permission" : info.label,
			description: isUnknown
				? "This wallet doesn't recognize this permission. Reject if you don't know what it does."
				: info.description,
			isNew: true,
			isUnknown,
			// Default-OFF for unknown capability types. Forces a deliberate
			// click before the cap can be added to the session grant list.
			// Mitigates the persistence-by-accident path codex flagged: an
			// approved unknown grant is persisted in DappSession.capabilityGrants
			// and a later wallet version that adds support for that type would
			// honor it retroactively. Recognized caps default ON as before.
			selected: !isUnknown,
			risk: info.risk,
			reRequested: reRequestedTypes.has(cap.type),
		})
	}

	for (const cap of existingGrants) {
		const info = getCapabilityInfo(cap.type)
		const isUnknown = !isKnownCapability(cap.type)
		items.push({
			capability: cap,
			label: isUnknown ? "Unknown permission" : info.label,
			description: isUnknown
				? "This wallet doesn't recognize this permission. Reject if you don't know what it does."
				: info.description,
			isNew: false,
			isUnknown,
			selected: true,
			risk: info.risk,
			reRequested: false,
		})
	}

	return items
}
