/**
 * How the approval card reads one call's arguments, in the first shape that applies: the wallet's
 * transfer/mint vocabulary (structured, immediate, only on a contract the wallet registered as a
 * token), the ABI decode the wallet fetched (named parameters, in the contract's own words), or the
 * raw wire fields — 32-byte hex nobody can review, so never the default view.
 */

import type { DecodedCall, DecodedParam, DecodedValue, UndecodedReason } from "@/wallet/services/execution/client"
import type { TokenInfo } from "@/wallet/services/token/client"
import { formatBaseUnits } from "@/utils/amount"
import { trimAddress } from "@/utils/string"
import { humanizeMethodName } from "@/utils/tx-enrichment"
import { parseTransferIntent, projectArgument, smallFieldDecimal } from "@/utils/transfer-intent"
import { safeWire } from "./humanize"

/** Shape of a call on the wire, shared by `aztec_sendTx` execution calls and authwit call intents. */
export type WireCall = { name?: string; to?: unknown; selector?: unknown; args?: unknown; hideMsgSender?: boolean }

/** Who spends in a transfer: the explicit `from` argument, the account contract as `msg_sender` when
 *  the wallet executes from the account, or nobody when the transaction runs through the entrypoint. */
export type TransferSender = { kind: "explicit" | "account"; address: string } | { kind: "none" }

/** One raw field row: trimmed for the eye, the full value on hover, and its decimal when it is small
 *  enough to be a count or an amount rather than a hash. */
export type RawRow = { kind: "field"; short: string; full: string; decimal?: string } | { kind: "text"; value: string } | { kind: "opaque" }
export type RawRows = { rows: RawRow[]; hidden: number }

export type CallSurface =
	| { kind: "transfer"; to: string; amount: string; sender: TransferSender; nonce?: string }
	| { kind: "mint"; to: string; amount: string }
	| { kind: "decoded"; fn: string; params: readonly DecodedParam[] }
	| { kind: "pending" }
	| ({ kind: "raw"; reason: UndecodedReason } & RawRows)

/** The caller a vocabulary reading names when the call itself omits one; absent for an authwit
 *  intent, where the signer is not the caller and the card claims nothing. */
export type CallerContext = { accountAddress: string; noFrom: boolean }

export const wire = (v: unknown, max: number): string => safeWire(v === undefined || v === null ? "" : String(v), max)

/** Raw-field rows are capped: past this the JSON view is the disclosure, not a 200-row card. */
export const MAX_ARG_ROWS = 32

const rawRow = (arg: unknown): RawRow => {
	const p = projectArgument(arg)
	if (p.kind === "field") return { kind: "field", short: trimAddress(p.value, 10, 6), full: p.value, decimal: smallFieldDecimal(p.value) }
	if (p.kind === "text") return { kind: "text", value: safeWire(p.value, 64) }
	return { kind: "opaque" }
}

export const rawRows = (args: unknown): RawRows => {
	const list = Array.isArray(args) ? args : []
	return { rows: list.slice(0, MAX_ARG_ROWS).map(rawRow), hidden: Math.max(0, list.length - MAX_ARG_ROWS) }
}

/** The token the wallet registered at `contract` on `chainId`, if any. */
export const tokenAt = (
	tokens: readonly TokenInfo[] | undefined,
	chainId: number | undefined,
	contract: unknown,
): TokenInfo | undefined => {
	const address = wire(contract, 80).toLowerCase()
	return tokens?.find((t) => t.chainId === chainId && t.contract.toLowerCase() === address)
}

const isZero = (n: string): boolean => /^(0x0+|0)$/.test(n)

const senderOf = (ctx: CallerContext): TransferSender => (ctx.noFrom ? { kind: "none" } : { kind: "account", address: ctx.accountAddress })

