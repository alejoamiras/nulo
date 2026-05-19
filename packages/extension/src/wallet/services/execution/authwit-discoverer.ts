/**
 * `AuthwitDiscoverer` — owns the authwit-related logic that would
 * otherwise be tangled inside `ExecutionService`:
 *
 *   - `discoverPrivateAuthwits` — runs a `SKIP_TX_VALIDATION` simulation
 *     and turns the resulting `CallAuthorizationRequest` offchain
 *     effects into `AddPrivateAuthwitAction` entries the caller splices
 *     into the operation's action list.
 *   - `computeCallMessageHash` / `computeEncodedCallMessageHash` /
 *     `computeIntentMessageHash` — the three authwit message-hash
 *     helpers called by `buildTxRequest` when adding public/private
 *     authwits to the action list. Pure functions of
 *     `content + nodeInfo + pre-resolved instances/artifacts` maps.
 *
 * `discoverPrivateAuthwits` takes `buildTxRequest` as a callback rather
 * than depending on `TxRequestBuilder` directly, because callers may
 * choose between the legacy facade `buildTxRequest` and
 * `TxRequestBuilder.buildStandard` without changing this discoverer's
 * signature.
 *
 * `AuthwitDiscoverer` does NOT write to the auth registry — it only
 * computes hashes and emits action shapes. `trackAuthwit` (registry
 * write) lives at the call site for now; moving it to after-send
 * requires the executor coordinator to own that flush point.
 */

