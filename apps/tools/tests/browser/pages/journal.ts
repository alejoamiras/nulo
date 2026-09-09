/** The app's bridge journal, read from the page's storage: the exact figures a send recorded. */
import { TxHash } from "@aztec/aztec.js/tx"
import type { Page } from "@playwright/test"

export interface JournalDeposit {
	id: string
	direction: string
	intent?: string
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

/** Every deposit record the journal holds, newest last. */
export async function depositRecords(page: Page): Promise<JournalDeposit[]> {
	const raw = await page.evaluate(() => {
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
	return collectDeposits(raw)
}

const isDeposit = (o: Record<string, unknown>): boolean => typeof o.id === "string" && o.direction === "deposit"

/** Deposit records wherever the stored shape nests them (arrays, keyed maps, wrapper objects). */
function collectDeposits(v: unknown, out: JournalDeposit[] = []): JournalDeposit[] {
	if (Array.isArray(v)) {
		for (const x of v) collectDeposits(x, out)
		return out
	}
	if (!v || typeof v !== "object") return out
	const o = v as Record<string, unknown>
	if (isDeposit(o)) out.push(o as unknown as JournalDeposit)
	else for (const x of Object.values(o)) collectDeposits(x, out)
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
