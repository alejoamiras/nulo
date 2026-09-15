import type { PrestoStatus } from "@alejoamiras/presto-core"
import { effectScope } from "vue"
import { describe, expect, test, vi } from "vitest"

import { useAcceleratorStatus } from "./useAcceleratorStatus"

function fakeClient(...results: Array<PrestoStatus | Error>) {
	const checkStatus = vi.fn(async () => {
		const next = results.shift()
		if (next instanceof Error) throw next
		if (!next) throw new Error("no result programmed")
		return next
	})
	return { checkStatus }
}

const active: PrestoStatus = {
	available: true,
	needsDownload: false,
	appVersion: "1.1.1",
	nativeAztecVersion: "5.2.0",
	protocol: "https",
}

describe("useAcceleratorStatus (arc-1 shim over PrestoClient)", () => {
	test("initial state is idle when autoDetect=false and nothing is probed", () => {
		const client = fakeClient()
		const scope = effectScope()
		const result = scope.run(() => useAcceleratorStatus({ autoDetect: false, client }))!
		expect(result.status.value).toBe("idle")
		expect(result.info.value).toBeNull()
		expect(client.checkStatus).not.toHaveBeenCalled()
		scope.stop()
	})

	test("available → active with the health info mapped", async () => {
		const scope = effectScope()
		const result = scope.run(() => useAcceleratorStatus({ autoDetect: false, client: fakeClient(active) }))!
		await result.detect()
		expect(result.status.value).toBe("active")
		expect(result.info.value).toEqual({ version: "1.1.1", aztec_version: "5.2.0", bb_available: true })
		scope.stop()
	})

	test("available + needsDownload → no-bb", async () => {
		const scope = effectScope()
		const client = fakeClient({ ...active, needsDownload: true })
		const result = scope.run(() => useAcceleratorStatus({ autoDetect: false, client }))!
		await result.detect()
		expect(result.status.value).toBe("no-bb")
		expect(result.info.value?.bb_available).toBe(false)
		scope.stop()
	})

	test.each<PrestoStatus>([
		{ available: false, reason: "offline" },
		{ available: false, reason: "permission-blocked" },
		{ available: false, reason: "secure-connection-unavailable", diagnosis: "unconfirmed" },
		{ available: false, reason: "error", protocol: "https" },
		{ available: false, reason: "version-mismatch", nativeAztecVersion: "5.1.0", protocol: "https" },
	])("unavailable ($reason) → not-detected", async (status) => {
		const scope = effectScope()
		const result = scope.run(() => useAcceleratorStatus({ autoDetect: false, client: fakeClient(status) }))!
		await result.detect()
		expect(result.status.value).toBe("not-detected")
		expect(result.info.value).toBeNull()
		scope.stop()
	})

	test("a rejected probe → not-detected", async () => {
		const scope = effectScope()
		const client = fakeClient(new Error("boom"))
		const result = scope.run(() => useAcceleratorStatus({ autoDetect: false, client }))!
		await result.detect()
		expect(result.status.value).toBe("not-detected")
		scope.stop()
	})

	test("a mount probe uses the cache; an explicit retry forces a refresh", async () => {
		const scope = effectScope()
		const client = fakeClient(active, { available: false, reason: "offline" })
		const result = scope.run(() => useAcceleratorStatus({ autoDetect: false, client }))!
		await result.detect()
		expect(client.checkStatus).toHaveBeenLastCalledWith({ forceRefresh: false })
		await result.detect({ forceRefresh: true })
		expect(client.checkStatus).toHaveBeenLastCalledWith({ forceRefresh: true })
		expect(result.status.value).toBe("not-detected")
		scope.stop()
	})
})
