/**
 * The wizard's shared vocabulary: what a token is at each stage of selection, what a send is once
 * the user has chosen, and the outcomes the grant and route steps can produce. Every composable
 * and every step component speaks these types; none of them re-declares a token shape of its own.
 */
import type { FuelRoute, Registration, TokenState } from "@nulo/bridge-core"
import type { Address, Hex } from "viem"

export type Direction = "l1-to-l2" | "l2-to-l1"

/** What the user wants out of a deposit: the token, the token plus gas, or gas alone. */
export type SendIntent = "token" | "token+gas" | "gas"

export type TokenSource = "manifest" | "list" | "pasted"

/** A token the wizard can act on before anything is read from the chain. */
export interface SelectableToken {
	chainId: number
	/** Lowercase. */
	address: Address
	symbol: string
	name: string
	decimals: number
	source: TokenSource
	/** `${chainId}:${address}` — the committed sprite is keyed by identity, never by symbol. */
	logoKey: string
}

/** What the amount step needs to render a field: the catalog row has it before the chain is read. */
export type AmountToken = Pick<SelectableToken, "symbol" | "decimals">

/** The shape `SelectableToken.logoKey` carries: the committed sprite is keyed by identity, never by symbol. */
export const logoKeyOf = (chainId: number, address: string): string => `${chainId}:${address}`

/** The L1-attested words the hub derives the L2 token from. */
export interface TokenWords {
	nameWord: Hex
	symbolWord: Hex
}

/** What a token says its identity is, from one source. */
export interface TokenIdentity {
	symbol: string
	name: string
	decimals: number
}

/** A listed identity the token contract itself contradicts. Set only when the two disagree; the
 *  resolved token then carries the LIVE values and the review names the disagreement. */
export interface MetadataConflict {
	listed: TokenIdentity
	live: TokenIdentity
}

/**
 * A selected token with everything the review and the send need. For a first-time token the
 * words and `l2Token` are a PREVIEW from sanitized live metadata; the receipt re-reads the
 * factory's frozen registration and the journal carries that, never this.
 */
export interface ResolvedToken extends SelectableToken {
	state: TokenState
	portal: Address
	words: TokenWords
	l2Token: Hex
	registration?: Registration
	metadataConflict?: MetadataConflict
}

export interface TokenBalances {
	l1?: bigint
	l2Public?: bigint
	l2Private?: bigint
}

/**
 * - `declined`: the wallet answered and the token is not in the grant.
 * - `stale`: the selection moved on while the wallet was deciding.
 * - `busy`: the wallet never saw the request — another flow owned it. Nothing was refused.
 */
export type GrantOutcome = "granted" | "declined" | "stale" | "busy"

export interface GasLegPlan {
	fuelAmount: bigint
	fuelFj: bigint
	/** What the probe says `fuelAmount` buys — display + floor input, never the claim amount. */
	quote: bigint
	minFuelOutput: bigint
	route: FuelRoute
	capped: "min" | "half" | null
}

/** Everything "Sign & send" acts on. */
export interface SendPlan {
	direction: "l1-to-l2"
	intent: SendIntent
	token: ResolvedToken
	amount: bigint
	isPrivate: boolean
	gas?: GasLegPlan
}

export interface ExitPlan {
	direction: "l2-to-l1"
	token: ResolvedToken
	amount: bigint
	isPrivate: boolean
	recipientL1: Address
}
