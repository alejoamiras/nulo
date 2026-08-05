import { describe, expect, test, vi } from "vitest"
import { FpcType } from "@/wallet/services/fpc/client"
import { buildFeeMethods, buildSettings, FEE_JUICE_BRIDGE_URL, formatGasBalance, settingsForMethod, withTimeout } from "./fee-helpers"

describe("fee-helpers/formatGasBalance", () => {
	test("returns '0' for zero raw value", () => {
		expect(formatGasBalance("0")).toBe("0")
	})

	test("scales by 1e18 for non-zero values", () => {
		expect(formatGasBalance(`${10 ** 18}`)).toBe("1")
	})

	test("handles null + undefined as zero", () => {
		expect(formatGasBalance(null)).toBe("0")
		expect(formatGasBalance(undefined)).toBe("0")
	})
})

describe("fee-helpers/buildSettings", () => {
	test("returns undefined when paymentMethod is missing", () => {
		expect(buildSettings(undefined)).toBeUndefined()
	})

	test("emits priorityLevel for non-default priorities", () => {
		const r = buildSettings({ kind: "fj" }, "fast")
		expect(r).toEqual({ paymentMethod: { kind: "fj" }, priorityLevel: "fast" })
	})

	test("omits priorityLevel for 'normal' priority", () => {
		const r = buildSettings({ kind: "fj" }, "normal")
		expect(r).toEqual({ paymentMethod: { kind: "fj" } })
	})

	test("omits priorityLevel when priority is undefined", () => {
		const r = buildSettings({ kind: "fj" })
		expect(r).toEqual({ paymentMethod: { kind: "fj" } })
	})
})

describe("fee-helpers/settingsForMethod", () => {
	const known = (publicFeeJuice: string, privateFeeJuice: string | null = null) => ({ publicFeeJuice, privateFeeJuice })

	test("undefined method yields undefined settings", () => {
		expect(settingsForMethod(undefined, "normal", known("1"))).toBeUndefined()
	})

	test("'fj' with zero public Fee Juice yields undefined", () => {
		expect(settingsForMethod({ type: "fj", title: "x", subtitle: "y" }, "normal", known("0"))).toBeUndefined()
	})

	test("'fj' with non-zero balance yields the FJ settings", () => {
		expect(settingsForMethod({ type: "fj", title: "x", subtitle: "y" }, "normal", known("1"))).toEqual({
			paymentMethod: { kind: "fj" },
		})
	})

	test("'fj' with non-default priority surfaces priorityLevel", () => {
		expect(settingsForMethod({ type: "fj", title: "x", subtitle: "y" }, "fast", known("1"))).toEqual({
			paymentMethod: { kind: "fj" },
			priorityLevel: "fast",
		})
	})

	test("'private_fpc' without fpc yields undefined", () => {
		expect(settingsForMethod({ type: "private_fpc", title: "x", subtitle: "y" }, "normal", known("1"))).toBeUndefined()
	})

	test("'private_fpc' with fpc but zero private balance yields undefined", () => {
		const m = { type: "private_fpc" as const, title: "x", subtitle: "y", fpc: { id: "p1", type: FpcType.PrivateFpc } }
		expect(settingsForMethod(m, "normal", known("1", "0"))).toBeUndefined()
	})

	test("'private_fpc' with fpc but null private balance yields undefined", () => {
		const m = { type: "private_fpc" as const, title: "x", subtitle: "y", fpc: { id: "p1", type: FpcType.PrivateFpc } }
		expect(settingsForMethod(m, "normal", known("1", null))).toBeUndefined()
	})

	test("'private_fpc' with fpc and non-zero private balance yields fpc settings", () => {
		const m = { type: "private_fpc" as const, title: "x", subtitle: "y", fpc: { id: "p1", type: FpcType.PrivateFpc } }
		expect(settingsForMethod(m, "normal", known("1", "1000"))).toEqual({
			paymentMethod: { kind: "fpc", fpcId: "p1" },
		})
	})

	test("Sponsored FPC encodes only the kind+fpcId", () => {
		const m = {
			type: "fpc" as const,
			title: "x",
			subtitle: "sponsored",
			fpc: { id: "s1", type: FpcType.DefaultSponsoredFpc },
		}
		expect(settingsForMethod(m, "normal", known("1"))).toEqual({
			paymentMethod: { kind: "fpc", fpcId: "s1" },
		})
	})
})

