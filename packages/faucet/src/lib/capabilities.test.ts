import { AztecAddress } from "@aztec/aztec.js/addresses"
import { describe, expect, it } from "vitest"
import { buildBridgeManifest, buildCombinedManifest, buildFaucetManifest } from "./capabilities"

const DRIPPER = AztecAddress.fromString("0x0000000000000000000000000000000000000000000000000000000000000001")
const USDC = AztecAddress.fromString("0x0000000000000000000000000000000000000000000000000000000000000002")
const ETH = AztecAddress.fromString("0x0000000000000000000000000000000000000000000000000000000000000003")
const SPONSORED_FPC = AztecAddress.fromString("0x0000000000000000000000000000000000000000000000000000000000000004")

describe("buildFaucetManifest", () => {
	const m = buildFaucetManifest({
		dripperAddress: DRIPPER,
		usdcAddress: USDC,
		ethAddress: ETH,
		sponsoredFpcAddress: SPONSORED_FPC,
		appUrl: "https://faucet.test",
	})

	it("populates metadata with the dApp identity and url", () => {
		expect(m.metadata.name).toBe("nulo-faucet")
		expect(m.metadata.version).toBe("0.1.0")
		expect(m.metadata.url).toBe("https://faucet.test")
	})

	it("requests accounts with canGet=true and canCreateAuthWit=false (no authwit needed)", () => {
		const cap = m.capabilities.find((c) => c.type === "accounts")
		expect(cap).toEqual({ type: "accounts", canGet: true, canCreateAuthWit: false })
	})

	it("declares contracts scope = [DRIPPER, USDC, ETH] only — no SponsoredFPC", () => {
		const cap = m.capabilities.find((c) => c.type === "contracts")
		if (cap?.type !== "contracts") throw new Error("contracts cap missing")
		const addrs = cap.contracts.map((a) => a.toString())
		expect(addrs).toEqual([DRIPPER.toString(), USDC.toString(), ETH.toString()])
		expect(cap.canRegister).toBe(true)
	})

	it("declares simulation.utilities.scope = balance_of_private only (utility functions)", () => {
		const cap = m.capabilities.find((c) => c.type === "simulation")
		if (cap?.type !== "simulation") throw new Error("simulation cap missing")
		const scopes = cap.utilities.scope.map((s) => `${s.contract.toString()}::${s.function}`)
		expect(scopes).toEqual([`${USDC.toString()}::balance_of_private`, `${ETH.toString()}::balance_of_private`])
	})

	it("declares simulation.transactions.scope = balance_of_public only (public views)", () => {
		const cap = m.capabilities.find((c) => c.type === "simulation")
		if (cap?.type !== "simulation") throw new Error("simulation cap missing")
		const scopes = cap.transactions.scope.map((s) => `${s.contract.toString()}::${s.function}`)
		expect(scopes).toEqual([`${USDC.toString()}::balance_of_public`, `${ETH.toString()}::balance_of_public`])
	})

	it("declares transaction scope = drip_to_public + drip_to_private + sponsor_unconditionally", () => {
		const cap = m.capabilities.find((c) => c.type === "transaction")
		if (cap?.type !== "transaction") throw new Error("transaction cap missing")
		expect(cap.scope).toEqual([
			{ contract: DRIPPER, function: "drip_to_public" },
			{ contract: DRIPPER, function: "drip_to_private" },
			{ contract: SPONSORED_FPC, function: "sponsor_unconditionally" },
		])
	})

	it("includes the sponsor_unconditionally entry so Nulo's per-call scope check passes", () => {
		const cap = m.capabilities.find((c) => c.type === "transaction")
		if (cap?.type !== "transaction") throw new Error("transaction cap missing")
		const sponsorEntry = cap.scope.find((s) => s.function === "sponsor_unconditionally")
		expect(sponsorEntry?.contract.toString()).toBe(SPONSORED_FPC.toString())
	})
})

const BRIDGE = AztecAddress.fromString("0x0000000000000000000000000000000000000000000000000000000000000005")
const TOKEN = AztecAddress.fromString("0x0000000000000000000000000000000000000000000000000000000000000006")
const PROXY = AztecAddress.fromString("0x0000000000000000000000000000000000000000000000000000000000000007")

