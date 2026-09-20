import { describe, expect, test, vi } from "vitest"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { LegalAcceptanceServiceClient, LegalStatus } from "@/wallet/services/legal/client"
import { useLegalAcceptance } from "./useLegalAcceptance"

function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

function makeService(getStatus: () => Promise<LegalStatus> = async () => "current") {
	const service = {
		onAcceptanceChanged: new EventHandler<LegalStatus>(),
		onConnected: new EventHandler<void>(),
		getStatus: vi.fn(getStatus),
		accept: vi.fn(async () => ({})),
	}
	return { service, client: service as unknown as LegalAcceptanceServiceClient }
}

describe("useLegalAcceptance", () => {
	test("starts at loading, which is not the same as missing", () => {
		const { client } = makeService()
		const legal = useLegalAcceptance(client)
		expect(legal.status.value).toBe("loading")
		expect(legal.isCurrent.value).toBe(false)
	})

	test("refresh resolves to what the background says", async () => {
		const { client } = makeService(async () => "stale")
		const legal = useLegalAcceptance(client)
		await legal.refresh()
		expect(legal.status.value).toBe("stale")
	})

	test("subscribes before it reads: a change landing mid-read wins over the read", async () => {
		const read = deferred<LegalStatus>()
		const { service, client } = makeService(() => read.promise)
		const legal = useLegalAcceptance(client)
		const refreshing = legal.refresh()
		service.onAcceptanceChanged.invoke("current")
		read.resolve("missing")
		await refreshing
		expect(legal.status.value).toBe("current")
	})

	test("of two overlapping reads, only the newer one lands", async () => {
		const reads = [deferred<LegalStatus>(), deferred<LegalStatus>()]
		let call = 0
		const { client } = makeService(() => (reads[call++] as (typeof reads)[number]).promise)
		const legal = useLegalAcceptance(client)
		const first = legal.refresh()
		const second = legal.refresh()
		reads[1]?.resolve("current")
		reads[0]?.resolve("missing")
		await Promise.all([first, second])
		expect(legal.status.value).toBe("current")
	})

	test("an event after the read updates the status", async () => {
		const { service, client } = makeService(async () => "missing")
		const legal = useLegalAcceptance(client)
		await legal.refresh()
		service.onAcceptanceChanged.invoke("current")
		expect(legal.isCurrent.value).toBe(true)
	})

	test("a reconnect re-reads: an event missed while the port was down is recovered", async () => {
		const { service, client } = makeService(async () => "missing")
		const legal = useLegalAcceptance(client)
		await legal.refresh()
		service.getStatus.mockResolvedValue("current")
		service.onConnected.invoke()
		await vi.waitFor(() => expect(legal.status.value).toBe("current"))
	})

	test("a failed read is not current, and keeps the error", async () => {
		const boom = new Error("port closed")
		const { client } = makeService(async () => {
			throw boom
		})
		const legal = useLegalAcceptance(client)
		await legal.refresh()
		expect(legal.status.value).toBe("missing")
		expect(legal.error.value).toBe(boom)
	})

	test("accept stays not-current until the background has stored the record", async () => {
		const write = deferred<object>()
		const { service, client } = makeService(async () => "missing")
		service.accept.mockReturnValue(write.promise)
		const legal = useLegalAcceptance(client)
		await legal.refresh()
		const accepting = legal.accept("popup")
		expect(legal.status.value).toBe("missing")
		write.resolve({})
		await accepting
		expect(service.accept).toHaveBeenCalledWith("popup")
		expect(legal.status.value).toBe("current")
	})

	test("a failed accept surfaces and changes nothing", async () => {
		const boom = new Error("storage full")
		const { service, client } = makeService(async () => "stale")
		service.accept.mockRejectedValue(boom)
		const legal = useLegalAcceptance(client)
		await legal.refresh()
		await expect(legal.accept("popup")).rejects.toBe(boom)
		expect(legal.status.value).toBe("stale")
		expect(legal.error.value).toBe(boom)
	})

	test("dispose unsubscribes, drops an in-flight read, and is safe to call twice", async () => {
		const read = deferred<LegalStatus>()
		const { service, client } = makeService(() => read.promise)
		const legal = useLegalAcceptance(client)
		const refreshing = legal.refresh()
		legal.dispose()
		legal.dispose()
		read.resolve("current")
		await refreshing
		service.onAcceptanceChanged.invoke("current")
		service.onConnected.invoke()
		expect(legal.status.value).toBe("loading")
		expect(service.getStatus).toHaveBeenCalledTimes(1)
	})
})
