import type { LocalTxOrigin } from "@nulo/wallet-bridge"
import { z } from "zod"
import type { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"

/** `OriginType`, `TxOrigin`, and `LocalTxOrigin` live in
 *  `@nulo/wallet-bridge`. Re-exported here so extension call sites can
 *  import them from `@/wallet/services/transaction/service` / `/spec`. */
export { OriginType } from "@nulo/wallet-bridge"
export type { TxOrigin, LocalTxOrigin } from "@nulo/wallet-bridge"

export const TRANSACTION_SERVICE_NAME = "transaction"

/** Block inclusion/finalization status. */
export enum TxStatus {
	Pending,
	Dropped,
	Proposed,
	Checkpointed,
	Proven,
	Finalized,
}

/** Execution result — only meaningful when tx is in a block. */
export enum TxExecutionResult {
	Success,
	AppLogicReverted,
	TeardownReverted,
	BothReverted,
}

/** Full transaction call from UI/DApp interaction. */
export type TxCall = {
	/** Contract address. */
	contract: string
	/** Function name. */
	method: string
	/** Arguments. */
	args: unknown[]
	/** Additional information telling whether the call produces token transfers. */
	transfers?: TxTransfer[]
}

export enum TransferType {
	Private,
	PrivateToPublic,
	Public,
	PublicToPrivate,
}

export type TransferToken = {
	name: string
	symbol: string
	decimals: number
}

export type TxTransfer = {
	/** Token info. */
	token: TransferToken
	/** Transfer type. */
	type: TransferType
	/** Sender. */
	from: string
	/** Recipient. */
	to: string
	/** Amount. */
	amount: string
}

export type TxBlock = {
	/** Block hash. */
	hash: string
	/** Block number/level/height. */
	number: number
}

/** Gas breakdown captured at submission time from finalized GasSettings. */
export type TxGasDetails = {
	/** L2 gas limit (app logic). */
	l2GasLimit: number
	/** DA gas limit (app logic). */
	daGasLimit: number
	/** L2 gas limit (teardown/fee payment). */
	teardownL2GasLimit: number
	/** DA gas limit (teardown/fee payment). */
	teardownDaGasLimit: number
	/** Fee per L2 gas unit (raw bigint as string). */
	feePerL2Gas: string
	/** Fee per DA gas unit (raw bigint as string). */
	feePerDaGas: string
}

/** Transaction from UI or DApp interaction (has full call details). */
export type Tx = {
	/** Chain id. */
	chainId: number
	/** Sender address. */
	account: string
	/** Nonce. */
	nonce: string
	/** Fee payment method. */
	feePaymentMethod: AccountFeePaymentMethodOptions
	/** Transaction hash. */
	hash: string
	/** Creation time. */
	createdAt: number
	/** Update time. */
	updatedAt: number
	/** Transaction status. */
	status: TxStatus
	/** Execution result (success/revert info). */
	executionResult?: TxExecutionResult
	/** Block in which the transaction is included. */
	block?: TxBlock
	/** Fee paid (set from receipt after confirmation). */
	fee?: string
	/** Estimated fee from gas settings (set at submission time). */
	estimatedFee?: string
	/** Gas breakdown from finalized gas settings (set at submission time). */
	gasDetails?: TxGasDetails
	/** Error message, if some. */
	error?: string
	/**
	 * RPC URL of the endpoint this tx was submitted through. Captured at
	 * `addTransaction` time so receipt polling stays bound to the original
	 * endpoint even after the user swaps the network's primary endpoint.
	 * Optional for forward-compat with older records (wiped by the v3
	 * storage migration anyway).
	 */
	submittedEndpointUrl?: string
	origin: LocalTxOrigin
	calls: TxCall[]
}

/** Tolerant-deep sub-schema: validates only the fields consumers BRANCH on
 *  (contract/method/args + transfer from/to for balance-refresh targeting);
 *  `z.custom` passes the value through VERBATIM, so display-only fields
 *  (token, type, amount, …) are never stripped by the codec. */
const TxCallRowSchema = z.custom<TxCall>((v) => {
	const c = v as TxCall
	if (typeof c !== "object" || c === null) return false
	if (typeof c.contract !== "string" || typeof c.method !== "string" || !Array.isArray(c.args)) return false
	if (c.transfers === undefined) return true
	return Array.isArray(c.transfers) && c.transfers.every((t) => typeof t?.from === "string" && typeof t?.to === "string")
})

const tolerantObject = (v: unknown) => typeof v === "object" && v !== null

/** Storage codec row schema — exact on the flat/branched fields; tolerant
 *  (object-shaped, passed through verbatim) on the deep display payloads
 *  (`feePaymentMethod` is an `@aztec/entrypoints` union — see UPDATE.md;
 *  `origin` is a wallet-bridge union; results/gas are render-only). */
export const TxSchema: z.ZodType<Tx> = z.object({
	chainId: z.number(),
	account: z.string(),
	nonce: z.string(),
	// AccountFeePaymentMethodOptions is a NUMERIC enum in @aztec/entrypoints —
	// rows store 0|1|2. Number-shaped (not nativeEnum) so an upstream member
	// addition cannot false-reject stored rows. @aztec-coupled: see UPDATE.md.
	feePaymentMethod: z.custom<AccountFeePaymentMethodOptions>((v) => typeof v === "number"),
	hash: z.string(),
	createdAt: z.number(),
	updatedAt: z.number(),
	status: z.nativeEnum(TxStatus),
	executionResult: z.nativeEnum(TxExecutionResult).optional(),
	block: z.object({ hash: z.string(), number: z.number() }).optional(),
	fee: z.string().optional(),
	estimatedFee: z.string().optional(),
	gasDetails: z.custom<TxGasDetails>(tolerantObject).optional(),
	error: z.string().optional(),
	submittedEndpointUrl: z.string().optional(),
	origin: z.custom<LocalTxOrigin>(tolerantObject),
	calls: z.array(TxCallRowSchema),
})

export type Methods = {
	/**
	 * Returns a list of transactions for a given account.
	 * @param account Account address.
	 */
	getTransactions(account: string): Tx[]

	/**
	 * Returns a transaction with the specified hash.
	 * @param hash Transaction hash.
	 */
	getTransaction(hash: string): Tx
}

export type Events = {
	onTransactionAdded: Tx
	onTransactionUpdated: Tx
	onTransactionDeleted: Tx
}
