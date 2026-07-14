/**
 * Thin adapter over upstream @aztec/accounts/schnorr.
 * Keeps our IAccountContract surface (for DI + cross-process PXE) while delegating
 * payload encoding, signing, and entrypoint semantics to the canonical Aztec SDK.
 */
import { Fr } from "@aztec/foundation/curves/bn254"
import { FunctionSelector, type ContractArtifact } from "@aztec/stdlib/abi"
import { FunctionCall } from "@aztec/stdlib/abi"
import type { AztecAddress } from "@aztec/stdlib/aztec-address"
import type { AuthWitness } from "@aztec/stdlib/auth-witness"
import {
	CompleteAddress,
	computePartialAddress,
	type ContractInstanceWithAddress,
	getContractInstanceFromInstantiationParams,
} from "@aztec/stdlib/contract"
import type { GasSettings } from "@aztec/stdlib/gas"
import { computeSiloedPrivateInitializationNullifier } from "@aztec/stdlib/hash"
import type { AztecNode } from "@aztec/stdlib/interfaces/client"
import { deriveKeys } from "@aztec/stdlib/keys"
import { ExecutionPayload, type TxExecutionRequest } from "@aztec/stdlib/tx"
import { SchnorrAccountContract, SchnorrAccountContractArtifact } from "@aztec/accounts/schnorr"
import { deriveNuloAccountKeys } from "@nulo/wallet-crypto"
import { AccountFeePaymentMethodOptions, DefaultAccountEntrypoint, type DefaultAccountEntrypointOptions } from "@aztec/entrypoints/account"
import { DefaultMultiCallEntrypoint } from "@aztec/entrypoints/multicall"
import { APP_MAX_CALLS } from "@aztec/entrypoints/encoding"
import type { ChainInfo } from "@aztec/entrypoints/interfaces"
import type { AuthWitnessProvider } from "@aztec/entrypoints/interfaces"
import { LogLevel, type ILogger } from "@nulo/wallet-core/logger"
import type { IPXE } from "../pxe/ipxe"
import { completeFeeOptions, type PartialGasSettingsRPC } from "./fee-options"
import type { IAccountContract } from "."

export class NuloAccount implements IAccountContract {
	public readonly name = "nulo-v1"
	public readonly address: AztecAddress
	public readonly artifact: ContractArtifact = SchnorrAccountContractArtifact

	private readonly entrypoint: DefaultAccountEntrypoint
	private readonly authWitnessProvider: AuthWitnessProvider

	constructor(
		// The derived privacy secret key (NEVER the seed and NEVER the signing key): it is the only
		// key material this class hands to the PXE, and the signing key is not recoverable from it.
		private readonly secretKey: Fr,
		private readonly instance: ContractInstanceWithAddress,
		private readonly completeAddress: CompleteAddress,
		private readonly signingAccountContract: SchnorrAccountContract,
		private readonly logger: ILogger,
	) {
		this.address = instance.address
		this.authWitnessProvider = signingAccountContract.getAuthWitnessProvider(completeAddress)
		this.entrypoint = new DefaultAccountEntrypoint(this.address, this.authWitnessProvider)
	}

	public static async new(seed: Fr, logger: ILogger): Promise<NuloAccount> {
		// Signing-key-root model (NULO-ACCOUNT-KDF v1): the seed derives the signing key (the
		// ownership root); the privacy secret derives one-way FROM the signing key.
		const { signingKey, secretKey } = await deriveNuloAccountKeys(seed)
		const keys = await deriveKeys(secretKey)
		const accountContract = new SchnorrAccountContract(signingKey)
		const init = await accountContract.getInitializationFunctionAndArgs()
		if (!init) {
			throw new Error("Schnorr account contract is missing its initializer")
		}
		const { constructorName, constructorArgs } = init
		const instance = await getContractInstanceFromInstantiationParams(SchnorrAccountContractArtifact, {
			constructorArgs,
			constructorArtifact: constructorName,
			publicKeys: keys.publicKeys,
			salt: Fr.ZERO,
			immutablesHash: await accountContract.getImmutablesHash(),
		})
		const completeAddress = await CompleteAddress.fromSecretKeyAndInstance(secretKey, instance)
		return new NuloAccount(secretKey, instance, completeAddress, accountContract, logger)
	}

	public async ensureRegistered(pxe: IPXE): Promise<void> {
		const accounts = await pxe.getRegisteredAccounts()
		if (!accounts.find((x) => x.address.toString() === this.address.toString())) {
			this.logger.log(this.name, LogLevel.Debug, "register account...")
			const registered = await pxe.registerAccount(this.secretKey, await computePartialAddress(this.instance))
			if (!registered.address.equals(this.address)) {
				throw new Error(
					`registered account address mismatch: PXE=${registered.address.toString()} expected=${this.address.toString()}`,
				)
			}
		}
	}

	public async ensureContractRegistered(pxe: IPXE): Promise<void> {
		const instance = await pxe.getContractInstance(this.address)
		if (!instance) {
			this.logger.log(this.name, LogLevel.Debug, "register contract...")
			await pxe.registerContract({ instance: this.instance, artifact: this.artifact })
		}
	}

	public async getCompleteAddress(): Promise<CompleteAddress> {
		return this.completeAddress
	}

	public async createAuthWit(messageHash: Fr): Promise<AuthWitness> {
		return this.authWitnessProvider.createAuthWit(messageHash)
	}

