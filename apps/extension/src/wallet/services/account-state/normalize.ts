/**
 * Pure normalizer for the backup `account-state` slice — the ONE trust
 * boundary both consumers share (the import page's connectivity preflight and
 * `AccountStateService.restore`). The slice is attacker-controlled backup
 * content that is deliberately NOT schema'd by the backup registry
 * (non-storage pass-through), so every bound lives here: item/network/child
 * caps, duplicate-network merging, and malformed-entry collapse into
 * fixed-size violation records (never one record per hostile entry).
 */

import type { Restored } from "@/wallet/base"
import type { BackupAccountState, BackupContract, BackupSender } from "./spec"

export const ACCOUNT_STATE_CAPS = {
	maxNetworks: 8,
	maxInputItems: 16,
	maxSendersPerNetwork: 64,
	maxContractsPerNetwork: 32,
	// UTF-16 code units of the serialized slice (not bytes — a cheap, still-hard bound).
	// The slice stores a full contract artifact PER NETWORK, so canonical contracts
	// (HandshakeRegistry, AuthRegistry, PrivateFPC) are duplicated once per network and dominate
	// it — a 3-network profile measured 33.8M of which ~35% was those duplicates, which crossed
	// the old 32MiB bound the moment upstream added HandshakeRegistry to the preloaded set.
	// Two constraints pin this number, and raising it further breaks both:
	//   - It must stay well under MAX_BACKUP_FILE_BYTES (64MiB) and under the ~48MiB of plaintext
	//     a base64-sealed encrypted backup can carry, or the whole-file cap always trips first and
	//     this stops being a bound at all.
	//   - The export-time warning derives from it as 80% of this value, so a larger cap silently
	//     raises the threshold past the payload we actually ship and disables the early signal.
	// 40MiB keeps today's 33.8M above the warning line while leaving ~8M of headroom.
	// Deduplicating or omitting re-registerable canonical contracts is the real fix, but it
	// requires knowing which ones the wallet can always rebuild locally (handshake/auth registry
	// tracking) — deliberately not attempted here.
	maxSliceCodeUnits: 40 * 1024 * 1024,
	maxErrorMessageLength: 200,
} as const

/** Constant skip/violation copy — never derived from slice content. */
export const ACCOUNT_STATE_SKIP_UNREACHABLE = "Skipped — couldn't reach the network"
export const ACCOUNT_STATE_SKIP_WRONG_NETWORK = "Skipped — this endpoint serves a different network"
export const ACCOUNT_STATE_SKIP_DEADLINE = "Skipped — ran out of time reaching the network"

export interface NormalizedAccountStateItem {
	networkId: string
	senders: BackupSender[]
	contracts: BackupContract[]
}

/** Top-level error record in the exact result shape `collectRestoreErrors`
 *  consumes — empty child arrays, the error at item level. */
export interface AccountStateViolationRecord {
	networkId: string
	senders: BackupSender[]
	contracts: BackupContract[]
	restoreError: string
}

export interface NormalizedAccountState {
	items: NormalizedAccountStateItem[]
	violations: AccountStateViolationRecord[]
}

function violation(networkId: string, message: string): AccountStateViolationRecord {
	return { networkId, senders: [], contracts: [], restoreError: message }
}

function isValidSender(entry: unknown): entry is BackupSender {
	return (
		typeof entry === "object" &&
		entry !== null &&
		typeof (entry as { address?: unknown }).address === "string" &&
		(entry as { address: string }).address.length > 0 &&
		(entry as { address: string }).address.length <= 200
	)
}

function isValidContract(entry: unknown): entry is BackupContract {
	if (typeof entry !== "object" || entry === null) return false
	const c = entry as { address?: unknown; instance?: unknown; artifact?: unknown }
	// Deep instance/artifact validation stays PXE's job (it re-validates on
	// registration); presence + address shape is the boundary's concern.
	return typeof c.address === "string" && c.address.length > 0 && c.address.length <= 200 && !!c.instance && !!c.artifact
}

export function truncateErrorMessage(message: string): string {
	return message.length <= ACCOUNT_STATE_CAPS.maxErrorMessageLength
		? message
		: `${message.slice(0, ACCOUNT_STATE_CAPS.maxErrorMessageLength - 1)}…`
}

/**
 * Normalize an untrusted account-state slice: merge duplicate networkIds
 * (so duplicates cannot bypass per-network caps), enforce every cap, and
 * collapse malformed/excess content into bounded violation records.
 */
