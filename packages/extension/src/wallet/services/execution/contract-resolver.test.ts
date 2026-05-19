/**
 * Unit tests for `ContractResolver`.
 *
 * Uses a fake IPXE — no real PXE, no Aztec crypto. Exercises:
 *   - extractContracts: every authwit + call variant, dedup via Set
 *   - resolveInstance / resolveInstances: happy path + not-found throw
 *   - resolveArtifact / resolveArtifacts: happy path + formatted throw
 *     (`"Contract artifact not found for class ${classId}"` — the
 *     formatted string is load-bearing per codex audit)
 *   - dedup: resolveArtifacts fetches each class id once regardless of
 *     how many instances share it
 */

import { describe, expect, test, vi } from "vitest"
import type { ContractArtifact } from "@aztec/stdlib/abi"
import type { ContractInstanceWithAddress } from "@aztec/stdlib/contract"
import type { ConfigProp, IConfig } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import type { IPXE } from "@nulo/aztec-runtime/pxe"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { Action } from "./spec"
import { ContractResolver } from "./contract-resolver"

/** Minimal IConfig stand-in — avoids ConfigStore's chrome.storage touch
 *  which fires at construction time, before vitest's chrome stub is installed. */
function fakeLogger(): LoggerStore {
	const config: IConfig = {
		onUpdate: new EventHandler<ConfigProp>(),
		get: (() => false) as IConfig["get"],
	}
	return new LoggerStore(config)
}

function fakeInstance(classIdHex: string): ContractInstanceWithAddress {
	return {
		currentContractClassId: { toString: () => classIdHex },
	} as unknown as ContractInstanceWithAddress
}

function fakePxe(
	overrides: Partial<{
		getContractInstance: (addr: unknown) => Promise<ContractInstanceWithAddress | undefined>
		getContractArtifact: (classId: unknown) => Promise<ContractArtifact | undefined>
	}> = {},
): IPXE {
	return {
		getContractInstance: overrides.getContractInstance ?? (async () => fakeInstance("0xaa")),
		getContractArtifact: overrides.getContractArtifact ?? (async () => ({}) as ContractArtifact),
	} as unknown as IPXE
}

describe("ContractResolver.extractContracts", () => {
	const resolver = new ContractResolver(fakeLogger())

	test("returns empty for empty actions", () => {
		expect(resolver.extractContracts([])).toEqual([])
	})

	test("collects call + encoded_call addresses", () => {
		const actions: Action[] = [
			{ kind: "call", contract: "0xAA" } as unknown as Action,
			{ kind: "encoded_call", to: "0xBB" } as unknown as Action,
		]
		expect(resolver.extractContracts(actions).sort()).toEqual(["0xAA", "0xBB"])
	})

	test("collects addresses from add_private_authwit { call, encoded_call }", () => {
		const actions: Action[] = [
			{ kind: "add_private_authwit", content: { kind: "call", contract: "0x10" } } as unknown as Action,
			{ kind: "add_private_authwit", content: { kind: "encoded_call", to: "0x11" } } as unknown as Action,
		]
		expect(resolver.extractContracts(actions).sort()).toEqual(["0x10", "0x11"])
	})

	test("collects addresses from add_public_authwit { call, encoded_call }", () => {
		const actions: Action[] = [
			{ kind: "add_public_authwit", content: { kind: "call", contract: "0x20" } } as unknown as Action,
			{ kind: "add_public_authwit", content: { kind: "encoded_call", to: "0x21" } } as unknown as Action,
		]
		expect(resolver.extractContracts(actions).sort()).toEqual(["0x20", "0x21"])
	})

	test("dedupes duplicate addresses across action kinds", () => {
		const actions: Action[] = [
			{ kind: "call", contract: "0xAA" } as unknown as Action,
			{ kind: "encoded_call", to: "0xAA" } as unknown as Action,
			{ kind: "add_private_authwit", content: { kind: "call", contract: "0xAA" } } as unknown as Action,
		]
		expect(resolver.extractContracts(actions)).toEqual(["0xAA"])
	})

	test("ignores non-call non-authwit actions", () => {
		const actions: Action[] = [{ kind: "add_capsule" } as unknown as Action, { kind: "add_extra_args" } as unknown as Action]
		expect(resolver.extractContracts(actions)).toEqual([])
	})
})

