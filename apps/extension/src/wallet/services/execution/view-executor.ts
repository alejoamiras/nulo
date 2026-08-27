/**
 * `ViewExecutor` — the read-only dApp RPC family (simulate, utility,
 * profile, metadata/chain-info getters), moved verbatim off the
 * execution facade.
 *
 * No lane deps here by design: these paths take no execution slot, no
 * journal record, and no cancel controller — they are stateless reads
 * (plus PXE-local contract registration as a simulation prerequisite in
 * `executeSimulateUtility`). Service instances are injected directly;
 * there is no seam to swap.
 */

import { type Aliased, ContractInitializationStatus } from "@aztec/aztec.js/wallet"
import { AccountFeePaymentMethodOptions } from "@aztec/entrypoints/account"
import type { ChainInfo } from "@aztec/entrypoints/interfaces"
import { Fr } from "@aztec/foundation/curves/bn254"
import type { PackedPrivateEvent } from "@aztec/pxe/client/bundle"
import { type AbiDecoded, decodeFromAbi, encodeArguments, FunctionCall, FunctionSelector } from "@aztec/stdlib/abi"
import { AuthWitness } from "@aztec/stdlib/auth-witness"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract"
import type { TxProfileResult, TxSimulationResult, UtilityExecutionResult } from "@aztec/stdlib/tx"
import { assertLiveChainIdentity } from "@nulo/aztec-runtime/utils"
import { getErrorMessage } from "@nulo/wallet-core/utils"
import z from "zod"
import type { AccountService } from "@/wallet/services/account/service"
import type { ContactService } from "@/wallet/services/contact/service"
import { type NetworkService, networkInfoFrom } from "@/wallet/services/network/service"
import type { ProfileService } from "@/wallet/services/profile/service"
import { requireActiveProfile } from "@/wallet/services/profile/require-active-profile"
import type { PxeServiceClient } from "@/wallet/services/pxe/client"
import { type ContractResolver, findFunctionByName, findFunctionBySelector } from "./contract-resolver"
import { rehydrateOptimizablePrefix, runFastPath } from "./fast-path"
import { applyEmbeddedFpcGasCap } from "./fee/embedded-fpc-cap"
import { suggestGasLimits } from "./fee/fee-strategy"
import type { OperationPlanner } from "./operation-planner"
import type {
	AztecExecuteUtilityOperation,
	AztecGetAddressBookOperation,
	AztecGetChainInfoOperation,
	AztecGetContractClassMetadataOperation,
	AztecGetContractMetadataOperation,
	AztecGetPrivateEventsOperation,
	AztecProfileTxOperation,
	AztecSimulateTxOperation,
	SimulateTransactionOperation,
	SimulateUtilityOperation,
} from "./spec"
import type { TxRequestBuilder } from "./tx-request-builder"

export interface ViewExecutorDeps {
	planner: OperationPlanner
	resolver: ContractResolver
	txBuilder: TxRequestBuilder
	pxeService: PxeServiceClient
	profileService: ProfileService
	networkService: NetworkService
	accountService: AccountService
	contactService: ContactService
	logDebug(msg: string, ...rest: unknown[]): void
	logError(msg: string, ...rest: unknown[]): void
}

export class ViewExecutor {
	public constructor(private readonly deps: ViewExecutorDeps) {}

	public async executeSimulateTransaction(op: SimulateTransactionOperation): Promise<unknown> {
		const { txRequest, pxe, account } = await this.deps.txBuilder.buildStandard(
			op,
			AccountFeePaymentMethodOptions.PREEXISTING_FEE_JUICE,
		)
		const simulatedTx = await pxe.simulateTx(txRequest, {
			simulatePublic: op.simulatePublic ?? false,
			skipFeeEnforcement: true,
			scopes: [account.address],
		})
		return {
			gasUsed: simulatedTx.gasUsed,
			privateReturn: simulatedTx.getPrivateReturnValues(),
			publicReturn: simulatedTx.getPublicReturnValues(),
		}
	}

