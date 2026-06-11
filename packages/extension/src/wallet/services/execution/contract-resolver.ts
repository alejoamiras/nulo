/**
 * `ContractResolver` — consolidates contract-instance + artifact
 * resolution logic that would otherwise be duplicated between
 * `ExecutionService` and `PxeService`.
 *
 * Five methods, nothing else. No state, no storage, no locks. PXE
 * access is passed per-call so the resolver stays a pure helper.
 *
 *   - Walk an `Action[]` to collect every contract address referenced
 *     (authwit targets + call destinations).
 *   - Fetch the `ContractInstanceWithAddress` for each in parallel.
 *   - Deduplicate by class id and fetch the matching `ContractArtifact`s.
 *
 * ## Error contract (frozen by call site)
 *
 *   - `resolveInstance` → throws `"Contract instance not found"` when
 *     PXE returns undefined for the address. Callers match on this
 *     exact string.
 *   - `resolveArtifact` → throws
 *     `"Contract artifact not found for class ${classId}"`. The formatted
 *     variant is load-bearing — don't collapse to the bare string.
 *
 * Downstream consumers (`TxRequestBuilder`, `AuthwitDiscoverer`) take
 * this resolver as a constructor dep and do not reach back into the
 * facade's private state.
 */

import { Fr } from "@aztec/foundation/curves/bn254"
import { type ContractArtifact, type FunctionAbi, FunctionSelector } from "@aztec/stdlib/abi"
import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract"
import { AztecAddress } from "@aztec/stdlib/aztec-address"
import { type ILogger, LogLevel } from "@/wallet/logger"
import type { IPXE } from "@nulo/aztec-runtime/pxe"
import type { Action, AddPrivateAuthwitAction, AddPublicAuthwitAction, CallAuthwitContent, EncodedCallAuthwitContent } from "./spec"

const LOG_SOURCE = "ContractResolver"

/** Find a function ABI by name. Lookup order is FROZEN: `functions[]`
 *  first, then `nonDispatchPublicFunctions[]` — callers across the
 *  execution layer depend on a name collision resolving to the
 *  dispatch-able entry. Returns `undefined` when absent; callers own
 *  their (frozen) error text. */
export function findFunctionByName(artifact: ContractArtifact, name: string): FunctionAbi | undefined {
	return artifact.functions.find((x) => x.name === name) ?? artifact.nonDispatchPublicFunctions.find((x) => x.name === name)
}

/** Find a function ABI by selector string. Same frozen lookup order as
 *  `findFunctionByName`. Async because selector derivation is. Returns
 *  `undefined` when absent; callers own their error text. */
