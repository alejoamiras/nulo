import { describe, expect, test } from "vitest"
import type { Token } from "@/wallet/services/token/spec"
import { isLegacyBalanceRow, rowMatchesToken } from "./balance-identity"
import type { TokenBalanceRaw } from "./spec"

const token = (overrides: Partial<Token> = {}): Token => ({
	id: 7,
	profileId: "p1",
	chainId: 1,
	contract: "0xc7",
	name: "T7",
	symbol: "T7",
	decimals: 18,
	...overrides,
})

const row = (overrides: Partial<TokenBalanceRaw> = {}): TokenBalanceRaw => ({
	id: 1,
	token: 7,
	account: "0xa",
	profileId: "p1",
	chainId: 1,
	contract: "0xc7",
	updatedAt: 0,
	...overrides,
})

describe("rowMatchesToken", () => {
	test("full identity match", () => {
		expect(rowMatchesToken(row(), token())).toBe(true)
	})

	test.each([
		["token fk", { token: 8 }],
		["profileId", { profileId: "p2" }],
		["chainId", { chainId: 2 }],
		["contract", { contract: "0xother" }],
	] as const)("any single mismatch fails: %s", (_name, overrides) => {
		expect(rowMatchesToken(row(overrides), token())).toBe(false)
	})
})

describe("isLegacyBalanceRow", () => {
	const legacyFull = {
		id: 3,
		token: 7,
		account: "0xa",
		publicBalance: "5",
		privateBalance: "6",
		updatedAt: 9,
		syncFailure: { at: 1, message: "m" },
	}
	const legacyMinimal = { id: 3, token: 7, account: "0xa", updatedAt: 0 }

	test("matches the exact legacy shape, full and minimal, at its canonical key", () => {
		expect(isLegacyBalanceRow(legacyFull, "3")).toBe(true)
		expect(isLegacyBalanceRow(legacyMinimal, "3")).toBe(true)
	})

	test("unknown extra keys are tolerated (the old codec was non-strict)", () => {
		expect(isLegacyBalanceRow({ ...legacyMinimal, junk: true }, "3")).toBe(true)
	})

	test.each(["profileId", "chainId", "contract"])("any new-schema field present disqualifies: %s", (field) => {
		expect(isLegacyBalanceRow({ ...legacyMinimal, [field]: "x" }, "3")).toBe(false)
	})

	test.each([
		["string id", { ...legacyMinimal, id: "3" }],
		["string token", { ...legacyMinimal, token: "7" }],
		["numeric account", { ...legacyMinimal, account: 1 }],
		["string updatedAt", { ...legacyMinimal, updatedAt: "0" }],
		["numeric publicBalance", { ...legacyMinimal, publicBalance: 5 }],
		["numeric privateBalance", { ...legacyMinimal, privateBalance: 5 }],
		["malformed syncFailure", { ...legacyMinimal, syncFailure: { at: "1", message: "m" } }],
		["null syncFailure", { ...legacyMinimal, syncFailure: null }],
	] as const)("otherwise-malformed rows are NOT legacy: %s", (_name, raw) => {
		expect(isLegacyBalanceRow(raw as Record<string, unknown>, "3")).toBe(false)
	})

	test("storage-key identity must be canonical and equal to the embedded id", () => {
		expect(isLegacyBalanceRow(legacyMinimal, "4")).toBe(false)
		expect(isLegacyBalanceRow(legacyMinimal, "03")).toBe(false)
		expect(isLegacyBalanceRow(legacyMinimal, "3e0")).toBe(false)
		expect(isLegacyBalanceRow(legacyMinimal, " 3")).toBe(false)
	})
})