describe("fee-helpers/settingsForMethod — unknown balances (degraded init)", () => {
	// `undefined` balances = the read failed or timed out and a silent retry is
	// pending. Self-paid methods fail CLOSED on unknown: estimation simulates
	// with skipFeeEnforcement, so it would NOT catch an actually-zero balance —
	// an unverified self-paid send could reach proving only to be dropped at
	// the sequencer. Sponsored FPCs need no user balance and stay usable.
	test("'fj' with UNKNOWN balances fails closed", () => {
		expect(settingsForMethod({ type: "fj", title: "x", subtitle: "y" }, "normal", undefined)).toBeUndefined()
	})

	test("'private_fpc' with UNKNOWN balances fails closed even when a PrivateFPC is registered", () => {
		const m = { type: "private_fpc" as const, title: "x", subtitle: "y", fpc: { id: "p1", type: FpcType.PrivateFpc } }
		expect(settingsForMethod(m, "normal", undefined)).toBeUndefined()
	})

	test("Sponsored FPC is unaffected by unknown balances", () => {
		const m = { type: "fpc" as const, title: "x", subtitle: "sponsored", fpc: { id: "s1", type: FpcType.DefaultSponsoredFpc } }
		expect(settingsForMethod(m, "normal", undefined)).toEqual({
			paymentMethod: { kind: "fpc", fpcId: "s1" },
		})
	})
})

describe("fee-helpers/withTimeout", () => {
	test("resolves through when the promise settles first", async () => {
		await expect(withTimeout(Promise.resolve(42), 1_000, "x")).resolves.toBe(42)
	})

	test("rejects through when the promise rejects first", async () => {
		await expect(withTimeout(Promise.reject(new Error("inner")), 1_000, "x")).rejects.toThrow("inner")
	})

	test("rejects with a labeled error once the deadline passes", async () => {
		vi.useFakeTimers()
		try {
			const p = withTimeout(new Promise(() => {}), 1_000, "getGasBalances")
			const assertion = expect(p).rejects.toThrow(/getGasBalances timed out/)
			await vi.advanceTimersByTimeAsync(1_000)
			await assertion
		} finally {
			vi.useRealTimers()
		}
	})
})

