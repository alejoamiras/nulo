/**
 * The SW-side recovery-mode admission gate. The offscreen keeps store keys and chain runtimes
 * warm across lock and profile switch, so a degraded re-unlock never consults the store-key
 * provider — an already-open runtime would serve the session. The gate therefore runs BEFORE
 * the send, on the SW's own session state, for every profile-bound op; the cleanup calls stay
 * admitted so a profile in recovery mode can still be purged.
 */
import { beforeEach, describe, expect, test, vi } from "vitest"
import { ServiceClient } from "@nulo/extension-messaging/offscreen"
import { RecoveryModeError } from "@nulo/extension-messaging/errors"
import type { ILogger } from "@nulo/wallet-core/logger"
import type { NetworkInfo } from "@nulo/aztec-runtime/pxe"

vi.mock("@/wallet/utils/offscreen", async (importOriginal) => ({
	...(await importOriginal<Record<string, unknown>>()),
	ensureOffscreenRunning: vi.fn(async () => undefined),
}))

import { PxeServiceClient, registerPxeGenerationProvider, registerPxeRecoveryGuard } from "./client"

const noopLogger: ILogger = { log: () => {} }
const net: NetworkInfo = { profileId: "p1", chainId: 31337, rpcUrl: "http://n/1" }

describe("PxeServiceClient recovery-mode admission", () => {
	let wire: string[]
	let recovery: Set<string>

	beforeEach(() => {
		vi.stubGlobal("self", globalThis)
		vi.stubGlobal("chrome", {
			runtime: {
				onMessage: { addListener: () => {} },
				connect: () => ({ onMessage: { addListener: () => {} }, onDisconnect: { addListener: () => {} }, postMessage: () => {} }),
			},
		})
		wire = []
		const impl = async function (this: unknown, method: unknown) {
			wire.push(method as string)
			return []
		}
		vi.spyOn(ServiceClient.prototype as unknown as { request: (...a: unknown[]) => Promise<unknown> }, "request").mockImplementation(
			impl,
		)
		vi.spyOn(
			Object.getPrototypeOf(ServiceClient.prototype) as { request: (...a: unknown[]) => Promise<unknown> },
			"request",
		).mockImplementation(impl)
		recovery = new Set()
		registerPxeRecoveryGuard((profileId) => recovery.has(profileId))
		registerPxeGenerationProvider(async () => "gen-A")
	})

	test("a profile-bound op is rejected in the SW with RecoveryModeError — nothing reaches the wire", async () => {
		const client = new PxeServiceClient(noopLogger)
		recovery.add("p1")
		await expect(client.getSenders(net)).rejects.toBeInstanceOf(RecoveryModeError)
		await expect(client.getContracts(net)).rejects.toThrow("Wallet keys need recovery — export a backup and restore it")
		expect(wire).toEqual([])
	})

	test("a healthy re-unlock admits again; another profile's recovery mode does not leak across", async () => {
		const client = new PxeServiceClient(noopLogger)
		recovery.add("p2")
		await client.getSenders(net)
		expect(wire).toEqual(["getSenders"])
		recovery.add("p1")
		await expect(client.getSenders(net)).rejects.toBeInstanceOf(RecoveryModeError)
		recovery.delete("p1")
		await client.getSenders(net)
		expect(wire).toEqual(["getSenders", "getSenders"])
	})

	test("cleanup stays admitted in recovery mode (positive control): clearChainState / clearProfileState go out", async () => {
		const client = new PxeServiceClient(noopLogger)
		recovery.add("p1")
		await client.clearChainState("p1", 31337)
		await client.clearProfileState("p1", "gen-A")
		expect(wire).toEqual(["clearChainState", "clearProfileState"])
	})
})

describe("PxeServiceClient.isAcceptedSender — responses only from the offscreen document", () => {
	const sender = (v: object) => v as unknown as chrome.runtime.MessageSender
	test("exact offscreen URL (bare, ?instance=, tab-hosted) accepted; popup URL, url-less SW and foreign id rejected", () => {
		vi.stubGlobal("chrome", {
			runtime: { id: "nulo", getURL: (p: string) => `chrome-extension://nulo/${p}`, onMessage: { addListener: () => {} } },
		})
		const accepts = (s: chrome.runtime.MessageSender | undefined) =>
			(new PxeServiceClient(noopLogger) as unknown as { isAcceptedSender: (x: unknown) => boolean }).isAcceptedSender(s)
		const doc = "chrome-extension://nulo/src/offscreen/index.html"
		expect(accepts(sender({ id: "nulo", url: doc }))).toBe(true)
		expect(accepts(sender({ id: "nulo", url: `${doc}?instance=abc`, tab: { id: 4 } }))).toBe(true)
		expect(accepts(sender({ id: "nulo", url: "chrome-extension://nulo/src/popup/index.html" }))).toBe(false)
		expect(accepts(sender({ id: "nulo" }))).toBe(false)
		expect(accepts(sender({ id: "other", url: doc }))).toBe(false)
		expect(accepts(undefined)).toBe(false)
	})
})
