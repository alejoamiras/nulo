import { beforeEach, describe, expect, test } from "vitest"
import { FakeBrowserApi } from "./fake-browser-api"

describe("FakeBrowserApi", () => {
	let api: FakeBrowserApi

	beforeEach(() => {
		api = new FakeBrowserApi()
		api.reset()
	})

	describe("storage", () => {
		test("set + get round-trip (local)", async () => {
			await api.storage.local.set({ foo: "bar" })
			const entries = await api.storage.local.get("foo")
			expect(entries.foo).toBe("bar")
		})

		test("get all with null key", async () => {
			await api.storage.local.set({ a: 1, b: 2 })
			const all = await api.storage.local.get(null)
			expect(all).toEqual({ a: 1, b: 2 })
		})

		test("remove deletes the key", async () => {
			await api.storage.local.set({ k: "v" })
			await api.storage.local.remove("k")
			const all = await api.storage.local.get(null)
			expect(all).toEqual({})
		})

		test("local and session are separate areas", async () => {
			await api.storage.local.set({ area: "local" })
			await api.storage.session.set({ area: "session" })
			const local = await api.storage.local.get("area")
			const session = await api.storage.session.get("area")
			expect(local.area).toBe("local")
			expect(session.area).toBe("session")
		})

		test("reset clears in-memory state", async () => {
			await api.storage.local.set({ persists: "no" })
			api.reset()
			const all = await api.storage.local.get(null)
			expect(all).toEqual({})
		})

		test("onChange fires on writes", async () => {
			const changes: unknown[] = []
			const unsub = api.storage.local.onChange((c) => changes.push(c))
			await api.storage.local.set({ x: 1 })
			expect(changes).toHaveLength(1)
			unsub()
			await api.storage.local.set({ x: 2 })
			expect(changes).toHaveLength(1)
		})
	})

	describe("runtime ports (long-lived)", () => {
		test("connect + onConnect delivers messages both ways", async () => {
			const received: unknown[] = []
			api.runtime.onConnect((port) => {
				port.onMessage((msg) => {
					received.push(msg)
					port.postMessage({ echo: msg })
				})
			})

			const client = api.runtime.connect({ name: "test" })
			const replies: unknown[] = []
			client.onMessage((msg) => replies.push(msg))

			client.postMessage({ hello: "world" })

			expect(received).toEqual([{ hello: "world" }])
			expect(replies).toEqual([{ echo: { hello: "world" } }])
		})

		test("disconnect notifies both sides", () => {
			let clientDisconnected = false
			let serverDisconnected = false

			api.runtime.onConnect((port) => {
				port.onDisconnect(() => {
					serverDisconnected = true
				})
			})

			const client = api.runtime.connect({ name: "test" })
			client.onDisconnect(() => {
				clientDisconnected = true
			})

			client.disconnect()
			expect(clientDisconnected).toBe(true)
			expect(serverDisconnected).toBe(true)
		})
	})

	describe("windows", () => {
		test("create returns an id; onRemoved fires on remove", async () => {
			let removedId: number | undefined
			api.windows.onRemoved((id) => {
				removedId = id
			})
			const win = await api.windows.create({ url: "https://example" })
			expect(win.id).toBeDefined()

			await api.windows.remove(win.id as number)
			expect(removedId).toBe(win.id)
		})

		test("records create options and update calls; update on a closed id rejects", async () => {
			const windows = api.windows as unknown as {
				creates: unknown[]
				updates: unknown[]
				lastFocused: unknown
			}
			const win = await api.windows.create({ url: "https://example", left: -1160, top: 40 })
			expect(windows.creates).toEqual([{ url: "https://example", left: -1160, top: 40 }])

			await api.windows.update(win.id as number, { focused: true, drawAttention: true, state: "normal" })
			expect(windows.updates).toEqual([{ windowId: win.id, options: { focused: true, drawAttention: true, state: "normal" } }])

			await api.windows.remove(win.id as number)
			await expect(api.windows.update(win.id as number, { focused: true })).rejects.toThrow(/No window/)

			await expect(api.windows.getLastFocused()).resolves.toBeUndefined()
			windows.lastFocused = { left: 0, top: 0, width: 1920, height: 1080 }
			await expect(api.windows.getLastFocused()).resolves.toEqual({ left: 0, top: 0, width: 1920, height: 1080 })
		})
	})
})
