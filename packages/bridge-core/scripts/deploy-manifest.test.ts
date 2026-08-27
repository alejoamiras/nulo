import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { appendJournal, type CandidateManifest, readJournal, resolveResume, writeCandidateAtomic } from "./deploy-manifest"

let dir: string
beforeEach(() => {
	dir = mkdtempSync(join(tmpdir(), "deploy-manifest-"))
})
afterEach(() => {
	rmSync(dir, { recursive: true, force: true })
})

// Schema-valid fixture: the atomic writer now STRICT-validates before writing (candidate-schema),
// so the fixture carries full-width addresses and a complete fuel block, like a real candidate.
const L2A = `0x${"aa".repeat(32)}`
const L2B = `0x${"bb".repeat(32)}`
const L2C = `0x${"cc".repeat(32)}`
const manifest: CandidateManifest = {
	network: "testnet",
	l1: {
		usdc: "0x0000000000000000000000000000000000000001",
		portal: "0x0000000000000000000000000000000000000002",
		portalSource: "forked-v1",
		token: { name: "Aztec Nulo", symbol: "AZLO", decimals: 18, maxWholePerTx: 1000 },
		fuel: {
			core: {
				router: "0x0000000000000000000000000000000000000003",
				permit2: "0x0000000000000000000000000000000000000007",
				swapTarget: "0x0000000000000000000000000000000000000004",
				feeJuicePortal: "0x000000000000000000000000000000000000000a",
			},
			swap: {
				poolManager: "0x0000000000000000000000000000000000000005",
				quoter: "0x0000000000000000000000000000000000000006",
				weth: "0x0000000000000000000000000000000000000008",
				feeJuice: "0x0000000000000000000000000000000000000009",
				pools: { tokenWeth: { fee: 500, tickSpacing: 10 }, ethFj: { fee: 987, tickSpacing: 10 } },
				slippageBps: 100,
				minFuelFj: "10000000000000000000",
			},
		},
		feeJuice: {
			portal: "0x000000000000000000000000000000000000000a",
			asset: "0x0000000000000000000000000000000000000009",
			feeAssetHandler: "0x000000000000000000000000000000000000000b",
			minFj: "1000000000000000000",
		},
	},
	l2: {
		proxy: { address: L2A, salt: 111, constructorArtifact: "constructor", constructorArgs: [] },
		token: {
			address: L2B,
			salt: 222,
			constructorArtifact: "constructor_with_minter",
			constructorArgs: ["Aztec Nulo", "AZLO", 18, L2A],
		},
		bridge: {
			address: L2C,
			salt: 333,
			constructorArtifact: "constructor",
			constructorArgs: [L2A, "0x0000000000000000000000000000000000000002"],
		},
	},
}

describe("writeCandidateAtomic", () => {
	it("round-trips every faucet-consumed field and leaves no temp file", () => {
		const target = join(dir, "testnet-bridge.candidate.json")
		writeCandidateAtomic(target, manifest)

		const back = JSON.parse(readFileSync(target, "utf8"))
		expect(back).toEqual(manifest)
		// The faucet reader (bridge-deployments.ts) reads exactly these paths.
		expect(back.l1.usdc).toBe(manifest.l1.usdc)
		expect(back.l1.portal).toBe(manifest.l1.portal)
		expect(back.l1.portalSource).toBe("forked-v1")
		expect(back.l1.fuel.core.swapTarget).toBe((manifest.l1.fuel?.core as { swapTarget: string } | undefined)?.swapTarget)
		for (const k of ["proxy", "token", "bridge"] as const) {
			expect(back.l2[k].address).toBe(manifest.l2[k].address)
			expect(typeof back.l2[k].salt).toBe("number")
			expect(back.l2[k].constructorArtifact).toBe(manifest.l2[k].constructorArtifact)
		}
		// No sibling temp left behind after the atomic rename.
		expect(readdirSync(dir).filter((f) => f.endsWith(".tmp"))).toHaveLength(0)
	})

	it("overwrites an existing candidate atomically", () => {
		const target = join(dir, "c.json")
		writeCandidateAtomic(target, manifest)
		const next = { ...manifest, l1: { ...manifest.l1, portal: "0x0000000000000000000000000000000000000099" } }
		writeCandidateAtomic(target, next)
		expect(JSON.parse(readFileSync(target, "utf8")).l1.portal).toBe("0x0000000000000000000000000000000000000099")
	})
})

describe("journal + resume", () => {
	it("appends two-phase entries and reads them back in order", () => {
		const j = join(dir, "j.jsonl")
		appendJournal(j, { phase: "generation", salts: { proxy: 1, token: 2, bridge: 3 } })
		appendJournal(j, { phase: "submitted", step: "usdc", txHash: "0xdead" })
		appendJournal(j, { phase: "confirmed", step: "usdc", address: "0xusdc" })

		const entries = readJournal(j)
		expect(entries).toHaveLength(3)
		expect(entries[0].phase).toBe("generation")
		expect(entries[1]).toMatchObject({ phase: "submitted", step: "usdc", txHash: "0xdead" })
		expect(entries[2]).toMatchObject({ phase: "confirmed", step: "usdc", address: "0xusdc" })
		expect(entries.every((e) => typeof e.ts === "string")).toBe(true)
	})

	it("resolveResume returns null for an empty journal (clean start)", () => {
		expect(resolveResume([])).toBeNull()
		expect(resolveResume(readJournal(join(dir, "missing.jsonl")))).toBeNull()
	})

	it("reconstructs salts, confirmed steps, and the portal-init flag", () => {
		const j = join(dir, "j2.jsonl")
		appendJournal(j, { phase: "generation", salts: { proxy: 11, token: 12, bridge: 13 } })
		appendJournal(j, { phase: "confirmed", step: "portal", address: "0xportal" })
		appendJournal(j, { phase: "confirmed", step: "bridge", address: "0xbridge" })

		const before = resolveResume(readJournal(j))
		expect(before).not.toBeNull()
		expect(before?.salts).toEqual({ proxy: 11, token: 12, bridge: 13 })
		expect(before?.confirmed.portal).toBe("0xportal")
		expect(before?.portalInitialized).toBe(false)

		// Once portal-init confirms, resume must treat the generation as locked.
		appendJournal(j, { phase: "confirmed", step: "portal-init", address: "done" })
		expect(resolveResume(readJournal(j))?.portalInitialized).toBe(true)
	})
})
