/**
 * `OperationPlanner` — normalizes incoming operation shapes into the
 * concrete objects downstream collaborators consume. Houses three
 * functions previously scattered across `ExecutionService`:
 *
 *   - `buildTransferOperation` — transfer params → `SendTransactionOperation`.
 *     Dispatches on the requested `TransferType` to pick the token's
 *     transfer function, and encodes the call args. Also wallet-lock
 *     guards; preserves the `"Unauthorized"` / `"Transfer type not
 *     supported"` / `"Invalid transfer type"` strings verbatim.
 *   - `processAztecJsPayload` — Aztec.js `ExecutionPayload` (capsules,
 *     auth-witnesses, extra-hashed args, calls) → normalized `Action[]`
 *     + inferred `AccountFeePaymentMethodOptions` + `FeeOptions`. Consumed by
 *     `executeAztecSendTx`, `executeAztecSimulateTx`, `executeAztecProfileTx`.
 *   - `extractPrimaryMethod` — best-effort display label for the task
 *     title (popup UX). Reads the first call in an operation.
 *
 * Method signatures and bodies are preserved byte-for-byte from the
 * original `ExecutionService` implementations. `FeeStrategy`,
 * `TxRequestBuilder`, and `AuthwitDiscoverer` build on top.
 *
 * Dependencies: ProfileService (wallet-lock check) + TokenService
 * (transfer-function lookup). Both injected in the facade's init phase.
 * The auth check stays inside `buildTransferOperation` to preserve the
 * exact ordering today's callers depend on (`estimateTransferFee`
 * currently has NO separate auth check; it relies on this one).
 */

