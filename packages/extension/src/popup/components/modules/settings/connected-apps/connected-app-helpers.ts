// @ts-expect-error — luxon ships no .d.ts; behavior is identical to the
// .vue call sites that already import it without types.
import { DateTime } from "luxon"

export const CAPABILITY_LABELS: Record<string, string> = {
	accounts: "Share accounts",
	contracts: "Register and query contracts",
	contractClasses: "Query contract classes",
	simulation: "Simulate transactions",
	transaction: "Send transactions",
	data: "Access private data",
}

export function getCapabilityLabel(type: string): string {
	return CAPABILITY_LABELS[type] ?? type
}

export function formatSessionExpiry(expiryMs: number | undefined): string {
	if (!expiryMs) return ""
	return DateTime.fromMillis(expiryMs).toFormat("LLL dd 'at' HH:mm")
}

export interface SessionPermission {
	methods?: string[]
	events?: string[]
}

export interface SessionParams {
	methods: string[]
	events: string[]
}

/**
 * Flatten permission scopes into a deduplicated methods/events pair.
 * Used for the "Session allowances" section. Chain scoping lives on the
 * parent `DappSession.chainId` (sessions are per
 * `(origin, chainId, profileId)`), so the page reads the single
 * `session.chainId` directly instead of flattening per-permission
 * `chains` arrays.
 */
export function parseSessionParams(permissions: SessionPermission[] | undefined): SessionParams {
	const methods: string[] = []
	const events: string[] = []
	for (const p of permissions ?? []) {
		if (p.methods) methods.push(...p.methods)
		if (p.events) events.push(...p.events)
	}
	return {
		methods: [...new Set(methods)],
		events: [...new Set(events)],
	}
}
