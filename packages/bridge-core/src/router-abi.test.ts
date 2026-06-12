import { existsSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { SWAP_BRIDGE_ROUTER_ABI } from "./router-abi"

const ARTIFACT = join(
	dirname(fileURLToPath(import.meta.url)),
	"..",
	"..",
	"bridge-evm",
	"out",
	"SwapBridgeRouter.sol",
	"SwapBridgeRouter.json",
)

type AbiParam = { name: string; type: string; indexed?: boolean; components?: AbiParam[] }
const shape = (p: AbiParam): unknown => ({
	name: p.name,
	type: p.type,
	...(p.indexed !== undefined ? { indexed: p.indexed } : {}),
	...(p.components ? { components: p.components.map(shape) } : {}),
})

// The minimal const must match the COMPILED router - drift fails here, not at runtime.
describe.skipIf(!existsSync(ARTIFACT))("router-abi pin (forge artifact)", () => {
	const artifact = JSON.parse(readFileSync(ARTIFACT, "utf8")) as { abi: (AbiParam & { type: string })[] }

	it("bridgeWithFuel inputs match the artifact", () => {
		const real = artifact.abi.find((e) => (e as { name?: string }).name === "bridgeWithFuel") as unknown as {
			inputs: AbiParam[]
		}
		const ours = SWAP_BRIDGE_ROUTER_ABI.find((e) => e.name === "bridgeWithFuel") as unknown as { inputs: AbiParam[] }
		expect(ours.inputs.map(shape)).toEqual(real.inputs.map(shape))
	})

	it("BridgeWithFuel event matches the artifact", () => {
		const real = artifact.abi.find((e) => (e as { name?: string }).name === "BridgeWithFuel") as unknown as {
			inputs: AbiParam[]
		}
		const ours = SWAP_BRIDGE_ROUTER_ABI.find((e) => e.name === "BridgeWithFuel") as unknown as { inputs: AbiParam[] }
		expect(ours.inputs.map(shape)).toEqual(real.inputs.map(shape))
	})
})