	public async executeSimulateUtility(op: SimulateUtilityOperation): Promise<AbiDecoded> {
		const profile = await requireActiveProfile(this.deps.profileService, "Wallet locked")
		const network = await this.deps.networkService.getNetwork(op.networkId)
		const account = await this.deps.accountService.getAccountContract(profile.id, network.chainId, op.accountAddress)

		const pxe = this.deps.pxeService.getPXE(networkInfoFrom(network))

		const registeredContracts = new Set<string>((await pxe.getContracts()).map((x) => x.toString()))
		if (!registeredContracts.has(op.contract)) {
			const [_, instance] = await this.deps.resolver.resolveInstance(pxe, op.contract)
			const [__, artifact] = await this.deps.resolver.resolveArtifact(pxe, instance.currentContractClassId.toString())
			this.deps.logDebug("Register contract")
			await pxe.registerContract({ instance, artifact })
		}

		const [_, instance] = await this.deps.resolver.resolveInstance(pxe, op.contract)
		const [__, artifact] = await this.deps.resolver.resolveArtifact(pxe, instance.currentContractClassId.toString())

		const fn = findFunctionByName(artifact, op.method)
		if (!fn) {
			throw new Error("Method not found")
		}
		const fnSelector = await FunctionSelector.fromNameAndParameters(fn.name, fn.parameters)
		const encodedArgs = encodeArguments(fn, op.args)
		const call = new FunctionCall(
			fn.name,
			AztecAddress.fromStringUnsafe(op.contract),
			fnSelector,
			fn.functionType,
			false,
			fn.isStatic,
			encodedArgs,
			fn.returnTypes,
		)

		await account.ensureRegistered(pxe)
		const { result } = await pxe.executeUtility(call, {
			scopes: [account.address],
		})

		try {
			return decodeFromAbi(fn.returnTypes, result)
		} catch (error) {
			// `result` is the decoded return of a call executed under the user's own account scope —
			// live private contract state. The expected types and the arity are what diagnose a
			// decode mismatch; the values are the leak.
			this.deps.logError(
				"Failed to decode simulation results",
				fn.returnTypes,
				{ returnValueCount: Array.isArray(result) ? result.length : 0 },
				getErrorMessage(error),
			)
			return result as AbiDecoded
		}
	}

	public async executeAztecGetContractClassMetadata(
		op: AztecGetContractClassMetadataOperation,
	): Promise<{ isContractClassPubliclyRegistered: boolean; isArtifactRegistered: boolean }> {
		const network = await this.deps.networkService.getNetwork(op.networkId)
		const artifact = await this.deps.pxeService.getContractArtifact(networkInfoFrom(network), op.id, { pxeOnly: true })
		return {
			isContractClassPubliclyRegistered: !!artifact,
			isArtifactRegistered: !!artifact,
		}
	}

	public async executeAztecGetContractMetadata(op: AztecGetContractMetadataOperation): Promise<{
		instance?: ContractInstanceWithAddress
		initializationStatus: ContractInitializationStatus
		isContractPublished: boolean
		isContractUpdated: boolean
		updatedContractClassId?: Fr
	}> {
		const network = await this.deps.networkService.getNetwork(op.networkId)

		// Check PXE-local only: simulation requires both instance AND artifact
		// registered in PXE. The full cascade (node/known/registry) finds on-chain
		// data that PXE can't use for simulation.
		const localInstance = await this.deps.pxeService.getContractInstance(networkInfoFrom(network), op.address, { pxeOnly: true })

		let hasArtifact = false
		if (localInstance) {
			try {
				const artifact = await this.deps.pxeService.getContractArtifact(
					networkInfoFrom(network),
					localInstance.currentContractClassId,
					{ pxeOnly: true },
				)
				hasArtifact = !!artifact
			} catch {
				hasArtifact = false
			}
		}

		const isLocallyRegistered = !!localInstance && hasArtifact

		// `isContractPublished` is a best-effort flag — the wallet-sdk doc treats
		// it as a hint, not a guarantee. `nodeBestEffort: true` keeps a transient
		// node failure (testnet RPC noise) from failing the whole metadata call;
		// the local known-bundle fallback still runs underneath.
		let isPublished = isLocallyRegistered
		if (!isPublished) {
			const fullInstance = await this.deps.pxeService.getContractInstance(networkInfoFrom(network), op.address, {
				nodeBestEffort: true,
			})
			isPublished = !!fullInstance
		}

		return {
			instance: isLocallyRegistered ? localInstance : undefined,
			initializationStatus: isLocallyRegistered ? ContractInitializationStatus.INITIALIZED : ContractInitializationStatus.UNKNOWN,
			isContractPublished: isPublished,
			isContractUpdated: false,
			updatedContractClassId: undefined,
		}
	}

