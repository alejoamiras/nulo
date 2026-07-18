import { readFileSync } from "node:fs"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { describe, expect, it } from "vitest"
import { parseCandidateManifest } from "./candidate-schema"

const liveManifestPath = join(
	fileURLToPath(new URL(".", import.meta.url)),
	"..",
	"..",
	"..",
	"apps",
	"faucet",
	"public",
	"testnet-bridge.json",
)
const liveManifest = () => JSON.parse(readFileSync(liveManifestPath, "utf8"))

describe("candidate-schema (strict bridge-manifest gate)", () => {
	it("accepts the committed live manifest", () => {
		expect(() => parseCandidateManifest(liveManifest())).not.toThrow()
	})

	it("rejects unknown fields anywhere (no silent stale carries)", () => {
		const m = liveManifest()
		m.l1.fuel.legacyCarriedField = "0xdead"
		expect(() => parseCandidateManifest(m)).toThrow(/unrecognized|legacyCarriedField/i)
	})

	it("rejects a malformed portal address in the fuel block", () => {
		const m = liveManifest()
		m.l1.fuel.feeJuicePortal = "not-an-address"
		expect(() => parseCandidateManifest(m)).toThrow(/feeJuicePortal/)
	})

	it("rejects a non-integer minFuelFj (base-unit amounts travel as decimal strings)", () => {
		const m = liveManifest()
		m.l1.fuel.minFuelFj = "1.5e18"
		expect(() => parseCandidateManifest(m)).toThrow(/minFuelFj/)
	})

	it("rejects a missing l2 record", () => {
		const m = liveManifest()
		delete m.l2.bridge
		expect(() => parseCandidateManifest(m)).toThrow(/l2\.bridge/)
	})

	it("rejects an out-of-range slippage", () => {
		const m = liveManifest()
		m.l1.fuel.slippageBps = 10_001
		expect(() => parseCandidateManifest(m)).toThrow(/slippageBps/)
	})
})
