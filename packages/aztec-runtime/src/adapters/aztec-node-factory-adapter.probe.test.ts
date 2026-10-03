/**
 * `probeChainId`'s composite, apart from the transport tests: the node client is mocked, which a
 * hoisted `vi.mock` would impose on every test in the real-transport file.
 */
import { describe, expect, test, vi } from "vitest"

const nodeInfo = vi.hoisted(() => ({ l1ChainId: 0, rollupVersion: 0 }))

vi.mock("@aztec-labs/stdlib/interfaces/client", async (importOriginal) => ({
	...(await importOriginal<typeof import("@aztec-labs/stdlib/interfaces/client")>()),
	createAztecNodeClient: vi.fn(() => ({ getNodeInfo: async () => ({ ...nodeInfo }) })),
}))

const { AztecNodeFactoryAdapter } = await import("./aztec-node-factory-adapter")

describe("AztecNodeFactoryAdapter.probeChainId", () => {
	test.each([
		{ l1ChainId: 11155111, rollupVersion: 2914217885, expected: 2904119610 },
		{ l1ChainId: 1, rollupVersion: 2 ** 31, expected: 2147483649 },
	])("($l1ChainId, $rollupVersion) probes as the unsigned composite $expected", async ({ l1ChainId, rollupVersion, expected }) => {
		Object.assign(nodeInfo, { l1ChainId, rollupVersion })
		await expect(new AztecNodeFactoryAdapter().probeChainId("https://rpc.example", 1_000)).resolves.toBe(expected)
	})
})
