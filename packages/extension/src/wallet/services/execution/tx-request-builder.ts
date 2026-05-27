/**
 * `TxRequestBuilder` — owns transaction-request assembly end-to-end:
 *
 *   - `buildStandard` — the 270-LOC `buildTxRequest` path that consumes
 *     a Nulo `SendTransactionOperation`-shaped op + a fee payment method,
 *     resolves contracts, processes every action kind (call, encoded_call,
 *     add_capsule, add_extra_args, add_private_authwit, add_public_authwit),
 *     and asks the account contract to build a `TxExecutionRequest`.
 *
 *   - `buildNoFrom` — the 100-LOC DefaultEntrypoint variant
 *     (`buildNoFromTxRequest`). Handles the `aztec_sendTx` with
 *     `executionMode: "default_entrypoint"` path — inlined
 *     DefaultEntrypoint logic (we cannot import from `@aztec/entrypoints`
 *     in the service worker since upstream references `window`).
 *
 * ## Error contract (frozen by call site)
 *
 * Every throw is preserved verbatim from the original:
 *   - `"Wallet locked"` — no active profile
 *   - `"Contract not found"` / `"Contract artifact not found"` /
 *     `"Method not found"` — per-action resolution failures
 *   - `"Invalid authwit content kind"` — unrecognized authwit `content.kind`
 *   - `"DefaultEntrypoint requires exactly 1 call, got ${n}"`
 *   - `"DefaultEntrypoint only supports private functions"`
 *
 * ## `trackAuthwit` stays inside `buildStandard`
 *
 * `authRegistryService.trackAuthwit` is called inline during assembly.
 * Moving it to after-send (cleaner architecturally) requires
 * `ExecutionCoordinator` to own the post-send flush point; until then,
 * keep the inline call.
 *
 * ## Return-shape parity
 *
 * `buildStandard` returns the 7-tuple
 * `[txRequest, node, pxe, account, network, nonce, txCalls]`.
 * `buildNoFrom` returns the 6-tuple
 * `[txRequest, node, pxe, account, network, txCalls]` — no nonce, since
 * `DefaultEntrypoint` doesn't use one. These tuples feed the
 * fee-strategy branches.
 */

