import { describe, expect, it } from "vitest"
import { checkBuildIntegrity } from "./build-integrity"

const TESTNET = { key: "testnet" as const, l1ChainId: 11155111, walletChainId: 1816023401, host: "testnet.tools.nulo.sh" }
const MAINNET = { key: "mainnet" as const, l1ChainId: 1, walletChainId: 4248422646, host: "tools.nulo.sh" }

describe("checkBuildIntegrity — fail-closed target/manifest/hostname", () => {
	it("passes when target, manifest, and host all agree (prod)", () => {
		const err = checkBuildIntegrity(
			TESTNET,
			{ l1ChainId: 11155111, walletChainId: 1816023401 },
			{ hostname: "testnet.tools.nulo.sh", isProd: true },
		)
		expect(err).toBeNull()
	})

	// The exact placeholder-mainnet failure: a testnet-identity manifest bundled into a mainnet build.
	it("FAILS when the manifest chain != the build target (the placeholder-mainnet case)", () => {
		const err = checkBuildIntegrity(
			MAINNET,
			{ l1ChainId: 11155111, walletChainId: 1816023401 },
			{ hostname: "tools.nulo.sh", isProd: true },
		)
		expect(err).toMatch(/manifest chain .* != mainnet target/)
	})

	it("FAILS when the manifest omits its chain identity", () => {
		const err = checkBuildIntegrity(TESTNET, {}, { hostname: "testnet.tools.nulo.sh", isProd: true })
		expect(err).toMatch(/missing l1ChainId\/walletChainId/)
	})

	// Layer 5: a coherent testnet build served at the mainnet host passes the chain layers but must fail.
	it("FAILS in prod when the hostname != the target host (mis-hosted build)", () => {
		const err = checkBuildIntegrity(
			TESTNET,
			{ l1ChainId: 11155111, walletChainId: 1816023401 },
			{ hostname: "tools.nulo.sh", isProd: true },
		)
		expect(err).toMatch(/mis-hosted build/)
	})

	// CF Pages PR previews: the EXACT baked preview host is accepted; anything else still fails.
	it("accepts the EXACT baked preview host (a CF Pages preview build)", () => {
		const err = checkBuildIntegrity(
			TESTNET,
			{ l1ChainId: 11155111, walletChainId: 1816023401 },
			{ hostname: "abc123.nulo-tools.pages.dev", isProd: true, allowedPreviewHosts: ["abc123.nulo-tools.pages.dev"] },
		)
		expect(err).toBeNull()
	})

	it("REJECTS a different pages.dev host even when a preview host is baked (no wildcard)", () => {
		const err = checkBuildIntegrity(
			TESTNET,
			{ l1ChainId: 11155111, walletChainId: 1816023401 },
			{ hostname: "evil.nulo-tools.pages.dev", isProd: true, allowedPreviewHosts: ["abc123.nulo-tools.pages.dev"] },
		)
		expect(err).toMatch(/mis-hosted build/)
	})

	it("REJECTS a preview host when none was baked (the mainnet artifact)", () => {
		const err = checkBuildIntegrity(
			MAINNET,
			{ l1ChainId: 1, walletChainId: 4248422646 },
			{ hostname: "abc123.nulo-tools.pages.dev", isProd: true },
		)
		expect(err).toMatch(/mis-hosted build/)
	})

	it("SKIPS the hostname check outside prod (localhost dev / e2e)", () => {
		const err = checkBuildIntegrity(
			TESTNET,
			{ l1ChainId: 11155111, walletChainId: 1816023401 },
			{ hostname: "localhost", isProd: false },
		)
		expect(err).toBeNull()
	})
})

describe("preview hosts (branch alias)", () => {
	const target = { key: "testnet", l1ChainId: 11155111, walletChainId: 1337, host: "testnet.tools.nulo.sh" } as never
	const manifest = { l1ChainId: 11155111, walletChainId: 1337 }
	const hosts = ["4182ff98.nulo-faucet.pages.dev", "worktree-faucet-multi-accoun.nulo-faucet.pages.dev"]

	it("accepts BOTH baked preview hostnames (per-commit hash and branch alias)", () => {
		for (const hostname of hosts) {
			expect(checkBuildIntegrity(target, manifest, { hostname, isProd: true, allowedPreviewHosts: hosts })).toBeNull()
		}
	})

	it("still refuses any OTHER pages.dev host — exact match, no wildcard", () => {
		expect(
			checkBuildIntegrity(target, manifest, { hostname: "evil.nulo-faucet.pages.dev", isProd: true, allowedPreviewHosts: hosts }),
		).toMatch(/mis-hosted/)
	})
})
