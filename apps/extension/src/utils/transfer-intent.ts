/**
 * "Do not guess" reader of a dApp call's arguments for the approval card.
 *
 * A call is a transfer only when its name AND arity match a shape in the wallet's own transfer
 * vocabulary; the recipient, amount, optional sender and optional authwit nonce are then read by
 * ABI parameter name. Everything else is `unverified` and the card renders the raw arguments.
 * A name-plus-arity match is a display vocabulary, not proof of the contract's semantics.
 */

import { findTransferSignature } from "./token-transfer-vocabulary"

export type TransferIntent =
	| {
			kind: "transfer"
			/** Absent for the 2-argument shape, where the sender is the caller of the call. */
			from?: string
			to: string
			amount: string
			/** Present only for the shapes that carry an `authwit_nonce` parameter. */
			nonce?: string
	  }
	| { kind: "unverified" }

/** Shape of a sendTx call. Both Nulo `Action` and Aztec-sdk `WireCall`
 *  expose `name`/`method` and a positional `args` list. */
interface CallLike {
	name?: string
	method?: string
	args?: unknown[]
}

/** A dApp argument reduced to what the card may render: a canonical address, plain text, or nothing. */
export type ProjectedArgument = { kind: "address"; value: string } | { kind: "text"; value: string } | { kind: "opaque" }

export function parseTransferIntent(call: CallLike | undefined): TransferIntent {
	if (!call) return { kind: "unverified" }
	const name = call.method ?? call.name
	if (typeof name !== "string") return { kind: "unverified" }
	const args = call.args
	if (!Array.isArray(args)) return { kind: "unverified" }
	const signature = findTransferSignature(name, args.length)
	if (!signature) return { kind: "unverified" }

	const at = (param: string): unknown => args[signature.params.indexOf(param)]
	const to = canonicalAddress(at("to"))
	const amount = canonicalAmount(at("amount"))
	if (to === undefined || amount === undefined) return { kind: "unverified" }
	const intent: TransferIntent = { kind: "transfer", to, amount }
	if (signature.params.includes("from")) {
		const from = canonicalAddress(at("from"))
		if (from === undefined) return { kind: "unverified" }
		intent.from = from
	}
	if (signature.params.includes("authwit_nonce")) {
		const nonce = canonicalAmount(at("authwit_nonce"))
		if (nonce === undefined) return { kind: "unverified" }
		intent.nonce = nonce
	}
	return intent
}

/** Canonical 32-byte hex form — what an Aztec address serializes to. */
const HEX_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/

/** Canonical numeric form — pure decimal or `0x`-prefixed hex. No exponent, whitespace or Unicode digits. */
const CANONICAL_NUMBER_RE = /^(0x[0-9a-fA-F]+|\d+)$/

/** A canonical address string or an object whose own `toString()` yields one; anything else is refused
 *  so an attacker-defined `toString()` cannot put arbitrary text into a structured row. */
function canonicalAddress(arg: unknown): string | undefined {
	const projected = projectToString(arg)
	if (projected === undefined) return undefined
	return HEX_ADDRESS_RE.test(projected) ? projected : undefined
}

function canonicalAmount(arg: unknown): string | undefined {
	if (typeof arg === "number" && Number.isFinite(arg)) return String(arg)
	if (typeof arg === "bigint") return arg.toString()
	const projected = projectToString(arg)
	if (projected === undefined) return undefined
	return CANONICAL_NUMBER_RE.test(projected) ? projected : undefined
}

/** The projection the raw-argument fallback renders through: the same trust rules as the structured
 *  rows, so a value the structured row would refuse cannot appear verbatim one branch over. */
export function projectArgument(arg: unknown): ProjectedArgument {
	if (typeof arg === "bigint") return { kind: "text", value: arg.toString() }
	const projected = projectToString(arg)
	if (projected === undefined) return { kind: "opaque" }
	return HEX_ADDRESS_RE.test(projected) ? { kind: "address", value: projected } : { kind: "text", value: projected }
}

/** Pulls a string out of `arg`: plain strings pass through, primitives stringify, objects must expose
 *  a `toString()` that returns something other than the default `[object Object]`. */
function projectToString(arg: unknown): string | undefined {
	if (typeof arg === "string") return arg
	if (arg === null || arg === undefined) return undefined
	if (typeof arg !== "object") return String(arg)
	if (!("toString" in arg) || typeof (arg as { toString: unknown }).toString !== "function") return undefined
	const s = (arg as { toString: () => unknown }).toString()
	if (typeof s !== "string") return undefined
	if (s === "[object Object]") return undefined
	return s
}
