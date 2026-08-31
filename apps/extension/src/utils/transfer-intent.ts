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
 *  template renders the right branch without ambiguity.
 *
 *  Transfers expose the contract-call `from` arg — distinct from the
 *  wallet-account "From account" label which means "the account
 *  submitting the tx" (often the same, but a malicious dApp can craft
 *  `transfer(other_account, attacker, amount)` to make a user authorize
 *  pulling funds from a non-submitter account they control). Rendering
 *  `from` explicitly forces the user to verify it. */
export type TransferIntent =
	| { kind: "transfer"; from: string; to: string; amount: string }
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
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 16) — refactor when touched, never raise
export function parseTransferIntent(call: CallLike | undefined): TransferIntent {
	if (!call) return { kind: "unverified" }
	const name = call.method ?? call.name
	if (typeof name !== "string") return { kind: "unverified" }
	const args = call.args
	if (!Array.isArray(args)) return { kind: "unverified" }

	if (KNOWN_TRANSFER_METHODS.has(name)) {
		// Signature: (from, to, amount). Strict arity is the "do not guess"
		// defense if upstream extends the signature.
		if (args.length !== 3) return { kind: "unverified" }
		const from = canonicalAddress(args[0])
		const to = canonicalAddress(args[1])
		const amount = canonicalAmount(args[2])
		if (from === undefined || to === undefined || amount === undefined) return { kind: "unverified" }
		return { kind: "transfer", from, to, amount }
	}

	if (KNOWN_MINT_METHODS.has(name)) {
		// Signature: (to, amount).
		if (args.length !== 2) return { kind: "unverified" }
		const to = canonicalAddress(args[0])
		const amount = canonicalAmount(args[1])
		if (to === undefined || amount === undefined) return { kind: "unverified" }
		return { kind: "mint", to, amount }
	}

	return { kind: "unverified" }
}

/** Canonical 32-byte hex form — what an Aztec address serializes to.
 *  Accepts `0x` + exactly 64 hex chars. */
const HEX_ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/

/** Canonical numeric form — pure decimal or `0x`-prefixed hex (no `e`,
 *  no leading whitespace, no Unicode digit lookalikes, no `toString`
 *  trickery returning attacker-controlled text). */
const CANONICAL_NUMBER_RE = /^(0x[0-9a-fA-F]+|\d+)$/

/** Address projection. Accepts a plain string in canonical hex form
 *  OR an `AztecAddress`-like object whose `toString()` returns that
 *  same canonical hex. Rejects anything else — including custom
 *  `toString()` returning UI text — so attacker-controlled objects
 *  cannot inject arbitrary characters into the structured render. */
function canonicalAddress(arg: unknown): string | undefined {
	const projected = projectToString(arg)
	if (projected === undefined) return undefined
	return HEX_ADDRESS_RE.test(projected) ? projected : undefined
}

/** Amount projection. Accepts string / number / bigint / `Fr`/`U128`-like
 *  objects whose `toString()` returns a canonical numeric form. Rejects
 *  custom `toString()` returning attacker-controlled text. */
function canonicalAmount(arg: unknown): string | undefined {
	if (typeof arg === "number" && Number.isFinite(arg)) return String(arg)
	if (typeof arg === "bigint") return arg.toString()
	const projected = projectToString(arg)
	if (projected === undefined) return undefined
	return CANONICAL_NUMBER_RE.test(projected) ? projected : undefined
}

/** Pulls a string out of `arg` without trusting attacker-defined
 *  `toString()`. Plain strings pass through. Other shapes go through
 *  `Object.prototype.toString.call(arg)` semantics implicitly via
 *  `String()` — but we ALSO require the original object to expose its
 *  OWN `toString` (rejecting `[object Object]` shaped output). */
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
