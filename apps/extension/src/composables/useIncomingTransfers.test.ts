import { describe, expect, it, vi } from "vitest"
import { effectScope } from "vue"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { ConfigProp } from "@/wallet/config"
import type { IncomingTransferRecord } from "@/wallet/services/incoming-transfer/spec"
import { type ConfigServiceLike, type IncomingTransferServiceLike, useIncomingTransfers } from "./useIncomingTransfers"

const rec = (id: string, extra: Record<string, unknown> = {}): IncomingTransferRecord =>
	({ id, ...extra }) as unknown as IncomingTransferRecord

function makeIncomingService(records: IncomingTransferRecord[] = []) {
	return {
		getIncomingTransfers: vi.fn(async () => records),
		onIncomingTransferAdded: new EventHandler<IncomingTransferRecord>(),
		onIncomingTransferUpdated: new EventHandler<IncomingTransferRecord>(),
		onIncomingTransferDeleted: new EventHandler<IncomingTransferRecord>(),
		onConnected: new EventHandler<void>(),
	} satisfies IncomingTransferServiceLike & { getIncomingTransfers: ReturnType<typeof vi.fn> }
}

function makeConfigService() {
	return { onUpdate: new EventHandler<ConfigProp>() } satisfies ConfigServiceLike
}

const READY = () => ({ profileId: "p", networkId: "n", account: "a" })

/** Run the composable inside an effect scope so `onScopeDispose` is valid +
 *  `scope.stop()` exercises the auto-dispose path. */
function setup(opts: {
	incoming: ReturnType<typeof makeIncomingService>
	config: ReturnType<typeof makeConfigService>
	scope?: () => { profileId: string; networkId: string; account: string } | undefined
}) {
	const effect = effectScope()
	const result = effect.run(() =>
		useIncomingTransfers({
			incomingTransferService: opts.incoming,
			configService: opts.config,
			scope: opts.scope ?? READY,
		}),
	)
	if (!result) throw new Error("composable did not initialize")
	return { ...result, effect }
}

