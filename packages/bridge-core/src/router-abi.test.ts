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

// The minimal const must match the COMPILED router - drift fails here, not at runtime. The read is
// LAZY (inside each `it`), never at the describe-factory top level: `skipIf` still runs the factory
// at collection time, so a top-level readFileSync would ENOENT-crash collection wherever forge's
// `out/` isn't built (CI's unit-test job - it doesn't compile contracts). Skipped its never read.
const loadArtifact = () => JSON.parse(readFileSync(ARTIFACT, "utf8")) as { abi: (AbiParam & { type: string })[] }
const inputsOf = (abi: AbiParam[], name: string) =>
	(abi.find((e) => (e as { name?: string }).name === name) as unknown as { inputs: AbiParam[] }).inputs

describe.skipIf(!existsSync(ARTIFACT))("router-abi pin (forge artifact)", () => {
	it("bridgeWithFuel inputs match the artifact", () => {
		const real = inputsOf(loadArtifact().abi, "bridgeWithFuel")
		const ours = inputsOf(SWAP_BRIDGE_ROUTER_ABI as unknown as AbiParam[], "bridgeWithFuel")
		expect(ours.map(shape)).toEqual(real.map(shape))
	})

	it("BridgeWithFuel event matches the artifact", () => {
		const real = inputsOf(loadArtifact().abi, "BridgeWithFuel")
		const ours = inputsOf(SWAP_BRIDGE_ROUTER_ABI as unknown as AbiParam[], "BridgeWithFuel")
		expect(ours.map(shape)).toEqual(real.map(shape))
	})
})
