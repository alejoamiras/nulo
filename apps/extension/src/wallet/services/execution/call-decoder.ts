/**
 * Decodes a dApp call's field arguments against the contract artifact the PXE holds, for the
 * approval card. The registered artifact is the one the transaction executes against, so a decode
 * names parameters with ABI truth; a call that cannot be decoded says why and the card falls back
 * to the raw fields. Display only — nothing decoded here reaches execution.
 */

import { Fr } from "@aztec/foundation/curves/bn254"
import {
	type AbiDecoded,
	type AbiType,
	type ContractArtifact,
	type FunctionAbi,
	countArgumentsSize,
	decodeFromAbi,
	isAztecAddressStruct,
	isEthAddressStruct,
	isFunctionSelectorStruct,
	isOptionStruct,
	isWrappedFieldStruct,
} from "@aztec/stdlib/abi"
import type { DecodedCall, DecodedValue, DisplayCallInput } from "@nulo/wallet-bridge"
import { findFunctionByName, findFunctionBySelector } from "./contract-resolver"

export type ArtifactLookup = (contractAddress: string) => Promise<ContractArtifact | undefined>

/** Arrays past this many items are summarized: the card is a review surface, not a data viewer. */
const MAX_ARRAY_ITEMS = 8
/** A call past this many fields is not something a popup should decode row by row. */
const MAX_ARGS = 256
const FIELD_RE = /^0x[0-9a-fA-F]{1,64}$/
const FIELD_TYPE: AbiType = { kind: "field" }

export async function decodeCallForDisplay(lookup: ArtifactLookup, call: DisplayCallInput): Promise<DecodedCall> {
	const artifact = await lookup(call.to).catch(() => undefined)
	if (!artifact) return { kind: "undecoded", reason: "unknown-contract" }
	const fn = await resolveFunction(artifact, call)
	if (!fn) return { kind: "undecoded", reason: "unknown-function" }
	const fields = toFields(call.args)
	if (!fields || fields.length !== countArgumentsSize(fn)) return { kind: "undecoded", reason: "arguments" }
	try {
		const types = fn.parameters.map((p) => p.type)
		const decoded = decodeFromAbi(types, fields)
		const values = types.length === 1 ? [decoded] : (decoded as AbiDecoded[])
		return {
			kind: "decoded",
			contract: artifact.name,
			fn: fn.name,
			params: fn.parameters.map((p, i) => ({ name: p.name, value: project(values[i], p.type) })),
		}
	} catch {
		return { kind: "undecoded", reason: "arguments" }
	}
}

/** A selector is what the PXE dispatches on, so it is the truth when present; the dApp-supplied name
 *  only stands in when there is no selector to check it against. */
async function resolveFunction(artifact: ContractArtifact, call: DisplayCallInput): Promise<FunctionAbi | undefined> {
	if (call.selector !== undefined) return findFunctionBySelector(artifact, call.selector).catch(() => undefined)
	return call.name !== undefined ? findFunctionByName(artifact, call.name) : undefined
}

function toFields(args: readonly string[]): Fr[] | undefined {
	if (!Array.isArray(args) || args.length > MAX_ARGS) return undefined
	if (!args.every((a) => typeof a === "string" && FIELD_RE.test(a))) return undefined
	try {
		return args.map((a) => Fr.fromString(a))
	} catch {
		return undefined
	}
}

function project(value: AbiDecoded, type: AbiType): DecodedValue {
	if (value === undefined) return { kind: "none" }
	if (type.kind === "struct") return projectStruct(value, type)
	if (type.kind === "array" || type.kind === "tuple") return projectList(value, type)
	if (type.kind === "boolean") return { kind: "boolean", value: value === true }
	if (type.kind === "string") return { kind: "string", value: String(value) }
	if (type.kind === "integer") return { kind: "integer", value: String(value) }
	return { kind: "field", value: fieldString(value) }
}

function projectStruct(value: AbiDecoded, type: Extract<AbiType, { kind: "struct" }>): DecodedValue {
	if (isAztecAddressStruct(type) || isEthAddressStruct(type)) return { kind: "address", value: String(value) }
	if (isFunctionSelectorStruct(type)) return { kind: "selector", value: String(value) }
	if (isWrappedFieldStruct(type)) return { kind: "field", value: fieldString(value) }
	if (isOptionStruct(type)) return project(value, type.fields[1].type)
	const record = (typeof value === "object" && value !== null ? value : {}) as Record<string, AbiDecoded>
	return { kind: "struct", fields: type.fields.map((f) => ({ name: f.name, value: project(record[f.name], f.type) })) }
}

function projectList(value: AbiDecoded, type: Extract<AbiType, { kind: "array" | "tuple" }>): DecodedValue {
	const list = Array.isArray(value) ? value : []
	const typeAt = (i: number): AbiType => (type.kind === "array" ? type.type : (type.fields[i] ?? FIELD_TYPE))
	return {
		kind: "array",
		items: list.slice(0, MAX_ARRAY_ITEMS).map((v, i) => project(v, typeAt(i))),
		hidden: Math.max(0, list.length - MAX_ARRAY_ITEMS),
	}
}

/** A field prints as the 32-byte hex the wire carries, whether the decoder handed back a `bigint` or an `Fr`. */
function fieldString(value: AbiDecoded): string {
	if (typeof value === "bigint") return new Fr(value).toString()
	return String(value)
}
