import { describe, expect, it, vi } from "vitest"
import { effectScope, ref } from "vue"
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
// scope-filter (onAdded/onUpdated) admits them; override `accountAddress`/`networkId`/`profileId` to
// exercise the foreign-scope drop. Keyed by `id` — the discriminated-union PK (public records have no
// `siloedNullifier`).
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

	it("an Added is read back through the service, so a receipt the dust filter drops never appears", async () => {
		vi.useFakeTimers()
		try {
			const incoming = makeIncomingService([])
			const { incomingTransfers } = setup({ incoming, config: makeConfigService() })
			incoming.onIncomingTransferAdded.invoke(rec("dust"))
			expect(incomingTransfers.value).toEqual([])
			await vi.advanceTimersByTimeAsync(250)
			expect(incoming.getIncomingTransfers).toHaveBeenCalledTimes(1)
			expect(incomingTransfers.value).toEqual([])
		} finally {
			vi.useRealTimers()
		}
	})

	it("three Added in one tick make one read", async () => {
		vi.useFakeTimers()
		try {
			const incoming = makeIncomingService([rec("a"), rec("b"), rec("c")])
			const { incomingTransfers } = setup({ incoming, config: makeConfigService() })
			for (const id of ["a", "b", "c"]) incoming.onIncomingTransferAdded.invoke(rec(id))
			await vi.advanceTimersByTimeAsync(1_000)
			expect(incoming.getIncomingTransfers).toHaveBeenCalledTimes(1)
			expect(incomingTransfers.value.map((x) => x.id)).toEqual(["a", "b", "c"])
		} finally {
			vi.useRealTimers()
		}
	})

	it("an Added every 100 ms still reads within 1 s of the first", async () => {
		vi.useFakeTimers()
		try {
			const incoming = makeIncomingService([rec("a")])
			setup({ incoming, config: makeConfigService() })
			const stream = setInterval(() => incoming.onIncomingTransferAdded.invoke(rec("a")), 100)
			incoming.onIncomingTransferAdded.invoke(rec("a"))
			await vi.advanceTimersByTimeAsync(1_000)
			expect(incoming.getIncomingTransfers).toHaveBeenCalledTimes(1)
			// The next burst starts at 1.1 s and is read by its own cap, at 2.1 s.
			await vi.advanceTimersByTimeAsync(2_000)
			clearInterval(stream)
			expect(incoming.getIncomingTransfers).toHaveBeenCalledTimes(2)
		} finally {
			vi.useRealTimers()
		}
	})

	it("afterRead settles before the rows are assigned", async () => {
		let release!: () => void
		const afterRead = vi.fn(() => new Promise<void>((r) => (release = r)))
		const incoming = makeIncomingService([rec("a")])
		const effect = effectScope()
		const result = effect.run(() =>
			useIncomingTransfers({ incomingTransferService: incoming, configService: makeConfigService(), scope: READY, afterRead }),
		)
		const pending = result?.refresh()
		await vi.waitFor(() => expect(afterRead).toHaveBeenCalledWith(READY()))
		expect(result?.incomingTransfers.value).toEqual([])
		release()
		await pending
		expect(result?.incomingTransfers.value.map((x) => x.id)).toEqual(["a"])
	})

	it("a scope change while afterRead runs drops the rows; a rejecting afterRead still assigns them", async () => {
		const account = ref("a")
		let release!: () => void
		const afterRead = vi
			.fn<() => Promise<void>>()
			.mockImplementationOnce(() => new Promise<void>((r) => (release = r)))
			.mockRejectedValue(new Error("state read failed"))
		const incoming = makeIncomingService()
		incoming.getIncomingTransfers.mockResolvedValueOnce([rec("a1")]).mockResolvedValue([rec("b1", { accountAddress: "b" })])
		const effect = effectScope()
		const result = effect.run(() =>
			useIncomingTransfers({
				incomingTransferService: incoming,
				configService: makeConfigService(),
				scope: () => ({ profileId: "p", networkId: "n", account: account.value }),
				afterRead,
			}),
		)
		const stale = result?.refresh()
		await vi.waitFor(() => expect(afterRead).toHaveBeenCalledTimes(1))
		account.value = "b"
		release()
		await stale
		await vi.waitFor(() => expect(result?.incomingTransfers.value.map((x) => x.id)).toEqual(["b1"]))
		expect(afterRead).toHaveBeenCalledTimes(2)
	})

	it("onUpdated replaces an existing record", async () => {
		const incoming = makeIncomingService([rec("a", { v: 1 })])
		const { incomingTransfers, refresh } = setup({ incoming, config: makeConfigService() })
		await refresh()
		incoming.onIncomingTransferUpdated.invoke(rec("a", { v: 9 }))
		expect((incomingTransfers.value[0] as unknown as { v: number }).v).toBe(9)
	})

	it("onUpdated ignores an unknown record (does not add)", () => {
		const incoming = makeIncomingService()
		const { incomingTransfers } = setup({ incoming, config: makeConfigService() })
		incoming.onIncomingTransferUpdated.invoke(rec("ghost"))
		expect(incomingTransfers.value).toEqual([])
	})

	it("onDeleted removes by id", async () => {
		const incoming = makeIncomingService([rec("a"), rec("b")])
		const { incomingTransfers, refresh } = setup({ incoming, config: makeConfigService() })
		await refresh()
		incoming.onIncomingTransferDeleted.invoke(rec("a"))
		expect(incomingTransfers.value.map((x) => x.id)).toEqual(["b"])
	})

	it.each([
		["the service read", "read"],
		["afterRead", "afterRead"],
	] as const)("a receipt deleted while %s waits is not installed by that read", async (_name, pause) => {
		let release!: () => void
		const gate = new Promise<void>((r) => (release = r))
		const incoming = makeIncomingService()
		incoming.getIncomingTransfers.mockImplementationOnce(async () => {
			if (pause === "read") await gate
			return [rec("a"), rec("b")]
		})
		const afterRead = vi.fn(() => (pause === "afterRead" ? gate : Promise.resolve()))
		const effect = effectScope()
		const result = effect.run(() =>
			useIncomingTransfers({ incomingTransferService: incoming, configService: makeConfigService(), scope: READY, afterRead }),
		)
		const pending = result?.refresh()
		await vi.waitFor(() => expect(pause === "read" ? incoming.getIncomingTransfers : afterRead).toHaveBeenCalled())

		incoming.onIncomingTransferDeleted.invoke(rec("a"))
		release()
		await pending
		expect(result?.incomingTransfers.value.map((x) => x.id)).toEqual(["b"])

		incoming.getIncomingTransfers.mockResolvedValueOnce([rec("a"), rec("b")])
		await result?.refresh()
		expect(result?.incomingTransfers.value.map((x) => x.id)).toEqual(["a", "b"])
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

	it("dispose() removes every handler and a scheduled read — later events are ignored", async () => {
		vi.useFakeTimers()
		try {
			const incoming = makeIncomingService([rec("a")])
			const config = makeConfigService()
			const { incomingTransfers, dispose } = setup({ incoming, config })
			incoming.onIncomingTransferAdded.invoke(rec("a"))
			dispose()
			incoming.onIncomingTransferAdded.invoke(rec("a"))
			incoming.onIncomingTransferUpdated.invoke(rec("a"))
			incoming.onIncomingTransferDeleted.invoke(rec("a"))
			config.onUpdate.invoke({ key: "incomingTransfersVisible" } as unknown as ConfigProp)
			await vi.advanceTimersByTimeAsync(1_000)
			expect(incomingTransfers.value).toEqual([])
			expect(incoming.getIncomingTransfers).not.toHaveBeenCalled()
		} finally {
			vi.useRealTimers()
		}
	})

	it("scope.stop() auto-disposes via onScopeDispose", async () => {
		vi.useFakeTimers()
		try {
			const incoming = makeIncomingService([rec("a")])
			const { incomingTransfers, effect } = setup({ incoming, config: makeConfigService() })
			effect.stop()
			incoming.onIncomingTransferAdded.invoke(rec("a"))
			await vi.advanceTimersByTimeAsync(1_000)
			expect(incomingTransfers.value).toEqual([])
		} finally {
			vi.useRealTimers()
		}
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

	// ── Cross-account containment (privacy fix — #314 + code-review, id-keyed) ──

	it("an Added for a non-active account, network or profile starts no read", async () => {
		vi.useFakeTimers()
		try {
			const incoming = makeIncomingService()
			setup({ incoming, config: makeConfigService() })
			incoming.onIncomingTransferAdded.invoke(rec("foreign", { accountAddress: "OTHER_ACCOUNT" }))
			incoming.onIncomingTransferAdded.invoke(rec("wrongNet", { networkId: "OTHER_NET" }))
			incoming.onIncomingTransferAdded.invoke(rec("wrongProfile", { profileId: "OTHER_PROFILE" }))
			await vi.advanceTimersByTimeAsync(1_000)
			expect(incoming.getIncomingTransfers).not.toHaveBeenCalled()
		} finally {
			vi.useRealTimers()
		}
	})

	it("onUpdated DROPS a foreign-account record (never coerces it onto the active view)", async () => {
		const incoming = makeIncomingService([rec("mine")])
		const { incomingTransfers, refresh } = setup({ incoming, config: makeConfigService() })
		await refresh()
		incoming.onIncomingTransferUpdated.invoke(rec("mine", { accountAddress: "OTHER_ACCOUNT", v: 9 }))
		expect(incomingTransfers.value.map((x) => x.id)).toEqual(["mine"])
	})

	it("switching the active account SYNCHRONOUSLY clears the view then refetches for the new account", async () => {
		const account = ref("a")
		const incoming = makeIncomingService([rec("a1")])
		const scope = () => ({ profileId: "p", networkId: "n", account: account.value })
		const { incomingTransfers } = setup({ incoming, config: makeConfigService(), scope })
		incoming.onConnected.invoke()
		await Promise.resolve()
		expect(incomingTransfers.value.map((x) => x.id)).toEqual(["a1"])

		incoming.getIncomingTransfers.mockResolvedValueOnce([rec("b1", { accountAddress: "b" })])
		account.value = "b"
		expect(incomingTransfers.value).toEqual([]) // cleared synchronously, no A rows linger
		await Promise.resolve()
		await Promise.resolve()
		expect(incoming.getIncomingTransfers).toHaveBeenLastCalledWith("p", "n", "b")
		expect(incomingTransfers.value.map((x) => x.id)).toEqual(["b1"])
	})

	it("a late fetch for a superseded scope (A→B→A) does not clobber the current view", async () => {
		const account = ref("a")
		const scope = () => ({ profileId: "p", networkId: "n", account: account.value })
		let resolveA: (rows: IncomingTransferRecord[]) => void = () => {}
		const aPending = new Promise<IncomingTransferRecord[]>((r) => {
			resolveA = r
		})
		const incoming = makeIncomingService()
		incoming.getIncomingTransfers
			.mockReturnValueOnce(aPending)
			.mockResolvedValueOnce([rec("b1", { accountAddress: "b" })])
			.mockResolvedValueOnce([rec("a-fresh")])
		const { incomingTransfers, refresh } = setup({ incoming, config: makeConfigService(), scope })

		const aFetch = refresh()
		account.value = "b"
		await Promise.resolve()
		account.value = "a"
		await Promise.resolve()
		await Promise.resolve()
		resolveA([rec("a-stale")])
		await aFetch
		await Promise.resolve()
		expect(incomingTransfers.value.map((x) => x.id)).toEqual(["a-fresh"])
	})
})
