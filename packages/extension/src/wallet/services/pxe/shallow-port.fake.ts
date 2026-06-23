/**
 * SHALLOW_PXE_FAKE_BUNDLE_MARKER — the shared, dumb fake of the contract-registry
 * PXE slice (`ShallowPxe`) for in-process composition tests.
 *
 * Lives under `src/` ON PURPOSE so `vue-tsc` typechecks it and `biome` lints it:
 * because it `implements ShallowPxe` structurally, a shape change on the real
 * `IPXE` breaks `typecheck` here — that is the compile-time drift guard. It is
 * imported ONLY by `*.composition.test.ts` files; the production build never
 * imports it, and a CI step greps `dist/chrome|firefox` for the marker (carried
 * as live data on the factory's return, so it survives tree-shaking) and fails
 * on any hit (bundle hygiene). See `packages/extension/tests/COMPOSITION-TESTS.md`.
 *
 * DUMB BY CONTRACT: canned returns + a registered-address set. No Aztec
 * semantics, no proving/simulation (the `ShallowPxe` port can't express them).
 */
import type { ContractArtifact } from "@aztec/stdlib/abi"
import type { AztecAddress } from "@aztec/stdlib/aztec-address"
import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract"
import type { IPXE } from "@/wallet/services/pxe/client"
import type { ShallowPxe, ShallowPxeClient } from "./shallow-port"

/** Grepped out of `dist/chrome` by CI — proves the fake never ships. */
export const SHALLOW_PXE_FAKE_BUNDLE_MARKER = "SHALLOW_PXE_FAKE_BUNDLE_MARKER"

export interface ShallowPxeFakeConfig {
	/** Instances resolved by `address.toString()`. */
	instances?: Map<string, ContractInstanceWithAddress>
	/** Artifacts resolved by `classId.toString()`. */
	artifacts?: Map<string, ContractArtifact>
	/** Addresses the PXE already has registered (drives the dedup branch). */
	registered?: AztecAddress[]
}

export interface ShallowPxeFake {
	client: ShallowPxeClient
	pxe: ShallowPxe
	/** Every `registerContract` call, in order — the registration assertion surface. */
	registerCalls: { instance: ContractInstanceWithAddress; artifact?: ContractArtifact }[]
	/** Live registered-address set (seeded + appended on register) — the dedup lever. */
	registeredAddresses: AztecAddress[]
	/**
	 * The bundle marker, carried as live data on the returned object (NOT just
	 * the exported const above). This guarantees the marker string survives
	 * tree-shaking whenever the factory is bundled — so the `dist/chrome` grep
	 * in `_build-extension.yml` reliably catches a fake that leaked into prod.
	 * (An unused exported const could be tree-shaken away while the factory
	 * ships — codex post-impl audit High.)
	 */
	marker: typeof SHALLOW_PXE_FAKE_BUNDLE_MARKER
}

/** Build a dumb `ShallowPxeClient` whose `getPXE()` returns canned registry data. */
export function makeShallowPxeFake(config: ShallowPxeFakeConfig = {}): ShallowPxeFake {
	const instances = config.instances ?? new Map<string, ContractInstanceWithAddress>()
	const artifacts = config.artifacts ?? new Map<string, ContractArtifact>()
	const registeredAddresses = [...(config.registered ?? [])]
	const registerCalls: { instance: ContractInstanceWithAddress; artifact?: ContractArtifact }[] = []

	const pxe: ShallowPxe = {
		getContractInstance: async (address) => instances.get(address.toString()),
		getContractArtifact: async (id) => artifacts.get(id.toString()),
		getContracts: async () => registeredAddresses,
		registerContract: async (contract) => {
			registerCalls.push(contract)
			registeredAddresses.push(contract.instance.address)
		},
	}

	// The ONE cast: widen the 4-method ShallowPxe to the full IPXE the port
	// returns. The fake's surface is capped at ShallowPxe (it has no simulateTx/
	// proveTx), so a test that reaches a deep path throws loudly at runtime.
	return {
		client: { getPXE: () => pxe as unknown as IPXE },
		pxe,
		registerCalls,
		registeredAddresses,
		marker: SHALLOW_PXE_FAKE_BUNDLE_MARKER,
	}
}