	public async executeAztecGetPrivateEvents(op: AztecGetPrivateEventsOperation): Promise<PackedPrivateEvent[]> {
		const network = await this.deps.networkService.getNetwork(op.networkId)
		return this.deps.pxeService.getPrivateEvents(networkInfoFrom(network), op.eventMetadata.eventSelector, op.eventFilter)
	}

	public async executeAztecGetChainInfo(op: AztecGetChainInfoOperation): Promise<ChainInfo> {
		const network = await this.deps.networkService.getNetwork(op.networkId)
		const node = await this.deps.networkService.getNode(network.chainId)
		const nodeInfo = await node.getNodeInfo()
		// F-012 / A-01 V-01: this API returns chain identity to the dApp.
		// A drifted RPC must be reported as a mismatch rather than silently
		// reporting whatever the RPC claims.
		assertLiveChainIdentity(network, nodeInfo)
		return { chainId: new Fr(nodeInfo.l1ChainId), version: new Fr(nodeInfo.rollupVersion) }
	}

	public async executeAztecGetAddressBook(_op: AztecGetAddressBookOperation): Promise<Aliased<AztecAddress>[]> {
		// TODO: filter by chainId
		return (await this.deps.contactService.getContacts()).map((x) => ({
			alias: x.name,
			item: AztecAddress.fromStringUnsafe(x.address),
		}))
	}