describe("ContractResolver.resolveInstance", () => {
	const resolver = new ContractResolver(fakeLogger())
	const addr = "0x2e5b8006eb66aaa4fb0b7f83d21886cd702af84fd0af5551f06cb0b1d752a2ea"

	test("returns [address, instance] on PXE hit", async () => {
		const pxe = fakePxe({ getContractInstance: vi.fn(async () => fakeInstance("0xaa")) })
		const [a, inst] = await resolver.resolveInstance(pxe, addr)
		expect(a).toBe(addr)
		expect(inst.currentContractClassId.toString()).toBe("0xaa")
	})

	test("throws 'Contract instance not found' on PXE miss", async () => {
		const pxe = fakePxe({ getContractInstance: async () => undefined })
		await expect(resolver.resolveInstance(pxe, addr)).rejects.toThrow(/Contract instance not found/)
	})
})

describe("ContractResolver.resolveInstances", () => {
	const resolver = new ContractResolver(fakeLogger())
	const a = "0x2e5b8006eb66aaa4fb0b7f83d21886cd702af84fd0af5551f06cb0b1d752a2ea"
	const b = "0x135851e2bb11c8f473807ddba4185c45547929f9694a2fc924036a5ef3e88782"

	test("fetches every address in parallel and keys by original address string", async () => {
		const getContractInstance = vi.fn(async (addr: unknown) => {
			const hex = addr!.toString()
			return fakeInstance(`class-${hex.slice(-2)}`)
		})
		const pxe = fakePxe({ getContractInstance })
		const result = await resolver.resolveInstances(pxe, [a, b])
		expect(result.size).toBe(2)
		expect(result.get(a)).toBeDefined()
		expect(result.get(b)).toBeDefined()
		expect(getContractInstance).toHaveBeenCalledTimes(2)
	})

	test("returns empty map for empty input", async () => {
		const pxe = fakePxe()
		const result = await resolver.resolveInstances(pxe, [])
		expect(result.size).toBe(0)
	})
})

describe("ContractResolver.resolveArtifact", () => {
	const resolver = new ContractResolver(fakeLogger())
	const classId = "0x0a"

	test("returns [classId, artifact] on PXE hit", async () => {
		const getContractArtifact = vi.fn(async () => ({ name: "Token" }) as unknown as ContractArtifact)
		const pxe = fakePxe({ getContractArtifact })
		const [c, art] = await resolver.resolveArtifact(pxe, classId)
		expect(c).toBe(classId)
		expect((art as unknown as { name: string }).name).toBe("Token")
	})

	test("throws the FORMATTED 'Contract artifact not found for class ${classId}' on miss", async () => {
		const pxe = fakePxe({ getContractArtifact: async () => undefined })
		await expect(resolver.resolveArtifact(pxe, classId)).rejects.toThrow(/Contract artifact not found for class 0x0a/)
	})
})

describe("ContractResolver.resolveArtifacts", () => {
	const resolver = new ContractResolver(fakeLogger())

	test("dedupes by class id — one fetch per unique class", async () => {
		const instances = new Map<string, ContractInstanceWithAddress>()
		instances.set("0xAA", fakeInstance("0x01"))
		instances.set("0xBB", fakeInstance("0x01")) // same class id
		instances.set("0xCC", fakeInstance("0x02")) // different

		const getContractArtifact = vi.fn(async () => ({}) as ContractArtifact)
		const pxe = fakePxe({ getContractArtifact })
		const result = await resolver.resolveArtifacts(pxe, instances)

		expect(result.size).toBe(2)
		expect(result.has("0x01")).toBe(true)
		expect(result.has("0x02")).toBe(true)
		// Only 2 unique class ids → only 2 PXE calls despite 3 instances.
		expect(getContractArtifact).toHaveBeenCalledTimes(2)
	})

	test("returns empty map for empty instances", async () => {
		const pxe = fakePxe()
		const result = await resolver.resolveArtifacts(pxe, new Map())
		expect(result.size).toBe(0)
	})
})
