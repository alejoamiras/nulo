/**
 * What the approval window asks the wallet to decode for display: an operation's calls in the shape
 * the decoder reads, and the bookkeeping that keeps one decode per discovered authorization.
 */

import type { DecodedCall, DiscoveredAuthwit, DisplayCallInput } from "@/wallet/services/execution/client"
import type { DraftUIOperation } from "./types"

type WireCall = { to?: unknown; name?: unknown; selector?: unknown; args?: unknown }

const asText = (v: unknown): string | undefined => (typeof v === "string" ? v : v === undefined || v === null ? undefined : String(v))

const toDisplayCall = (call: WireCall): DisplayCallInput => ({
	to: asText(call.to) ?? "",
	name: asText(call.name),
	selector: asText(call.selector),
	args: Array.isArray(call.args) ? call.args.map((a) => asText(a) ?? "") : [],
})

/** The calls an operation carries that the card renders argument by argument: an `aztec_sendTx`'s
 *  execution calls, or the single call of an `aztec_createAuthWit` call intent. Empty for kinds whose
 *  card shows no arguments. */
export function displayCallsOf(op: DraftUIOperation): DisplayCallInput[] {
	if (op.kind === "aztec_sendTx") return ((op.exec?.calls ?? []) as WireCall[]).map(toDisplayCall)
	if (op.kind === "aztec_createAuthWit") {
		const intent = op.messageHashOrIntent as { call?: WireCall }
		return intent.call ? [toDisplayCall(intent.call)] : []
	}
	return []
}

/** The decoder itself was unreachable: every call reads as undecoded for that reason, so the card
 *  falls back to raw fields instead of waiting forever. */
export const undecodedAll = (count: number): DecodedCall[] =>
	Array.from({ length: count }, () => ({ kind: "undecoded", reason: "unavailable" }))

/** A discovered authorization decodes on its consumer contract by selector; only records not yet
 *  decoded or in flight are returned, so a re-estimate never re-decodes the same authorization. */
export function pendingAuthwitDecodes(
	listed: readonly DiscoveredAuthwit[],
	settled: ReadonlyMap<string, DecodedCall>,
	inFlight: ReadonlySet<string>,
): DiscoveredAuthwit[] {
	const seen = new Set<string>()
	return listed.filter((a) => {
		if (settled.has(a.messageHash) || inFlight.has(a.messageHash) || seen.has(a.messageHash)) return false
		seen.add(a.messageHash)
		return true
	})
}

export const authwitDisplayCall = (a: DiscoveredAuthwit): DisplayCallInput => ({ to: a.consumer, selector: a.selector, args: a.args })
