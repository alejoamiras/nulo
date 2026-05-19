import { describe, expect, it } from "vitest"
import { scanRpIdLiteralDrift, validateHostPermissions } from "./check-rp-id"

describe("validateHostPermissions", () => {
	it("ok when host_permissions contains the expected entry", () => {
		const result = validateHostPermissions({ host_permissions: ["https://nulo.sh/"] }, "nulo.sh")
		expect(result).toEqual({ ok: true })
	})

	it("ok when host_permissions has the expected entry alongside others", () => {
		const result = validateHostPermissions({ host_permissions: ["https://nulo.sh/", "https://example.com/"] }, "nulo.sh")
		expect(result).toEqual({ ok: true })
	})

	it("fails when host_permissions is missing", () => {
		const result = validateHostPermissions({}, "nulo.sh")
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error).toMatch(/missing or not an array/)
		}
	})

	it("fails when host_permissions does not contain the expected entry", () => {
		const result = validateHostPermissions({ host_permissions: ["https://wrong.example/"] }, "nulo.sh")
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.error).toMatch(/does not contain "https:\/\/nulo\.sh\/"/)
			expect(result.details).toMatchObject({
				expected: "https://nulo.sh/",
				hostPermissions: ["https://wrong.example/"],
			})
		}
	})

	it("fails when host_permissions has the bare host without https:// prefix", () => {
		const result = validateHostPermissions({ host_permissions: ["nulo.sh"] }, "nulo.sh")
		expect(result.ok).toBe(false)
	})

	it("fails when host_permissions has a different scheme", () => {
		const result = validateHostPermissions({ host_permissions: ["http://nulo.sh/"] }, "nulo.sh")
		expect(result.ok).toBe(false)
	})
})

describe("scanRpIdLiteralDrift", () => {
	const rpId = "nulo.sh"

	it("clean when source uses RP_ID identifier instead of literal", () => {
		const content = `
			import { RP_ID } from "@/wallet/services/passkey/spec"
			const opts = { rpId: RP_ID }
			const create = { rp: { id: RP_ID } }
		`
		expect(scanRpIdLiteralDrift("test.ts", content, rpId)).toEqual([])
	})

	it("flags double-quoted literal in rpId position", () => {
		const content = `const opts = { rpId: "nulo.sh" }`
		const findings = scanRpIdLiteralDrift("test.ts", content, rpId)
		expect(findings).toHaveLength(1)
		expect(findings[0]).toMatchObject({ line: 1, literal: rpId })
	})

	it("flags nested rp.id literal (catches the M4.9-v0 miss)", () => {
		const content = `
			const create = {
				rp: {
					name: "Nulo",
					id: "nulo.sh",
				},
			}
		`
		const findings = scanRpIdLiteralDrift("test.ts", content, rpId)
		expect(findings).toHaveLength(1)
		expect(findings[0].line).toBe(5)
	})

	it("flags single-quoted literal too", () => {
		const content = `const opts = { rpId: 'nulo.sh' }`
		expect(scanRpIdLiteralDrift("t.ts", content, rpId)).toHaveLength(1)
	})

	it("flags template-literal form", () => {
		const content = "const opts = { rpId: `nulo.sh` }"
		expect(scanRpIdLiteralDrift("t.ts", content, rpId)).toHaveLength(1)
	})

	it("ignores literals inside line comments", () => {
		const content = `// historical: id: "nulo.sh" — used to be a literal\nconst x = RP_ID`
		expect(scanRpIdLiteralDrift("t.ts", content, rpId)).toEqual([])
	})

	it("ignores literals inside block comments", () => {
		const content = `/* prior:\n  rpId: "nulo.sh"\n*/\nconst x = RP_ID`
		expect(scanRpIdLiteralDrift("t.ts", content, rpId)).toEqual([])
	})

	it("excludes the definition line when excludeDefinition is set", () => {
		const content = `export const RP_ID = "nulo.sh"`
		const findings = scanRpIdLiteralDrift("spec.ts", content, rpId, { excludeDefinition: true })
		expect(findings).toEqual([])
	})

	it("does NOT exclude definition by default", () => {
		const content = `export const RP_ID = "nulo.sh"`
		const findings = scanRpIdLiteralDrift("spec.ts", content, rpId)
		expect(findings).toHaveLength(1)
	})

	it("flags multiple drift sites independently", () => {
		const content = `
			const a = { rpId: "nulo.sh" }
			const b = { rp: { id: "nulo.sh" } }
		`
		expect(scanRpIdLiteralDrift("t.ts", content, rpId)).toHaveLength(2)
	})
})