import { Fr } from "@aztec/foundation/curves/bn254"
import { type AbiType, encodeArguments, FunctionCall, FunctionSelector, FunctionType } from "@aztec/stdlib/abi"
import { AuthWitness } from "@aztec/stdlib/auth-witness"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { GasSettings } from "@aztec/stdlib/gas"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { Capsule, ExecutionPayload, HashedValues, TxContext, TxExecutionRequest } from "@aztec/stdlib/tx"
import type { ILogger } from "@/wallet/logger"
import { LogLevel } from "@/wallet/logger"
import type { AccountService } from "@/wallet/services/account/service"
import type { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import type { IAccountContract, PartialGasSettingsRPC } from "@nulo/aztec-runtime/account"
import type { AuthRegistryService } from "@/wallet/services/auth-registry/service"
import type { NetworkService, Network } from "@/wallet/services/network/service"
import type { ProfileService } from "@/wallet/services/profile/service"
import type { IPXE, PxeServiceClient } from "@/wallet/services/pxe/client"
import { StepContent, type TaskService, type WrappedTask } from "@/wallet/services/task/service"
import type { TxCall } from "@/wallet/services/transaction/service"
import { getAuthRegistryAddress, getSetAuthorizedFn, getSetAuthorizedSelector } from "@/wallet/utils/auth-registry"
import type { AuthwitDiscoverer } from "./authwit-discoverer"
import type { ContractResolver } from "./contract-resolver"
import type { Action, AztecSendTxOperation } from "./spec"

const LOG_SOURCE = "TxRequestBuilder"

export type StandardTxRequestResult = [TxExecutionRequest, AztecNode, IPXE, IAccountContract, Network, Fr, TxCall[]]
export type NoFromTxRequestResult = [TxExecutionRequest, AztecNode, IPXE, IAccountContract, Network, TxCall[]]

export class TxRequestBuilder {
	public constructor(
		private readonly pxeService: PxeServiceClient,
		private readonly profileService: ProfileService,
		private readonly networkService: NetworkService,
		private readonly accountService: AccountService,
		private readonly authRegistryService: AuthRegistryService,
		private readonly taskService: TaskService,
		private readonly resolver: ContractResolver,
		private readonly authwit: AuthwitDiscoverer,
		private readonly logger: ILogger,
	) {}

	/** Standard Nulo path: wallet-lock check, resolve contracts, process
	 *  every action (authwit / call / capsule / extraArgs), build via the
	 *  account contract's entrypoint. */
	public async buildStandard(
		op: { networkId: string; accountAddress: string; actions: Action[] },
		feePaymentMethod: AccountFeePaymentMethodOptions,
		parentTask?: WrappedTask,
		gasSettings?: PartialGasSettingsRPC,
	): Promise<StandardTxRequestResult> {
		const step = new StepContent("Processing transaction")
		const task = parentTask ? parentTask.startSubtask(step) : this.taskService.startNewTask(step)

		try {
			const profile = await this.profileService.getActiveProfile()
			if (!profile) {
				throw new Error("Wallet locked")
			}
			const network = await this.networkService.getNetwork(op.networkId)
			const account = await this.accountService.getAccountContract(profile.id, network.chainId, op.accountAddress)

			// Wrap the entire build body in `withBinding` so any AztecNode
			// failure inside `node.getNodeInfo()` or
			// `account.buildTxExecutionRequest(node, …)` routes through the
			// classifier and the active endpoint takes a hit.
			return await this.networkService.withBinding(network.chainId, async (b) => {
				const node = b.node
				const pxe = this.pxeService.getPXE(b.info)
				const nodeInfo = await node.getNodeInfo()
				const contracts = this.resolver.extractContracts(op.actions)
				const instances = await this.resolver.resolveInstances(pxe, contracts)
				const artifacts = await this.resolver.resolveArtifacts(pxe, instances)

				const registeredContracts = new Set<string>((await pxe.getContracts()).map((x) => x.toString()))
				for (const [contract, instance] of instances) {
					if (!registeredContracts.has(contract)) {
						this.log("Register contract")
						await pxe.registerContract({
							instance,
							artifact: artifacts.get(instance.currentContractClassId.toString()),
						})
					}
				}

				const capsules: Capsule[] = []
				const authwits: AuthWitness[] = []
				const extraHashedArgs: HashedValues[] = []
				const calls: FunctionCall[] = []
				const nonce = Fr.random()
				const txCalls: TxCall[] = []

				for (const action of op.actions) {
					switch (action.kind) {
						case "add_capsule": {
							this.log("Adding capsule...")
							capsules.push(
								new Capsule(
									AztecAddress.fromString(action.contract),
									Fr.fromString(action.storageSlot),
									action.capsule.map(Fr.fromString),
								),
							)
							this.log("Capsule added.")
							break
						}
						case "add_extra_args": {
							this.log("Adding extra args...")
							extraHashedArgs.push(await HashedValues.fromArgs(action.args.map((x) => Fr.fromString(x))))
							this.log("Extra args added.")
							break
						}
						case "add_private_authwit": {
							this.log("Adding private authwit...")

							let messageHash: Fr
							switch (action.content.kind) {
								case "call": {
									messageHash = await this.authwit.computeCallMessageHash(action.content, nodeInfo, instances, artifacts)
									break
								}
								case "encoded_call": {
									messageHash = await this.authwit.computeEncodedCallMessageHash(
										action.content,
										nodeInfo,
										instances,
										artifacts,
									)
									break
								}
								case "intent": {
									messageHash = await this.authwit.computeIntentMessageHash(action.content, nodeInfo)
									break
								}
								case "message_hash": {
									messageHash = Fr.fromString(action.content.messageHash)
									break
								}
								default: {
									throw new Error("Invalid authwit content kind")
								}
							}

							const authwit = action.authwit
								? new AuthWitness(
										messageHash,
										action.authwit.map((x) => Fr.fromString(x)),
									)
								: await account.createAuthWit(messageHash)

							authwits.push(authwit)
							this.log("Private authwit added.")
							break
						}
						case "add_public_authwit": {
							this.log("Adding public authwit...")

							let messageHash: Fr
							switch (action.content.kind) {
								case "call": {
									messageHash = await this.authwit.computeCallMessageHash(action.content, nodeInfo, instances, artifacts)
									await this.authRegistryService.trackAuthwit(
										account.address.toString(),
										messageHash.toString(),
										action.content,
									)
									break
								}
								case "encoded_call": {
									messageHash = await this.authwit.computeEncodedCallMessageHash(
										action.content,
										nodeInfo,
										instances,
										artifacts,
									)
									await this.authRegistryService.trackAuthwit(
										account.address.toString(),
										messageHash.toString(),
										action.content,
									)
									break
								}
								case "intent": {
									messageHash = await this.authwit.computeIntentMessageHash(action.content, nodeInfo)
									await this.authRegistryService.trackAuthwit(
										account.address.toString(),
										messageHash.toString(),
										action.content,
									)
									break
								}
								case "message_hash": {
									messageHash = Fr.fromString(action.content.messageHash)
									await this.authRegistryService.trackAuthwit(
										account.address.toString(),
										messageHash.toString(),
										action.content,
									)
									break
								}
								default: {
									throw new Error("Invalid authwit content kind")
								}
							}

							const fn = getSetAuthorizedFn()
							calls.push(
								new FunctionCall(
									fn.name,
									getAuthRegistryAddress(),
									await getSetAuthorizedSelector(),
									fn.functionType,
									false,
									fn.isStatic,
									encodeArguments(fn, [messageHash, true]),
									fn.returnTypes,
								),
							)
							txCalls.push({
								contract: getAuthRegistryAddress().toString(),
								method: fn.name,
								args: [messageHash, true],
							})

							this.log("Public authwit added.")
							break
						}
						case "call": {
							const instance = instances.get(action.contract)
							if (!instance) {
								throw new Error("Contract not found")
							}
							const artifact = artifacts.get(instance.currentContractClassId.toString())
							if (!artifact) {
								throw new Error("Contract artifact not found")
							}
							const fn =
								artifact.functions.find((x) => x.name === action.method) ??
								artifact.nonDispatchPublicFunctions.find((x) => x.name === action.method)
							if (!fn) {
								throw new Error("Method not found")
							}
							const fnSelector = await FunctionSelector.fromNameAndParameters(fn.name, fn.parameters)
							calls.push(
								new FunctionCall(
									fn.name,
									AztecAddress.fromString(action.contract),
									fnSelector,
									fn.functionType,
									action.hideSender === true,
									fn.isStatic,
									encodeArguments(fn, action.args),
									fn.returnTypes,
								),
							)
							txCalls.push({ contract: action.contract, method: action.method, args: action.args })
							this.log("Call enqueued.")
							break
						}
						case "encoded_call": {
							if (action.type === undefined || action.isStatic === undefined) {
								const instance = instances.get(action.to)
								if (!instance) {
									throw new Error("Contract not found")
								}
								const artifact = artifacts.get(instance.currentContractClassId.toString())
								if (!artifact) {
									throw new Error("Contract artifact not found")
								}
								// Union of artifact.functions[] and nonDispatchPublicFunctions[]
								// element types — both expose `name`/`parameters`/`functionType`/`isStatic`
								// which is all this loop reads.
								let fn:
									| (typeof artifact.functions)[number]
									| (typeof artifact.nonDispatchPublicFunctions)[number]
									| undefined
								for (const _fn of artifact.functions) {
									const selector = await FunctionSelector.fromNameAndParameters(_fn.name, _fn.parameters)
									if (selector.toString() === action.selector) {
										fn = _fn
										break
									}
								}
								if (!fn) {
									for (const _fn of artifact.nonDispatchPublicFunctions) {
										const selector = await FunctionSelector.fromNameAndParameters(_fn.name, _fn.parameters)
										if (selector.toString() === action.selector) {
											fn = _fn
											break
										}
									}
								}
								if (!fn) {
									throw new Error("Method not found")
								}
								action.type = fn.functionType
								action.isStatic = fn.isStatic
							}
							const fnName = action.name || action.selector
							const fnReturnTypes: AbiType[] = []
							calls.push(
								new FunctionCall(
									fnName,
									AztecAddress.fromString(action.to),
									FunctionSelector.fromString(action.selector),
									action.type as FunctionType,
									action.hideMsgSender === true,
									action.isStatic ?? false,
									action.args.map((x) => Fr.fromString(x)),
									fnReturnTypes,
								),
							)
							txCalls.push({ contract: action.to, method: fnName, args: action.args })
							this.log("EncodedCall enqueued.")
							break
						}
					}
				}

				const payload = new ExecutionPayload(calls, authwits, capsules, extraHashedArgs)
				const txRequest = await account.buildTxExecutionRequest(
					node,
					pxe,
					payload,
					{
						cancellable: false,
						txNonce: nonce,
						feePaymentMethodOptions: feePaymentMethod,
					},
					gasSettings,
				)

				task.complete()
				return [txRequest, node, pxe, account, network, nonce, txCalls]
			})
		} catch (error) {
			task.fail(error)
			throw error
		}
	}

	/** DefaultEntrypoint variant: Aztec.js `aztec_sendTx` with
	 *  `executionMode: "default_entrypoint"`. Single-call, no account
	 *  wrapper, inlined `DefaultEntrypoint` logic. Cannot import
	 *  `@aztec/entrypoints/default` in the service worker (upstream
	 *  references `window`). */
	public async buildNoFrom(op: AztecSendTxOperation, parentTask?: WrappedTask): Promise<NoFromTxRequestResult> {
		const step = new StepContent("Processing transaction")
		const task = parentTask ? parentTask.startSubtask(step) : this.taskService.startNewTask(step)

		try {
			this.log(`buildNoFrom: starting, accountAddress=${op.accountAddress}, networkId=${op.networkId}`)
			const profile = await this.profileService.getActiveProfile()
			if (!profile) throw new Error("Wallet locked")

			const network = await this.networkService.getNetwork(op.networkId)
			const account = await this.accountService.getAccountContract(profile.id, network.chainId, op.accountAddress)
			this.log(`buildNoFrom: account resolved, address=${account.address.toString()}`)

			// Wrap entire build body in `withBinding` so any AztecNode call
			// (getNodeInfo, getCurrentMinFees) routes through the classifier.
			return await this.networkService.withBinding(network.chainId, async (b) => {
				const node = b.node
				const pxe = this.pxeService.getPXE(b.info)

				// Register account in PXE (needed for scopes)
				await account.ensureRegistered(pxe)
				this.log("buildNoFrom: account registered in PXE")

				// Register contracts referenced in the payload (same pattern as buildStandard)
				const callAddresses = (op.exec.calls ?? []).map((c) => c.to?.toString()).filter(Boolean)
				const uniqueAddresses = [...new Set(callAddresses)]
				this.log(
					`buildNoFrom: registering contracts, callAddresses=${JSON.stringify(callAddresses)}, unique=${uniqueAddresses.length}`,
				)
				const instances = await this.resolver.resolveInstances(pxe, uniqueAddresses)
				this.log(`buildNoFrom: got ${instances.size} instances`)
				const artifacts = await this.resolver.resolveArtifacts(pxe, instances)
				this.log(`buildNoFrom: got ${artifacts.size} artifacts`)
				const registeredContracts = new Set<string>((await pxe.getContracts()).map((x) => x.toString()))
				this.log(`buildNoFrom: ${registeredContracts.size} already registered contracts`)
				for (const [contract, instance] of instances) {
					if (!registeredContracts.has(contract)) {
						this.log(`buildNoFrom: registering contract ${contract} with classId ${instance.currentContractClassId.toString()}`)
						await pxe.registerContract({
							instance,
							artifact: artifacts.get(instance.currentContractClassId.toString()),
						})
					} else {
						this.log(`buildNoFrom: contract ${contract} already registered`)
					}
				}

				// Inline DefaultEntrypoint logic — calls the function directly, msg_sender = None.
				// Cannot import @aztec/entrypoints/default in service worker (references `window`).
				// Must parse raw JSON fields through Zod schemas (RPC bridge serializes to plain objects).
				const rawCalls = op.exec.calls ?? []
				if (rawCalls.length !== 1) {
					throw new Error(`DefaultEntrypoint requires exactly 1 call, got ${rawCalls.length}`)
				}
				const call = await FunctionCall.schema.parseAsync(rawCalls[0])
				if (call.type !== FunctionType.PRIVATE) {
					throw new Error("DefaultEntrypoint only supports private functions")
				}

				// Parse authwits from both exec and opts (same as processAztecJsPayload)
				const parsedAuthWits: AuthWitness[] = []
				for (const raw of (op.exec.authWitnesses ?? []).concat(op.opts.authWitnesses ?? [])) {
					parsedAuthWits.push(await AuthWitness.schema.parseAsync(raw))
				}
				const parsedCapsules: Capsule[] = []
				for (const raw of (op.exec.capsules ?? []).concat(op.opts.capsules ?? [])) {
					parsedCapsules.push(await Capsule.schema.parseAsync(raw))
				}
				const parsedExtraArgs: HashedValues[] = []
				for (const raw of op.exec.extraHashedArgs ?? []) {
					parsedExtraArgs.push(await HashedValues.schema.parseAsync(raw))
				}

				const hashedArguments = [await HashedValues.fromArgs(call.args)]
				const [nodeInfo, currentMinFees] = await Promise.all([node.getNodeInfo(), node.getCurrentMinFees()])
				const gasSettings = GasSettings.fallback({ maxFeesPerGas: currentMinFees })
				const txRequest = new TxExecutionRequest(
					call.to,
					call.selector,
					hashedArguments[0].hash,
					new TxContext(nodeInfo.l1ChainId, nodeInfo.rollupVersion, gasSettings),
					[...hashedArguments, ...parsedExtraArgs],
					parsedAuthWits,
					parsedCapsules,
				)

				// Build txCalls for transaction history
				const txCalls: TxCall[] = (op.exec.calls ?? []).map((call) => ({
					contract: call.to?.toString(),
					method: call.name ?? call.selector?.toString(),
					args: (call.args ?? []).map((a) => a.toString()),
				}))

				task.complete()
				return [txRequest, node, pxe, account, network, txCalls]
			})
		} catch (error) {
			task.fail(error)
			throw error
		}
	}

	private log(...data: unknown[]): void {
		this.logger.log(LOG_SOURCE, LogLevel.Debug, ...data)
	}
}
