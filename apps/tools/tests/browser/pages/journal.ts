/** The app's bridge journal, read from the page's storage: the exact figures a send recorded. */
import { TxHash } from "@aztec/aztec.js/tx"
import type { Page } from "@playwright/test"

export interface JournalDeposit {
	id: string
	direction: string
	intent?: string
	/** The token leg's base units — what a token+gas send delivers as the token, the whole amount otherwise. */
	amount?: string
	depositTxHash?: string
	claimTxHash?: string
	registerTxHash?: string
	fuel?: { received?: string; claimTxHash?: string }
	/** The token block the send read back from the factory — what the harness derives the L2 token from. */
	token?: {
		erc20: string
		portal: string
		l2Token: string
		nameWord: string
		symbolWord: string
		decimals: number
		displaySymbol: string
	}
}

export interface JournalExit {
	id: string
	direction: string
	exitTxHash?: string
	consumeTxHash?: string
}

/** Every exit record the journal holds, newest last. */
export async function exitRecords(page: Page): Promise<JournalExit[]> {
	return collect(await readJournal(page), "withdraw") as unknown as JournalExit[]
}

/** Every deposit record the journal holds, newest last. */
export async function depositRecords(page: Page): Promise<JournalDeposit[]> {
	return collect(await readJournal(page), "deposit") as unknown as JournalDeposit[]
}

async function readJournal(page: Page): Promise<unknown[]> {
	return page.evaluate(() => {
		const out: unknown[] = []
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i)
			if (!key?.startsWith("nulo-bridge:journal")) continue
			try {
				out.push(JSON.parse(localStorage.getItem(key) ?? "null"))
			} catch {}
		}
		return out
	})
}

/** Records of one direction wherever the stored shape nests them (arrays, keyed maps, wrapper objects). */
function collect(v: unknown, direction: string, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
	if (Array.isArray(v)) {
		for (const x of v) collect(x, direction, out)
		return out
	}
	if (!v || typeof v !== "object") return out
	const o = v as Record<string, unknown>
	if (typeof o.id === "string" && o.direction === direction) out.push(o)
	else for (const x of Object.values(o)) collect(x, direction, out)
	return out
}

type NodeLike = { getTxReceipt: (hash: TxHash) => Promise<{ transactionFee?: bigint }> }

/** What a landed L2 transaction billed, from the node's receipt. */
export async function transactionFeeOf(node: unknown, txHash: string): Promise<bigint> {
	const receipt = await (node as NodeLike).getTxReceipt(TxHash.fromString(txHash))
	if (receipt.transactionFee === undefined) throw new Error(`no transactionFee on the receipt of ${txHash}`)
	return receipt.transactionFee
}

/** The fuel a deposit's event recorded and the fee its claim billed — the two sides of conservation. */
export async function fuelConservation(page: Page, node: unknown): Promise<{ received: bigint; fee: bigint }> {
	const records = await depositRecords(page)
	const rec = records.at(-1)
	if (!rec) throw new Error("the journal holds no deposit")
	const received = rec.fuel?.received
	const claim = rec.fuel?.claimTxHash ?? rec.claimTxHash
	if (received === undefined || !claim)
		throw new Error(`the deposit ${rec.id} has no fuel figures (received ${received}, claim ${claim})`)
	return { received: BigInt(received), fee: await transactionFeeOf(node, claim) }
}