describe("useIncomingTransfers", () => {
	it("refresh() fetches for the active scope and populates the ref", async () => {
		const incoming = makeIncomingService([rec("a"), rec("b")])
		const { incomingTransfers, refresh } = setup({ incoming, config: makeConfigService() })
		await refresh()
		expect(incoming.getIncomingTransfers).toHaveBeenCalledWith("p", "n", "a")
		expect(incomingTransfers.value.map((x) => x.id)).toEqual(["a", "b"])
	})

	it("refresh() is a no-op when scope is not ready (no fetch)", async () => {
		const incoming = makeIncomingService([rec("a")])
		const { incomingTransfers, refresh } = setup({ incoming, config: makeConfigService(), scope: () => undefined })
		await refresh()
		expect(incoming.getIncomingTransfers).not.toHaveBeenCalled()
		expect(incomingTransfers.value).toEqual([])
	})

	it("refresh() clears atomically when the service returns [] (visibility off)", async () => {
		const incoming = makeIncomingService([rec("a")])
		const { incomingTransfers, refresh } = setup({ incoming, config: makeConfigService() })
		await refresh()
		expect(incomingTransfers.value).toHaveLength(1)
		incoming.getIncomingTransfers.mockResolvedValueOnce([])
		await refresh()
		expect(incomingTransfers.value).toEqual([])
	})

	it("onConnected triggers a refresh", async () => {
		const incoming = makeIncomingService([rec("z")])
		const { incomingTransfers } = setup({ incoming, config: makeConfigService() })
		incoming.onConnected.invoke()
		await Promise.resolve()
		expect(incomingTransfers.value.map((x) => x.id)).toEqual(["z"])
	})

	it("onAdded prepends a new record", () => {
		const incoming = makeIncomingService()
		const { incomingTransfers } = setup({ incoming, config: makeConfigService() })
		incoming.onIncomingTransferAdded.invoke(rec("a"))
		incoming.onIncomingTransferAdded.invoke(rec("b"))
		expect(incomingTransfers.value.map((x) => x.id)).toEqual(["b", "a"])
	})

	it("onAdded replaces in place when the id already exists", () => {
		const incoming = makeIncomingService()
		const { incomingTransfers } = setup({ incoming, config: makeConfigService() })
		incoming.onIncomingTransferAdded.invoke(rec("a", { v: 1 }))
		incoming.onIncomingTransferAdded.invoke(rec("a", { v: 2 }))
		expect(incomingTransfers.value).toHaveLength(1)
		expect((incomingTransfers.value[0] as unknown as { v: number }).v).toBe(2)
	})

	it("onUpdated replaces an existing record", () => {
		const incoming = makeIncomingService()
		const { incomingTransfers } = setup({ incoming, config: makeConfigService() })
		incoming.onIncomingTransferAdded.invoke(rec("a", { v: 1 }))
		incoming.onIncomingTransferUpdated.invoke(rec("a", { v: 9 }))
		expect((incomingTransfers.value[0] as unknown as { v: number }).v).toBe(9)
	})

	it("onUpdated ignores an unknown record (does not add)", () => {
		const incoming = makeIncomingService()
		const { incomingTransfers } = setup({ incoming, config: makeConfigService() })
		incoming.onIncomingTransferUpdated.invoke(rec("ghost"))
		expect(incomingTransfers.value).toEqual([])
	})

	it("onDeleted removes by id", () => {
		const incoming = makeIncomingService()
		const { incomingTransfers } = setup({ incoming, config: makeConfigService() })
		incoming.onIncomingTransferAdded.invoke(rec("a"))
		incoming.onIncomingTransferAdded.invoke(rec("b"))
		incoming.onIncomingTransferDeleted.invoke(rec("a"))
		expect(incomingTransfers.value.map((x) => x.id)).toEqual(["b"])
	})

	it("config update for incomingTransfersVisible triggers a refresh", async () => {
		const incoming = makeIncomingService([rec("a")])
		const config = makeConfigService()
		const { incomingTransfers } = setup({ incoming, config })
		config.onUpdate.invoke({ key: "incomingTransfersVisible" } as unknown as ConfigProp)
		await Promise.resolve()
		expect(incoming.getIncomingTransfers).toHaveBeenCalledTimes(1)
		expect(incomingTransfers.value.map((x) => x.id)).toEqual(["a"])
	})

	it("config update for an unrelated key does NOT refresh", async () => {
		const incoming = makeIncomingService()
		const config = makeConfigService()
		setup({ incoming, config })
		config.onUpdate.invoke({ key: "stealthMode" } as unknown as ConfigProp)
		await Promise.resolve()
		expect(incoming.getIncomingTransfers).not.toHaveBeenCalled()
	})

	it("dispose() removes every handler — later events are ignored", () => {
		const incoming = makeIncomingService()
		const config = makeConfigService()
		const { incomingTransfers, dispose } = setup({ incoming, config })
		dispose()
		incoming.onIncomingTransferAdded.invoke(rec("a"))
		incoming.onIncomingTransferUpdated.invoke(rec("a"))
		incoming.onIncomingTransferDeleted.invoke(rec("a"))
		config.onUpdate.invoke({ key: "incomingTransfersVisible" } as unknown as ConfigProp)
		expect(incomingTransfers.value).toEqual([])
		expect(incoming.getIncomingTransfers).not.toHaveBeenCalled()
	})

	it("scope.stop() auto-disposes via onScopeDispose", () => {
		const incoming = makeIncomingService()
		const { incomingTransfers, effect } = setup({ incoming, config: makeConfigService() })
		effect.stop()
		incoming.onIncomingTransferAdded.invoke(rec("a"))
		expect(incomingTransfers.value).toEqual([])
	})
})