const vocabularySurface = (ctx: CallerContext | undefined, call: WireCall): CallSurface | undefined => {
	const intent = parseTransferIntent(call as { name?: string; args?: unknown[] })
	if (intent.kind === "mint") return { kind: "mint", to: intent.to, amount: intent.amount }
	if (intent.kind !== "transfer") return undefined
	// A call that hides its msg_sender executes with a null caller; naming the account there would
	// be a confident lie, so the call falls through to the decode or the raw fields.
	if (intent.from === undefined && (ctx === undefined || call.hideMsgSender === true)) return undefined
	const sender: TransferSender = intent.from !== undefined ? { kind: "explicit", address: intent.from } : senderOf(ctx as CallerContext)
	const nonce = intent.nonce !== undefined && !isZero(intent.nonce) ? { nonce: intent.nonce } : {}
	return { kind: "transfer", to: intent.to, amount: intent.amount, sender, ...nonce }
}

/** `decoded` is `undefined` while the wallet is still decoding. The vocabulary applies only when the
 *  call targets a registered token (`tokenKnown`): a same-named function on any other contract keeps
 *  the contract's own reading, so a `transfer(admin, role)` never renders as a payment. */
export const callSurface = (
	ctx: CallerContext | undefined,
	call: WireCall,
	decoded: DecodedCall | undefined,
	tokenKnown = false,
): CallSurface => {
	const known = tokenKnown ? vocabularySurface(ctx, call) : undefined
	if (known) return known
	if (decoded === undefined) return { kind: "pending" }
	if (decoded.kind === "decoded") return { kind: "decoded", fn: decoded.fn, params: decoded.params }
	return { kind: "raw", reason: decoded.reason, ...rawRows(call.args) }
}

/** The header names the function by its ABI name once decoded, by the dApp's label otherwise. Both are
 *  untrusted strings, and a curated label applies only on the contract it belongs to. */
export const callName = (call: WireCall, surface: CallSurface): string => {
	const name = surface.kind === "decoded" ? safeWire(surface.fn, 64) : wire(call.name ?? call.selector, 64)
	return humanizeMethodName(name, wire(call.to, 80))
}

export type AmountLabel = { text: string; symbol?: string }

/** An amount in the token's own units when the wallet knows the token at `contract`; the raw integer
 *  otherwise — including a token whose symbol sanitizes to nothing, where a scaled number under a
 *  "base units" label would be a lie. */
export const amountLabel = (
	tokens: readonly TokenInfo[] | undefined,
	chainId: number | undefined,
	contract: unknown,
	amount: string,
): AmountLabel => {
	const token = tokenAt(tokens, chainId, contract)
	const symbol = token ? safeWire(token.symbol, 16) : ""
	if (!token || !symbol) return { text: amount }
	return { text: formatBaseUnits(BigInt(amount), token.decimals), symbol }
}

/** A one-line reading of a decoded value; nested shapes are summarized, an address is left to `AddressDisplay`. */
export const valueText = (v: DecodedValue): string => {
	switch (v.kind) {
		case "integer":
		case "selector":
			return v.value
		case "string":
			return safeWire(v.value, 64)
		case "boolean":
			return v.value ? "true" : "false"
		case "field":
			return trimAddress(v.value, 10, 6)
		case "address":
			return trimAddress(v.value)
		case "none":
			return "none"
		case "array":
			return `[${[...v.items.map(valueText), ...(v.hidden ? [`+${v.hidden} more`] : [])].join(", ")}]`
		case "struct":
			return `{ ${v.fields.map((f) => `${safeWire(f.name, 32)}: ${valueText(f.value)}`).join(", ")} }`
	}
}

export const RAW_NOTICE: Readonly<Record<UndecodedReason, string>> = {
	"unknown-contract": "Nulo doesn't have this contract's interface, so it can't read the arguments.",
	"unknown-function": "This function isn't in the interface Nulo has for the contract, so it can't read the arguments.",
	arguments: "The arguments don't fit the contract's interface, so Nulo can't read them.",
	unavailable: "Nulo couldn't read the arguments right now.",
}

export const rawToggleLabel = (count: number, open: boolean): string =>
	open ? "Hide raw values" : `Show ${count} raw value${count === 1 ? "" : "s"}`
