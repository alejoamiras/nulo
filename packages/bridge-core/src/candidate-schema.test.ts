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
	"tools",
	"public",
	"testnet-bridge.json",
)
const liveManifest = () => JSON.parse(readFileSync(liveManifestPath, "utf8"))

// The live manifest's swap block comes and goes with token cutovers (core-only after a cutover,
// restored once pools are seeded) — swap-shape tests INJECT a synthetic block so they never depend
// on the live file's current phase.
const withSwap = (m: ReturnType<typeof liveManifest>) => {
	m.l1.fuel.swap ??= {
		poolManager: "0x0000000000000000000000000000000000000005",
		quoter: "0x0000000000000000000000000000000000000006",
		weth: "0x0000000000000000000000000000000000000008",
		feeJuice: "0x0000000000000000000000000000000000000009",
		pools: { tokenWeth: { fee: 3000, tickSpacing: 60 }, ethFj: { fee: 987, tickSpacing: 10 } },
		slippageBps: 300,
		minFuelFj: "29580299742031535464",
	}
	return m
}

describe("candidate-schema (strict bridge-manifest gate)", () => {
	it("accepts the committed live manifest", () => {
		expect(() => parseCandidateManifest(liveManifest())).not.toThrow()
	})

	// Only forked-v1 portals remain source-verifiable from this repo, so this is where a pre-fork
	// manifest is stopped rather than silently verified against the wrong contract.
	it("rejects a manifest whose portalSource is not the fork", () => {
		const m = liveManifest()
		m.l1.portalSource = "canonical"
		expect(() => parseCandidateManifest(m)).toThrow(/portalSource/)
	})

	it("rejects a pre-fork manifest that omits portalSource entirely", () => {
		const m = liveManifest()
		delete m.l1.portalSource
		expect(() => parseCandidateManifest(m)).toThrow(/portalSource/)
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
		const m = withSwap(liveManifest())
		m.l1.fuel.swap.minFuelFj = "1.5e18"
		expect(() => parseCandidateManifest(m)).toThrow(/minFuelFj/)
	})

	it("rejects a missing l2 record", () => {
		const m = liveManifest()
		delete m.l2.bridge
		expect(() => parseCandidateManifest(m)).toThrow(/l2\.bridge/)
	})

	it("rejects an out-of-range slippage", () => {
		const m = withSwap(liveManifest())
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

	it("accepts core.swapTargetContract (InertSwapTarget|UniswapFuelSwap) and rejects junk", () => {
		const m = liveManifest()
		m.l1.fuel.core.swapTargetContract = "InertSwapTarget"
		expect(() => parseCandidateManifest(m)).not.toThrow()
		m.l1.fuel.core.swapTargetContract = "EvilSwap"
		expect(() => parseCandidateManifest(m)).toThrow(/swapTargetContract/)
	})

	// Semantic invariants (superRefine): coherent-looking but unusable manifests must reject.
	it("rejects a permissionless-mint token WITHOUT sourceContract (verify-l1 needs the name)", () => {
		const m = liveManifest()
		delete m.l1.token.sourceContract
		expect(() => parseCandidateManifest(m)).toThrow(/sourceContract/)
	})

	it("rejects EMPTY/short L2 constructorArgs (the identity-invariant bypass)", () => {
		const m = liveManifest()
		m.l2.token.constructorArgs = []
		expect(() => parseCandidateManifest(m)).toThrow(/empty\/short list/)
	})

	it("rejects an L1 token identity that drifts from the L2 constructor identity", () => {
		const m = liveManifest()
		m.l1.token.decimals = m.l1.token.decimals === 9 ? 12 : 9 // guaranteed ≠ the L2 constructor identity
		expect(() => parseCandidateManifest(m)).toThrow(/constructor identity/)
	})

	it("rejects slippageBps 10000 (a zero min-output floor)", () => {
		const m = withSwap(liveManifest())
		m.l1.fuel.swap.slippageBps = 10_000
		expect(() => parseCandidateManifest(m)).toThrow(/slippageBps/)
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