import { AuthWitness } from "@aztec/stdlib/auth-witness"
import { FunctionCall } from "@aztec/stdlib/abi"
import { Capsule, type ExecutionPayload, HashedValues } from "@aztec/stdlib/tx"
import type { InteractionWaitOptions } from "@aztec/aztec.js/contracts"
import type { ProfileOptions, SendOptions, SimulateOptions } from "@aztec/aztec.js/wallet"
import { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import type { ProfileService } from "@/wallet/services/profile/service"
import type { TokenService, Token } from "@/wallet/services/token/service"
import {
	TransferPrivateFn,
	TransferPrivateToPublicFn,
	TransferPublicFn,
	TransferPublicToPrivateFn,
} from "@/wallet/services/token/functions"
import { TransferType } from "@/wallet/services/transaction/spec"
import type { Fn } from "@/wallet/utils/fn"
import type {
	Action,
	AddCapsuleAction,
	AddExtraArgsAction,
	AddPrivateAuthwitAction,
	AztecSendTxOperation,
	EncodedCallAction,
	FeeOptions,
	FeeSettings,
	Operation,
	SendTransactionOperation,
} from "./spec"
import { detectEmbeddedFeePayment } from "./utils/fee-detection"

export class OperationPlanner {
	public constructor(
		private readonly profileService: ProfileService,
		private readonly tokenService: TokenService,
	) {}

	/** Build a `SendTransactionOperation` from a user-supplied transfer
	 *  request. Wallet-lock guarded at the top. Throws
	 *  `"Transfer type not supported"` if the token doesn't expose the
	 *  matching transfer function, or `"Invalid transfer type"` on an
	 *  unknown enum value. */
	public async buildTransferOperation(
		networkId: string,
		accountAddress: string,
		tokenId: number,
		transferType: TransferType,
		recipientAddress: string,
		amount: bigint,
		feeSettings: FeeSettings,
	): Promise<{ op: SendTransactionOperation; token: Token; fn: Fn; args: unknown[] }> {
		const profile = await this.profileService.getActiveProfile()
		if (!profile) {
			throw new Error("Unauthorized")
		}
		const token = await this.tokenService.getTokenRaw(tokenId)

		let fn: Fn
		let args: unknown[]
		switch (transferType) {
			case TransferType.Private: {
				if (!token.transferPrivateFn) {
					throw new Error("Transfer type not supported")
				}
				fn = TransferPrivateFn.new(token.transferPrivateFn.name, token.transferPrivateFn.impl)
				args = (fn as TransferPrivateFn).buildArgs(accountAddress, recipientAddress, amount)
				break
			}
			case TransferType.PrivateToPublic: {
				if (!token.transferPrivateToPublicFn) {
					throw new Error("Transfer type not supported")
				}
				fn = TransferPrivateToPublicFn.new(token.transferPrivateToPublicFn.name, token.transferPrivateToPublicFn.impl)
				args = (fn as TransferPrivateToPublicFn)?.buildArgs(accountAddress, recipientAddress, amount)
				break
			}
			case TransferType.Public: {
				if (!token.transferPublicFn) {
					throw new Error("Transfer type not supported")
				}
				fn = TransferPublicFn.new(token.transferPublicFn.name, token.transferPublicFn.impl)
				args = (fn as TransferPublicFn)?.buildArgs(accountAddress, recipientAddress, amount)
				break
			}
			case TransferType.PublicToPrivate: {
				if (!token.transferPublicToPrivateFn) {
					throw new Error("Transfer type not supported")
				}
				fn = TransferPublicToPrivateFn.new(token.transferPublicToPrivateFn.name, token.transferPublicToPrivateFn.impl)
				args = (fn as TransferPublicToPrivateFn)?.buildArgs(accountAddress, recipientAddress, amount)
				break
			}
			default:
				throw new Error("Invalid transfer type")
		}
		const selector = await fn.getSelector()
		const encodedArgs = fn.encodeArgs(args)

		const op: SendTransactionOperation = {
			kind: "send_transaction",
			networkId,
			accountAddress,
			feeSettings,
			actions: [
				{
					kind: "encoded_call",
					to: token.contract,
					selector: selector.toString(),
					args: encodedArgs.map((x) => x.toString()),
					name: fn.name,
					type: fn.type,
					isStatic: fn.isStatic,
					returnTypes: [],
				},
			],
		}

		return { op, token, fn, args }
	}

	/** Parse an Aztec.js `ExecutionPayload` + call-options into a normalized
	 *  `Action[]` array. Collects capsules, private authwits, extra-hashed
	 *  args, and encoded calls into a flat list. Also infers the fee
	 *  payment method from `feePayer` via `detectEmbeddedFeePayment`. */
	public async processAztecJsPayload(
		exec: ExecutionPayload,
		opts: SimulateOptions | ProfileOptions | SendOptions<InteractionWaitOptions>,
	): Promise<[Action[], AccountFeePaymentMethodOptions, FeeOptions]> {
		const actions: Action[] = []

		for (const _capsule of (exec.capsules ?? []).concat(opts.capsules ?? [])) {
			const capsule = await Capsule.schema.parseAsync(_capsule)
			actions.push({
				kind: "add_capsule",
				contract: capsule.contractAddress.toString(),
				storageSlot: capsule.storageSlot.toString(),
				capsule: capsule.data.map((x) => x.toString()),
				scope: capsule.scope?.toString(),
			} satisfies AddCapsuleAction)
		}

		for (const _authwit of (exec.authWitnesses ?? []).concat(opts.authWitnesses ?? [])) {
			const authwit = await AuthWitness.schema.parseAsync(_authwit)
			actions.push({
				kind: "add_private_authwit",
				content: {
					kind: "message_hash",
					messageHash: authwit.requestHash.toString(),
				},
				authwit: authwit.witness.map((x) => x.toString()),
			} satisfies AddPrivateAuthwitAction)
		}

		for (const _args of exec.extraHashedArgs ?? []) {
			const args = await HashedValues.schema.parseAsync(_args)
			actions.push({
				kind: "add_extra_args",
				args: args.values.map((x) => x.toString()),
			} satisfies AddExtraArgsAction)
		}

		for (const _call of exec.calls ?? []) {
			const call = await FunctionCall.schema.parseAsync(_call)
			actions.push({
				kind: "encoded_call",
				to: call.to.toString(),
				selector: call.selector.toString(),
				args: call.args.map((x) => x.toString()),
				hideMsgSender: call.hideMsgSender,
				name: call.name,
				type: call.type,
				isStatic: call.isStatic,
				returnTypes: call.returnTypes,
			} satisfies EncodedCallAction)
		}

		const maxFeesUpstream = opts.fee?.gasSettings?.maxFeesPerGas
		const maxPriorityFeesUpstream = opts.fee?.gasSettings?.maxPriorityFeesPerGas
		const feeOptions: FeeOptions = {
			embeddedFeePayment: detectEmbeddedFeePayment(exec.feePayer, opts.from),
			gasLimits: opts.fee?.gasSettings?.gasLimits,
			teardownGasLimits: opts.fee?.gasSettings?.teardownGasLimits,
			maxFeesPerGas: maxFeesUpstream
				? { feePerDaGas: maxFeesUpstream.feePerDaGas.toString(), feePerL2Gas: maxFeesUpstream.feePerL2Gas.toString() }
				: undefined,
			// Plumbed through so the standard path's gas settings match
			// what the dApp requested. Previously, this field was dropped
			// here.
			maxPriorityFeesPerGas: maxPriorityFeesUpstream
				? {
						feePerDaGas: maxPriorityFeesUpstream.feePerDaGas.toString(),
						feePerL2Gas: maxPriorityFeesUpstream.feePerL2Gas.toString(),
					}
				: undefined,
			gasPadding: 1,
		}

		const feePaymentMethod =
			feeOptions.embeddedFeePayment === "fjwc"
				? AccountFeePaymentMethodOptions.FEE_JUICE_WITH_CLAIM
				: feeOptions.embeddedFeePayment === "fpc"
					? AccountFeePaymentMethodOptions.EXTERNAL
					: AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE

		return [actions, feePaymentMethod, feeOptions]
	}

	/** Best-effort display label for the task title. Returns the first
	 *  call's method name (for Nulo `send_transaction` shapes) or the
	 *  first call's name/selector (for Aztec.js `aztec_sendTx` shapes).
	 *  Returns undefined for operation kinds that have no "primary" call. */
	public extractPrimaryMethod(operation: Operation): string | undefined {
		if ("actions" in operation && Array.isArray(operation.actions)) {
			const call = operation.actions.find((a) => a.kind === "call" || a.kind === "encoded_call")
			if (call?.kind === "call") return call.method
			if (call?.kind === "encoded_call") return call.name ?? call.selector
		}
		if ("exec" in operation && (operation as AztecSendTxOperation).exec?.calls?.length) {
			const first = (operation as AztecSendTxOperation).exec.calls[0]
			return first.name?.toString() ?? first.selector?.toString()
		}
		return undefined
	}
}
