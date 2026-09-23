/**
 * Pre-extraction pin (codex seam condition, round-2 plan 4): `transitionOperation`
 * persists the updated row BEFORE `onOperationUpdated` fires — the
 * `storage.set → emit` pair is a register-immediately span (no await between
 * them), so a listener that reads storage on the event always sees the new stage.
 */
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { describe, expect, test, vi } from "vitest"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { OperationJournalService } from "./service"

async function started(): Promise<{ api: FakeBrowserApi; service: OperationJournalService }> {
	const api = new FakeBrowserApi()
	api.reset()
	const service = new OperationJournalService(new LoggerStore(new ConfigStore()), api)
	const services = new ServiceCollection()
	services.add(service)
	await services.start()
	return { api, service }
}

describe("OperationJournalService — transition write-before-emit", () => {
	test("the row's storage write settles before onOperationUpdated fires, and the emitted record is the persisted one", async () => {
		const { api, service } = await started()
		const rec = await service.createOperation({ kind: "transfer", origin: "popup", profileId: "profile-a" })

		const log: string[] = []
		const origSet = api.storage.local.set.bind(api.storage.local)
		vi.spyOn(api.storage.local, "set").mockImplementation(async (entries) => {
			await origSet(entries)
			log.push("set")
		})
		service.onOperationUpdated.add((updated) => {
			log.push(`emit:${updated.progress.stage}`)
		})

		const updated = await service.transitionOperation(rec.id, { stage: "simulating" })

		expect(log).toEqual(["set", "emit:simulating"])
		expect(updated.progress.stage).toBe("simulating")
		expect((await service.getOperation(rec.id))?.progress.stage).toBe("simulating")
	})
})
