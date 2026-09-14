/**
 * The journal's popup boundary: two reads, both answered for the ACTIVE profile only, and the
 * Port fan-out filtered the same way. Driven through the real `handleRequest` (a fake Port
 * records what the popup would receive) so a gate moved into the method bodies — which would
 * break the reaper's in-process cross-profile sweep — reds the in-process pins below.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import { MessageType } from "@nulo/extension-messaging/messages"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { ServiceCollection } from "@/wallet/base"
import { ConfigStore } from "@/wallet/config"
import { LoggerStore } from "@/wallet/logger"
import { PROFILE_SERVICE_NAME } from "@/wallet/services/profile/spec"
import { svc } from "../composition-harness"
import { OperationJournalService } from "./service"
import type { OperationRecord } from "./spec"

type Port = {
	name: string
	postMessage: ReturnType<typeof vi.fn>
	onMessage: { addListener(): void }
	onDisconnect: { addListener(): void }
}
const fakePort = (): Port => ({
	name: "operation-journal",
	postMessage: vi.fn(),
	onMessage: { addListener() {} },
	onDisconnect: { addListener() {} },
})

let active: { id: string } | undefined

async function started(withProfileService = true) {
	const api = new FakeBrowserApi()
	api.reset()
	const service = new OperationJournalService(new LoggerStore(new ConfigStore()), api)
	const services = new ServiceCollection()
	if (withProfileService)
		services.add(
			svc(PROFILE_SERVICE_NAME, {
				getActiveProfile: async () => active,
				getProfiles: async () => [{ id: "p1" }, { id: "p2" }],
			}),
		)
	services.add(service)
	await services.start()
	const port = fakePort()
	// The Port would be admitted by onConnect (same-extension sender); attach it directly.
	;(service as unknown as { clients: Port[] }).clients.push(port)
	let nextId = 1
	const call = async (method: string, ...params: unknown[]) => {
		const requestId = nextId++
		const wrapped = Object.fromEntries(params.map((p, i) => [String(i), p]))
		await (service as unknown as { handleRequest: (c: unknown, p: Port) => Promise<void> }).handleRequest(
			{ requestId, method, params: { ...wrapped, n: params.length } },
			port,
		)
		const reply = port.postMessage.mock.calls
			.map((c) => c[0])
			.find((m) => m.type === MessageType.Response && m.content.requestId === requestId)
		return reply?.content
	}
	const seed = (profileId: string, kind = "transfer") =>
		service.createOperation({ kind, origin: "popup", profileId, accountAddress: "0xshared" })
	return { service, port, call, seed }
}

beforeEach(() => {
	active = { id: "p1" }
})

describe("journal RPC boundary — active-profile ownership", () => {
	test("getOperation(p2Id) → undefined with p1 active; the same id resolves once p2 is active", async () => {
		const { call, seed } = await started()
		const p2 = await seed("p2")
		expect((await call("getOperation", p2.id))?.result).toBeUndefined()
		active = { id: "p2" }
		expect((await call("getOperation", p2.id))?.result).toMatchObject({ id: p2.id, profileId: "p2" })
	})

	test("getOperations({}) → p1 rows only; a foreign profileId filter → []; locked → [] / undefined", async () => {
		const { call, seed } = await started()
		const p1 = await seed("p1")
		await seed("p2")
		const ids = async (...params: unknown[]) =>
			((await call("getOperations", ...params))?.result as OperationRecord[] | undefined)?.map((r) => r.id)
		expect(await ids({})).toEqual([p1.id])
		expect(await ids(undefined)).toEqual([p1.id])
		expect((await call("getOperations", { profileId: "p2" }))?.result).toEqual([])
		active = undefined
		expect((await call("getOperations", {}))?.result).toEqual([])
		expect((await call("getOperation", p1.id))?.result).toBeUndefined()
	})

	test("no ProfileService wired → fail closed ([] / undefined), while the in-process reads still work", async () => {
		const { call, seed, service } = await started(false)
		const p1 = await seed("p1")
		expect((await call("getOperations", {}))?.result).toEqual([])
		expect((await call("getOperation", p1.id))?.result).toBeUndefined()
		expect((await service.getOperations()).map((r) => r.id)).toEqual([p1.id])
	})

	test("each removed write is an invalid method (dropped, no response); backup/restore still reach the framework defaults", async () => {
		const { call, seed } = await started()
		const p1 = await seed("p1")
		for (const method of ["createOperation", "transitionOperation", "setOperationMeta", "countOperations", "deleteOperation"]) {
			expect(await call(method, p1.id)).toBeUndefined()
		}
		expect((await call("backup"))?.result).toBeNull()
		expect((await call("restore", []))?.result).toBeNull()
	})

	test("in-process reads and events cover BOTH profiles (the reaper/GC contract) — the gate is the boundary, not the body", async () => {
		const { service, seed } = await started()
		const seen: string[] = []
		service.onOperationAdded.add((r) => seen.push(r.profileId))
		await seed("p1")
		await seed("p2")
		expect((await service.getOperations({ isTerminal: false })).map((r) => r.profileId).sort()).toEqual(["p1", "p2"])
		expect(seen.sort()).toEqual(["p1", "p2"])
	})
})

describe("journal wire events — filtered to the active profile", () => {
	const flush = () => new Promise((r) => setTimeout(r, 5))
	const wireEvents = (port: Port) =>
		port.postMessage.mock.calls
			.map((c) => c[0])
			.filter((m) => m.type === MessageType.Event)
			.map((m) => `${m.content.event}:${m.content.payload.profileId}`)

	test("a p2 record added/updated/deleted while p1 is active reaches no Port; a p1 record does; nothing while locked", async () => {
		const { service, port, seed } = await started()
		const p2 = await seed("p2")
		await service.setOperationMeta(p2.id, { title: "renamed" })
		await service.deleteOperation(p2.id)
		const p1 = await seed("p1")
		await flush()
		expect(wireEvents(port)).toEqual(["onOperationAdded:p1"])

		active = undefined
		await service.deleteOperation(p1.id)
		await flush()
		expect(wireEvents(port)).toEqual(["onOperationAdded:p1"])
	})
})
