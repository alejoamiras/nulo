/**
 * Pure helper that simulates a batch of view-shaped calls. Extracted from the
 * former `ExecutionService.executeSimulateViews` so it can be unit-tested in
 * isolation and called directly by internal consumers (balance projector,
 * gas-balance read) without going through the operation-dispatch path.
 *
 * The historical Nulo-custom `simulate_views` op kind was retired in this
 * PR — this helper is the structurally-equivalent replacement.
 *
 * ## Behavior-parity invariants (preserved verbatim from the pre-extraction code)
 *
 *   - UTILITY-typed calls are LAUNCHED EAGERLY (live promise pushed into the
 *     queue) and AWAITED SERIALLY only after the tx-typed batch completes.
 *     This preserves the original concurrency profile: simulateTx and
 *     executeUtility run in parallel kernel-side.
 *   - PUBLIC/PRIVATE tx-typed calls are bundled into ONE `ExecutionPayload`
 *     and sent through `pxe.simulateTx` once.
 *   - `account.buildTxExecutionRequest` opts:
 *       { cancellable: false, txNonce: Fr.random(),
 *         feePaymentMethodOptions: PREEXISTING_FEE_JUICE }
 *   - `pxe.simulateTx` opts:
 *       { simulatePublic: true, skipFeeEnforcement: true,
 *         scopes: [account.address] }
 *   - Private-return unpacking depends on whether
 *     `txRequest.origin.toString() === account.address.toString()`:
 *       same    → `simulatedTx.getPrivateReturnValues().nested`
 *       different → `simulatedTx.getPrivateReturnValues().nested[1].nested`
 *   - `FunctionCall.hideMsgSender` constructor arg:
 *       'call' kind          → `call.hideSender === true`
 *       'encoded_call' kind  → `call.hideMsgSender === true`
 *       UTILITY (either kind) → always `false`
 *   - Error strings preserved verbatim — callers (`balance-projector`,
 *     gas-balance read) may surface them: "Contract not found",
 *     "Contract artifact not found", "Method not found".
 *   - Decode failures are isolated per-call: `decodeFromAbi` errors are
 *     logged but don't blow up sibling decodes.
 *
 * ## Dependency injection
 *
 * Callers resolve PXE / node / account / contractResolver themselves (via
 * `getViewSimulationDeps`) and pass them in. This keeps the helper pure and
 * trivially testable by stubbing the four dependencies.
 */

