import type { PrestoStatus } from "@alejoamiras/presto-core"
import { effectScope } from "vue"
import { describe, expect, test, vi } from "vitest"
import { usePrestoStatus } from "./usePrestoStatus"

type Deferred = { resolve: (s: PrestoStatus) => void; reject: (e: unknown) => void }

/** A fake client whose probes resolve in the order the test chooses. */
function fakeClient() {
	const pending: Deferred[] = []
	const checkStatus = vi.fn(
		() =>
			new Promise<PrestoStatus>((resolve, reject) => {
				pending.push({ resolve, reject })
			}),
	)
	return { checkStatus, pending }
}

const available: PrestoStatus = {
	available: true,
	needsDownload: false,
	appVersion: "1.1.1",
	nativeAztecVersion: "5.2.0",
	protocol: "https",
}

function run(client: ReturnType<typeof fakeClient>, autoDetect = false) {
	const scope = effectScope()
	const api = scope.run(() => usePrestoStatus({ client, autoDetect }))!
	return { ...api, scope }
}

describe("usePrestoStatus", () => {
	test("idle until detect; detecting while the probe is in flight", async () => {
		const client = fakeClient()
		const s = run(client)
		expect(s.state.value).toEqual({ kind: "idle" })
		expect(s.bannerStatus.value).toBeNull()
		const p = s.detect()
		expect(s.state.value).toEqual({ kind: "detecting" })
		client.pending[0].resolve(available)
		await p
		expect(s.state.value.kind).toBe("available")
		s.scope.stop()
	})

	test.each<[PrestoStatus, string]>([
		[available, "available"],
		[{ ...available, needsDownload: true }, "downloading"],
		[{ available: false, reason: "offline" }, "offline"],
		[{ available: false, reason: "permission-blocked" }, "permission-blocked"],
		[{ available: false, reason: "secure-connection-unavailable", diagnosis: "unconfirmed" }, "offline"],
		[{ available: false, reason: "secure-connection-unavailable", diagnosis: "https-disabled" }, "secure-connection-unavailable"],
		[{ available: false, reason: "version-mismatch", nativeAztecVersion: "5.1.0", protocol: "https" }, "version-mismatch"],
		[{ available: false, reason: "error", protocol: "https" }, "error"],
	])("maps %j → %s", async (status, kind) => {
		const client = fakeClient()
		const s = run(client)
		const p = s.detect()
		client.pending[0].resolve(status)
		await p
		expect(s.state.value.kind).toBe(kind)
		s.scope.stop()
	})

	test("bannerStatus mirrors the raw status the probe returned", async () => {
		const client = fakeClient()
		const s = run(client)
		const p = s.detect()
		client.pending[0].resolve({ available: false, reason: "offline" })
		await p
		expect(s.bannerStatus.value).toEqual({ available: false, reason: "offline" })
		s.scope.stop()
	})

	test("forceRefresh passes through to the client; the default is false", async () => {
		const client = fakeClient()
		const s = run(client)
		const p1 = s.detect()
		client.pending[0].resolve(available)
		await p1
		const p2 = s.detect({ forceRefresh: true })
		client.pending[1].resolve(available)
		await p2
		expect(client.checkStatus.mock.calls).toEqual([[{ forceRefresh: false }], [{ forceRefresh: true }]])
		s.scope.stop()
	})

	test("a result arriving after dispose() is dropped", async () => {
		const client = fakeClient()
		const s = run(client)
		const p = s.detect()
		s.dispose()
		client.pending[0].resolve(available)
		await p
		expect(s.state.value).toEqual({ kind: "detecting" })
		expect(s.bannerStatus.value).toBeNull()
		s.scope.stop()
	})

	test("an older probe resolving after a newer one cannot overwrite it", async () => {
		const client = fakeClient()
		const s = run(client)
		const first = s.detect()
		const second = s.detect({ forceRefresh: true })
		client.pending[1].resolve({ available: false, reason: "offline" })
		await second
		client.pending[0].resolve(available)
		await first
		expect(s.state.value.kind).toBe("offline")
		s.scope.stop()
	})

	test("a probe that throws shows Presto's error state instead of leaving `detecting`", async () => {
		const client = fakeClient()
		const s = run(client)
		const p = s.detect()
		client.pending[0].reject(new Error("probe exploded"))
		await p
		expect(s.state.value.kind).toBe("error")
		s.scope.stop()
	})

	test("two composables over one injected client share it (one probe each, same instance)", async () => {
		const client = fakeClient()
		const a = run(client)
		const b = run(client)
		const pa = a.detect()
		const pb = b.detect()
		client.pending[0].resolve(available)
		client.pending[1].resolve(available)
		await Promise.all([pa, pb])
		expect(client.checkStatus).toHaveBeenCalledTimes(2)
		expect(a.state.value.kind).toBe("available")
		expect(b.state.value.kind).toBe("available")
		a.scope.stop()
		b.scope.stop()
	})

	test("autoDetect=false never probes on its own", () => {
		const client = fakeClient()
		const s = run(client)
		expect(client.checkStatus).not.toHaveBeenCalled()
		s.scope.stop()
	})
})
