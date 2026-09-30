import { sanitizeWireString } from "@/wallet/services/dapp-session/capability-meta"
import type { TokenInfo } from "@/wallet/services/token/spec"
import type { TxCall, TxTransfer } from "@/wallet/services/transaction/spec"
import { pickPrimaryIndex } from "./primary-method"
import { isValidDecimals, knownDecimals } from "./token-amount"

export type TxAmount = { units: bigint; decimals: number; symbol: string }

/** The aztec-standards Token's mints, each `(recipient or commitment, amount: u128)`. */
const STANDARD_MINTS: ReadonlySet<string> = new Set(["mint_to_public", "mint_to_private", "mint_to_commitment"])
const U128_BOUND = 2n ** 128n

/** A symbol a contract or a restored record set, fit to show; anything but text shows as none. */
export const displaySymbol = (symbol: unknown): string => sanitizeWireString(typeof symbol === "string" ? symbol : "", 32)

function fromTransfer({ amount, token }: TxTransfer): TxAmount | null {
	if (!isValidDecimals(token?.decimals) || typeof amount !== "string" || !/^\d{1,80}$/.test(amount)) return null
	return { units: BigInt(amount), decimals: token.decimals, symbol: displaySymbol(token.symbol) }
}

function u128(arg: unknown): bigint | null {
	if (typeof arg !== "string" || !/^(?:\d{1,39}|0x[0-9a-fA-F]{1,64})$/.test(arg)) return null
	const units = BigInt(arg)
	return units < U128_BOUND ? units : null
}

/**
 * The amount a settled transaction record states, or null when the wallet cannot state it
 * exactly: a transfer from its own record, a standard mint from the listed token it names.
 */
export function txAmount(
	calls: readonly TxCall[] | undefined,
	tokens: readonly Pick<TokenInfo, "contract" | "decimals" | "symbol" | "hasDecimals">[],
): TxAmount | null {
	if (!calls?.length) return null
	const primary = calls[pickPrimaryIndex(calls) ?? 0]
	const transfer = primary.transfers?.[0]
	if (transfer) return fromTransfer(transfer)
	if (!STANDARD_MINTS.has(primary.method) || primary.args?.length !== 2) return null
	// With a second mint in the transaction the wallet cannot say which amount is the person's.
	if (calls.some((c) => c !== primary && STANDARD_MINTS.has(c.method))) return null
	const token = tokens.find((t) => t.contract === primary.contract)
	const decimals = knownDecimals(token)
	const units = u128(primary.args[1])
	if (!token || decimals === null || units === null) return null
	return { units, decimals, symbol: displaySymbol(token.symbol) }
}