import { Fr } from "@aztec/foundation/curves/bn254"
import {
	type AbiDecoded,
	type AbiType,
	type ContractArtifact,
	type FunctionAbi,
	FunctionCall,
	FunctionSelector,
	FunctionType,
	decodeFromAbi,
	encodeArguments,
} from "@aztec/stdlib/abi"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract"
import { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import { ExecutionPayload, type UtilityExecutionResult } from "@aztec/stdlib/tx"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import type { IAccountContract } from "@nulo/aztec-runtime/account"
import type { IPXE } from "@nulo/aztec-runtime/pxe"
import type { CallAction, EncodedCallAction } from "@nulo/wallet-bridge"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import { type ILogger, LogLevel } from "@/wallet/logger"
import type { ContractResolver } from "../contract-resolver"

const LOG_SOURCE = "batched-view-simulation"

export interface BatchedViewSimulationDeps {
	readonly pxe: IPXE
	readonly node: AztecNode
	readonly account: IAccountContract
	readonly contractResolver: ContractResolver
	readonly logger?: ILogger
}

export interface BatchedViewSimulationResult {
	readonly encoded: Fr[][]
	readonly decoded: AbiDecoded[]
}

export async function batchedViewSimulation(
	calls: ReadonlyArray<CallAction | EncodedCallAction>,
	deps: BatchedViewSimulationDeps,
): Promise<BatchedViewSimulationResult> {
	const encoded: Fr[][] = []
	const decoded: AbiDecoded[] = []
	if (calls.length === 0) return { encoded, decoded }

	const { pxe, node, account, contractResolver, logger } = deps

	// Resolve contract instances + artifacts up-front.
	// `extractContracts` accepts `Action[]`; CallAction + EncodedCallAction are
	// Action subtypes (see packages/wallet-bridge/src/action.ts union).
	const contractAddresses = contractResolver.extractContracts([...calls])
	const instances = await contractResolver.resolveInstances(pxe, contractAddresses)
	const artifacts = await contractResolver.resolveArtifacts(pxe, instances)

	// Register any contract PXE doesn't already know about.
	const registeredContracts = new Set<string>((await pxe.getContracts()).map((x) => x.toString()))
	for (const [contract, instance] of instances) {
		if (!registeredContracts.has(contract)) {
			logger?.log(LOG_SOURCE, LogLevel.Debug, `Register contract ${contract}`)
			await pxe.registerContract({
				instance,
				artifact: artifacts.get(instance.currentContractClassId.toString()),
			})
		}
	}

	await account.ensureRegistered(pxe)

	// Classify + enqueue. Utility calls launched eagerly (promise pushed);
	// tx-typed calls queued for the single batched simulateTx below.
	const txCalls: [FunctionCall, number, number, AbiType[]][] = []
	const utility: [Promise<UtilityExecutionResult>, number, AbiType[]][] = []
	let privateCallIndex = 0
	let publicCallIndex = 0

	for (let i = 0; i < calls.length; i++) {
		const call = calls[i]
		const enqueued = await enqueueCall(call, instances, artifacts, account, pxe)
		if (enqueued.kind === "utility") {
			utility.push([enqueued.promise, i, enqueued.returnTypes])
		} else {
			const slotIndex = enqueued.functionType === FunctionType.PUBLIC ? publicCallIndex++ : privateCallIndex++
			txCalls.push([enqueued.functionCall, i, slotIndex, enqueued.returnTypes])
		}
	}

	// Tx-typed batch (runs in parallel with the already-launched utility
	// promises). simulateTx is bundled regardless of public vs private —
	// the kernel splits internally based on `simulatePublic: true`.
	if (txCalls.length) {
		const payload = new ExecutionPayload(
			txCalls.map((x) => x[0]),
			[],
			[],
			[],
		)
		const txRequest = await account.buildTxExecutionRequest(node, pxe, payload, {
			cancellable: false,
			txNonce: Fr.random(),
			feePaymentMethodOptions: AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE,
		})
		const simulatedTx = await pxe.simulateTx(txRequest, {
			simulatePublic: true,
			skipFeeEnforcement: true,
			scopes: [account.address],
		})

		const publicReturn = simulatedTx.getPublicReturnValues()
		// Origin-dependent nested-shape unpacking. Pinned by unit tests; if
		// upstream changes this layout, the parity tests fail loudly.
		const privateReturn =
			txRequest.origin.toString() === account.address.toString()
				? simulatedTx.getPrivateReturnValues().nested
				: simulatedTx.getPrivateReturnValues().nested[1].nested

		for (const [call, i, j, types] of txCalls) {
			const values = (call.type === FunctionType.PUBLIC ? publicReturn[j] : privateReturn[j]).values ?? []
			encoded[i] = values
			try {
				decoded[i] = decodeFromAbi(types, values)
			} catch (error) {
				logger?.log(LOG_SOURCE, LogLevel.Error, "Failed to decode simulation results", types, values, getErrorMessage(error))
			}
		}
	}

	// Serially await utility promises (kicked off eagerly above; ran in
	// parallel with simulateTx). Order of awaits doesn't affect kernel
	// throughput — only the final per-index assignment ordering.
	for (const [promise, i, types] of utility) {
		const { result: values } = await promise
		try {
			decoded[i] = decodeFromAbi(types, values)
		} catch (error) {
			logger?.log(LOG_SOURCE, LogLevel.Error, "Failed to encode utility simulation results", types, values, getErrorMessage(error))
		}
		encoded[i] = values
	}

	return { encoded, decoded }
}

type EnqueuedCall =
	| { kind: "utility"; promise: Promise<UtilityExecutionResult>; returnTypes: AbiType[] }
	| { kind: "tx"; functionCall: FunctionCall; returnTypes: AbiType[]; functionType: FunctionType }

async function enqueueCall(
	call: CallAction | EncodedCallAction,
	instances: Map<string, ContractInstanceWithAddress>,
	artifacts: Map<string, ContractArtifact>,
	account: IAccountContract,
	pxe: IPXE,
): Promise<EnqueuedCall> {
	if (call.kind === "call") {
		const instance = instances.get(call.contract)
		if (!instance) throw new Error("Contract not found")
		const artifact = artifacts.get(instance.currentContractClassId.toString())
		if (!artifact) throw new Error("Contract artifact not found")
		const fn = findFunctionByName(artifact, call.method)
		if (!fn) throw new Error("Method not found")
		const fnSelector = await FunctionSelector.fromNameAndParameters(fn.name, fn.parameters)
		const encodedArgs = encodeArguments(fn, call.args)

		if (fn.functionType === FunctionType.UTILITY) {
			const functionCall = new FunctionCall(
				fn.name,
				AztecAddress.fromString(call.contract),
				fnSelector,
				fn.functionType,
				false, // hideMsgSender hardcoded false for utility calls (parity)
				fn.isStatic,
				encodedArgs,
				fn.returnTypes,
			)
			return {
				kind: "utility",
				promise: pxe.executeUtility(functionCall, { scopes: [account.address] }),
				returnTypes: fn.returnTypes,
			}
		}

		return {
			kind: "tx",
			functionCall: new FunctionCall(
				fn.name,
				AztecAddress.fromString(call.contract),
				fnSelector,
				fn.functionType,
				call.hideSender === true, // 'call' kind uses hideSender (parity)
				fn.isStatic,
				encodedArgs,
				fn.returnTypes,
			),
			returnTypes: fn.returnTypes,
			functionType: fn.functionType,
		}
	}

	// encoded_call kind
	const instance = instances.get(call.to)
	if (!instance) throw new Error("Contract not found")
	const artifact = artifacts.get(instance.currentContractClassId.toString())
	if (!artifact) throw new Error("Contract artifact not found")
	const fn = await findFunctionBySelector(artifact, call.selector)
	if (!fn) throw new Error("Method not found")

	if (fn.functionType === FunctionType.UTILITY) {
		const functionCall = new FunctionCall(
			fn.name,
			AztecAddress.fromString(call.to),
			FunctionSelector.fromString(call.selector),
			fn.functionType,
			false, // hideMsgSender hardcoded false for utility calls (parity)
			fn.isStatic,
			call.args.map((x) => Fr.fromString(x)),
			fn.returnTypes,
		)
		return {
			kind: "utility",
			promise: pxe.executeUtility(functionCall, { scopes: [account.address] }),
			returnTypes: fn.returnTypes,
		}
	}

	return {
		kind: "tx",
		functionCall: new FunctionCall(
			fn.name,
			AztecAddress.fromString(call.to),
			FunctionSelector.fromString(call.selector),
			fn.functionType,
			call.hideMsgSender === true, // 'encoded_call' kind uses hideMsgSender (parity)
			fn.isStatic,
			call.args.map((x) => Fr.fromString(x)),
			fn.returnTypes,
		),
		returnTypes: fn.returnTypes,
		functionType: fn.functionType,
	}
}

function findFunctionByName(artifact: ContractArtifact, name: string): FunctionAbi | undefined {
	return artifact.functions.find((x) => x.name === name) ?? artifact.nonDispatchPublicFunctions.find((x) => x.name === name)
}

async function findFunctionBySelector(artifact: ContractArtifact, selector: string): Promise<FunctionAbi | undefined> {
	for (const fn of artifact.functions) {
		const sel = await FunctionSelector.fromNameAndParameters(fn.name, fn.parameters)
		if (sel.toString() === selector) return fn
	}
	for (const fn of artifact.nonDispatchPublicFunctions) {
		const sel = await FunctionSelector.fromNameAndParameters(fn.name, fn.parameters)
		if (sel.toString() === selector) return fn
	}
	return undefined
}
