import { TOKEN_LIST_ORIGIN } from "@nulo/bridge-core"
import { describe, expect, it } from "vitest"
import { MAINNET_TARGET, TESTNET_TARGET } from "./network-targets"

/** `connect-src` is generated into `dist/_headers` per target; an origin missing here is a runtime
 *  fetch the browser blocks with no visible error, so both targets pin their exact reach. */
describe("cspConnectSrc", () => {
	it("testnet reaches its own node hosts", () => {
		expect(TESTNET_TARGET.cspConnectSrc).toContain("https://*.aztec-labs.com")
		expect(new URL(TESTNET_TARGET.nodeUrl).hostname.endsWith(".aztec-labs.com")).toBe(true)
	})

	it("testnet reaches the community token list the catalog loads", () => {
		expect(TESTNET_TARGET.cspConnectSrc).toContain(TOKEN_LIST_ORIGIN)
	})

	it("mainnet allows no remote origin at all (it serves the placeholder only)", () => {
		expect(MAINNET_TARGET.cspConnectSrc).toBe("'self' data: blob:")
	})

	it("mainnet no longer reaches its node or the token list", () => {
		expect(MAINNET_TARGET.cspConnectSrc).not.toContain("drpc.live")
		expect(MAINNET_TARGET.cspConnectSrc).not.toContain(TOKEN_LIST_ORIGIN)
	})

	it("both targets keep the self/data/blob base every build needs", () => {
		for (const target of [TESTNET_TARGET, MAINNET_TARGET]) {
			expect(target.cspConnectSrc.startsWith("'self' data: blob:")).toBe(true)
		}
	})
})
