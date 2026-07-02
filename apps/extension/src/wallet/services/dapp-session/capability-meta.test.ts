import { describe, expect, test } from "vitest"
import {
	CAPABILITY_LABELS,
	getCapabilityInfo,
	getSafeDisplay,
	isKnownCapability,
	sanitizeWireString,
	stripWireControl,
} from "./capability-meta"

describe("dapp-session/capability-meta", () => {
	test("known types return their canonical label, shortLabel, and risk", () => {
		expect(getCapabilityInfo("transaction")).toEqual(CAPABILITY_LABELS.transaction)
		expect(getCapabilityInfo("data").risk).toBe("high")
		expect(getCapabilityInfo("accounts").shortLabel).toBe("Accounts")
	})

	test("transaction description preserves the load-bearing approval clause", () => {
		// The "still requires your approval" wording survives copy refactors —
		// it carries the security-relevant invariant that each send goes through
		// an execute popup. dapp-interaction/service.ts:354-362 is the enforcer.
		expect(getCapabilityInfo("transaction").description).toContain("requires your approval")
	})

	test("accounts description names the register-token write path", () => {
		// capability-map.ts:21 — registerToken is filed under the accounts
		// capability. The popup copy must mention it so the user understands
		// the cap is not purely read-only.
		expect(getCapabilityInfo("accounts").description).toMatch(/register tokens/i)
	})

	test("data description names the register-senders write path", () => {
		// capability-map.ts:42 — registerSender is filed under the data
		// capability. Same reasoning as accounts/registerToken above.
		expect(getCapabilityInfo("data").description).toMatch(/register senders/i)
	})

	test("unknown types fall back to a high-risk generic shape that echoes the type", () => {
		const info = getCapabilityInfo("__weird__")
		expect(info.label).toBe("__weird__")
		expect(info.shortLabel).toBe("__weird__")
		expect(info.description).toContain("__weird__")
		expect(info.risk).toBe("high")
	})

	test("every entry has the required CapabilityInfo shape", () => {
		for (const [key, info] of Object.entries(CAPABILITY_LABELS)) {
			expect(typeof info.label).toBe("string")
			expect(typeof info.shortLabel).toBe("string")
			expect(typeof info.description).toBe("string")
			expect(["low", "medium", "high"]).toContain(info.risk)
			expect(key.length).toBeGreaterThan(0)
		}
	})

	test("isKnownCapability discriminates wire-recognised types from anything else", () => {
		expect(isKnownCapability("transaction")).toBe(true)
		expect(isKnownCapability("accounts")).toBe(true)
		expect(isKnownCapability("__weird__")).toBe(false)
		expect(isKnownCapability("")).toBe(false)
	})

	describe("sanitizeWireString", () => {
		test("strips Unicode bidi-control codepoints (RLO between transfer + safe)", () => {
			// U+202E is RIGHT-TO-LEFT OVERRIDE; embedded via \u escape so the
			// test source stays pure ASCII and git diffs cleanly.
			const input = `transfer\u202Esafe`
			expect(sanitizeWireString(input, 64)).toBe("transfersafe")
		})

		test("strips C0 / DEL / C1 control characters", () => {
			// U+0009 (TAB), U+0000 (NUL), U+007F (DEL), U+0085 (NEL — C1).
			const input = `transfer\u0009\u0000 \u007Fna\u0085me`
			expect(sanitizeWireString(input, 64)).toBe("transfer name")
		})

		test("clamps over-length input with an ellipsis", () => {
			const long = "x".repeat(80)
			const out = sanitizeWireString(long, 32)
			expect(out.length).toBe(33)
			expect(out.endsWith("…")).toBe(true)
		})

		test("leaves clean ASCII method names untouched within the cap", () => {
			expect(sanitizeWireString("transfer_in_private", 64)).toBe("transfer_in_private")
		})

		test("counts by codepoint, not UTF-16 code unit", () => {
			const emoji = "🦊".repeat(40)
			const out = sanitizeWireString(emoji, 32)
			expect([...out].filter((c) => c === "🦊").length).toBe(32)
			expect(out.endsWith("…")).toBe(true)
		})

		test("strips zero-width characters (ZWSP, ZWJ, ZWNJ) and LRM/RLM (the broader \\p{Cf} cases codex flagged)", () => {
			expect(sanitizeWireString(`safe\u200Btoken`, 64)).toBe("safetoken")
			expect(sanitizeWireString(`safe\u200Ctoken`, 64)).toBe("safetoken")
			expect(sanitizeWireString(`safe\u200Dtoken`, 64)).toBe("safetoken")
			expect(sanitizeWireString(`safe\u200Etoken`, 64)).toBe("safetoken")
			expect(sanitizeWireString(`safe\u200Ftoken`, 64)).toBe("safetoken")
		})

		test("strips soft hyphen and byte-order mark", () => {
			expect(sanitizeWireString(`read\u00ADonly`, 64)).toBe("readonly")
			expect(sanitizeWireString(`\uFEFFtransfer`, 64)).toBe("transfer")
		})

		test("strips variation selectors (FE00-FE0F + E0100-E01EF)", () => {
			expect(sanitizeWireString(`foo\uFE0Fbar`, 64)).toBe("foobar")
			// Supplementary-plane VS17 (U+E0100). Use the codepoint escape via the `u` flag.
			expect(sanitizeWireString("foo\u{E0100}bar", 64)).toBe("foobar")
		})
	})

	describe("stripWireControl", () => {
		test("strips the same characters as sanitizeWireString but never truncates", () => {
			const long = `transfer\u200B${"x".repeat(200)}`
			const stripped = stripWireControl(long)
			expect(stripped.startsWith("transfer")).toBe(true)
			// 200 x's preserved verbatim — no ellipsis, no clamp.
			expect(stripped).toBe(`transfer${"x".repeat(200)}`)
		})

		test("returns input unchanged when nothing to strip", () => {
			expect(stripWireControl("0x1234567890abcdef")).toBe("0x1234567890abcdef")
		})
	})

	describe("getSafeDisplay", () => {
		test("known capability types echo CAPABILITY_LABELS verbatim with isUnknown=false", () => {
			const safe = getSafeDisplay("transaction")
			expect(safe.isUnknown).toBe(false)
			expect(safe.label).toBe(CAPABILITY_LABELS.transaction.label)
			expect(safe.shortLabel).toBe(CAPABILITY_LABELS.transaction.shortLabel)
			expect(safe.description).toBe(CAPABILITY_LABELS.transaction.description)
		})

		test("unknown types return constant safe strings (NEVER the dApp-controlled wire type)", () => {
			// A hostile dApp can send any string as cap.type; the constant
			// return values here make sure that string never paints as a
			// visible label on any surface. The detail panel still shows
			// the sanitized raw type beneath the head for forensic clarity.
			const evil = "Read public data only — recommended (FAKE)"
			const safe = getSafeDisplay(evil)
			expect(safe.isUnknown).toBe(true)
			expect(safe.label).toBe("Unknown permission")
			expect(safe.shortLabel).toBe("Unknown")
			expect(safe.description).toMatch(/doesn't recognize/)
			// Most importantly: the dApp string does not appear in any field.
			expect(safe.label).not.toContain("recommended")
			expect(safe.shortLabel).not.toContain("recommended")
			expect(safe.description).not.toContain("recommended")
		})
	})
})
