/**
 * Canonical, byte-stable fingerprint for a dApp operation's estimate-reuse
 * identity — the input-match gate of `OperationEstimateReuse`.
 *
 * Contract (audit-pinned, plan architecture §2):
 * - Covers the **post-planner, pre-discovery, pre-payload** `Action[]` set;
 *   stash and consume MUST fingerprint the same normalization point.
 * - Explicit exhaustive switch per action kind — a new `Action` kind fails
 *   compilation (`never` guard) instead of silently escaping the hash.
 * - Strict value allowlist for nested `call.args` (`unknown[]`): primitives,
 *   arrays, and plain string-keyed objects only, depth-capped. Anything else
 *   returns `null` = "not fingerprintable" — the caller must treat the op as
 *   reuse-INELIGIBLE (fail-safe: estimate still works, no stash).
 * - Length-prefixed, type-tagged encoding — no `JSON.stringify` (the audit's
 *   banned pattern: recursive key-filter stringify silently dropped nested
 *   fields and let distinct inputs collide).
 * - Binds the FULL normalized `FeeOptions` (incl. `teardownGasLimits` and
 *   `maxPriorityFeesPerGas`) plus `executionMode` and `opts.from`,
 *   alongside the wallet `FeeSettings` hash.
 */

import type { Action, FeeOptions } from "@nulo/wallet-bridge"
import { fingerprintFeeSettings } from "./transfer-estimate-reuse"
import type { FeeSettings } from "./spec"

const MAX_VALUE_DEPTH = 6

/** Type-tagged, length-prefixed scalar/structure encoder. Returns null on any
 *  value outside the allowlist (functions, symbols, class instances, Maps,
 *  cycles-by-depth, …). */
// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 25) — refactor when touched, never raise
function encodeValue(value: unknown, depth: number): string | null {
	if (depth > MAX_VALUE_DEPTH) return null
	if (value === null) return "z"
	if (value === undefined) return "u"
	switch (typeof value) {
		case "string":
			return `s${value.length}:${value}`
		case "number":
			return Number.isFinite(value) ? `n${value}` : null
		case "bigint":
			return `i${value.toString()}`
		case "boolean":
			return value ? "t" : "f"
		case "object": {
			if (Array.isArray(value)) {
				const parts: string[] = []
				for (const item of value) {
					const enc = encodeValue(item, depth + 1)
					if (enc === null) return null
					parts.push(enc)
				}
				return `a${parts.length}[${parts.join(",")}]`
			}
			if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return null
			const keys = Object.keys(value as Record<string, unknown>).sort()
			const parts: string[] = []
			for (const key of keys) {
				const enc = encodeValue((value as Record<string, unknown>)[key], depth + 1)
				if (enc === null) return null
				parts.push(`s${key.length}:${key}=${enc}`)
			}
			return `o${parts.length}{${parts.join(",")}}`
		}
		default:
			return null
	}
}

/** Length-prefixed string — free-form fields MUST go through this (or
 *  `encodeValue`), never raw interpolation: bare `|`-joins let
 *  `{contract:"a|b", method:"c"}` collide with `{contract:"a", method:"b|c"}`.
 *  Today every fingerprinted scalar is planner-normalized hex, but the
 *  encoding must not rely on its inputs staying tame. */
function str(value: string): string {
	return `s${value.length}:${value}`
}

/** Optional string — undefined and "" must not collide. */
function optStr(value: string | undefined): string {
	return value === undefined ? "u" : str(value)
}

function encodeStringArray(values: readonly string[]): string {
	return `a${values.length}[${values.map(str).join(",")}]`
}

/** Exhaustive authwit-content encoder — the inner discriminated union of both authwit kinds. */
function encodeAuthwitContent(content: (Action & { kind: "add_private_authwit" | "add_public_authwit" })["content"]): string | null {
	switch (content.kind) {
		case "call": {
			const args = encodeValue(content.args, 0)
			return args === null
				? null
				: `call(${str(content.caller)}|${str(content.contract)}|${str(content.method)}|${args}|${content.hideSender ?? false})`
		}
		case "encoded_call":
			return `enc(${str(content.caller)}|${str(content.to)}|${str(content.selector)}|${encodeStringArray(content.args)}|${content.hideMsgSender ?? false})`
		case "intent":
			return `intent(${str(content.consumer)}|${encodeStringArray(content.intent)})`
		case "message_hash":
			return `hash(${str(content.messageHash)})`
		default: {
			const _exhaustive: never = content
			void _exhaustive
			return null
		}
	}
}

/** Exhaustive per-kind action encoder. */
function encodeAction(action: Action): string | null {
	switch (action.kind) {
		case "add_capsule":
			return `capsule(${str(action.contract)}|${str(action.storageSlot)}|${encodeStringArray(action.capsule)}|${optStr(action.scope)})`
		case "add_extra_args":
			return `extra(${encodeStringArray(action.args)})`
		case "add_private_authwit":
		case "add_public_authwit": {
			const contentEnc = encodeAuthwitContent(action.content)
			if (contentEnc === null) return null
			const witness = action.kind === "add_private_authwit" && action.authwit ? encodeStringArray(action.authwit) : ""
			return `${action.kind}(${contentEnc}|${witness})`
		}
		case "call": {
			const args = encodeValue(action.args, 0)
			if (args === null) return null
			return `call(${str(action.contract)}|${str(action.method)}|${args}|${action.hideSender ?? false})`
		}
		case "encoded_call":
			return `enc(${str(action.to)}|${str(action.selector)}|${encodeStringArray(action.args)}|${action.hideMsgSender ?? false}|${action.isStatic ?? false})`
		default: {
			const _exhaustive: never = action
			void _exhaustive
			return null
		}
	}
}

function encodeFeeOptions(fee: FeeOptions | undefined): string {
	if (!fee) return "none"
	const limits = (l: { daGas: number; l2Gas: number } | undefined) => (l ? `${l.daGas}:${l.l2Gas}` : "-")
	const fees = (f: { feePerDaGas: number | string; feePerL2Gas: number | string } | undefined) =>
		f ? `${String(f.feePerDaGas)}:${String(f.feePerL2Gas)}` : "-"
	return [
		fee.embeddedFeePayment ?? "-",
		limits(fee.gasLimits),
		limits(fee.teardownGasLimits),
		fees(fee.maxFeesPerGas),
		fees(fee.maxPriorityFeesPerGas),
		fee.gasPadding ?? "-",
	].join("|")
}

export type OperationFingerprintInput = {
	networkId: string
	accountAddress: string
	/** "standard" when the operation carries no explicit mode. */
	executionMode: string
	/** `opts.from` for aztec_sendTx; empty for send_transaction. */
	from: string
	/** Post-planner, pre-discovery, pre-payload action set. */
	actions: readonly Action[]
	fee: FeeOptions | undefined
	feeSettings: FeeSettings
}

/** Null ⇒ not fingerprintable ⇒ the operation is reuse-ineligible. */
export function fingerprintOperation(input: OperationFingerprintInput): string | null {
	const actionParts: string[] = []
	for (const action of input.actions) {
		const enc = encodeAction(action)
		if (enc === null) return null
		actionParts.push(enc)
	}
	return [
		`net=${str(input.networkId)}`,
		`acct=${str(input.accountAddress)}`,
		`mode=${str(input.executionMode)}`,
		`from=${str(input.from)}`,
		`fee=${str(encodeFeeOptions(input.fee))}`,
		`fs=${str(fingerprintFeeSettings(input.feeSettings))}`,
		`actions=${actionParts.length}[${actionParts.join(";")}]`,
	].join("&")
}
