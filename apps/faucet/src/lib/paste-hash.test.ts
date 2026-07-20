import type { DepositJournalRecord } from "@nulo/bridge-core"
import { describe, expect, it } from "vitest"
import { type MinimalReceipt, validatePastedDepositHash } from "./paste-hash"

const ID = `0x${"ab".repeat(32)}`
const PORTAL = "0xPortalAddress"
const rec = { id: ID, portal: PORTAL, direction: "deposit" } as DepositJournalRecord
const GOOD = `0x${"cd".repeat(32)}`

const receipt = (over: Partial<MinimalReceipt> = {}): MinimalReceipt => ({
	status: "success",
	to: PORTAL,
	logs: [{ topics: [ID] }],
	...over,
})

describe("validatePastedDepositHash", () => {
	it("accepts a mined success sent to the portal whose logs carry the record's secret hash", async () => {
		expect(await validatePastedDepositHash(rec, GOOD, async () => receipt())).toEqual({ ok: true })
	})

	it("trims + accepts surrounding whitespace", async () => {
		expect(await validatePastedDepositHash(rec, `  ${GOOD}\n`, async () => receipt())).toEqual({ ok: true })
	})

	it("rejects a malformed hash without any RPC call", async () => {
		let called = false
		const v = await validatePastedDepositHash(rec, "0xnothex", async () => {
			called = true
			return receipt()
		})
		expect(v.ok).toBe(false)
		expect(called).toBe(false)
	})

	it("rejects a not-yet-mined tx (null receipt)", async () => {
		const v = await validatePastedDepositHash(rec, GOOD, async () => null)
		expect(v).toMatchObject({ ok: false })
		if (!v.ok) expect(v.reason).toMatch(/isn't on ethereum yet/i)
	})

	it("rejects a reverted tx", async () => {
		const v = await validatePastedDepositHash(rec, GOOD, async () => receipt({ status: "reverted" }))
		if (!v.ok) expect(v.reason).toMatch(/reverted/i)
		expect(v.ok).toBe(false)
	})

	it("rejects a tx sent to the wrong contract", async () => {
		const v = await validatePastedDepositHash(rec, GOOD, async () => receipt({ to: "0xSomethingElse" }))
		if (!v.ok) expect(v.reason).toMatch(/not sent to this bridge/i)
		expect(v.ok).toBe(false)
	})

	it("rejects a tx whose logs never carry the record's secret hash", async () => {
		const v = await validatePastedDepositHash(rec, GOOD, async () => receipt({ logs: [{ topics: ["0xdeadbeef"] }] }))
		if (!v.ok) expect(v.reason).toMatch(/doesn't match this bridge/i)
		expect(v.ok).toBe(false)
	})

	it("tolerates an empty-logs receipt (content-hash check is best-effort)", async () => {
		expect(await validatePastedDepositHash(rec, GOOD, async () => receipt({ logs: [] }))).toEqual({ ok: true })
	})

	it("surfaces an RPC throw as a retryable error", async () => {
		const v = await validatePastedDepositHash(rec, GOOD, async () => {
			throw new Error("network")
		})
		if (!v.ok) expect(v.reason).toMatch(/could not read/i)
		expect(v.ok).toBe(false)
	})
})