export function normalizeAccountStateSlice(raw: unknown): NormalizedAccountState {
	if (!Array.isArray(raw)) {
		return { items: [], violations: [violation("(slice)", "malformed account-state slice (not an array)")] }
	}
	if (raw.length === 0) return { items: [], violations: [] }

	let sliceCodeUnits: number
	try {
		sliceCodeUnits = JSON.stringify(raw).length
	} catch {
		return { items: [], violations: [violation("(slice)", "malformed account-state slice (not serializable)")] }
	}
	if (sliceCodeUnits > ACCOUNT_STATE_CAPS.maxSliceCodeUnits) {
		return { items: [], violations: [violation("(slice)", `account-state slice too large (${sliceCodeUnits} code units)`)] }
	}

	const violations: AccountStateViolationRecord[] = []

	const inputItems = raw.slice(0, ACCOUNT_STATE_CAPS.maxInputItems)
	if (raw.length > ACCOUNT_STATE_CAPS.maxInputItems) {
		violations.push(
			violation("(slice)", `${raw.length - ACCOUNT_STATE_CAPS.maxInputItems} account-state item(s) over the cap were dropped`),
		)
	}

	let malformedItems = 0
	let malformedChildren = 0
	const byNetwork = new Map<string, NormalizedAccountStateItem>()
	for (const item of inputItems) {
		const networkId = typeof item === "object" && item !== null ? (item as { networkId?: unknown }).networkId : undefined
		if (typeof networkId !== "string" || networkId.length === 0 || networkId.length > 100) {
			malformedItems++
			continue
		}
		const merged = byNetwork.get(networkId) ?? { networkId, senders: [], contracts: [] }
		const rawSenders = (item as { senders?: unknown }).senders
		const rawContracts = (item as { contracts?: unknown }).contracts
		if (!Array.isArray(rawSenders) || !Array.isArray(rawContracts)) {
			// The old per-item "malformed (not arrays)" record vanished in the
			// collector; it now surfaces as a bounded top-level violation.
			violations.push(violation(networkId, "malformed account-state item (senders/contracts not arrays)"))
		}
		for (const s of Array.isArray(rawSenders) ? rawSenders : []) {
			if (isValidSender(s)) merged.senders.push({ address: s.address })
			else malformedChildren++
		}
		for (const c of Array.isArray(rawContracts) ? rawContracts : []) {
			if (isValidContract(c)) merged.contracts.push({ address: c.address, instance: c.instance, artifact: c.artifact })
			else malformedChildren++
		}
		byNetwork.set(networkId, merged)
	}
	if (malformedItems > 0) violations.push(violation("(slice)", `${malformedItems} malformed account-state item(s) dropped`))
	if (malformedChildren > 0) violations.push(violation("(slice)", `${malformedChildren} malformed sender/contract entries dropped`))

	const items: NormalizedAccountStateItem[] = []
	for (const item of byNetwork.values()) {
		if (items.length >= ACCOUNT_STATE_CAPS.maxNetworks) {
			violations.push(violation(item.networkId, "network over the account-state network cap — its registrations were dropped"))
			continue
		}
		const overSenders = item.senders.length - ACCOUNT_STATE_CAPS.maxSendersPerNetwork
		const overContracts = item.contracts.length - ACCOUNT_STATE_CAPS.maxContractsPerNetwork
		if (overSenders > 0 || overContracts > 0) {
			violations.push(
				violation(
					item.networkId,
					`over the per-network cap: ${Math.max(overSenders, 0)} sender(s) + ${Math.max(overContracts, 0)} contract(s) dropped`,
				),
			)
		}
		items.push({
			networkId: item.networkId,
			senders: item.senders.slice(0, ACCOUNT_STATE_CAPS.maxSendersPerNetwork),
			contracts: item.contracts.slice(0, ACCOUNT_STATE_CAPS.maxContractsPerNetwork),
		})
	}

	return { items, violations }
}

/** Networks (deduped, capped) that carry at least one registrable entry —
 *  the ONLY networks worth a connectivity preflight. */
export function registrableNetworkIds(normalized: NormalizedAccountState): string[] {
	return normalized.items.filter((i) => i.senders.length > 0 || i.contracts.length > 0).map((i) => i.networkId)
}

/** Whether an error's shape indicates the network (not the payload) failed —
 *  the trigger for per-network fail-fast. Conservative on purpose: payload
 *  validation errors must never classify as connectivity. */
export function isConnectivityErrorMessage(message: string): boolean {
	// Bare `timeout`/`refused` stay deliberately broad — narrowing them (e.g. to
	// `timeout after`) lets messages like "RPC timeout" defeat the per-network
	// fail-fast, and the deadline alone would then eat the whole budget.
	return /timed out|timeout|Error fetching from host|Failed to fetch|fetch failed|ECONNREFUSED|refused|ERR_CONNECTION|network error/i.test(
		message,
	)
}

/** The full account-state result shape for a wholly-skipped network. */
export function skippedNetworkRecord(networkId: string, message: string): Restored<BackupAccountState> {
	return { networkId, senders: [], contracts: [], restoreError: message }
}