	public async executeAztecSimulateTx(op: AztecSimulateTxOperation): Promise<TxSimulationResult> {
		if (op.accountAddress !== op.opts?.from?.toString()) {
			throw new Error("Invalid `opts.from`")
		}

		// Mixed-payload fast path. The public-static *prefix* of
		// `op.exec.calls` runs directly against the node via
		// `simulateViaNode`; the remainder goes through PXE in parallel;
		// upstream's `buildMergedSimulationResult` stitches them back in
		// payload order. Mirrors `BaseWallet.simulateTx`.
		//
		// First-tx multicall init exception: when the user's account
		// hasn't sent its first tx yet, `nulo-account.buildTxExecutionRequest`
		// wraps `[ctor, entrypoint(appCalls)]` via `DefaultMultiCallEntrypoint`,
		// producing a doubly-nested execution tree. Upstream's flat
		// `appCallOffset` model can't express that. For mixed-with-remainder
		// payloads in this state, route entirely to the standard path; pure-
		// prefix is still optimized because `simulateViaNode` bypasses the
		// account entirely.
		const split = rehydrateOptimizablePrefix(op.exec?.calls)
		if (split === null) {
			return this.executeAztecSimulateTxStandard(op)
		}
		const { optimizableCalls, remainingRaw } = split

		const profile = await requireActiveProfile(this.deps.profileService, "Wallet locked")
		const network = await this.deps.networkService.getNetwork(op.networkId)
		const node = await this.deps.networkService.getNode(network.chainId)

		if (remainingRaw.length > 0) {
			const account = await this.deps.accountService.getAccountContract(profile.id, network.chainId, op.accountAddress)
			const needsInit = await account.requiresInitialization(node)
			if (needsInit) {
				// Mixed + first-tx → don't try to merge. The naive "normalize
				// the standard arm's private-execution tree onto the inner
				// entrypoint subtree" approach was audited (codex 019e1912
				// + opus 4.7, 2026-05-12) and rejected because:
				//   • publicInputs.gasUsed IS dApp-visible via
				//     TxSimulationResult.gasUsed and would over-report
				//     (ctor gas leaks into the projected result).
				//   • firstNullifier of the multicall result IS the account
				//     init nullifier; carrying it onto an entrypoint-rooted
				//     tree is semantically wrong.
				// See wallets-architecture-research/synthesis/
				// implementation-plan-p1-p3.md "Tracked follow-ups" §4 for
				// the trigger conditions to revisit.
				return this.executeAztecSimulateTxStandard(op)
			}
		}

		const pxe = this.deps.pxeService.getPXE(networkInfoFrom(network))

		const result = await runFastPath({
			node,
			pxe,
			network,
			fromAddr: AztecAddress.fromStringUnsafe(op.accountAddress),
			opts: op.opts,
			optimizableCalls,
			remainingRaw,
			runStandardArm: async (rawCalls) =>
				this.executeAztecSimulateTxStandard({ ...op, exec: { ...op.exec, calls: rawCalls as never } }),
			// Naive — upstream uses it only for error contextualization;
			// no functional impact on sim correctness.
			getContractName: async () => undefined,
			logError: (msg, err) => this.deps.logError(msg, err),
		})
		if (result === null) {
			return this.executeAztecSimulateTxStandard(op)
		}
		return result
	}

	/** Standard path: full PXE simulation through the account entrypoint
	 *  (with stub-account override). Used when the fast path's
	 *  `tryRehydratePureStaticPayload` returns `null` (any non-public-
	 *  static call disqualifies the fast path), when no node block is
	 *  synced, or when a fast-path-exclusive operation throws and signals
	 *  fallback. */
	private async executeAztecSimulateTxStandard(op: AztecSimulateTxOperation): Promise<TxSimulationResult> {
		const { actions, feePaymentMethod, feeOptions: fee } = await this.deps.planner.processAztecJsPayload(op.exec, op.opts)
		// Thread the dApp's `opts.fee.gasSettings` (including
		// `maxPriorityFeesPerGas`) so `nulo-account.ts`'s
		// `completeFeeOptions` call uses the dApp-supplied values rather
		// than silently defaulting from `node.getCurrentMinFees() * 1.5`.
		const { txRequest, node, pxe, account } = await this.deps.txBuilder.buildStandard(
			{ ...op, actions },
			feePaymentMethod,
			undefined,
			op.opts.fee?.gasSettings,
		)
		suggestGasLimits(txRequest, fee)
		await applyEmbeddedFpcGasCap(txRequest, fee, node)
		const additionalScopes = Array.isArray(op.opts.additionalScopes) ? op.opts.additionalScopes : []
		// Thread `stubAccountAddresses` so the simulated account contract
		// is the stubbed pass-through one (override path at
		// `pxe/service.ts:233-246`). Real signing keys never enter PXE
		// during a dApp `simulateTx` — defense-in-depth for read-heavy
		// dApp flows. The third-arg pattern matches `executeNoFromSendTx`'s
		// kernelless discovery sim, so the override mechanism is exercised
		// identically across all dApp-facing sim paths.
		return pxe.simulateTx(
			txRequest,
			{
				simulatePublic: true,
				skipTxValidation: op.opts.skipTxValidation,
				skipFeeEnforcement: op.opts.skipFeeEnforcement ?? true,
				scopes: [account.address, ...additionalScopes],
			},
			[account.address.toString()],
		)
	}

