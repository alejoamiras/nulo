import { describe, expect, it } from "vitest"
import { FpcType } from "@/wallet/services/fpc/client"
import { fpcSortOrder, isSyntheticRow, prepareFpc, PUBLIC_FJ_ROW } from "./fpc-helpers"

describe("prepareFpc", () => {
	it("labels DefaultSponsoredFpc as sponsored", () => {
		const result = prepareFpc({ id: "1", address: "0x1", type: FpcType.DefaultSponsoredFpc })
		expect(result.typeName).toBe("sponsored")
		expect(result.typeDescription).toMatch(/sponsor/i)
	})

	it("labels PrivateFpc as private", () => {
		const result = prepareFpc({ id: "1", address: "0x1", type: FpcType.PrivateFpc })
		expect(result.typeName).toBe("private")
		expect(result.typeDescription).toMatch(/private/i)
	})

	it("preserves isProtocol when present", () => {
		const result = prepareFpc({ id: "1", address: "0x1", type: FpcType.PrivateFpc, isProtocol: true })
		expect(result.isProtocol).toBe(true)
	})
})

describe("fpcSortOrder", () => {
	it("sorts PrivateFPC before SponsoredFPC", () => {
		const priv = prepareFpc({ id: "1", address: "0x1", type: FpcType.PrivateFpc })
		const spon = prepareFpc({ id: "2", address: "0x2", type: FpcType.DefaultSponsoredFpc })
		expect(fpcSortOrder(priv)).toBeLessThan(fpcSortOrder(spon))
	})

	it("sorts protocol Sponsored before user-added Sponsored", () => {
		const proto = prepareFpc({ id: "1", address: "0x1", type: FpcType.DefaultSponsoredFpc, isProtocol: true })
		const user = prepareFpc({ id: "2", address: "0x2", type: FpcType.DefaultSponsoredFpc, isProtocol: false })
		expect(fpcSortOrder(proto)).toBeLessThan(fpcSortOrder(user))
	})
})

describe("isSyntheticRow", () => {
	it("returns true for the public-fj anchor", () => {
		expect(isSyntheticRow(PUBLIC_FJ_ROW)).toBe(true)
	})

	it("returns false for any prepared fpc", () => {
		const fpc = prepareFpc({ id: "1", address: "0x1", type: FpcType.PrivateFpc })
		expect(isSyntheticRow(fpc)).toBe(false)
	})
})

describe("PUBLIC_FJ_ROW", () => {
	it("carries the public-fj id and human label", () => {
		expect(PUBLIC_FJ_ROW.id).toBe("public-fj")
		expect(PUBLIC_FJ_ROW.synthetic).toBe("public-fj")
		expect(PUBLIC_FJ_ROW.name).toBe("Public Fee Juice")
	})
})
