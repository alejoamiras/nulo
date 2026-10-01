/**
 * The adapter's single-attempt paths at the real transport boundary: the SDK's JSON-RPC client over
 * the single-attempt fetch, with only `globalThis.fetch` stubbed. Neither may retry; the silent
 * read also may not outlive its deadline or write the SDK's own log lines (which carry the body and
 * the endpoint URL) to `console.*`, where the wallet's log buffer would keep them.
 */
import { Fr } from "@aztec-labs/foundation/curves/bn254"
import { AztecAddress } from "@aztec-labs/stdlib/aztec-address"
import { TxHash } from "@aztec-labs/stdlib/tx"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { AztecNodeFactoryAdapter, SILENT_RPC_LOG } from "./aztec-node-factory-adapter"

const URL = "https://rpc.example/key-in-path"
const CONTRACT = AztecAddress.fromNumberUnsafe(5)
const SLOT = new Fr(9n)
const SENTINEL = "sentinel-7f3a"

const realFetch = globalThis.fetch
const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const

function reply(body: unknown, init: { ok?: boolean; status?: number } = {}): Response {
	return {
		ok: init.ok ?? true,
		status: init.status ?? 200,
		statusText: init.ok === false ? "Server Error" : "OK",
		headers: { get: () => null },
		json: async () => body,
	} as unknown as Response
}

/** Answers each batched request by its id, as a node does. */
function answering(result: (method: string) => string) {
	return vi.fn(async (_url: string, init: RequestInit) => {
		const calls = JSON.parse(String(init.body)) as { id: number; method: string }[]
		return reply(calls.map((c) => ({ jsonrpc: "2.0", id: c.id, result: result(c.method) })))
	})
}

function consoleText(spies: ReturnType<typeof vi.spyOn>[]): string {
	return JSON.stringify(
		spies.flatMap((s) => s.mock.calls),
		(_k, v) => (typeof v === "bigint" ? v.toString() : v),
	)
}

let consoleSpies: ReturnType<typeof vi.spyOn>[]

beforeEach(() => {
	consoleSpies = CONSOLE_METHODS.map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
	for (const level of ["warn", "debug", "error"] as const) vi.spyOn(SILENT_RPC_LOG, level)
})

afterEach(() => {
	globalThis.fetch = realFetch
	vi.useRealTimers()
	vi.restoreAllMocks()
})

describe("AztecNodeFactoryAdapter.readPublicStorageOnce", () => {
	test("resolves the field a well-formed reply carries, from the named contract and slot", async () => {
		const fetchSpy = answering(() => new Fr(1234n).toString())
		globalThis.fetch = fetchSpy as unknown as typeof fetch

		const value = await new AztecNodeFactoryAdapter().readPublicStorageOnce(URL, CONTRACT, SLOT, 5_000)

		expect(value.toBigInt()).toBe(1234n)
		expect(fetchSpy).toHaveBeenCalledTimes(1)
		const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit]
		expect(url).toBe(URL)
		const [call] = JSON.parse(String(init.body)) as { method: string; params: unknown[] }[]
		expect(call?.method).toBe("aztec_getPublicStorageAt")
		expect(call?.params).toEqual(["latest", CONTRACT.toString(), SLOT.toString()])
	})

	test("a null result rejects instead of resolving to no field", async () => {
		globalThis.fetch = answering(() => null as unknown as string) as unknown as typeof fetch

		await expect(new AztecNodeFactoryAdapter().readPublicStorageOnce(URL, CONTRACT, SLOT, 5_000)).rejects.toThrow()
	})

	test("a 500 rejects after exactly one attempt", async () => {
		const fetchSpy = vi.fn(async () => reply({ error: { message: "boom" } }, { ok: false, status: 500 }))
		globalThis.fetch = fetchSpy as unknown as typeof fetch

		await expect(new AztecNodeFactoryAdapter().readPublicStorageOnce(URL, CONTRACT, SLOT, 5_000)).rejects.toThrow()
		expect(fetchSpy).toHaveBeenCalledTimes(1)
		expect(consoleText(consoleSpies)).not.toContain(URL)
	})

	test("a body that is not a batch reply rejects, and the SDK's warning about it stays off the console", async () => {
		const fetchSpy = vi.fn(async () => reply({ message: SENTINEL, detail: SENTINEL }))
		globalThis.fetch = fetchSpy as unknown as typeof fetch

		await expect(new AztecNodeFactoryAdapter().readPublicStorageOnce(URL, CONTRACT, SLOT, 5_000)).rejects.toThrow()
		expect(fetchSpy).toHaveBeenCalledTimes(1)
		expect(SILENT_RPC_LOG.warn).toHaveBeenCalledWith(expect.stringContaining("Invalid response"), expect.anything())
		const printed = consoleText(consoleSpies)
		expect(printed).not.toContain(SENTINEL)
		expect(printed).not.toContain(URL)
	})

	test("a node that never answers is aborted at the deadline, and nothing is left running", async () => {
		vi.useFakeTimers()
		let signal: AbortSignal | undefined
		const fetchSpy = vi.fn(
			(_url: string, init: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					signal = init.signal ?? undefined
					signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))
				}),
		)
		globalThis.fetch = fetchSpy as unknown as typeof fetch

		let settled = false
		const read = new AztecNodeFactoryAdapter().readPublicStorageOnce(URL, CONTRACT, SLOT, 5_000).finally(() => {
			settled = true
		})
		const outcome = read.catch((e: unknown) => e)
		await vi.advanceTimersByTimeAsync(4_999)
		expect(settled).toBe(false)
		await vi.advanceTimersByTimeAsync(1)

		expect(await outcome).toBeInstanceOf(Error)
		expect(signal?.aborted).toBe(true)
		expect(fetchSpy).toHaveBeenCalledTimes(1)
		expect(vi.getTimerCount()).toBe(0)
		expect(consoleText(consoleSpies)).not.toContain(URL)
	})
})

describe("AztecNodeFactoryAdapter.createSingleAttemptNode", () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	test("a call that fails is one request: nothing is retried after it", async () => {
		const fetch = vi.fn(async () => {
			throw new TypeError("Failed to fetch")
		})
		vi.stubGlobal("fetch", fetch)
		const node = new AztecNodeFactoryAdapter().createSingleAttemptNode("http://localhost:1", 1_000)
		await expect(node.getTxReceipt(TxHash.random())).rejects.toThrow()
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	test("refuses a URL outside the allowlist, as createNode does", () => {
		expect(() => new AztecNodeFactoryAdapter().createSingleAttemptNode("http://example.com", 1_000)).toThrow(/refused/)
	})
})