describe("fee-helpers/buildFeeMethods", () => {
	test("emits exactly FJ + private_fpc placeholders when no fpcs are registered", () => {
		const m = buildFeeMethods([])
		expect(m.map((x) => x.type)).toEqual(["fj", "private_fpc"])
	})

	test("private_fpc carries the registered PrivateFpc when present", () => {
		const fpcs = [{ id: "p1", type: FpcType.PrivateFpc, name: "MyPrivate" }]
		const m = buildFeeMethods(fpcs)
		const priv = m.find((x) => x.type === "private_fpc")
		expect(priv?.title).toBe("MyPrivate")
		expect(priv?.fpc?.id).toBe("p1")
	})

	test("appends DefaultSponsoredFpc with 'sponsored' subtitle", () => {
		const fpcs = [{ id: "s1", type: FpcType.DefaultSponsoredFpc, name: "Sponsor" }]
		const m = buildFeeMethods(fpcs)
		const fpc = m.find((x) => x.fpc?.id === "s1")
		expect(fpc?.subtitle).toBe("sponsored")
		expect(fpc?.title).toBe("Sponsor")
	})

	test("does NOT emit any token_fpc / coming-soon placeholder", () => {
		const m = buildFeeMethods([])
		expect(m.find((x) => x.subtitle === "coming soon")).toBeUndefined()
	})

	test("PrivateFpc is not duplicated as a regular fpc entry", () => {
		const fpcs = [{ id: "p1", type: FpcType.PrivateFpc, name: "Private" }]
		const m = buildFeeMethods(fpcs)
		const priv = m.filter((x) => x.fpc?.id === "p1")
		expect(priv).toHaveLength(1)
		expect(priv[0].type).toBe("private_fpc")
	})

	test("without gasBalances, fj + private_fpc are NOT marked disabled (loading state)", () => {
		const fpcs = [{ id: "p1", type: FpcType.PrivateFpc, name: "Private" }]
		const m = buildFeeMethods(fpcs)
		const fj = m.find((x) => x.type === "fj")
		const priv = m.find((x) => x.type === "private_fpc")
		expect(fj?.disabled).toBeUndefined()
		expect(priv?.disabled).toBeUndefined()
	})

	test("with zero public balance, fj is disabled with 'no balance' reason", () => {
		const m = buildFeeMethods([], { publicFeeJuice: "0", privateFeeJuice: null })
		const fj = m.find((x) => x.type === "fj")
		expect(fj?.disabled).toBe(true)
		expect(fj?.disabledReason).toBe("no balance")
		expect(fj?.subtitle).toBe("public")
	})

	test("with non-zero public balance, fj is enabled", () => {
		const m = buildFeeMethods([], { publicFeeJuice: "1000", privateFeeJuice: null })
		const fj = m.find((x) => x.type === "fj")
		expect(fj?.disabled).toBeUndefined()
	})

	test("private_fpc without registered FPC is disabled with 'not available' reason", () => {
		const m = buildFeeMethods([], { publicFeeJuice: "1000", privateFeeJuice: "1000" })
		const priv = m.find((x) => x.type === "private_fpc")
		expect(priv?.disabled).toBe(true)
		expect(priv?.disabledReason).toBe("not available")
	})

	test("private_fpc with registered FPC but null private balance is disabled with 'no balance'", () => {
		const fpcs = [{ id: "p1", type: FpcType.PrivateFpc, name: "Private" }]
		const m = buildFeeMethods(fpcs, { publicFeeJuice: "1000", privateFeeJuice: null })
		const priv = m.find((x) => x.type === "private_fpc")
		expect(priv?.disabled).toBe(true)
		expect(priv?.disabledReason).toBe("no balance")
		expect(priv?.subtitle).toBe("private")
	})

	test("private_fpc with registered FPC but zero private balance is disabled with 'no balance'", () => {
		const fpcs = [{ id: "p1", type: FpcType.PrivateFpc, name: "Private" }]
		const m = buildFeeMethods(fpcs, { publicFeeJuice: "1000", privateFeeJuice: "0" })
		const priv = m.find((x) => x.type === "private_fpc")
		expect(priv?.disabled).toBe(true)
		expect(priv?.disabledReason).toBe("no balance")
	})

	test("private_fpc with registered FPC and non-zero private balance is enabled", () => {
		const fpcs = [{ id: "p1", type: FpcType.PrivateFpc, name: "Private" }]
		const m = buildFeeMethods(fpcs, { publicFeeJuice: "1000", privateFeeJuice: "1000" })
		const priv = m.find((x) => x.type === "private_fpc")
		expect(priv?.disabled).toBeUndefined()
	})

	test("allowSponsored:false omits the Sponsored FPC row (Alpha/mainnet)", () => {
		const fpcs = [{ id: "s1", type: FpcType.DefaultSponsoredFpc, name: "Sponsor" }]
		const m = buildFeeMethods(fpcs, undefined, { allowSponsored: false })
		expect(m.map((x) => x.type)).toEqual(["fj", "private_fpc"])
		expect(m.find((x) => x.fpc?.id === "s1")).toBeUndefined()
	})

	test("allowSponsored defaults true (Sponsored FPC retained)", () => {
		const fpcs = [{ id: "s1", type: FpcType.DefaultSponsoredFpc, name: "Sponsor" }]
		expect(buildFeeMethods(fpcs).find((x) => x.fpc?.id === "s1")?.subtitle).toBe("sponsored")
	})
})

describe("fee-helpers/FEE_JUICE_BRIDGE_URL", () => {
	test("defaults to the tools fee-juice bridge", () => {
		expect(FEE_JUICE_BRIDGE_URL).toBe("https://tools.nulo.sh")
	})
})
