/**
 * Activity rows written straight into storage, for the specs that measure a row. The smoke build
 * has no sandbox, and none could make a dApp's long title, a nine-digit amount and a priced receipt
 * on demand.
 */
import type { Page } from "puppeteer"
import { getPriceMapEntry } from "@/wallet/services/price/price-map"
import { captureSoleProfileId, getAccountAddress } from "../fixtures/helpers"

/** The contract the price map prices on the Testnet. The V6 line seeds no default token yet, so the
 *  rows borrow the price map's one Testnet row, Alpha V5's cUSD address. */
const PRICED_TOKEN = {
	contract: "0x018d47f656a0d242e28e5d15b5c965f39529bd860f2eaae947527b5094d800f6",
	name: "Compressed USD",
	symbol: "cUSD",
	decimals: 6,
}

/** The active profile, network and account, and a token the price map prices on that chain. */
export type ActivityScope = {
	profileId: string
	networkId: string
	chainId: number
	account: string
	token: { contract: string; name: string; symbol: string; decimals: number }
}

export async function readActivityScope(page: Page): Promise<ActivityScope> {
	const profileId = await captureSoleProfileId(page)
	const account = await getAccountAddress(page)
	const { networkId, chainId } = await page.evaluate(async (pid: string) => {
		const all = await chrome.storage.local.get(null)
		const networkId = all[`nulo:core:active-network@${pid}`] as string
		const network = JSON.parse(all[`nulo:core:networks@${networkId}`] as string) as { chainId: number }
		return { networkId, chainId: network.chainId }
	}, profileId)
	if (!getPriceMapEntry(chainId, PRICED_TOKEN.contract)) throw new Error(`the price map prices no fixture token on chain ${chainId}`)
	return { profileId, networkId, chainId, account, token: PRICED_TOKEN }
}

export type TransferSeed = {
	hash: string
	/** Base units of the scope's token. */
	amount: string
	at?: number
	/** The wire's transfer type: 0 private, 1 private → public, 2 public, 3 public → private. */
	transferType?: number
	/** Sent by a dApp: its name is the row's second chip. */
	dapp?: string
}

/** A finalized transfer under the tx root, with every field the row codec branches on. */
export async function seedTransaction(page: Page, scope: ActivityScope, seed: TransferSeed): Promise<void> {
	const at = seed.at ?? Date.now()
	const { contract, ...token } = scope.token
	const tx = {
		chainId: scope.chainId,
		profileId: scope.profileId,
		networkId: scope.networkId,
		account: scope.account,
		nonce: "0",
		feePaymentMethod: 0,
		hash: seed.hash,
		createdAt: at,
		updatedAt: at,
		status: 5,
		executionResult: 0,
		origin: seed.dapp === undefined ? { type: 0 } : { type: 1, name: seed.dapp },
		calls: [
			{
				contract,
				method: "transfer",
				args: [],
				transfers: [{ token, type: seed.transferType ?? 0, from: scope.account, to: scope.account, amount: seed.amount }],
			},
		],
	}
	await page.evaluate(
		(key: string, row: unknown) => chrome.storage.local.set({ [key]: JSON.stringify(row) }),
		`nulo:core:txs@${seed.hash}`,
		tx,
	)
}

/** The scope's token as a registered row: a receipt shows its amount and quote only through one. */
export async function seedTokenRow(page: Page, scope: ActivityScope, id: number): Promise<void> {
	const row = { id, profileId: scope.profileId, chainId: scope.chainId, ...scope.token }
	await page.evaluate(
		(key: string, value: unknown) => chrome.storage.local.set({ [key]: JSON.stringify(value) }),
		`nulo:core:tokens@${id}`,
		row,
	)
}

export type ReceiptSeed = { tokenId: number; amount: string; nullifier: string; at?: number }

/** A visible note receipt of the registered token. Block 1 keeps it history: it never plays as an arrival. */
export async function seedReceipt(page: Page, scope: ActivityScope, seed: ReceiptSeed): Promise<string> {
	const id = `note:${scope.profileId}|${scope.networkId}|${seed.nullifier}`
	const record = {
		kind: "note",
		id,
		siloedNullifier: seed.nullifier,
		noteHash: `0x${"ab".repeat(32)}`,
		owner: scope.account,
		profileId: scope.profileId,
		networkId: scope.networkId,
		accountAddress: scope.account,
		contract: scope.token.contract,
		tokenId: seed.tokenId,
		amountRaw: seed.amount,
		txHash: `0x${"7c".repeat(32)}`,
		l2BlockNumber: 1,
		txIndexInBlock: 0,
		indexInTx: 0,
		hidden: false,
		discoveredAt: seed.at ?? Date.now(),
	}
	await page.evaluate(
		(key: string, value: unknown) => chrome.storage.local.set({ [key]: JSON.stringify(value) }),
		`nulo:core:incoming-transfers@${id}`,
		record,
	)
	return id
}
