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
import { encodeArguments, FunctionCall, FunctionSelector, FunctionType } from "@aztec/stdlib/abi"
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
import { assertLiveChainIdentity, chainInfoFrom } from "@nulo/aztec-runtime/utils"
import type { AuthRegistryService } from "@/wallet/services/auth-registry/service"
import { networkInfoFrom, type NetworkService, type Network } from "@/wallet/services/network/service"
import type { ProfileService } from "@/wallet/services/profile/service"
import { requireActiveProfile } from "@/wallet/services/profile/require-active-profile"
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
	/** The EXACT chain-identity pair the build asserted and signed under —
	 *  consumers snapshotting chain identity must use THIS, never refetch
	 *  (a refetch after an endpoint flip would bind the snapshot to a chain
	 *  the request was not built for). */
	chainIdentity: { l1ChainId: number; rollupVersion: number }
	nonce: Fr
	txCalls: TxCall[]
	/** Public authwits this build will write on-chain (`set_authorized`). Recording
	 *  is DEFERRED to the post-send tail (pending → reconcile) so a pure build —
	 *  during fee estimate, or a rejected approval — records nothing. NO_FROM builds
	 *  carry an empty array (they emit no `add_public_authwit`). */
	pendingPublicAuthwits: { account: string; hash: string; content: AuthwitContent }[]
	/** Node-advertised per-tx gas admission limit, snapshotted from the SAME
	 *  `getNodeInfo()` the build asserted chain identity against — the
	 *  finalize-time clamp reads THIS, never a live refetch (zero extra RPCs,
	 *  and no chance of clamping against a flipped endpoint). */
	txsLimits: Gas
	/** True iff this build wrapped the account constructor (first-tx
	 *  multicall). Send-path provenance for the existing-nullifier
	 *  classification — the flag lives here because `TxExecutionRequest`
	 *  itself cannot carry it. */
	initializesAccount: boolean
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
	// biome-ignore lint/complexity/noExcessiveLinesPerFunction: baseline (208 lines) — split when touched, never grow
	// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: baseline (score 38) — refactor when touched, never raise
	public async buildStandard(
		op: { networkId: string; accountAddress: string; actions: Action[] },
		feePaymentMethod: AccountFeePaymentMethodOptions,
		parentTask?: WrappedTask,
		gasSettings?: PartialGasSettingsRPC,
	): Promise<BuiltStandardTx> {
		const step = new StepContent("Processing transaction")
		const task = parentTask ? parentTask.startSubtask(step) : this.taskService.startNewTask(step)

		try {
			const profile = await requireActiveProfile(this.profileService, "Wallet locked")
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
								AztecAddress.fromStringUnsafe(action.contract),
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
								AztecAddress.fromStringUnsafe(action.contract),
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
						// Resolve the ABI UNCONDITIONALLY and bind the dApp-supplied `name` to the
						// selector's real function. Resolving only when `action.type`/`isStatic`
						// were absent let a dApp supply them to skip the lookup and execute a
						// selector that did not match the authorized `name` — scope authorizes the
						// name, execution ran the selector. Build the call from ABI truth; never
						// trust dApp-supplied type/isStatic/returnTypes for execution metadata.
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
						if (action.name !== undefined && action.name !== fn.name) {
							throw new Error(
								`Scope violation: call name "${action.name}" does not match selector's function "${fn.name}" on ${action.to}`,
							)
						}
						action.type = fn.functionType
						action.isStatic = fn.isStatic
						calls.push(
							new FunctionCall(
								fn.name,
								AztecAddress.fromStringUnsafe(action.to),
								FunctionSelector.fromString(action.selector),
								fn.functionType,
								action.hideMsgSender === true,
								fn.isStatic,
								action.args.map((x) => Fr.fromString(x)),
								fn.returnTypes ?? [],
							),
						)
						txCalls.push({ contract: action.to, method: fn.name, args: action.args })
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
			const buildMeta: { initializesAccount?: boolean } = {}
			const txRequest = await account.buildTxExecutionRequest(
				node,
				pxe,
				payload,
				{
					cancellable: false,
					txNonce: nonce,
					feePaymentMethodOptions: feePaymentMethod,
				},
				chainInfoFrom(nodeInfo),
				gasSettings,
				buildMeta,
			)

			task.complete()
			return {
				txRequest,
				initializesAccount: buildMeta.initializesAccount === true,
				node,
				pxe,
				account,
				network,
				chainIdentity: { l1ChainId: nodeInfo.l1ChainId, rollupVersion: nodeInfo.rollupVersion },
				nonce,
				txCalls,
				pendingPublicAuthwits,
				txsLimits: new Gas(nodeInfo.txsLimits.gas.daGas, nodeInfo.txsLimits.gas.l2Gas),
			}
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
	/**
	 * Parse + validate the single NO_FROM call: bind the dApp-supplied name to the
	 * selector's real ABI function, and derive the function type from the ABI — never
	 * trust call.name/type. The NO_FROM path resolved no artifact, so a dApp could name
	 * a benign function while running a different selector.
	 */
	private async resolveNoFromCall(
		op: AztecSendTxOperation,
		instances: Awaited<ReturnType<TxRequestBuilder["resolver"]["resolveInstances"]>>,
		artifacts: Awaited<ReturnType<TxRequestBuilder["resolver"]["resolveArtifacts"]>>,
	): Promise<FunctionCall> {
		const rawCalls = op.exec.calls ?? []
		if (rawCalls.length !== 1) {
			throw new Error(`DefaultEntrypoint requires exactly 1 call, got ${rawCalls.length}`)
		}
		const call = await FunctionCall.schema.parseAsync(rawCalls[0])
		const noFromInstance = instances.get(call.to.toString())
		if (!noFromInstance) {
			throw new Error("Contract not found")
		}
		const noFromArtifact = artifacts.get(noFromInstance.currentContractClassId.toString())
		if (!noFromArtifact) {
			throw new Error("Contract artifact not found")
		}
		const noFromFn = await findFunctionBySelector(noFromArtifact, call.selector.toString())
		if (!noFromFn) {
			throw new Error("Method not found")
		}
		if (call.name !== undefined && call.name !== noFromFn.name) {
			throw new Error(
				`Scope violation: call name "${call.name}" does not match selector's function "${noFromFn.name}" on ${call.to.toString()}`,
			)
		}
		if (noFromFn.functionType !== FunctionType.PRIVATE) {
			throw new Error("DefaultEntrypoint only supports private functions")
		}
		return call
	}

	/** Parse authwits/capsules/extra args from both exec and opts (same merge as
	 *  processAztecJsPayload) through the Zod schemas — the RPC bridge serializes to
	 *  plain objects. */
	private async parseNoFromExtras(op: AztecSendTxOperation): Promise<{
		parsedAuthWits: AuthWitness[]
		parsedCapsules: Capsule[]
		parsedExtraArgs: HashedValues[]
	}> {
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
		return { parsedAuthWits, parsedCapsules, parsedExtraArgs }
	}

	public async buildNoFrom(op: AztecSendTxOperation, parentTask?: WrappedTask): Promise<BuiltNoFromTx> {
		const step = new StepContent("Processing transaction")
		const task = parentTask ? parentTask.startSubtask(step) : this.taskService.startNewTask(step)

		try {
			this.log(`buildNoFrom: starting, accountAddress=${op.accountAddress}, networkId=${op.networkId}`)
			const profile = await requireActiveProfile(this.profileService, "Wallet locked")

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
			this.log(`buildNoFrom: registering contracts, callAddresses=${callAddresses.length}, unique=${uniqueAddresses.length}`)
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
			const call = await this.resolveNoFromCall(op, instances, artifacts)
			const { parsedAuthWits, parsedCapsules, parsedExtraArgs } = await this.parseNoFromExtras(op)

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
			// A NO_FROM build never wraps an account ctor (it targets a contract
			// entrypoint directly), so it can never lose an initialization race.
			return {
				initializesAccount: false,
				txRequest,
				node,
				pxe,
				account,
				network,
				chainIdentity: { l1ChainId: nodeInfo.l1ChainId, rollupVersion: nodeInfo.rollupVersion },
				txCalls,
				pendingPublicAuthwits: [],
				// NO_FROM gasSettings are ALREADY capped by construction — the
				// `GasSettings.fallback` above uses these limits directly.
				txsLimits: new Gas(nodeInfo.txsLimits.gas.daGas, nodeInfo.txsLimits.gas.l2Gas),
			}
		} catch (error) {
			task.fail(error)
			throw error
		}
	}

	private log(...data: unknown[]): void {
		this.logger.log(LOG_SOURCE, LogLevel.Debug, ...data)
	}
}
