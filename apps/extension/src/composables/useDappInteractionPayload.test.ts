import { describe, it, expect, vi, beforeEach } from "vitest"
import { effectScope, nextTick } from "vue"
import { EventHandler } from "@nulo/wallet-core/utils"
import { useDappInteractionPayload, type DappInteractionLike } from "./useDappInteractionPayload"

interface TestPayload {
	params: {
		dappMetadata: {
			name: string
			url: string
			logo?: string
		}
		extra: number
	}
}

const flush = async () => {
	await Promise.resolve()
	await Promise.resolve()
	await nextTick()
}

const makeService = (): DappInteractionLike & {
	__getInteractionPayload: ReturnType<typeof vi.fn>
	__rejectInteraction: ReturnType<typeof vi.fn>
	__resolveInteraction: ReturnType<typeof vi.fn>
	__isInteractionCancelled: ReturnType<typeof vi.fn>
} => {
	const onInteractionCancelled = new EventHandler<string>()
	const getInteractionPayload = vi.fn(async () => ({}))
	const rejectInteraction = vi.fn()
	const resolveInteraction = vi.fn(async () => {})
	const isInteractionCancelled = vi.fn(async () => false)
	return {
		getInteractionPayload,
		rejectInteraction,
		resolveInteraction,
		isInteractionCancelled,
		onInteractionCancelled,
		__getInteractionPayload: getInteractionPayload,
		__rejectInteraction: rejectInteraction,
		__resolveInteraction: resolveInteraction,
		__isInteractionCancelled: isInteractionCancelled,
	}
}

