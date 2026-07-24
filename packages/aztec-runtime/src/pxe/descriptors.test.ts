import { describe, expect, test, vi } from "vitest"
import { PXE_IPXE_METHODS, PXE_METHOD_DESCRIPTORS } from "./descriptors"
import type { NetworkInfo } from "./chain-runtime"
import type { PxeServiceClientBase } from "./client"
import { PXEProxy } from "./proxy"

/** The deliberate `Methods` − `IPXE` delta: SW-side only, never per-network in-process. */
const SW_ONLY = [
	"getNoteSchemas",
	"getBlockTimestamp",
	"clearChainState",
	"getPublicTokenTransferEvents",
	"getPublicScanTips",
	"getPublicTokenClassStatus",
] as const

describe("PXE_METHOD_DESCRIPTORS", () => {
	test("covers the full 25-method surface with every flag explicit", () => {
		const names = Object.keys(PXE_METHOD_DESCRIPTORS)
		expect(names).toHaveLength(25)
		for (const name of names) {
			const d = PXE_METHOD_DESCRIPTORS[name as keyof typeof PXE_METHOD_DESCRIPTORS]
			expect(typeof d.rpc).toBe("boolean")
			expect(typeof d.ipxe).toBe("boolean")
			expect(typeof d.requiresNetwork).toBe("boolean")
		}
	})

	test("derives the 17-method in-process subset with no duplicates", () => {
		expect(PXE_IPXE_METHODS).toHaveLength(17)
		expect(new Set(PXE_IPXE_METHODS).size).toBe(17)
	})

	test("excludes the SW-only methods from the in-process subset", () => {
		// The type asserts in descriptors.ts enforce the inclusion side
		// (keyof IPXE === the ipxe:true keys); this pins the exclusion rationale.
		for (const swOnly of SW_ONLY) {
			expect(PXE_METHOD_DESCRIPTORS[swOnly].ipxe).toBe(false)
			expect(PXE_IPXE_METHODS as readonly string[]).not.toContain(swOnly)
		}
	})

	test("every in-process method is network-curried (ipxe implies requiresNetwork)", () => {
		for (const name of PXE_IPXE_METHODS) {
			expect(PXE_METHOD_DESCRIPTORS[name].requiresNetwork).toBe(true)
		}
	})
})

describe("PXEProxy (generated from the descriptor table)", () => {
	const network = { id: "net1", chainId: 1 } as unknown as NetworkInfo

	const makeSpyService = () => {
		const svc: Record<string, ReturnType<typeof vi.fn>> = {}
		for (const name of PXE_IPXE_METHODS) {
			svc[name] = vi.fn(async () => `${name}-result`)
		}
		return svc
	}

	test("exposes exactly the ipxe subset as prototype methods — and nothing SW-only", () => {
		const proxy = new PXEProxy(makeSpyService() as unknown as PxeServiceClientBase, network)
		for (const name of PXE_IPXE_METHODS) {
			expect(typeof (proxy as unknown as Record<string, unknown>)[name]).toBe("function")
		}
		for (const swOnly of SW_ONLY) {
			expect((proxy as unknown as Record<string, unknown>)[swOnly]).toBeUndefined()
		}
	})

	test("every method curries the bound network FIRST and threads args + result verbatim", async () => {
		const svc = makeSpyService()
		const proxy = new PXEProxy(svc as unknown as PxeServiceClientBase, network) as unknown as Record<
			string,
			(...args: unknown[]) => Promise<unknown>
		>
		const a = { some: "arg" }
		const b = ["second"]
		for (const name of PXE_IPXE_METHODS) {
			const result = await proxy[name](a, b)
			expect(svc[name]).toHaveBeenCalledTimes(1)
			expect(svc[name]).toHaveBeenCalledWith(network, a, b)
			expect(result).toBe(`${name}-result`)
		}
	})

	test("installed methods keep their own .name (stack-trace parity with hand-written methods)", () => {
		const proxy = new PXEProxy(makeSpyService() as unknown as PxeServiceClientBase, network) as unknown as Record<
			string,
			(...args: unknown[]) => unknown
		>
		for (const name of PXE_IPXE_METHODS) {
			expect(proxy[name].name).toBe(name)
		}
	})
})
