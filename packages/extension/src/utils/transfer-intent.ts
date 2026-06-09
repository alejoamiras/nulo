/**
 * F-008 / Phase 7: "do not guess" parser for sendTx call arguments.
 *
 * Pre-fix, the approval popup showed only the method name + contract address
 * for sendTx-like operations. The actual arguments (recipient, amount) were
 * hidden behind a "View JSON" sub-link. Users approved transfers without
 * seeing where the funds were going.
 *
 * This helper recognizes ONLY the documented Nulo / Aztec-standards token
 * transfer signatures. For known transfers it returns a typed intent with
 * `to` + `amount`. For anything else, it returns `{ kind: "unverified" }`
 * — the caller renders an "unverified summary" marker + indexed args
 * fallback rather than guessing semantically.
 *
 * The "do not guess" semantics are critical: a malicious dApp could craft
 * a payload whose method name + arg positions LOOK transfer-like but
 * aren't (codex Round 1 S-2). By matching only the exact known method
 * names + arg arities, the helper refuses to render a precise-but-wrong
 * "To/Amount" summary.
 */

/** Known token-transfer method names — all share `(from, to, amount)` arity. */
const KNOWN_TRANSFER_METHODS = new Set(["transfer_in_private", "transfer_in_public", "transfer_to_private", "transfer_to_public"])

/** Known mint method names that share `(to, amount)` arity. Mints are
 *  inbound transfers from the contract minter's perspective and worth
 *  surfacing as structured. */
const KNOWN_MINT_METHODS = new Set(["mint_to_private", "mint_to_public"])

/** Result of intent extraction. Discriminated on `kind` so the caller's
 *  template renders the right branch without ambiguity. */
export type TransferIntent =
	| { kind: "transfer"; to: string; amount: string }
	| { kind: "mint"; to: string; amount: string }
	| { kind: "unverified" }

/** Shape of a sendTx call. Both Nulo `Action` and Aztec-sdk `WireCall`
 *  expose `name`/`method` and a positional `args` list. */
interface CallLike {
	name?: string
	method?: string
	args?: unknown[]
}

/**
 * Extract a structured intent from a single call. Returns `unverified` if
 * the method name isn't in the known set OR if the arg arity doesn't
 * match the expected signature.
 */
export function parseTransferIntent(call: CallLike | undefined): TransferIntent {
	if (!call) return { kind: "unverified" }
	const name = call.method ?? call.name
	if (typeof name !== "string") return { kind: "unverified" }
	const args = call.args
	if (!Array.isArray(args)) return { kind: "unverified" }

	if (KNOWN_TRANSFER_METHODS.has(name)) {
		// Signature: (from, to, amount). Arity check is strict — refuse to
		// guess if upstream changes the signature.
		if (args.length !== 3) return { kind: "unverified" }
		const to = stringifyArg(args[1])
		const amount = stringifyArg(args[2])
		if (to === undefined || amount === undefined) return { kind: "unverified" }
		return { kind: "transfer", to, amount }
	}

	if (KNOWN_MINT_METHODS.has(name)) {
		// Signature: (to, amount).
		if (args.length !== 2) return { kind: "unverified" }
		const to = stringifyArg(args[0])
		const amount = stringifyArg(args[1])
		if (to === undefined || amount === undefined) return { kind: "unverified" }
		return { kind: "mint", to, amount }
	}

	return { kind: "unverified" }
}

/** Best-effort string projection of a single positional arg. Handles
 *  `AztecAddress`-like objects (via `toString`), `bigint`, `number`, and
 *  plain strings. Returns `undefined` for anything else so the caller
 *  falls through to `unverified`. */
function stringifyArg(arg: unknown): string | undefined {
	if (typeof arg === "string") return arg
	if (typeof arg === "number" || typeof arg === "bigint") return String(arg)
	if (arg && typeof arg === "object" && "toString" in arg && typeof (arg as { toString: unknown }).toString === "function") {
		const s = (arg as { toString: () => string }).toString()
		if (typeof s === "string" && s !== "[object Object]") return s
	}
	return undefined
}