describe("useDappInteractionPayload", () => {
	it("replays a cancel that fired before the popup subscribed (durable flag, not just the event)", async () => {
		const service = makeService()
		service.__isInteractionCancelled.mockResolvedValue(true)
		const scope = effectScope()
		const result = scope.run(() =>
			useDappInteractionPayload({
				interactionService: service,
				getRequestId: () => "req-1",
				dappOf: () => undefined,
			}),
		)!
		await result.load()
		expect(result.isCancelled.value).toBe(true)
		scope.stop()
	})

	let service: ReturnType<typeof makeService>

	beforeEach(() => {
		service = makeService()
	})

	it("loads the payload using the requestId getter", async () => {
		service.__getInteractionPayload.mockResolvedValue({
			params: { dappMetadata: { name: "test", url: "https://test.com" }, extra: 42 },
		})
		const scope = effectScope()
		const result = scope.run(() =>
			useDappInteractionPayload<TestPayload>({
				interactionService: service,
				getRequestId: () => "req-1",
				dappOf: (p) => p.params.dappMetadata,
			}),
		)!
		const payload = await result.load()
		expect(payload.params.extra).toBe(42)
		expect(result.requestId.value).toBe("req-1")
		expect(result.payload.value).toEqual(payload)
		scope.stop()
	})

	it("throws when requestId getter returns undefined", async () => {
		const scope = effectScope()
		const result = scope.run(() =>
			useDappInteractionPayload<TestPayload>({
				interactionService: service,
				getRequestId: () => undefined,
				dappOf: (p) => p.params.dappMetadata,
			}),
		)!
		await expect(result.load()).rejects.toThrow(/Invalid interaction request id/)
		expect(service.__getInteractionPayload).not.toHaveBeenCalled()
		scope.stop()
	})

	it("extracts dapp metadata via the dappOf callback", async () => {
		service.__getInteractionPayload.mockResolvedValue({
			params: { dappMetadata: { name: "Foo", url: "https://foo.com" }, extra: 1 },
		})
		const scope = effectScope()
		const result = scope.run(() =>
			useDappInteractionPayload<TestPayload>({
				interactionService: service,
				getRequestId: () => "req-2",
				dappOf: (p) => p.params.dappMetadata,
			}),
		)!
		await result.load()
		expect(result.dapp.value).toMatchObject({ name: "Foo", url: "https://foo.com" })
		scope.stop()
	})

	it("copies logo to logoBlobUrl when a logo is present", async () => {
		service.__getInteractionPayload.mockResolvedValue({
			params: { dappMetadata: { name: "Foo", url: "https://foo.com", logo: "https://foo.com/logo.png" }, extra: 1 },
		})
		const scope = effectScope()
		const result = scope.run(() =>
			useDappInteractionPayload<TestPayload>({
				interactionService: service,
				getRequestId: () => "req-3",
				dappOf: (p) => p.params.dappMetadata,
			}),
		)!
		await result.load()
		expect(result.dapp.value?.logoBlobUrl).toBe("https://foo.com/logo.png")
		scope.stop()
	})

	it("leaves logoBlobUrl undefined when no logo is in the payload", async () => {
		service.__getInteractionPayload.mockResolvedValue({
			params: { dappMetadata: { name: "Foo", url: "https://foo.com" }, extra: 1 },
		})
		const scope = effectScope()
		const result = scope.run(() =>
			useDappInteractionPayload<TestPayload>({
				interactionService: service,
				getRequestId: () => "req-4",
				dappOf: (p) => p.params.dappMetadata,
			}),
		)!
		await result.load()
		expect(result.dapp.value?.logoBlobUrl).toBeUndefined()
		scope.stop()
	})

	it("flips isCancelled when onInteractionCancelled fires for the active requestId", async () => {
		service.__getInteractionPayload.mockResolvedValue({
			params: { dappMetadata: { name: "Foo", url: "https://foo.com" }, extra: 1 },
		})
		const scope = effectScope()
		const result = scope.run(() =>
			useDappInteractionPayload<TestPayload>({
				interactionService: service,
				getRequestId: () => "req-5",
				dappOf: (p) => p.params.dappMetadata,
			}),
		)!
		await result.load()
		expect(result.isCancelled.value).toBe(false)
		service.onInteractionCancelled.invoke("req-5")
		expect(result.isCancelled.value).toBe(true)
		scope.stop()
	})

	it("ignores onInteractionCancelled for a different requestId", async () => {
		service.__getInteractionPayload.mockResolvedValue({
			params: { dappMetadata: { name: "Foo", url: "https://foo.com" }, extra: 1 },
		})
		const scope = effectScope()
		const result = scope.run(() =>
			useDappInteractionPayload<TestPayload>({
				interactionService: service,
				getRequestId: () => "mine",
				dappOf: (p) => p.params.dappMetadata,
			}),
		)!
		await result.load()
		service.onInteractionCancelled.invoke("not-mine")
		expect(result.isCancelled.value).toBe(false)
		scope.stop()
	})

	it("reject() forwards to interactionService.rejectInteraction", async () => {
		service.__getInteractionPayload.mockResolvedValue({
			params: { dappMetadata: { name: "Foo", url: "https://foo.com" }, extra: 1 },
		})
		const scope = effectScope()
		const result = scope.run(() =>
			useDappInteractionPayload<TestPayload>({
				interactionService: service,
				getRequestId: () => "req-6",
				dappOf: (p) => p.params.dappMetadata,
			}),
		)!
		await result.load()
		result.reject("nope")
		expect(service.__rejectInteraction).toHaveBeenCalledWith("req-6", "nope")
		scope.stop()
	})

	it("reject() is a no-op once the interaction is cancelled", async () => {
		service.__getInteractionPayload.mockResolvedValue({
			params: { dappMetadata: { name: "Foo", url: "https://foo.com" }, extra: 1 },
		})
		const scope = effectScope()
		const result = scope.run(() =>
			useDappInteractionPayload<TestPayload>({
				interactionService: service,
				getRequestId: () => "req-7",
				dappOf: (p) => p.params.dappMetadata,
			}),
		)!
		await result.load()
		service.onInteractionCancelled.invoke("req-7")
		result.reject("late")
		expect(service.__rejectInteraction).not.toHaveBeenCalled()
		scope.stop()
	})

	it("reject() before load() is a no-op (no requestId yet)", () => {
		const scope = effectScope()
		const result = scope.run(() =>
			useDappInteractionPayload<TestPayload>({
				interactionService: service,
				getRequestId: () => "req-8",
				dappOf: (p) => p.params.dappMetadata,
			}),
		)!
		result.reject("early")
		expect(service.__rejectInteraction).not.toHaveBeenCalled()
		scope.stop()
	})

	it("surfaces fetch errors via the error ref and rethrows", async () => {
		const boom = new Error("backend down")
		service.__getInteractionPayload.mockRejectedValue(boom)
		const scope = effectScope()
		const result = scope.run(() =>
			useDappInteractionPayload<TestPayload>({
				interactionService: service,
				getRequestId: () => "req-9",
				dappOf: (p) => p.params.dappMetadata,
			}),
		)!
		await expect(result.load()).rejects.toBe(boom)
		expect(result.error.value).toBe(boom)
		expect(result.isLoading.value).toBe(false)
		scope.stop()
	})

	it("isLoading toggles around load()", async () => {
		let resolveIt: (v: TestPayload) => void = () => {}
		service.__getInteractionPayload.mockReturnValue(
			new Promise<TestPayload>((res) => {
				resolveIt = res
			}),
		)
		const scope = effectScope()
		const result = scope.run(() =>
			useDappInteractionPayload<TestPayload>({
				interactionService: service,
				getRequestId: () => "req-10",
				dappOf: (p) => p.params.dappMetadata,
			}),
		)!
		const promise = result.load()
		await flush()
		expect(result.isLoading.value).toBe(true)
		resolveIt({ params: { dappMetadata: { name: "x", url: "x" }, extra: 1 } })
		await promise
		expect(result.isLoading.value).toBe(false)
		scope.stop()
	})

	it("dispose unsubscribes from cancellation events", async () => {
		service.__getInteractionPayload.mockResolvedValue({
			params: { dappMetadata: { name: "Foo", url: "https://foo.com" }, extra: 1 },
		})
		const scope = effectScope()
		const result = scope.run(() =>
			useDappInteractionPayload<TestPayload>({
				interactionService: service,
				getRequestId: () => "req-11",
				dappOf: (p) => p.params.dappMetadata,
			}),
		)!
		await result.load()
		result.dispose()
		service.onInteractionCancelled.invoke("req-11")
		expect(result.isCancelled.value).toBe(false)
		scope.stop()
	})

	it("auto-disposes when its effect scope stops", async () => {
		service.__getInteractionPayload.mockResolvedValue({
			params: { dappMetadata: { name: "Foo", url: "https://foo.com" }, extra: 1 },
		})
		const scope = effectScope()
		const result = scope.run(() =>
			useDappInteractionPayload<TestPayload>({
				interactionService: service,
				getRequestId: () => "req-12",
				dappOf: (p) => p.params.dappMetadata,
			}),
		)!
		await result.load()
		scope.stop()
		service.onInteractionCancelled.invoke("req-12")
		expect(result.isCancelled.value).toBe(false)
	})
})