	public async buildTxExecutionRequest(
		node: AztecNode,
		pxe: IPXE,
		payload: ExecutionPayload,
		options: DefaultAccountEntrypointOptions,
		chainInfo: ChainInfo,
		gasSettingsRPC?: PartialGasSettingsRPC,
	): Promise<TxExecutionRequest> {
		// Use the shared `completeFeeOptions` translator so both the
		// standard and fast paths produce identical `GasSettings` for
		// identical inputs. Mirrors upstream
		// `BaseWallet.completeFeeOptions({forEstimation:true, ...})`
		// byte-for-byte:
		//   - `maxFeesPerGas` defaults from `node.getCurrentMinFees() * 1.5`
		//   - `maxPriorityFeesPerGas` defaults to `GasFees.empty()`
		// Hardcoded `1e18 / 1e18` constants are not used — drift between
		// fast and standard paths is eliminated.
		const gasSettings = await completeFeeOptions({
			node,
			gasSettings: gasSettingsRPC,
			forEstimation: true,
		})

		// Recursively chunk payloads exceeding APP_MAX_CALLS by wrapping slices through
		// the account entrypoint, so every nesting layer gets its own outer-authwit hash.
		let current = payload
		while (current.calls.length > APP_MAX_CALLS) {
			current = await this.chunkHead(current, chainInfo)
		}

		await this.ensureRegistered(pxe)
		await this.ensureContractRegistered(pxe)

		const initNullifier = await computeSiloedPrivateInitializationNullifier(this.address, this.instance.initializationHash)
		const initWitness = await node.getNullifierMembershipWitness("latest", initNullifier)
		if (!initWitness) {
			this.logger.log(this.name, LogLevel.Debug, "init nullifier NOT found, wrapping deploy + entrypoint via MulticallEntrypoint")
			return this.buildWithInitialization(current, chainInfo, gasSettings, options)
		}

		return this.entrypoint.createTxExecutionRequest(current, gasSettings, chainInfo, options)
	}

	/** See `IAccountContract.requiresInitialization`. Reuses the same
	 *  init-nullifier check `buildTxExecutionRequest` performs internally,
	 *  exposed so the mixed-payload orchestrator can detect first-tx state
	 *  without reaching through `NuloAccount.instance` from outside. */
	public async requiresInitialization(node: AztecNode): Promise<boolean> {
		const initNullifier = await computeSiloedPrivateInitializationNullifier(this.address, this.instance.initializationHash)
		const witness = await node.getNullifierMembershipWitness("latest", initNullifier)
		return witness === undefined
	}

	/**
	 * Take the first APP_MAX_CALLS calls, wrap them via the account entrypoint (each wrap signs
	 * its own outer-authwit), and keep the remainder. Loop at call-site until `calls.length <= APP_MAX_CALLS`.
	 */
	private async chunkHead(payload: ExecutionPayload, chainInfo: ChainInfo): Promise<ExecutionPayload> {
		const head = payload.calls.slice(0, APP_MAX_CALLS)
		const tail = payload.calls.slice(APP_MAX_CALLS)
		const chunkOptions: DefaultAccountEntrypointOptions = {
			cancellable: false,
			txNonce: Fr.random(),
			feePaymentMethodOptions: AccountFeePaymentMethodOptions.EXTERNAL,
		}
		const wrapped = await this.entrypoint.wrapExecutionPayload(new ExecutionPayload(head, [], [], []), chainInfo, chunkOptions)
		return new ExecutionPayload(
			[...wrapped.calls, ...tail],
			[...payload.authWitnesses, ...wrapped.authWitnesses],
			[...payload.capsules, ...wrapped.capsules],
			[...payload.extraHashedArgs, ...wrapped.extraHashedArgs],
		)
	}

	/**
	 * First-tx deploy path: wrap [ctor, ...userPayload] via the protocol MulticallEntrypoint so the
	 * tx simultaneously publishes the account and executes the user's first call.
	 */
	private async buildWithInitialization(
		payload: ExecutionPayload,
		chainInfo: ChainInfo,
		gasSettings: GasSettings,
		options: DefaultAccountEntrypointOptions,
	): Promise<TxExecutionRequest> {
		const wrappedApp = await this.entrypoint.wrapExecutionPayload(payload, chainInfo, options)

		const ctorFn =
			this.artifact.functions.find((x) => x.name === "constructor") ??
			this.artifact.functions.find((x) => x.name.includes("constructor"))
		if (!ctorFn) {
			throw new Error("constructor not found in account artifact")
		}
		const ctorSelector = await FunctionSelector.fromNameAndParameters(ctorFn.name, ctorFn.parameters)
		const schnorrInit = await this.signingAccountContract.getInitializationFunctionAndArgs()
		if (!schnorrInit) {
			throw new Error("Schnorr account contract is missing its initializer")
		}
		const { constructorArgs } = schnorrInit

		const ctorCall = new FunctionCall(
			ctorFn.name,
			this.address,
			ctorSelector,
			ctorFn.functionType,
			false,
			ctorFn.isStatic,
			constructorArgs,
			ctorFn.returnTypes,
		)

		const combined = new ExecutionPayload(
			[ctorCall, ...wrappedApp.calls],
			wrappedApp.authWitnesses,
			wrappedApp.capsules,
			wrappedApp.extraHashedArgs,
		)

		const multicall = new DefaultMultiCallEntrypoint()
		return multicall.createTxExecutionRequest(combined, gasSettings, chainInfo)
	}
}
