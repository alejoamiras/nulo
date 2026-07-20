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
import { AUTHWIT_RIDER_INFO, getCapabilityInfo, getSafeDisplay, type CapabilityRisk } from "@/wallet/services/dapp-session/capability-meta"

export type UICapabilityItem = {
	capability: Capability
	label: string
	description: string
	isNew: boolean
	isUnknown: boolean
	selected: boolean
	risk: CapabilityRisk
	reRequested: boolean
	/**
	 * Marks the synthetic card for the accounts `canCreateAuthWit`
	 * sub-permission. The rider's `capability` is the accounts cap itself, so
	 * the approve path must EXCLUDE riders from the plain new-capability grant
	 * list (or accounts would be pushed twice) and instead use the rider's
	 * `selected` to keep or strip `canCreateAuthWit` on the accounts grant.
	 */
	authwitRider?: boolean
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
		// split). Its `canCreateAuthWit` sub-permission DOES get a card — a
		// rider the user can individually deselect (deselection strips the
		// flag from the accounts grant on approve). Boolean() coercion
		// mirrors the dispatcher/scope-checker read, so a dApp sending a
		// truthy non-boolean (`canCreateAuthWit: 1`) can't dodge the card.
		if (cap.type === "accounts") {
			if (Boolean((cap as { canCreateAuthWit?: unknown }).canCreateAuthWit)) {
				items.push({
					capability: cap,
					label: AUTHWIT_RIDER_INFO.label,
					description: AUTHWIT_RIDER_INFO.description,
					isNew: true,
					isUnknown: false,
					selected: true,
					risk: AUTHWIT_RIDER_INFO.risk,
					reRequested: reRequestedTypes.has(cap.type),
					authwitRider: true,
				})
			}
			continue
		}

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

/**
 * The accounts capability actually granted on approve. A deselected authwit
 * rider strips `canCreateAuthWit` (enforcement — method-scope-checkers and the
 * dispatcher — reads the flag truthy, so `false` fully disables it). No rider
 * card means the flag wasn't requested: the cap passes through untouched.
 * Pure + exported so the consent-granularity guarantee is unit-testable
 * without standing up the popup runtime.
 */
export function buildGrantedAccountsCap(accountsCap: Capability, items: readonly UICapabilityItem[]): Capability {
	const rider = items.find((c) => c.authwitRider)
	const stripAuthwit = rider !== undefined && !rider.selected
	return stripAuthwit ? ({ ...accountsCap, canCreateAuthWit: false } as Capability) : accountsCap
}
