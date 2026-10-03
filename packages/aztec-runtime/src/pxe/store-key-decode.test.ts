/**
 * `provisionChainStoreKey` decodes its wire key with strict `atob` semantics, before any lifecycle
 * check or state change, and wipes the decoded copy whenever it does not install it.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

vi.mock("./known-artifacts", () => ({
	loadProductionKnownArtifacts: async () => ({ artifacts: new Map(), instances: new Map() }),
}))
vi.mock("./note-schemas", () => ({
	loadProductionNoteSchemas: async () => new Map<string, unknown>(),
}))

import type { ILogger } from "@nulo/wallet-core/logger"
import type { PxeFactory } from "./chain-runtime"
import { PxeService, type IProfileReader } from "./service"

const noopLogger: ILogger = { log: () => {} }
const noopProfiles: IProfileReader = { connect: async () => {}, getProfiles: async () => [] }
const GEN_1 = "11111111111111111111111111111111"
const GEN_2 = "22222222222222222222222222222222"

/** 32 bytes of 0xfb: the canonical encoding uses `+`, `/` and `=`. */
const KEY = new Uint8Array(32).fill(0xfb)
const KEY_B64 = "+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/v7+/s="
/** Same as KEY except the last byte. */
const KEY_LAST = new Uint8Array(32).fill(0xfb).map((b, i) => (i === 31 ? 0xfa : b))
const KEY_LAST_B64 = btoa(String.fromCharCode(...KEY_LAST))

type Internals = { storeKeys: Map<string, Uint8Array>; profileLifecycles: Map<string, { kind: string; gen: string }> }

function makeService(): PxeService {
	const factory: PxeFactory = {
		createChainRuntime: async () => {
			throw new Error("not used")
		},
	}
	const service = new PxeService(noopProfiles, noopLogger, factory)
	;(service as unknown as { initialized: boolean }).initialized = true
	return service
}
const internals = (s: PxeService) => s as unknown as Internals

describe("provisionChainStoreKey: wire-key decode", () => {
	beforeEach(() => {
		vi.stubGlobal("chrome", { runtime: { onMessage: { addListener: () => {} } } })
	})
	afterEach(() => {
		vi.restoreAllMocks()
		vi.unstubAllGlobals()
	})

	test("the fixture encodes with + / and =", () => {
		expect(btoa(String.fromCharCode(...KEY))).toBe(KEY_B64)
	})

	test.each([
		["canonical", KEY_B64],
		["unpadded", KEY_B64.replace(/=$/, "")],
		["ASCII whitespace", ` ${KEY_B64.slice(0, 20)}\n${KEY_B64.slice(20)}\t`],
	])("installs the %s encoding", async (_label, wire) => {
		const service = makeService()
		await service.provisionChainStoreKey("p1", wire, GEN_1)
		expect([...(internals(service).storeKeys.get("p1") ?? [])]).toEqual([...KEY])
		expect(internals(service).profileLifecycles.get("p1")).toEqual({ kind: "live", gen: GEN_1 })
	})

	test.each([
		["URL-safe", KEY_B64.replaceAll("+", "-").replaceAll("/", "_")],
		["junk-suffixed", `${KEY_B64}!`],
		["over-padded", `${KEY_B64}=`],
		["NBSP-suffixed", `${KEY_B64} `],
		["non-ASCII-suffixed", `${KEY_B64}é`],
	])("refuses the %s encoding with InvalidCharacterError, touching no state", async (_label, wire) => {
		const service = makeService()
		await expect(service.provisionChainStoreKey("p1", wire, GEN_1)).rejects.toMatchObject({ name: "InvalidCharacterError" })
		expect(internals(service).storeKeys.has("p1")).toBe(false)
		expect(internals(service).profileLifecycles.has("p1")).toBe(false)
		// A lifecycle set before the decode would refuse a successor generation here.
		await service.provisionChainStoreKey("p1", KEY_B64, GEN_2)
		expect(internals(service).profileLifecycles.get("p1")).toEqual({ kind: "live", gen: GEN_2 })
	})

	test.each([
		["", 0],
		["QUJD", 3],
	])("refuses %j by decoded length", async (wire, length) => {
		const service = makeService()
		await expect(service.provisionChainStoreKey("p1", wire, GEN_1)).rejects.toThrow(
			`provisionChainStoreKey: expected a 32-byte key, got ${length}`,
		)
		expect(internals(service).profileLifecycles.has("p1")).toBe(false)
	})

	test("a malformed key is refused by the decode before a refusing lifecycle is consulted", async () => {
		const service = makeService()
		internals(service).profileLifecycles.set("p1", { kind: "deleting", gen: GEN_1 })
		await expect(service.provisionChainStoreKey("p1", `${KEY_B64}!`, GEN_1)).rejects.toMatchObject({ name: "InvalidCharacterError" })
		await expect(service.provisionChainStoreKey("p1", KEY_B64, GEN_1)).rejects.toThrow(
			"provisionChainStoreKey: profile p1 is being deleted — provision rejected",
		)
	})

	test("a live same-generation re-provision compares every byte and wipes the decoded copy either way", async () => {
		const service = makeService()
		await service.provisionChainStoreKey("p1", KEY_B64, GEN_1)
		const realFill = Uint8Array.prototype.fill
		const wiped: number[][] = []
		vi.spyOn(Uint8Array.prototype, "fill").mockImplementation(function (this: Uint8Array, ...args: Parameters<Uint8Array["fill"]>) {
			if (args[0] === 0 && this.length === 32) wiped.push([...this])
			return realFill.apply(this, args)
		})

		await service.provisionChainStoreKey("p1", KEY_B64, GEN_1)
		expect(wiped).toEqual([[...KEY]])

		await expect(service.provisionChainStoreKey("p1", KEY_LAST_B64, GEN_1)).rejects.toThrow(
			"provisionChainStoreKey: profile p1 is live under a different key for this generation — provision rejected",
		)
		expect(wiped).toEqual([[...KEY], [...KEY_LAST]])
		expect([...(internals(service).storeKeys.get("p1") ?? [])]).toEqual([...KEY])
	})
})
