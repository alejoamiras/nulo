import { describe, expect, it } from "vitest"
import { formatPasskeyUserName } from "./passkey-label"

const ID = "a3f29b14"

describe("formatPasskeyUserName", () => {
	it("formats a simple name as nulo-{slug}-{id}", () => {
		expect(formatPasskeyUserName("Alice", ID)).toBe("nulo-alice-a3f29b14")
	})

	it("lowercases", () => {
		expect(formatPasskeyUserName("ALICE", ID)).toBe("nulo-alice-a3f29b14")
	})

	it("turns whitespace runs into single hyphens", () => {
		expect(formatPasskeyUserName("My  Wallet", ID)).toBe("nulo-my-wallet-a3f29b14")
	})

	it("folds combining accents instead of inserting stray hyphens (Élodie -> elodie)", () => {
		// Regression for the NFKD bug: É decomposes to E + U+0301; without
		// stripping the combining mark the allow-list would yield "e-lodie".
		expect(formatPasskeyUserName("Élodie", ID)).toBe("nulo-elodie-a3f29b14")
	})

	it("strips emoji and symbols", () => {
		expect(formatPasskeyUserName("Alice 🚀!!!", ID)).toBe("nulo-alice-a3f29b14")
	})

	it("strips bidi/zero-width/control characters so they cannot survive in the label", () => {
		// U+202E RIGHT-TO-LEFT OVERRIDE + U+200B ZERO WIDTH SPACE must not appear.
		const out = formatPasskeyUserName("ab‮cd​", ID)
		expect(out).not.toContain("‮")
		expect(out).not.toContain("​")
		expect(out).toBe("nulo-ab-cd-a3f29b14")
	})

	it("caps the slug length and never leaves a trailing hyphen from the cut", () => {
		const long = "abcdefghij klmnopqrst uvwxyzabcdefgh" // 24th char is a space boundary
		const out = formatPasskeyUserName(long, ID)
		const slug = out.replace(/^nulo-/, "").replace(/-a3f29b14$/, "")
		expect(slug.length).toBeLessThanOrEqual(24)
		expect(slug.endsWith("-")).toBe(false)
		expect(out.startsWith("nulo-")).toBe(true)
		expect(out.endsWith(`-${ID}`)).toBe(true)
	})

	it("never produces doubled hyphens around stray edge symbols", () => {
		expect(formatPasskeyUserName("-x-", ID)).toBe("nulo-x-a3f29b14")
	})

	it("falls back to nulo-profile-{id} for an empty name", () => {
		expect(formatPasskeyUserName("", ID)).toBe("nulo-profile-a3f29b14")
	})

	it("falls back for a whitespace-only name", () => {
		expect(formatPasskeyUserName("   ", ID)).toBe("nulo-profile-a3f29b14")
	})

	it("falls back for an all-symbol name", () => {
		expect(formatPasskeyUserName("!@#$%^&*", ID)).toBe("nulo-profile-a3f29b14")
	})

	it("falls back for a non-Latin (CJK) name under the ASCII-slug policy", () => {
		expect(formatPasskeyUserName("山田", ID)).toBe("nulo-profile-a3f29b14")
	})

	it("preserves the id verbatim", () => {
		expect(formatPasskeyUserName("Alice", "deadbeef")).toBe("nulo-alice-deadbeef")
	})
})
