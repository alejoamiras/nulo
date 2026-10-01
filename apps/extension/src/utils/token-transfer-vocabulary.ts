/**
 * The token-function vocabulary the approval surfaces recognize. Transfers derive from the wallet's
 * own token-function descriptors so a display list can never drift from what the wallet itself calls
 * a transfer. Mints have no descriptor (the wallet never calls one), so the standard token's mint
 * entry points are a hand-written display vocabulary, pinned by the paired test.
 *
 * Imports the descriptor leaf directly: the `token/functions` barrel pulls the runtime (account
 * + PXE code) into every popup bundle that only needs names and arities.
 */

import { AUTHWIT_NONCE_NAMES, TOKEN_FN_DESCRIPTORS } from "@/wallet/services/token/functions/descriptors"
import type { TokenFnKind } from "@/wallet/services/token/functions/types"

export type TransferKind = Extract<TokenFnKind, `transfer${string}`>
export type MintKind = "mintPrivate" | "mintPublic"

/** One recognized shape of a token function: its kind and its parameter names in ABI order. */
export interface TransferSignature {
	readonly kind: TransferKind
	readonly params: readonly string[]
}
export interface MintSignature {
	readonly kind: MintKind
	readonly params: readonly string[]
}

const TRANSFER_KINDS: readonly TransferKind[] = ["transferPrivate", "transferPublic", "transferPrivateToPublic", "transferPublicToPrivate"]

export const TRANSFER_LABELS: Readonly<Record<TransferKind, string>> = {
	transferPrivate: "Transfer (private)",
	transferPublic: "Transfer (public)",
	transferPrivateToPublic: "Transfer to public",
	transferPublicToPrivate: "Transfer to private",
}

const buildSignatures = (): ReadonlyMap<string, readonly TransferSignature[]> => {
	const byName = new Map<string, TransferSignature[]>()
	for (const kind of TRANSFER_KINDS) {
		const descriptor = TOKEN_FN_DESCRIPTORS[kind]
		for (const name of descriptor.defaultNames) {
			for (const variant of descriptor.variants) {
				const params = descriptor.abiBuilder(name, variant.impl).parameters.map((p) => p.name)
				const list = byName.get(name) ?? []
				list.push({ kind, params })
				byName.set(name, list)
			}
		}
	}
	return byName
}

/**
 * Function name → every shape the wallet recognizes under that name. A name carries a LIST
 * because the same name can take two arities (`transfer(to, amount)` and
 * `transfer(from, to, amount, authwit_nonce)`); matching is on `(name, args.length)`.
 */
export const TRANSFER_SIGNATURES: ReadonlyMap<string, readonly TransferSignature[]> = buildSignatures()

/** The signature `name` takes with exactly `arity` arguments, if the wallet recognizes one. */
export const findTransferSignature = (name: string, arity: number): TransferSignature | undefined =>
	TRANSFER_SIGNATURES.get(name)?.find((s) => s.params.length === arity)

/** The display label for a recognized transfer name, `null` for anything else. */
export const transferLabel = (name: string): string | null => {
	const signatures = TRANSFER_SIGNATURES.get(name)
	return signatures?.length ? TRANSFER_LABELS[signatures[0].kind] : null
}

/** The standard token's mint entry points, both `(to, amount)`. */
const MINT_PARAMS: readonly string[] = ["to", "amount"]
export const MINT_SIGNATURES: ReadonlyMap<string, readonly MintSignature[]> = new Map([
	["mint_to_private", [{ kind: "mintPrivate", params: MINT_PARAMS }]],
	["mint_to_public", [{ kind: "mintPublic", params: MINT_PARAMS }]],
])

export const findMintSignature = (name: string, arity: number): MintSignature | undefined =>
	MINT_SIGNATURES.get(name)?.find((s) => s.params.length === arity)

/** Whether an interface's parameter `name` fills the vocabulary's `role`: the same name, or for the
 *  nonce role either of the nonce's names, as the descriptors' predicate accepts them. */
export const abiNameFitsRole = (role: string, name: string): boolean =>
	name === role || (AUTHWIT_NONCE_NAMES.includes(role) && AUTHWIT_NONCE_NAMES.includes(name))

/**
 * The selector each shape dispatches on, keyed `name/arity`: its name over the descriptors' own
 * parameter types (AztecAddress, u128, Field). The selector is what runs, and an interface a dApp
 * registers can put any name on it, so a reading keyed on the decoded name checks it here. Static
 * because hashing needs bb.js, which the popup does not load; a node test recomputes every entry.
 */
export const VOCABULARY_SELECTORS: ReadonlyMap<string, string> = new Map([
	["transfer_private_to_private/2", "0x1851e9ca"],
	["transfer_private_to_private/4", "0xedc09d49"],
	["transfer/2", "0x754fb767"],
	["transfer/4", "0x49b80d25"],
	["transfer_in_private/2", "0xe4e546d1"],
	["transfer_in_private/4", "0xd73354bc"],
	["transfer_public_to_public/4", "0xc47adea0"],
	["transfer_in_public/4", "0x8c9e5472"],
	["transfer_private_to_public/4", "0xaf28c76f"],
	["transfer_to_public/4", "0xe74559c9"],
	["transfer_public_to_private/2", "0xc88a9e82"],
	["transfer_public_to_private/4", "0x32c5dcf8"],
	["transfer_to_private/2", "0x89758b40"],
	["transfer_to_private/4", "0xd3a2b436"],
	["mint_to_private/2", "0xf8f84119"],
	["mint_to_public/2", "0x451b5fae"],
])

/** The selector `name` dispatches on with `arity` arguments, as `FunctionSelector.toString()` prints it. */
export const vocabularySelector = (name: string, arity: number): string | undefined => VOCABULARY_SELECTORS.get(`${name}/${arity}`)
