import { AztecAddress } from "@aztec/aztec.js/addresses"
import { describe, expect, it } from "vitest"
import { buildFaucetManifest } from "./capabilities"

const DRIPPER = AztecAddress.fromString("0x0000000000000000000000000000000000000000000000000000000000000001")
const USDC = AztecAddress.fromString("0x0000000000000000000000000000000000000000000000000000000000000002")
const ETH = AztecAddress.fromString("0x0000000000000000000000000000000000000000000000000000000000000003")

describe("buildFaucetManifest", () => {
	const m = buildFaucetManifest({
		dripperAddress: DRIPPER,
		usdcAddress: USDC,
		ethAddress: ETH,
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

	it("declares simulation utilities scope = balance_of_{public,private} for both tokens", () => {
		const cap = m.capabilities.find((c) => c.type === "simulation")
		if (cap?.type !== "simulation") throw new Error("simulation cap missing")
		const scopes = cap.utilities.scope.map((s) => `${s.contract.toString()}::${s.function}`)
		expect(scopes).toEqual([
			`${USDC.toString()}::balance_of_private`,
			`${USDC.toString()}::balance_of_public`,
			`${ETH.toString()}::balance_of_private`,
			`${ETH.toString()}::balance_of_public`,
		])
	})

	it("declares transaction scope = exactly the two Dripper functions (no wildcards)", () => {
		const cap = m.capabilities.find((c) => c.type === "transaction")
		if (cap?.type !== "transaction") throw new Error("transaction cap missing")
		expect(cap.scope).toEqual([
			{ contract: DRIPPER, function: "drip_to_public" },
			{ contract: DRIPPER, function: "drip_to_private" },
		])
	})
})