	public async executeAztecExecuteUtility(op: AztecExecuteUtilityOperation): Promise<UtilityExecutionResult> {
		const profile = await requireActiveProfile(this.deps.profileService, "Wallet locked")
		const network = await this.deps.networkService.getNetwork(op.networkId)
		const account = await this.deps.accountService.getAccountContract(profile.id, network.chainId, op.accountAddress)
		const pxe = this.deps.pxeService.getPXE(networkInfoFrom(network))
		await account.ensureRegistered(pxe)
		// F-02: bind the dApp-supplied `name` to the SELECTOR's real function
		// before executing. `checkExecuteUtility` (method-scope-checkers) authorizes
		// on `call.name`, but `pxe.executeUtility` dispatches by `call.selector`.
		// Without this bind a dApp scoped for `symbol` could send
		// `{name:"symbol", selector:<balance_of_private>}` — scope passes on the
		// name, PXE runs the selector and returns the user's PRIVATE state. Resolve
		// the ABI, reject a name/selector mismatch, and rebuild the call from ABI
		// truth (isStatic/type/returnTypes), mirroring the four tx/authwit sinks.
		// A present-but-mismatched name is rejected; an EMPTY name ("") is also
		// rejected (it is NOT treated as "absent" — doing so let a dApp scope
		// `{function:""}` and sign a different selector silently). Only a genuinely
		// absent (`undefined`) name skips the check, and only a wildcard scope
		// authorizes such a selector-only call.
		// `checkExecuteUtility` validates `to`/`name` presence but NOT `selector`;
		// guard it before dereferencing so a malformed call is a controlled error,
		// not a raw TypeError from `.toString()`.
		if (op.call.to === undefined || op.call.selector === undefined) {
			throw new Error("Malformed executeUtility: call requires a `to` and a `selector`")
		}
		const [, instance] = await this.deps.resolver.resolveInstance(pxe, op.call.to.toString())
		const [, artifact] = await this.deps.resolver.resolveArtifact(pxe, instance.currentContractClassId.toString())
		const fn = await findFunctionBySelector(artifact, op.call.selector.toString())
		if (!fn) {
			throw new Error("Method not found")
		}
		if (op.call.name !== undefined && op.call.name !== fn.name) {
			throw new Error(`Scope violation: call name "${op.call.name}" does not match selector's function "${fn.name}" on ${op.call.to}`)
		}
		const boundCall = new FunctionCall(
			fn.name,
			op.call.to,
			op.call.selector,
			fn.functionType,
			// hideMsgSender only applies to enqueued public calls; a utility read
			// has no msg_sender to hide. Force `false` (matching executeSimulateUtility)
			// rather than trust the dApp-supplied flag.
			false,
			fn.isStatic,
			op.call.args,
			fn.returnTypes ?? [],
		)
		return pxe.executeUtility(boundCall, {
			authwits: await z.array(AuthWitness.schema).optional().parseAsync(op.opts.authWitnesses),
			scopes: await z.array(AztecAddress.schema).parseAsync(op.opts.scopes),
		})
	}

	public async executeAztecProfileTx(op: AztecProfileTxOperation): Promise<TxProfileResult> {
		if (op.accountAddress !== op.opts?.from?.toString()) {
			throw new Error("Invalid `opts.from`")
		}
		const { actions, feePaymentMethod, feeOptions: fee } = await this.deps.planner.processAztecJsPayload(op.exec, op.opts)
		const { txRequest, node, pxe } = await this.deps.txBuilder.buildStandard({ ...op, actions }, feePaymentMethod)
		suggestGasLimits(txRequest, fee)
		await applyEmbeddedFpcGasCap(txRequest, fee, node)
		const additionalScopes = Array.isArray(op.opts.additionalScopes) ? op.opts.additionalScopes : []
		return pxe.profileTx(txRequest, {
			profileMode: op.opts.profileMode,
			skipProofGeneration: op.opts.skipProofGeneration,
			scopes: [AztecAddress.fromStringUnsafe(op.accountAddress), ...additionalScopes],
		})
	}
}
