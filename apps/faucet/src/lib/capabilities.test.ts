import { AztecAddress } from "@aztec/aztec.js/addresses"
import { describe, expect, it } from "vitest"
import { buildBridgeManifest, buildCombinedManifest, buildFaucetManifest } from "./capabilities"

const DRIPPER = AztecAddress.fromStringUnsafe("0x0000000000000000000000000000000000000000000000000000000000000001")
const USDC = AztecAddress.fromStringUnsafe("0x0000000000000000000000000000000000000000000000000000000000000002")
const ETH = AztecAddress.fromStringUnsafe("0x0000000000000000000000000000000000000000000000000000000000000003")
const SPONSORED_FPC = AztecAddress.fromStringUnsafe("0x0000000000000000000000000000000000000000000000000000000000000004")

import { PRIVATE_FPC_ADDRESS, feeJuiceAddress } from "@nulo/bridge-core"

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

	it("declares contracts scope = [DRIPPER, USDC, ETH] only - no SponsoredFPC", () => {
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

const BRIDGE = AztecAddress.fromStringUnsafe("0x0000000000000000000000000000000000000000000000000000000000000007")
const TOKEN = AztecAddress.fromStringUnsafe("0x0000000000000000000000000000000000000000000000000000000000000006")
const PROXY = AztecAddress.fromStringUnsafe("0x0000000000000000000000000000000000000000000000000000000000000007")

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
			`${feeJuiceAddress}::claim_and_end_setup`,
			`${feeJuiceAddress}::claim`,
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
			"claim_and_end_setup",
			"claim",
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

	it("declares all seven contracts - faucet (dripper, usdc, eth) + bridge (bridge, token, proxy) + PrivateFPC", () => {
		const cap = m.capabilities.find((c) => c.type === "contracts")
		if (cap?.type !== "contracts") throw new Error("contracts cap missing")
		expect(cap.contracts.map((a) => a.toString())).toEqual([
			DRIPPER.toString(),
			USDC.toString(),
			ETH.toString(),
			BRIDGE.toString(),
			TOKEN.toString(),
			PROXY.toString(),
			PRIVATE_FPC_ADDRESS,
		])
	})

	it("scopes both faucet drips and the bridge claim/exit/burn + sponsor", () => {
		const cap = m.capabilities.find((c) => c.type === "transaction")
		if (cap?.type !== "transaction") throw new Error("transaction cap missing")
		expect(cap.scope.map((s) => s.function)).toEqual([
			"drip_to_public",
			"drip_to_private",
			"claim_and_end_setup",
			"claim",
			"mint_and_pay_fee",
			"pay_fee",
			"claim_public",
			"claim_private",
			"exit_to_l1_public",
			"exit_to_l1_private",
			"burn_public",
			"burn_private",
			"sponsor_unconditionally",
			"set_authorized",
		])
	})

	it("puts the bridge txs in simulation.transactions too (so the claim can be simulate-gated, prompt-free)", () => {
		const cap = m.capabilities.find((c) => c.type === "simulation")
		if (cap?.type !== "simulation") throw new Error("simulation cap missing")
		const fns = cap.transactions.scope.map((s) => s.function)
		expect(fns).toContain("balance_of_public")
		expect(fns).toContain("claim_public")
		expect(fns).toContain("sponsor_unconditionally")
	})
})

