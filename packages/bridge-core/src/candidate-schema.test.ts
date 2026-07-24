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

	it("rejects a malformed portal address in the fuel core block", () => {
		const m = liveManifest()
		m.l1.fuel.core.feeJuicePortal = "not-an-address"
		expect(() => parseCandidateManifest(m)).toThrow(/feeJuicePortal/)
	})

	it("rejects a non-integer minFuelFj (base-unit amounts travel as decimal strings)", () => {
		const m = liveManifest()
		m.l1.fuel.swap.minFuelFj = "1.5e18"
		expect(() => parseCandidateManifest(m)).toThrow(/minFuelFj/)
	})

	it("rejects a missing l2 record", () => {
		const m = liveManifest()
		delete m.l2.bridge
		expect(() => parseCandidateManifest(m)).toThrow(/l2\.bridge/)
	})

	it("rejects an out-of-range slippage", () => {
		const m = liveManifest()
		m.l1.fuel.swap.slippageBps = 10_001
		expect(() => parseCandidateManifest(m)).toThrow(/slippageBps/)
	})

	// The core/swap split: a bridge-only (mainnet) deployment carries `fuel.core` + omits `fuel.swap`
	// and `feeJuice.feeAssetHandler`. Both shapes must validate; `core` must be mandatory when `fuel`
	// is present.
	it("accepts a bridge-only (mainnet-shape) manifest: swap + feeAssetHandler omitted", () => {
		const m = liveManifest()
		delete m.l1.fuel.swap
		if (m.l1.feeJuice) delete m.l1.feeJuice.feeAssetHandler
		expect(() => parseCandidateManifest(m)).not.toThrow()
	})

	it("rejects fuel without its core block", () => {
		const m = liveManifest()
		delete m.l1.fuel.core
		expect(() => parseCandidateManifest(m)).toThrow(/core/)
	})

	// verify-l1 source-verifies a permissionless-mint token against token.sourceContract — the DP7
	// cutover candidate declares TestUsdc; absent defaults to the legacy MintableERC20; junk rejects.
	it("accepts token.sourceContract TestUsdc (the DP7 cutover shape) and rejects unknown contracts", () => {
		const m = liveManifest()
		m.l1.token.sourceContract = "TestUsdc"
		expect(() => parseCandidateManifest(m)).not.toThrow()
		m.l1.token.sourceContract = "EvilToken"
		expect(() => parseCandidateManifest(m)).toThrow(/sourceContract/)
	})
})
