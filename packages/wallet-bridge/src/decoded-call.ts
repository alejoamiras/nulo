/**
 * The display-only projection of a contract call the wallet decoded against the artifact its PXE
 * holds. Every leaf is stringified — the record crosses the RPC boundary as JSON — and nothing in it
 * feeds execution: the approval card renders it, the executor never reads it.
 */

/** One decoded value, typed by the ABI so the card can render each kind on its own terms. */
export type DecodedValue =
	| { readonly kind: "address"; readonly value: string }
	| { readonly kind: "integer"; readonly value: string }
	| { readonly kind: "boolean"; readonly value: boolean }
	| { readonly kind: "field"; readonly value: string }
	| { readonly kind: "string"; readonly value: string }
	| { readonly kind: "selector"; readonly value: string }
	| { readonly kind: "none" }
	| { readonly kind: "array"; readonly items: readonly DecodedValue[]; readonly hidden: number }
	| { readonly kind: "struct"; readonly fields: readonly DecodedField[] }

export type DecodedField = { readonly name: string; readonly value: DecodedValue }

export type DecodedParam = { readonly name: string; readonly value: DecodedValue }

export type UndecodedReason = "unknown-contract" | "unknown-function" | "arguments" | "unavailable"

export type DecodedCall =
	| { readonly kind: "decoded"; readonly contract: string; readonly fn: string; readonly params: readonly DecodedParam[] }
	| { readonly kind: "undecoded"; readonly reason: UndecodedReason }

/** A call as the popup hands it to the decoder: the target, the function by selector (ABI truth when
 *  present) or by name, and the arguments as field strings — the `aztec_sendTx` wire shape and the
 *  discovered-authorization record alike. */
export type DisplayCallInput = {
	readonly to: string
	readonly name?: string
	readonly selector?: string
	readonly args: readonly string[]
}
