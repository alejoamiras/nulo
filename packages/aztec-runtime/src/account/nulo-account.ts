/**
 * Thin adapter over upstream @aztec/accounts/schnorr.
 * Keeps our IAccountContract surface (for DI + cross-process PXE) while delegating
 * payload encoding, signing, and entrypoint semantics to the canonical Aztec SDK.
 */
import { Fr } from "@aztec/foundation/curves/bn254"
import type { ContractArtifact } from "@aztec/stdlib/abi"
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
// The lazy variant: same upstream signing/auth-witness provider, but the npm artifact sits behind
// a dynamic import we never trigger — the vendored copy in `./frozen-artifact` is the only
// artifact this account ever loads (the eager module would double-bundle ~1.4 MB).
import { SchnorrAccountContract } from "@aztec/accounts/schnorr/lazy"
import { deriveSecretKeyFromSigningKey } from "@aztec/accounts/utils"
import { deriveNuloAccountKeys } from "@nulo/wallet-crypto"
import type { GrumpkinScalar } from "@aztec/foundation/curves/grumpkin"
import { AccountFeePaymentMethodOptions, DefaultAccountEntrypoint, type DefaultAccountEntrypointOptions } from "@aztec/entrypoints/account"
import { DefaultMultiCallEntrypoint } from "@aztec/entrypoints/multicall"
import { APP_MAX_CALLS } from "@aztec/entrypoints/encoding"
import type { ChainInfo } from "@aztec/entrypoints/interfaces"
import type { AuthWitnessProvider } from "@aztec/entrypoints/interfaces"
import { LogLevel, type ILogger } from "@nulo/wallet-core/logger"
import type { IPXE } from "../pxe/ipxe"
import { completeFeeOptions, type PartialGasSettingsRPC } from "./fee-options"
import { FrozenSchnorrAccountArtifact } from "./frozen-artifact"
import { FROZEN_INSTANTIATION_DESCRIPTOR, buildFrozenConstructorCall, frozenConstructorArgs } from "./instantiation-descriptor"
import type { IAccountContract } from "."

export class NuloAccount implements IAccountContract {
	public readonly name = "nulo-v1"
	public readonly address: AztecAddress
	public readonly artifact: ContractArtifact = FrozenSchnorrAccountArtifact

	private readonly entrypoint: DefaultAccountEntrypoint
	private readonly authWitnessProvider: AuthWitnessProvider

	private constructor(
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
		// Signing-key-root model (NULO-ACCOUNT-KDF v2): the seed derives the signing key (the
		// ownership root); the privacy secret derives one-way FROM the signing key.
		const { signingKey, secretKey } = await deriveNuloAccountKeys(seed)
		return NuloAccount.fromKeys(signingKey, secretKey, logger)
	}

	/**
	 * Build an account directly from its Schnorr signing key — the entry point for IMPORTED
	 * accounts, which supply the ownership root as external key material (no Nulo seed exists for
	 * them). The privacy secret is re-derived one-way from the signing key, exactly as the seed
	 * path does, so an imported account is a first-class `IAccountContract` indistinguishable
	 * downstream. The frozen artifact/descriptor still fix every non-key input, so the address is
	 * a pure function of the signing key.
	 */
	public static async fromSigningKey(signingKey: GrumpkinScalar, logger: ILogger): Promise<NuloAccount> {
		const secretKey = await deriveSecretKeyFromSigningKey(signingKey)
		return NuloAccount.fromKeys(signingKey, secretKey, logger)
	}

	/** The key-material-agnostic tail shared by `new` (seed-derived) and `fromSigningKey`
	 *  (imported): keys → frozen instance → complete address → account. */
	private static async fromKeys(signingKey: GrumpkinScalar, secretKey: Fr, logger: ILogger): Promise<NuloAccount> {
		const keys = await deriveKeys(secretKey)
		const accountContract = new SchnorrAccountContract(signingKey)
		// Every non-key instantiation input comes from the frozen descriptor — the same source the
		// first-tx constructor call consumes — so derivation and execution cannot split-brain.
		const signingPublicKey = await accountContract.getSigningPublicKey()
		const instance = await getContractInstanceFromInstantiationParams(FrozenSchnorrAccountArtifact, {
			constructorArgs: frozenConstructorArgs(signingPublicKey),
			constructorArtifact: FROZEN_INSTANTIATION_DESCRIPTOR.constructorName,
			publicKeys: keys.publicKeys,
			salt: FROZEN_INSTANTIATION_DESCRIPTOR.salt,
			immutablesHash: FROZEN_INSTANTIATION_DESCRIPTOR.immutablesHash,
			deployer: FROZEN_INSTANTIATION_DESCRIPTOR.deployer,
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
		// PXE-LOCAL ONLY: this asks "is OUR account contract already registered in the PXE?" — a local
		// question. The default node cascade is both wrong (an extension account is ctor-init only and
		// never published on-chain, so the node never has it) and dangerous: against an unreachable node
		// (offline / node-free smoke) the node client retries with backoff and blows the caller's timeout,
		// which wedged the post-restore boot. 5.0.0's PXE returns a preimage, so a local miss cascaded to
		// the node where rc.2 returned the instance directly — pxeOnly restores the offline-safe behavior.
		const instance = await pxe.getContractInstance(this.address, { pxeOnly: true })
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
		outMeta?: { initializesAccount?: boolean },
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
			// Provenance for the send-path classifier: an existing-nullifier
			// rejection is only "duplicate initialization" when THIS build
			// wrapped the ctor — the same text on a non-initializing tx is an
			// ordinary double-spend and must stay generic.
			if (outMeta) outMeta.initializesAccount = true
			return this.buildWithInitialization(current, chainInfo, gasSettings, options)
		}

		if (outMeta) outMeta.initializesAccount = false
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

		// Same frozen descriptor the address derivation consumed — the executed constructor can
		// never drift from the address-committed one.
		const signingPublicKey = await this.signingAccountContract.getSigningPublicKey()
		const ctorCall = await buildFrozenConstructorCall(this.artifact, this.address, signingPublicKey)

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
