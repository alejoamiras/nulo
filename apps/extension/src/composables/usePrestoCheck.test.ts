import type { PrestoStatus } from "@alejoamiras/presto-core"
import { effectScope } from "vue"
import { describe, expect, test, vi } from "vitest"
import { type PrestoCheckConfig, usePrestoCheck } from "./usePrestoCheck"

const available: PrestoStatus = {
	available: true,
	needsDownload: false,
	appVersion: "1.1.1",
	nativeAztecVersion: "5.2.0",
	protocol: "https",
}
const offline: PrestoStatus = { available: false, reason: "offline" }

function fakeClient(status: PrestoStatus = available) {
	return { checkStatus: vi.fn(async () => status) }
}

function fakeConfig(reached: boolean | Error = false) {
	const getValue = vi.fn(async () => {
		if (reached instanceof Error) throw reached
		return reached
	})
	const setValue = vi.fn(async () => {})
	return { getValue, setValue } as unknown as PrestoCheckConfig & { getValue: typeof getValue; setValue: typeof setValue }
}

function run(config: ReturnType<typeof fakeConfig>, client = fakeClient()) {
	const api = effectScope().run(() => usePrestoCheck(config, { client }))!
	return { ...api, client }
}

describe("usePrestoCheck", () => {
	test("reads as detecting until start() has read the flag, so the resting copy never flashes", () => {
		expect(run(fakeConfig()).state.value).toEqual({ kind: "detecting" })
	})

	test("start() with the flag unset rests in idle and sends no probe", async () => {
		const { state, start, client } = run(fakeConfig(false))
		await start()
		expect(state.value).toEqual({ kind: "idle" })
		expect(client.checkStatus).not.toHaveBeenCalled()
	})

	test("start() with the flag set probes on its own, without forcing a refresh", async () => {
		const { state, start, client } = run(fakeConfig(true))
		await start()
		expect(client.checkStatus).toHaveBeenCalledExactlyOnceWith({ forceRefresh: false })
		expect(state.value.kind).toBe("available")
	})

	test("an unreadable flag rests instead of probing, and start() does not throw", async () => {
		const { state, start, client } = run(fakeConfig(new Error("port closed")))
		await expect(start()).resolves.toBeUndefined()
		expect(state.value).toEqual({ kind: "idle" })
		expect(client.checkStatus).not.toHaveBeenCalled()
	})

	test("check() probes with a forced refresh and remembers a probe that reached Presto", async () => {
		const config = fakeConfig()
		const { state, check, client } = run(config)
		await check()
		expect(client.checkStatus).toHaveBeenCalledExactlyOnceWith({ forceRefresh: true })
		expect(state.value.kind).toBe("available")
		expect(config.setValue).toHaveBeenCalledExactlyOnceWith("prestoReached", true)
	})

	test.each([
		["downloading", { ...available, needsDownload: true }],
		["version-mismatch", { available: false, reason: "version-mismatch", nativeAztecVersion: "5.1.0", protocol: "https" }],
	] as [string, PrestoStatus][])("check() remembers %s: Presto answered", async (_kind, status) => {
		const config = fakeConfig()
		await run(config, fakeClient(status)).check()
		expect(config.setValue).toHaveBeenCalledWith("prestoReached", true)
	})

	test.each([
		["offline", offline],
		["permission-blocked", { available: false, reason: "permission-blocked" }],
		[
			"an unreachable encrypted connection",
			{ available: false, reason: "secure-connection-unavailable", diagnosis: "presto-reachable" },
		],
	] as [string, PrestoStatus][])(
		"check() does not remember %s: it cannot tell a granted permission from a dismissed prompt",
		async (_kind, status) => {
			const config = fakeConfig()
			await run(config, fakeClient(status)).check()
			expect(config.setValue).not.toHaveBeenCalled()
		},
	)

	test("check() before start() leaves the resting state visible afterwards", async () => {
		const { state, check } = run(fakeConfig(), fakeClient(offline))
		await check()
		expect(state.value.kind).toBe("offline")
	})

	test("a failed write of the flag does not reject check() or disturb the state", async () => {
		const config = fakeConfig()
		config.setValue.mockRejectedValueOnce(new Error("port closed"))
		const { state, check } = run(config)
		await expect(check()).resolves.toBeUndefined()
		expect(state.value.kind).toBe("available")
	})

	test("a result arriving after dispose() is dropped and nothing is remembered", async () => {
		const config = fakeConfig()
		const { state, check, dispose } = run(config)
		const pending = check()
		dispose()
		await pending
		expect(state.value).toEqual({ kind: "detecting" })
		expect(config.setValue).not.toHaveBeenCalled()
	})
})
