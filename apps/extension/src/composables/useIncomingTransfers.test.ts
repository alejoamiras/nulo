import { describe, expect, it, vi } from "vitest"
import { effectScope, ref } from "vue"
import { EventHandler } from "@nulo/wallet-core/utils"
import type { ConfigProp } from "@/wallet/config"
import type { IncomingTransferRecord } from "@/wallet/services/incoming-transfer/spec"
import { type ConfigServiceLike, type IncomingTransferServiceLike, useIncomingTransfers } from "./useIncomingTransfers"

// Records default to the READY scope (p, n, a) so they pass the composable's
// live-scope filter; override profileId/networkId/accountAddress to exercise
// the foreign-scope drop.
const rec = (siloedNullifier: string, extra: Record<string, unknown> = {}): IncomingTransferRecord =>
	({ siloedNullifier, profileId: "p", networkId: "n", accountAddress: "a", ...extra }) as unknown as IncomingTransferRecord

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
		expect(incomingTransfers.value.map((x) => x.siloedNullifier)).toEqual(["a", "b"])
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
		expect(incomingTransfers.value.map((x) => x.siloedNullifier)).toEqual(["z"])
	})

	it("onAdded prepends a new record", () => {
		const incoming = makeIncomingService()
		const { incomingTransfers } = setup({ incoming, config: makeConfigService() })
		incoming.onIncomingTransferAdded.invoke(rec("a"))
		incoming.onIncomingTransferAdded.invoke(rec("b"))
		expect(incomingTransfers.value.map((x) => x.siloedNullifier)).toEqual(["b", "a"])
	})

	it("onAdded replaces in place when the siloedNullifier already exists", () => {
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

	it("onDeleted removes by siloedNullifier", () => {
		const incoming = makeIncomingService()
		const { incomingTransfers } = setup({ incoming, config: makeConfigService() })
		incoming.onIncomingTransferAdded.invoke(rec("a"))
		incoming.onIncomingTransferAdded.invoke(rec("b"))
		incoming.onIncomingTransferDeleted.invoke(rec("a"))
		expect(incomingTransfers.value.map((x) => x.siloedNullifier)).toEqual(["b"])
	})

	it("onDeleted ignores a foreign record that shares the nullifier", () => {
		// A siloed nullifier is unique within ONE rollup tree, not across them, so
		// the same value can legitimately exist under another profile or network.
		// Matching on it alone would let that delete remove the row on screen.
		const incoming = makeIncomingService()
		const { incomingTransfers } = setup({ incoming, config: makeConfigService() })
		incoming.onIncomingTransferAdded.invoke(rec("shared"))

		incoming.onIncomingTransferDeleted.invoke(rec("shared", { networkId: "other-network" }))
		expect(incomingTransfers.value.map((x) => x.siloedNullifier)).toEqual(["shared"])

		incoming.onIncomingTransferDeleted.invoke(rec("shared", { profileId: "other-profile" }))
		expect(incomingTransfers.value.map((x) => x.siloedNullifier)).toEqual(["shared"])

		// Its own scope's delete still applies.
		incoming.onIncomingTransferDeleted.invoke(rec("shared"))
		expect(incomingTransfers.value).toEqual([])
	})

	it("config update for incomingTransfersVisible triggers a refresh", async () => {
		const incoming = makeIncomingService([rec("a")])
		const config = makeConfigService()
		const { incomingTransfers } = setup({ incoming, config })
		config.onUpdate.invoke({ key: "incomingTransfersVisible" } as unknown as ConfigProp)
		await Promise.resolve()
		expect(incoming.getIncomingTransfers).toHaveBeenCalledTimes(1)
		expect(incomingTransfers.value.map((x) => x.siloedNullifier)).toEqual(["a"])
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

	// ── Cross-account containment (the privacy fix) ──

	it("onAdded DROPS a record for a non-active account (the leak the broadcast would otherwise cause)", () => {
		const incoming = makeIncomingService()
		const { incomingTransfers } = setup({ incoming, config: makeConfigService() })
		incoming.onIncomingTransferAdded.invoke(rec("foreign", { accountAddress: "OTHER_ACCOUNT" }))
		expect(incomingTransfers.value).toEqual([])
	})

	it("onAdded DROPS a record for a non-active network or profile", () => {
		const incoming = makeIncomingService()
		const { incomingTransfers } = setup({ incoming, config: makeConfigService() })
		incoming.onIncomingTransferAdded.invoke(rec("wrongNet", { networkId: "OTHER_NET" }))
		incoming.onIncomingTransferAdded.invoke(rec("wrongProfile", { profileId: "OTHER_PROFILE" }))
		expect(incomingTransfers.value).toEqual([])
	})

	it("onUpdated DROPS a foreign-account record (never coerces it onto the active view)", () => {
		const incoming = makeIncomingService()
		const { incomingTransfers } = setup({ incoming, config: makeConfigService() })
		incoming.onIncomingTransferAdded.invoke(rec("mine"))
		incoming.onIncomingTransferUpdated.invoke(rec("mine", { accountAddress: "OTHER_ACCOUNT", v: 9 }))
		// The foreign update is dropped; the active record is untouched.
		expect(incomingTransfers.value.map((x) => x.siloedNullifier)).toEqual(["mine"])
	})

	it("switching the active account SYNCHRONOUSLY clears the view then refetches for the new account", async () => {
		const account = ref("a")
		const incoming = makeIncomingService([rec("a1")])
		const scope = () => ({ profileId: "p", networkId: "n", account: account.value })
		const { incomingTransfers } = setup({ incoming, config: makeConfigService(), scope })
		await (async () => {
			incoming.onConnected.invoke()
			await Promise.resolve()
		})()
		expect(incomingTransfers.value.map((x) => x.siloedNullifier)).toEqual(["a1"])

		// Switch to account "b": the sync watcher clears immediately…
		incoming.getIncomingTransfers.mockResolvedValueOnce([rec("b1", { accountAddress: "b" })])
		account.value = "b"
		expect(incomingTransfers.value).toEqual([]) // cleared synchronously, no A rows linger
		await Promise.resolve()
		await Promise.resolve()
		expect(incoming.getIncomingTransfers).toHaveBeenLastCalledWith("p", "n", "b")
		expect(incomingTransfers.value.map((x) => x.siloedNullifier)).toEqual(["b1"])
	})

	it("a late fetch for a superseded scope (A→B→A) does not clobber the current view", async () => {
		const account = ref("a")
		const scope = () => ({ profileId: "p", networkId: "n", account: account.value })
		// First fetch (for A) is deferred; we resolve it AFTER switching away and back.
		let resolveA: (rows: IncomingTransferRecord[]) => void = () => {}
		const aPending = new Promise<IncomingTransferRecord[]>((r) => {
			resolveA = r
		})
		const incoming = makeIncomingService()
		incoming.getIncomingTransfers
			.mockReturnValueOnce(aPending) // A (stale, resolves last)
			.mockResolvedValueOnce([rec("b1", { accountAddress: "b" })]) // B
			.mockResolvedValueOnce([rec("a-fresh")]) // A again (fresh)
		const { incomingTransfers, refresh } = setup({ incoming, config: makeConfigService(), scope })

		const aFetch = refresh() // starts A fetch (pending)
		account.value = "b" // sync clear + refresh B
		await Promise.resolve()
		account.value = "a" // sync clear + refresh A-fresh
		await Promise.resolve()
		await Promise.resolve()
		// Now the ORIGINAL A fetch resolves — it must be dropped (superseded seq).
		resolveA([rec("a-stale")])
		await aFetch
		await Promise.resolve()
		expect(incomingTransfers.value.map((x) => x.siloedNullifier)).toEqual(["a-fresh"])
	})
})