export async function findFunctionBySelector(artifact: ContractArtifact, selector: string): Promise<FunctionAbi | undefined> {
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

export class ContractResolver {
	public constructor(private readonly logger: ILogger) {}

	/** Extract every unique contract address an action list references —
	 *  authwit targets (call + encoded_call variants × private + public)
	 *  plus direct call destinations. Order-unspecified; dedup via `Set`. */
	public extractContracts(actions: Action[]): string[] {
		return [
			...new Set(
				actions
					.filter((x) => x.kind === "add_private_authwit" && x.content.kind === "call")
					.map((x) => ((x as AddPrivateAuthwitAction).content as CallAuthwitContent).contract)
					.concat(
						actions
							.filter((x) => x.kind === "add_private_authwit" && x.content.kind === "encoded_call")
							.map((x) => ((x as AddPrivateAuthwitAction).content as EncodedCallAuthwitContent).to),
					)
					.concat(
						actions
							.filter((x) => x.kind === "add_public_authwit" && x.content.kind === "call")
							.map((x) => ((x as AddPublicAuthwitAction).content as CallAuthwitContent).contract),
					)
					.concat(
						actions
							.filter((x) => x.kind === "add_public_authwit" && x.content.kind === "encoded_call")
							.map((x) => ((x as AddPublicAuthwitAction).content as EncodedCallAuthwitContent).to),
					)
					.concat(actions.filter((x) => x.kind === "call").map((x) => x.contract))
					.concat(actions.filter((x) => x.kind === "encoded_call").map((x) => x.to)),
			),
		]
	}

	/** Fetch a single `ContractInstanceWithAddress` from PXE. Throws
	 *  `"Contract instance not found"` if PXE returns undefined. */
	public async resolveInstance(pxe: IPXE, contract: string): Promise<[string, ContractInstanceWithAddress]> {
		const instance = await pxe.getContractInstance(AztecAddress.fromString(contract))
		if (!instance) {
			throw new Error("Contract instance not found")
		}
		return [contract, instance]
	}

	/** Fetch instances for every address in `contracts`. Parallel fetch.
	 *  Returns a `Map` keyed by the original address string. */
	public async resolveInstances(pxe: IPXE, contracts: string[]): Promise<Map<string, ContractInstanceWithAddress>> {
		this.logger.log(LOG_SOURCE, LogLevel.Debug, "Get instances...")
		const instances = new Map<string, ContractInstanceWithAddress>()
		this.logger.log(LOG_SOURCE, LogLevel.Debug, `Fetching ${contracts.length} instances...`)
		const fetched = await Promise.all(contracts.map((x) => this.resolveInstance(pxe, x)))
		this.logger.log(LOG_SOURCE, LogLevel.Debug, `${fetched.length} instances fetched`)
		for (const [address, instance] of fetched) {
			instances.set(address, instance)
		}
		return instances
	}

	/** Fetch a single artifact by class id. Throws
	 *  `"Contract artifact not found for class ${classId}"` — formatted
	 *  variant preserved per audit finding. */
	public async resolveArtifact(pxe: IPXE, classId: string): Promise<[string, ContractArtifact]> {
		const artifact = await pxe.getContractArtifact(Fr.fromString(classId))
		if (!artifact) {
			throw new Error(`Contract artifact not found for class ${classId}`)
		}
		return [classId, artifact]
	}

	/** Register every instance PXE doesn't already know about. One
	 *  `getContracts()` snapshot, then per-instance `registerContract`
	 *  with the matching artifact. Log messages differ per call site, so
	 *  sites pass hooks instead of the helper guessing. */
	public async ensureContractsRegistered(
		pxe: IPXE,
		instances: Map<string, ContractInstanceWithAddress>,
		artifacts: Map<string, ContractArtifact>,
		hooks?: {
			onRegister?: (contract: string, instance: ContractInstanceWithAddress) => void
			onSkip?: (contract: string) => void
		},
	): Promise<void> {
		const registered = new Set<string>((await pxe.getContracts()).map((x) => x.toString()))
		for (const [contract, instance] of instances) {
			if (!registered.has(contract)) {
				hooks?.onRegister?.(contract, instance)
				await pxe.registerContract({
					instance,
					artifact: artifacts.get(instance.currentContractClassId.toString()),
				})
			} else {
				hooks?.onSkip?.(contract)
			}
		}
	}

	/** Fetch artifacts for every UNIQUE class id referenced by `instances`.
	 *  Deduplicates first so we don't refetch a shared artifact. Keyed by
	 *  class-id string. */
	public async resolveArtifacts(pxe: IPXE, instances: Map<string, ContractInstanceWithAddress>): Promise<Map<string, ContractArtifact>> {
		this.logger.log(LOG_SOURCE, LogLevel.Debug, "Get artifacts...")
		const artifacts = new Map<string, ContractArtifact>()
		// Spread into an array before `.filter` — `MapIterator.prototype.filter`
		// is a Stage 4 iterator-helper proposal not yet available on every
		// runtime CI uses (the failure mode is a silent `TypeError: ... is not a
		// function`). Array methods are universally supported.
		const classIds = new Set(
			[...instances.values()]
				.filter((x) => !artifacts.has(x.currentContractClassId.toString()))
				.map((x) => x.currentContractClassId.toString()),
		)
		this.logger.log(
			LOG_SOURCE,
			LogLevel.Debug,
			`Fetching ${classIds.size} artifacts for contracts: ${[...instances.keys()].join(", ")}...`,
		)
		this.logger.log(LOG_SOURCE, LogLevel.Debug, `Class IDs: ${[...classIds].join(", ")}`)
		// Same iterator-helper avoidance as above: spread the Set before `.map`.
		const fetched = await Promise.all([...classIds].map((x) => this.resolveArtifact(pxe, x)))
		this.logger.log(LOG_SOURCE, LogLevel.Debug, `${fetched.length} artifacts fetched`)
		for (const [classId, artifact] of fetched) {
			artifacts.set(classId, artifact)
		}
		return artifacts
	}
}