describe("fuel claim scope (canonical FeeJuice)", () => {
	const BRIDGE = AztecAddress.fromStringUnsafe("0x0000000000000000000000000000000000000000000000000000000000000007")
	const PROXY = AztecAddress.fromStringUnsafe("0x0000000000000000000000000000000000000000000000000000000000000008")
	const bridgeInput = () => ({
		bridgeAddress: BRIDGE,
		tokenAddress: USDC,
		proxyAddress: PROXY,
		sponsoredFpcAddress: SPONSORED_FPC,
	})
	const combinedInput = () => ({
		dripperAddress: DRIPPER,
		usdcAddress: USDC,
		ethAddress: ETH,
		sponsoredFpcAddress: SPONSORED_FPC,
		bridgeAddress: BRIDGE,
		tokenAddress: USDC,
		proxyAddress: PROXY,
	})
	const txScope = (m: ReturnType<typeof buildBridgeManifest>) => {
		const cap = m.capabilities.find((c) => c.type === "transaction")
		if (cap?.type !== "transaction") throw new Error("transaction cap missing")
		return cap.scope as { contract: unknown; function: string }[]
	}
	const simTxScope = (m: ReturnType<typeof buildBridgeManifest>) => {
		const cap = m.capabilities.find((c) => c.type === "simulation")
		if (cap?.type !== "simulation") throw new Error("simulation cap missing")
		return cap.transactions?.scope as { contract: unknown; function: string }[]
	}
	const hasFjClaim = (scope: { contract: unknown; function: string }[]) =>
		scope.some((s) => String(s.contract) === feeJuiceAddress && s.function === "claim_and_end_setup")

	it("bridge manifest scopes the FJ claim for BOTH send and simulate (the fjwc dry-run)", () => {
		const m = buildBridgeManifest(bridgeInput())
		expect(hasFjClaim(txScope(m))).toBe(true)
		expect(hasFjClaim(simTxScope(m))).toBe(true)
	})

	it("combined manifest scopes the FJ claim identically", () => {
		const m = buildCombinedManifest(combinedInput())
		expect(hasFjClaim(txScope(m))).toBe(true)
		expect(hasFjClaim(simTxScope(m))).toBe(true)
	})

	const hasPrivateFuel = (scope: { contract: unknown; function: string }[]) =>
		scope.some((s) => String(s.contract) === feeJuiceAddress && s.function === "claim") &&
		scope.some((s) => String(s.contract) === PRIVATE_FPC_ADDRESS && s.function === "mint_and_pay_fee")

	it("combined manifest scopes private fuel (FeeJuice.claim + mint_and_pay_fee) for send AND simulate", () => {
		const m = buildCombinedManifest(combinedInput())
		expect(hasPrivateFuel(txScope(m))).toBe(true)
		expect(hasPrivateFuel(simTxScope(m))).toBe(true)
	})

	it("includes the PrivateFPC in contracts (pre-registered for the no-fuel private-FJ read under 5.0.1)", () => {
		// The wallet only auto-registers the FPC when a tx USES it as fee payer; the no-fuel claim gate
		// reads its balance_of BEFORE that, and 5.0.1's registerContract conformance (dev #288) stops the
		// read's on-the-fly Contract.at() from registering the artifact — so the faucet pre-registers it.
		const m = buildCombinedManifest(combinedInput())
		const cap = m.capabilities.find((c) => c.type === "contracts")
		if (cap?.type !== "contracts") throw new Error("contracts cap missing")
		expect(cap.contracts.map(String)).toContain(PRIVATE_FPC_ADDRESS)
	})

	it("scopes PrivateFPC.balance_of for the no-fuel private-FJ read (utilities only — it is abi_utility)", () => {
		const m = buildCombinedManifest(combinedInput())
		const cap = m.capabilities.find((c) => c.type === "simulation")
		if (cap?.type !== "simulation") throw new Error("simulation cap missing")
		const inUtil = (scope: { contract: unknown; function: string }[]) =>
			scope.some((s) => String(s.contract) === PRIVATE_FPC_ADDRESS && s.function === "balance_of")
		expect(inUtil(cap.utilities.scope as never)).toBe(true)
		// It is a utility read — NOT a tx-shaped simulation NOR a send.
		expect(inUtil(cap.transactions.scope as never)).toBe(false)
		expect(inUtil(txScope(m))).toBe(false)
	})

	it("scopes PrivateFPC.pay_fee for the no-fuel private self-pay — BOTH simulate AND send (mirrors mint_and_pay_fee)", () => {
		const m = buildCombinedManifest(combinedInput())
		const hasPayFee = (scope: { contract: unknown; function: string }[]) =>
			scope.some((s) => String(s.contract) === PRIVATE_FPC_ADDRESS && s.function === "pay_fee")
		expect(hasPayFee(simTxScope(m))).toBe(true)
		expect(hasPayFee(txScope(m))).toBe(true)
	})

	it("scopes FeeJuice.balance_of_public for the no-fuel L7 cold-check (simulate only)", () => {
		const m = buildCombinedManifest(combinedInput())
		const hasFjBalance = (scope: { contract: unknown; function: string }[]) =>
			scope.some((s) => String(s.contract) === feeJuiceAddress && s.function === "balance_of_public")
		expect(hasFjBalance(simTxScope(m))).toBe(true)
		// It is a read — NOT a send-scoped function.
		expect(hasFjBalance(txScope(m))).toBe(false)
	})

	it("the FJ entries are exactly the two claim functions on one protocol contract - no wildcards", () => {
		const m = buildBridgeManifest(bridgeInput())
		const fj = txScope(m).filter((s) => String(s.contract) === feeJuiceAddress)
		expect(fj.map((s) => `${String(s.contract)}::${s.function}`)).toEqual([
			`${feeJuiceAddress}::claim_and_end_setup`,
			`${feeJuiceAddress}::claim`,
		])
	})
})
