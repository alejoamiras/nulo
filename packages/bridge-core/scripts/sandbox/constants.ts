/** Fixed values of the sandbox network the harness deploys onto. None is a credential. */
import { GasFees } from "@aztec/stdlib/gas"
import { type Address, defineChain, type Hex } from "viem"
import { mnemonicToAccount } from "viem/accounts"
import type { L1Ctx } from "../../src/flows"

export const CHAIN_ID = 31337
export const PERMIT2 = "0x000000000022D473030F116dDEE9F6B43aC78BA3" as Address
export const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11" as Address
export const ZERO_L1 = "0x0000000000000000000000000000000000000000" as Address
/** Stands in for WETH in the route grammar; the sandbox has no V4, so it is never swapped through. */
export const FAKE_WETH = "0x00000000000000000000000000000000000077e7" as Address
/** The mock returns `in × 10^12` FeeJuice-wei, so one whole 6-decimal token buys one whole FeeJuice. */
export const MOCK_RATE_NUM = 10n ** 12n
/** 1 FJ — the floor the app refuses to bridge below. */
export const MIN_FJ = 10n ** 18n
/** The local sequencer prices L2 gas orders of magnitude above the old default; a lower ceiling
 *  rejects every setup tx with "maxFeesPerGas.feePerL2Gas must be >= gasFees". */
export const FEE_CEILING = { maxFeesPerGas: new GasFees(10n ** 13n, 10n ** 13n) }

/** Anvil's default mnemonic. Index 0 deploys and is the relayer's L1 side; every other index is an actor. */
export const ANVIL_MNEMONIC = "test test test test test test test test test test test junk"
export function anvilKey(index: number): Hex {
	const hd = mnemonicToAccount(ANVIL_MNEMONIC, { addressIndex: index }).getHdKey()
	const key = hd.privateKey
	if (!key) throw new Error(`anvil account ${index} has no private key`)
	return `0x${Buffer.from(key).toString("hex")}` as Hex
}
/** Anvil's first two funded keys, as the smoke has always used them. */
export const KEY_0 = anvilKey(0)
export const KEY_1 = anvilKey(1)

export interface TokenSpec {
	name: string
	symbol: string
	decimals: number
}

export const SPECS = {
	usdc: { name: "Nulo USDC", symbol: "USDC", decimals: 6 },
	usdt: { name: "Nulo USDT", symbol: "USDT", decimals: 6 },
	nort: { name: "No Route Token", symbol: "NORT", decimals: 18 },
	pxo: { name: "Portal Only", symbol: "PXO", decimals: 18 },
} satisfies Record<string, TokenSpec>
export type SpecKey = keyof typeof SPECS

export const sandboxChain = (rpcUrl: string) =>
	defineChain({
		id: CHAIN_ID,
		name: "sandbox",
		nativeCurrency: { decimals: 18, name: "Ether", symbol: "ETH" },
		rpcUrls: { default: { http: [rpcUrl] } },
		contracts: { multicall3: { address: MULTICALL3 } },
	})

export const lc = (v: string) => v.toLowerCase() as Address
export const rndNonce = () => BigInt(`0x${crypto.randomUUID().replaceAll("-", "")}`)
/** Read from the CHAIN, never the wall clock: anvil's timestamp runs far ahead of real time here
 *  (every forced block and every sequencer publication advances it), and a wall-clock deadline is
 *  already in this chain's past — Permit2 answers `SignatureExpired`. */
export const deadline = async (l1: L1Ctx): Promise<bigint> => (await l1.pub.getBlock()).timestamp + 3600n
