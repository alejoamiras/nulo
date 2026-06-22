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
 * ## Public authwits: collected here, recorded POST-send
 *
 * `buildStandard` is PURE w.r.t. the authwit index — it does not write to
 * `authRegistryService`. Each `add_public_authwit` action is collected into
 * `pendingPublicAuthwits` (returned on the result) and a per-build cap is
 * enforced. The post-send tail (`dapp-send-executor` → `recordPendingAuthwits`)
 * writes them as pending rows, reconciled by the tx's on-chain outcome. This is
 * what keeps a fee-estimate or a rejected approval from leaking a tracked grant.
 *
 * ## Return shape
 *
 * `buildStandard` returns a `BuiltStandardTx`; `buildNoFrom` returns a
 * `BuiltNoFromTx` (same fields minus `nonce`, since `DefaultEntrypoint`
 * doesn't use one). These feed the fee-strategy branches.
 */

import { Fr } from "@aztec/foundation/curves/bn254"
import { type AbiType, encodeArguments, FunctionCall, FunctionSelector, FunctionType } from "@aztec/stdlib/abi"
import { AuthWitness } from "@aztec/stdlib/auth-witness"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { Gas, GasSettings } from "@aztec/stdlib/gas"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { Capsule, ExecutionPayload, HashedValues, TxContext, TxExecutionRequest } from "@aztec/stdlib/tx"
import type { ILogger } from "@/wallet/logger"
import { LogLevel } from "@/wallet/logger"
import type { AccountService } from "@/wallet/services/account/service"
import type { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import type { IAccountContract, PartialGasSettingsRPC } from "@nulo/aztec-runtime/account"
import { assertLiveChainIdentity } from "@nulo/aztec-runtime/utils"
import type { AuthRegistryService } from "@/wallet/services/auth-registry/service"
import { networkInfoFrom, type NetworkService, type Network } from "@/wallet/services/network/service"
import type { ProfileService } from "@/wallet/services/profile/service"
import type { IPXE, PxeServiceClient } from "@/wallet/services/pxe/client"
import { StepContent, type TaskService, type WrappedTask } from "@/wallet/services/task/service"
import type { TxCall } from "@/wallet/services/transaction/service"
import { getAuthRegistryAddress, getSetAuthorizedFn, getSetAuthorizedSelector } from "@/wallet/utils/auth-registry"
import type { AuthwitDiscoverer } from "./authwit-discoverer"
import { type ContractResolver, findFunctionByName, findFunctionBySelector } from "./contract-resolver"
import type { Action, AuthwitContent, AztecSendTxOperation } from "./spec"

const LOG_SOURCE = "TxRequestBuilder"

export interface BuiltStandardTx {
	txRequest: TxExecutionRequest
	node: AztecNode
	pxe: IPXE
	account: IAccountContract
	network: Network
	nonce: Fr
	txCalls: TxCall[]
	/** Public authwits this build will write on-chain (`set_authorized`). Recording
	 *  is DEFERRED to the post-send tail (pending → reconcile) so a pure build —
	 *  during fee estimate, or a rejected approval — records nothing. NO_FROM builds
	 *  carry an empty array (they emit no `add_public_authwit`). */
	pendingPublicAuthwits: { account: string; hash: string; content: AuthwitContent }[]
}

/** NO_FROM (DefaultEntrypoint) variant — no account nonce exists on that path. */
export type BuiltNoFromTx = Omit<BuiltStandardTx, "nonce">

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
	): Promise<BuiltStandardTx> {
		const step = new StepContent("Processing transaction")
		const task = parentTask ? parentTask.startSubtask(step) : this.taskService.startNewTask(step)

		try {
			const profile = await this.profileService.getActiveProfile()
			if (!profile) {
				throw new Error("Wallet locked")
			}
			const network = await this.networkService.getNetwork(op.networkId)
			const account = await this.accountService.getAccountContract(profile.id, network.chainId, op.accountAddress)
			const node = await this.networkService.getNode(network.chainId)
			const pxe = this.pxeService.getPXE(networkInfoFrom(network))

			const nodeInfo = await node.getNodeInfo()
			// F-012 / Phase 5: refuse to sign/prove if the live node's chain
			// identity has drifted from the network the user selected. Without
			// this, a malicious or drifted RPC endpoint can change the signing
			// context after enrollment.
			assertLiveChainIdentity(network, nodeInfo)
			const contracts = this.resolver.extractContracts(op.actions)
			const instances = await this.resolver.resolveInstances(pxe, contracts)
			const artifacts = await this.resolver.resolveArtifacts(pxe, instances)

			await this.resolver.ensureContractsRegistered(pxe, instances, artifacts, {
				onRegister: () => this.log("Register contract"),
			})

			const capsules: Capsule[] = []
			const authwits: AuthWitness[] = []
			const extraHashedArgs: HashedValues[] = []
			const calls: FunctionCall[] = []
			const nonce = Fr.random()
			const txCalls: TxCall[] = []
			const pendingPublicAuthwits: { account: string; hash: string; content: AuthwitContent }[] = []

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
						// Collect for POST-send recording (pending → reconcile). Build stays PURE:
						// no trackAuthwit side-effect, so a fee-estimate or a rejected approval
						// records nothing. The post-send tail persists these as pending rows.
						pendingPublicAuthwits.push({
							account: account.address.toString(),
							hash: messageHash.toString(),
							content: action.content,
						})

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
						const fn = findFunctionByName(artifact, action.method)
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
							const fn = await findFunctionBySelector(artifact, action.selector)
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

			// Per-BUILD cap (pre-send gate): block a grant that would push the account past the
			// tracked-authwit ceiling. Delegated to the auth-registry service so the
			// existing+pending+unique-new ceiling logic is unit-testable in isolation.
			if (pendingPublicAuthwits.length > 0) {
				await this.authRegistryService.assertWithinCap(
					account.address.toString(),
					pendingPublicAuthwits.map((p) => p.hash),
				)
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
			return { txRequest, node, pxe, account, network, nonce, txCalls, pendingPublicAuthwits }
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
	public async buildNoFrom(op: AztecSendTxOperation, parentTask?: WrappedTask): Promise<BuiltNoFromTx> {
		const step = new StepContent("Processing transaction")
		const task = parentTask ? parentTask.startSubtask(step) : this.taskService.startNewTask(step)

		try {
			this.log(`buildNoFrom: starting, accountAddress=${op.accountAddress}, networkId=${op.networkId}`)
			const profile = await this.profileService.getActiveProfile()
			if (!profile) throw new Error("Wallet locked")

			const network = await this.networkService.getNetwork(op.networkId)
			const node = await this.networkService.getNode(network.chainId)
			const pxe = this.pxeService.getPXE(networkInfoFrom(network))
			const account = await this.accountService.getAccountContract(profile.id, network.chainId, op.accountAddress)
			this.log(`buildNoFrom: account resolved, address=${account.address.toString()}`)

			// Register account in PXE (needed for scopes)
			await account.ensureRegistered(pxe)
			this.log("buildNoFrom: account registered in PXE")

			// Register contracts referenced in the payload (same pattern as buildStandard)
			const callAddresses = (op.exec.calls ?? []).map((c) => c.to?.toString()).filter(Boolean)
			const uniqueAddresses = [...new Set(callAddresses)]
			this.log(`buildNoFrom: registering contracts, callAddresses=${JSON.stringify(callAddresses)}, unique=${uniqueAddresses.length}`)
			const instances = await this.resolver.resolveInstances(pxe, uniqueAddresses)
			this.log(`buildNoFrom: got ${instances.size} instances`)
			const artifacts = await this.resolver.resolveArtifacts(pxe, instances)
			this.log(`buildNoFrom: got ${artifacts.size} artifacts`)
			await this.resolver.ensureContractsRegistered(pxe, instances, artifacts, {
				onRegister: (contract, instance) =>
					this.log(`buildNoFrom: registering contract ${contract} with classId ${instance.currentContractClassId.toString()}`),
				onSkip: (contract) => this.log(`buildNoFrom: contract ${contract} already registered`),
			})

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
			const nodeInfo = await node.getNodeInfo()
			// F-012 / Phase 5: refuse to sign/prove if the live node's chain
			// identity has drifted from the network the user selected.
			assertLiveChainIdentity(network, nodeInfo)
			const currentMinFees = await node.getCurrentMinFees()
			// 5.0: `fallback` requires explicit gasLimits — fill the network's per-tx admission limit.
			const gasSettings = GasSettings.fallback({
				maxFeesPerGas: currentMinFees,
				gasLimits: new Gas(nodeInfo.txsLimits.gas.daGas, nodeInfo.txsLimits.gas.l2Gas),
			})
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
			// NO_FROM emits no add_public_authwit, so there is nothing to record.
			return { txRequest, node, pxe, account, network, txCalls, pendingPublicAuthwits: [] }
		} catch (error) {
			task.fail(error)
			throw error
		}
	}

	private log(...data: unknown[]): void {
		this.logger.log(LOG_SOURCE, LogLevel.Debug, ...data)
	}
}