describe("buildBridgeManifest", () => {
	const m = buildBridgeManifest({
		bridgeAddress: BRIDGE,
		tokenAddress: TOKEN,
		proxyAddress: PROXY,
		sponsoredFpcAddress: SPONSORED_FPC,
		appUrl: "https://bridge.test",
	})

	it("metadata identifies the bridge dApp", () => {
		expect(m.metadata.name).toBe("nulo-bridge")
		expect(m.metadata.url).toBe("https://bridge.test")
	})

	it("requests canCreateAuthWit=true (exit_to_l1 needs a public burn auth-wit)", () => {
		const cap = m.capabilities.find((c) => c.type === "accounts")
		expect(cap).toEqual({ type: "accounts", canGet: true, canCreateAuthWit: true })
	})

	it("declares contracts = [bridge, token, proxy]", () => {
		const cap = m.capabilities.find((c) => c.type === "contracts")
		if (cap?.type !== "contracts") throw new Error("contracts cap missing")
		expect(cap.contracts.map((a) => a.toString())).toEqual([BRIDGE.toString(), TOKEN.toString(), PROXY.toString()])
		expect(cap.canRegister).toBe(true)
	})

	it("scopes token balance reads (private utility, public view)", () => {
		const cap = m.capabilities.find((c) => c.type === "simulation")
		if (cap?.type !== "simulation") throw new Error("simulation cap missing")
		expect(cap.utilities.scope.map((s) => `${s.contract.toString()}::${s.function}`)).toEqual([
			`${TOKEN.toString()}::balance_of_private`,
		])
		expect(cap.transactions.scope.map((s) => `${s.contract.toString()}::${s.function}`)).toEqual([
			`${TOKEN.toString()}::balance_of_public`,
		])
	})

	it("scopes claim + exit (both privacies) + token burns + sponsor", () => {
		const cap = m.capabilities.find((c) => c.type === "transaction")
		if (cap?.type !== "transaction") throw new Error("transaction cap missing")
		expect(cap.scope.map((s) => s.function)).toEqual([
			"claim_public",
			"claim_private",
			"exit_to_l1_public",
			"exit_to_l1_private",
			"burn_public",
			"burn_private",
			"sponsor_unconditionally",
		])
		const sponsor = cap.scope.find((s) => s.function === "sponsor_unconditionally")
		expect(sponsor?.contract.toString()).toBe(SPONSORED_FPC.toString())
	})
})

describe("buildCombinedManifest", () => {
	const m = buildCombinedManifest({
		dripperAddress: DRIPPER,
		usdcAddress: USDC,
		ethAddress: ETH,
		bridgeAddress: BRIDGE,
		tokenAddress: TOKEN,
		proxyAddress: PROXY,
		sponsoredFpcAddress: SPONSORED_FPC,
		appUrl: "https://app.test",
	})

	it("requests canCreateAuthWit=true (the bridge's exit needs a public burn auth-wit)", () => {
		const cap = m.capabilities.find((c) => c.type === "accounts")
		expect(cap).toEqual({ type: "accounts", canGet: true, canCreateAuthWit: true })
	})

	it("declares all six contracts — faucet (dripper, usdc, eth) + bridge (bridge, token, proxy)", () => {
		const cap = m.capabilities.find((c) => c.type === "contracts")
		if (cap?.type !== "contracts") throw new Error("contracts cap missing")
		expect(cap.contracts.map((a) => a.toString())).toEqual([
			DRIPPER.toString(),
			USDC.toString(),
			ETH.toString(),
			BRIDGE.toString(),
			TOKEN.toString(),
			PROXY.toString(),
		])
	})

	it("scopes both faucet drips and the bridge claim/exit/burn + sponsor", () => {
		const cap = m.capabilities.find((c) => c.type === "transaction")
		if (cap?.type !== "transaction") throw new Error("transaction cap missing")
		expect(cap.scope.map((s) => s.function)).toEqual([
			"drip_to_public",
			"drip_to_private",
			"claim_public",
			"claim_private",
			"exit_to_l1_public",
			"exit_to_l1_private",
			"burn_public",
			"burn_private",
			"sponsor_unconditionally",
		])
	})
})
