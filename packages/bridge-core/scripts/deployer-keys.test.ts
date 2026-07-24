import { describe, expect, it } from "vitest"
import { resolveDeployerKeys } from "./deployer-keys"

const SECRET = "correct-horse-battery-staple"

describe("resolveDeployerKeys — stable, network-separated L2 deployer (F6/A11)", () => {
	it("is deterministic: the same env secret always yields the same secret+salt (pre-fundable, crash-recoverable)", () => {
		const a = resolveDeployerKeys("testnet", { BRIDGE_DEPLOYER_SECRET_TESTNET: SECRET })
		const b = resolveDeployerKeys("testnet", { BRIDGE_DEPLOYER_SECRET_TESTNET: SECRET })
		expect(a.secret.toString()).toBe(b.secret.toString())
		expect(a.salt.toString()).toBe(b.salt.toString())
	})

	it("secret and salt are distinct derivations", () => {
		const k = resolveDeployerKeys("testnet", { BRIDGE_DEPLOYER_SECRET_TESTNET: SECRET })
		expect(k.secret.toString()).not.toBe(k.salt.toString())
	})

	it("networks NEVER share an identity — even the same raw secret derives different keys (DP4)", () => {
		const t = resolveDeployerKeys("testnet", { BRIDGE_DEPLOYER_SECRET_TESTNET: SECRET })
		const m = resolveDeployerKeys("mainnet", { BRIDGE_DEPLOYER_SECRET_MAINNET: SECRET })
		expect(t.secret.toString()).not.toBe(m.secret.toString())
		expect(t.salt.toString()).not.toBe(m.salt.toString())
	})

	it("fails closed on a missing or short secret, naming the network's own env var", () => {
		expect(() => resolveDeployerKeys("mainnet", {})).toThrow(/BRIDGE_DEPLOYER_SECRET_MAINNET/)
		expect(() => resolveDeployerKeys("testnet", { BRIDGE_DEPLOYER_SECRET_TESTNET: "short" })).toThrow(/16/)
		// The mainnet lookup never falls back to the testnet var.
		expect(() => resolveDeployerKeys("mainnet", { BRIDGE_DEPLOYER_SECRET_TESTNET: SECRET })).toThrow(/BRIDGE_DEPLOYER_SECRET_MAINNET/)
	})
})