import { Fr } from "@aztec/foundation/curves/bn254"
import { AbiTypeSchema, FunctionSelector, type FunctionType, type FunctionAbi, FunctionCall, encodeArguments } from "@aztec/stdlib/abi"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { computeAuthWitMessageHash, CallAuthorizationRequest, computeInnerAuthWitHash } from "@aztec/aztec.js/authorization"
import type { ContractArtifact } from "@aztec/stdlib/abi"
import type { NodeInfo, ContractInstanceWithAddress } from "@aztec/stdlib/contract"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { collectOffchainEffects, type TxExecutionRequest } from "@aztec/stdlib/tx"
import z from "zod"
import type { ILogger } from "@/wallet/logger"
import { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import type { IAccountContract } from "@nulo/aztec-runtime/account"
import type { IPXE } from "@nulo/aztec-runtime/pxe"
import type { Action, AddPrivateAuthwitAction, CallAuthwitContent, EncodedCallAuthwitContent, IntentAuthwitContent } from "./spec"

/** Minimal build-context the discoverer needs from `buildTxRequest`.
 *  Callers produce this by calling either the facade's legacy
 *  `buildTxRequest` method or `TxRequestBuilder.buildStandard`. */
export type DiscoverContext = {
	txRequest: TxExecutionRequest
	node: AztecNode
	pxe: IPXE
	account: IAccountContract
}

/** Callback provided by the caller so the discoverer can run its
 *  kernelless simulation without reaching into facade state. */
export type BuildTxRequestFn = (
	op: { networkId: string; accountAddress: string; actions: Action[] },
	paymentMethod: AccountFeePaymentMethodOptions,
) => Promise<DiscoverContext>

export class AuthwitDiscoverer {
	public constructor(readonly _logger: ILogger) {}

	/** Runs a simulation with `skipTxValidation: true` + `skipFeeEnforcement: true`
	 *  and `scopes: [account.address]`, inspects the `privateExecutionResult`'s
	 *  offchain effects for `CallAuthorizationRequest`s, and emits one
	 *  `AddPrivateAuthwitAction { kind: "message_hash" }` per authorization
	 *  the tx proved it needs. Mirrors service.ts:1446-1486 byte-for-byte. */
	public async discoverPrivateAuthwits(
		op: { networkId: string; accountAddress: string; actions: Action[] },
		buildTxRequest: BuildTxRequestFn,
	): Promise<AddPrivateAuthwitAction[]> {
		const { txRequest, node, pxe, account } = await buildTxRequest(op, AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE)

		// Kernelless simulation: stub the caller's account contract so its
		// `verify_private_authwit` returns true unconditionally. Otherwise any
		// tx that requires an authwit (e.g., an AMM swap where the Token
		// transfer macro emits a CallAuthorizationRequest) aborts the
		// simulation inside SchnorrAccount.verify_private_authwit — the
		// offchain effects never reach us and discovery can't produce any
		// authwit actions. `SimulatedSchnorrAccountContractArtifact`
		// (bundled by @aztec/noir-contracts.js) is the canonical stub;
		// PxeService.simulateTx wraps it into a `SimulationOverrides` when
		// `stubAccountAddresses` is passed. Mirrors the demo-wallet's
		// kernelless-sim pattern.
		const simulationResult = await pxe.simulateTx(
			txRequest,
			{
				simulatePublic: true,
				skipTxValidation: true,
				skipFeeEnforcement: true,
				scopes: [account.address],
			},
			[account.address.toString()],
		)

		const effects = collectOffchainEffects(simulationResult.privateExecutionResult)
		if (!effects.length) {
			return []
		}

		const nodeInfo = await node.getNodeInfo()
		const chainInfo = { chainId: new Fr(nodeInfo.l1ChainId), version: new Fr(nodeInfo.rollupVersion) }
		const actions: AddPrivateAuthwitAction[] = []

		for (const effect of effects) {
			try {
				const authRequest = await CallAuthorizationRequest.fromFields(effect.data)
				const messageHash = await computeAuthWitMessageHash(
					{ consumer: effect.contractAddress, innerHash: authRequest.innerHash },
					chainInfo,
				)
				actions.push({
					kind: "add_private_authwit",
					content: { kind: "message_hash", messageHash: messageHash.toString() },
				})
			} catch {
				// Effect is not a CallAuthorizationRequest — skip.
			}
		}

		return actions
	}

	/** Compute the authwit message hash for a `call`-kind content.
	 *  Resolves the function from the pre-fetched artifact by name;
	 *  throws `"Contract not found"` / `"Contract artifact not found"`
	 *  / `"Method not found"` — call-site-verbatim from service.ts:2060-2099. */
	public async computeCallMessageHash(
		content: CallAuthwitContent,
		nodeInfo: NodeInfo,
		instances: Map<string, ContractInstanceWithAddress>,
		artifacts: Map<string, ContractArtifact>,
	): Promise<Fr> {
		const instance = instances.get(content.contract)
		if (!instance) {
			throw new Error("Contract not found")
		}
		const artifact = artifacts.get(instance.currentContractClassId.toString())
		if (!artifact) {
			throw new Error("Contract artifact not found")
		}
		const fn =
			artifact.functions.find((x) => x.name === content.method) ??
			artifact.nonDispatchPublicFunctions.find((x) => x.name === content.method)
		if (!fn) {
			throw new Error("Method not found")
		}
		return await computeAuthWitMessageHash(
			{
				caller: AztecAddress.fromString(content.caller),
				call: new FunctionCall(
					fn.name,
					AztecAddress.fromString(content.contract),
					await FunctionSelector.fromNameAndParameters(fn.name, fn.parameters),
					fn.functionType,
					content.hideSender === true,
					fn.isStatic,
					encodeArguments(fn, content.args),
					fn.returnTypes,
				),
			},
			{
				chainId: new Fr(nodeInfo.l1ChainId),
				version: new Fr(nodeInfo.rollupVersion),
			},
		)
	}

	/** Compute the authwit message hash for an `encoded_call`-kind content.
	 *  If content lacks `name/type/isStatic/returnTypes`, reads them from
	 *  the artifact by matching `FunctionSelector.fromNameAndParameters`
	 *  against `content.selector` — backfills missing fields on `content`
	 *  (mutating — preserved from today's service.ts:2101-2165 behavior). */
	public async computeEncodedCallMessageHash(
		content: EncodedCallAuthwitContent,
		nodeInfo: NodeInfo,
		instances: Map<string, ContractInstanceWithAddress>,
		artifacts: Map<string, ContractArtifact>,
	): Promise<Fr> {
		if (
			content.name === undefined ||
			content.type === undefined ||
			content.isStatic === undefined ||
			content.returnTypes === undefined
		) {
			const instance = instances.get(content.to)
			if (!instance) {
				throw new Error("Contract not found")
			}
			const artifact = artifacts.get(instance.currentContractClassId.toString())
			if (!artifact) {
				throw new Error("Contract artifact not found")
			}
			let fn: FunctionAbi | undefined
			for (const _fn of artifact.functions) {
				const selector = await FunctionSelector.fromNameAndParameters(_fn.name, _fn.parameters)
				if (selector.toString() === content.selector) {
					fn = _fn
					break
				}
			}
			if (!fn) {
				for (const _fn of artifact.nonDispatchPublicFunctions) {
					const selector = await FunctionSelector.fromNameAndParameters(_fn.name, _fn.parameters)
					if (selector.toString() === content.selector) {
						fn = _fn
						break
					}
				}
			}
			if (!fn) {
				throw new Error("Method not found")
			}
			content.name = fn.name
			content.type = fn.functionType
			content.isStatic = fn.isStatic
			content.returnTypes = fn.returnTypes
		}
		return await computeAuthWitMessageHash(
			{
				caller: AztecAddress.fromString(content.caller),
				call: new FunctionCall(
					content.name,
					AztecAddress.fromString(content.to),
					FunctionSelector.fromString(content.selector),
					content.type as FunctionType,
					content.hideMsgSender === true,
					content.isStatic,
					content.args.map((x) => Fr.fromString(x)),
					await z.array(AbiTypeSchema).parseAsync(content.returnTypes),
				),
			},
			{
				chainId: new Fr(nodeInfo.l1ChainId),
				version: new Fr(nodeInfo.rollupVersion),
			},
		)
	}

	/** Compute the authwit message hash for an `intent`-kind content. */
	public async computeIntentMessageHash(content: IntentAuthwitContent, nodeInfo: NodeInfo): Promise<Fr> {
		return await computeAuthWitMessageHash(
			{
				consumer: AztecAddress.fromString(content.consumer),
				innerHash: await computeInnerAuthWitHash(content.intent.map((x) => Fr.fromString(x))),
			},
			{
				chainId: new Fr(nodeInfo.l1ChainId),
				version: new Fr(nodeInfo.rollupVersion),
			},
		)
	}
}
