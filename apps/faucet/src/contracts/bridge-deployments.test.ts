import { describe, expect, it } from "vitest"
import config from "../../public/testnet-bridge.json"
import {
	BRIDGE_PERMIT2,
	BRIDGE_ROUTER,
	BRIDGE_SWAP_TARGET,
	L1_PORTAL,
	L1_USDC,
	PRIVATE_CLAIM_MODE,
	SUPPORTS_SALT_V2,
} from "./bridge-deployments"

/**
 * Client-pin (codex cond. 4): every address the deposit witness binds — tokenPortal, bridgeToken,
 * router, permit2, swapTarget — comes ONLY from the committed manifest, never from caller/user input.
 * These assertions pin the manifest→export mapping so a refactor can't silently let an arbitrary
 * address into the Permit2 witness (the generic-router phishing surface). Case-insensitive: EIP-55 vs
 * lowercase manifest.
 */
describe("bridge-deployments — client-pin (witness addresses are manifest-sourced)", () => {
	const l1 = config.l1 as {
		usdc: string
		portal: string
		fuel: { router: string; permit2: string; swapTarget: string }
		privateClaimMode?: string
	}

	it("bridge token + portal are the manifest values", () => {
		expect(L1_USDC.toLowerCase()).toBe(l1.usdc.toLowerCase())
		expect(L1_PORTAL.toLowerCase()).toBe(l1.portal.toLowerCase())
	})

	it("router + permit2 + swapTarget are the manifest values (not caller input)", () => {
		expect(BRIDGE_ROUTER?.toLowerCase()).toBe(l1.fuel.router.toLowerCase())
		expect(BRIDGE_PERMIT2?.toLowerCase()).toBe(l1.fuel.permit2.toLowerCase())
		expect(BRIDGE_SWAP_TARGET?.toLowerCase()).toBe(l1.fuel.swapTarget.toLowerCase())
	})

	it("SUPPORTS_SALT_V2 reflects the manifest's privateClaimMode (L9 interlock)", () => {
		expect(PRIVATE_CLAIM_MODE).toBe(l1.privateClaimMode)
		expect(SUPPORTS_SALT_V2).toBe(l1.privateClaimMode === "salt-v2")
	})
})
