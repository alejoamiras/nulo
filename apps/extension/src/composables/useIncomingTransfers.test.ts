import { describe, expect, it, vi } from "vitest"
import { effectScope, nextTick, ref } from "vue"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { ConfigProp } from "@/wallet/config"
import type { IncomingTransferRecord } from "@/wallet/services/incoming-transfer/spec"
import {
	type ConfigServiceLike,
	type IncomingTransferServiceLike,
	type PriceServiceLike,
	useIncomingTransfers,
} from "./useIncomingTransfers"

// Records default to the READY scope (profile "p", network "n", account "a") so the live
// scope-filter (onAdded/onUpdated) admits them; override `accountAddress`/`networkId` to test filtering.
const rec = (id: string, extra: Record<string, unknown> = {}): IncomingTransferRecord =>
	({ id, profileId: "p", networkId: "n", accountAddress: "a", ...extra }) as unknown as IncomingTransferRecord

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

function makePriceService() {
	return { onQuotesUpdated: new EventHandler<unknown>() } satisfies PriceServiceLike
}

const READY = () => ({ profileId: "p", networkId: "n", account: "a" })

/** Run the composable inside an effect scope so `onScopeDispose` is valid +
 *  `scope.stop()` exercises the auto-dispose path. */
function setup(opts: {
	incoming: ReturnType<typeof makeIncomingService>
	config: ReturnType<typeof makeConfigService>
	price?: ReturnType<typeof makePriceService>
	scope?: () => { profileId: string; networkId: string; account: string } | undefined
}) {
	const effect = effectScope()
	const result = effect.run(() =>
		useIncomingTransfers({
			incomingTransferService: opts.incoming,
			configService: opts.config,
			priceService: opts.price,
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

	it("re-fetches when the dust threshold config changes (D8)", async () => {
		const incoming = makeIncomingService([rec("a")])
		const config = makeConfigService()
		setup({ incoming, config })
		incoming.getIncomingTransfers.mockClear()
		config.onUpdate.invoke({ key: "incomingDustUsdThreshold", value: 0.05 } as unknown as ConfigProp)
		await Promise.resolve()
		expect(incoming.getIncomingTransfers).toHaveBeenCalledTimes(1)
	})

	it("re-fetches on onQuotesUpdated (a fresh quote can move a receipt across the threshold)", async () => {
		const incoming = makeIncomingService([rec("a")])
		const price = makePriceService()
		setup({ incoming, config: makeConfigService(), price })
		incoming.getIncomingTransfers.mockClear()
		price.onQuotesUpdated.invoke({})
		await Promise.resolve()
		expect(incoming.getIncomingTransfers).toHaveBeenCalledTimes(1)
	})

	it("dispose() removes the price + config subscriptions", async () => {
		const incoming = makeIncomingService([rec("a")])
		const config = makeConfigService()
		const price = makePriceService()
		const { dispose } = setup({ incoming, config, price })
		dispose()
		incoming.getIncomingTransfers.mockClear()
		config.onUpdate.invoke({ key: "incomingDustUsdThreshold", value: 1 } as unknown as ConfigProp)
		price.onQuotesUpdated.invoke({})
		await Promise.resolve()
		expect(incoming.getIncomingTransfers).not.toHaveBeenCalled()
	})

	it("onAdded IGNORES a record for a different account (scope filter — no cross-account leak)", () => {
		const incoming = makeIncomingService()
		const { incomingTransfers } = setup({ incoming, config: makeConfigService() })
		incoming.onIncomingTransferAdded.invoke(rec("foreign", { accountAddress: "OTHER" }))
		incoming.onIncomingTransferAdded.invoke(rec("foreign-net", { networkId: "OTHERNET" }))
		expect(incomingTransfers.value).toEqual([]) // neither entered the active-account feed
		incoming.onIncomingTransferAdded.invoke(rec("mine")) // in-scope
		expect(incomingTransfers.value.map((x) => x.id)).toEqual(["mine"])
	})

	it("re-fetches when the active scope (account) changes", async () => {
		const incoming = makeIncomingService([rec("a")])
		const account = ref("a")
		setup({ incoming, config: makeConfigService(), scope: () => ({ profileId: "p", networkId: "n", account: account.value }) })
		incoming.getIncomingTransfers.mockClear()
		account.value = "b" // account switch — a pure store mutation, no remount
		await nextTick()
		expect(incoming.getIncomingTransfers).toHaveBeenCalledWith("p", "n", "b")
	})

	it("in-flight guard: a superseded refresh does not clobber a newer one", async () => {
		const incoming = makeIncomingService()
		let resolveFirst: (v: IncomingTransferRecord[]) => void = () => {}
		incoming.getIncomingTransfers
			.mockImplementationOnce(() => new Promise((r) => (resolveFirst = r))) // 1st fetch hangs
			.mockResolvedValueOnce([rec("newer")]) // 2nd fetch wins
		const { incomingTransfers, refresh } = setup({ incoming, config: makeConfigService() })
		const first = refresh() // token 1 (pending)
		await refresh() // token 2 resolves → "newer"
		resolveFirst([rec("stale")]) // token 1 resolves LATE
		await first
		expect(incomingTransfers.value.map((x) => x.id)).toEqual(["newer"]) // stale did not clobber
	})
})
