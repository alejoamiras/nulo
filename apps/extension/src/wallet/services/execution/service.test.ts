/**
 * The auto-lock deferral check: an expired session stays open only for sends the user approved
 * and that have not been broadcast, read from the journal under the session's own profile.
 */
import { describe, expect, test, vi } from "vitest"
import { ExecutionService } from "./service"

function makeService(records: { kind: string; progress: { stage: string } }[]) {
	const getOperations = vi.fn(async () => records)
	const service = Object.assign(Object.create(ExecutionService.prototype), { operationJournal: { getOperations } }) as {
		hasApprovedSendsInFlight(profileId: string): Promise<boolean>
	}
	return { service, getOperations }
}

describe("ExecutionService auto-lock deferral check", () => {
	test.each([
		{ kind: "dapp_execute", stage: "queued", defers: false },
		{ kind: "dapp_execute", stage: "pending", defers: true },
		{ kind: "transfer", stage: "simulating", defers: true },
		{ kind: "transfer", stage: "proving", defers: true },
		{ kind: "transfer", stage: "submitting", defers: false },
		{ kind: "transfer", stage: "succeeded", defers: false },
		{ kind: "token_import", stage: "proving", defers: false },
	])("a $kind record at $stage defers: $defers", async ({ kind, stage, defers }) => {
		const { service, getOperations } = makeService([{ kind, progress: { stage } }])
		expect(await service.hasApprovedSendsInFlight("p1")).toBe(defers)
		expect(getOperations).toHaveBeenCalledWith({ profileId: "p1" })
	})

	test("a journal of queued requests alone does not defer", async () => {
		const queued = { kind: "dapp_execute", progress: { stage: "queued" } }
		const { service } = makeService([queued, queued, queued])
		expect(await service.hasApprovedSendsInFlight("p1")).toBe(false)
	})
})
