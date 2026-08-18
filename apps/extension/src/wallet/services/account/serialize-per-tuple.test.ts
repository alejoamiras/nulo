/**
 * Regression pins for `AccountService.serializePerTuple`'s rejection behavior
 * (2026-08-16 remediation follow-up, arc 1): a rejected create must reject its
 * CALLER — and nothing else. The prior hand-rolled chain (preserved verbatim
 * through the Q-08 dedup as a BUG PIN) carried a `void next.finally(() => {})`
 * branch whose un-awaited derived promise re-raised every op rejection as an
 * `unhandledrejection`, which the SW's global handler then logged + persisted
 * as a phantom Error-level entry for failures the UI had already handled.
 *
 * The reject lever is `getProfileSecret → undefined` → `deriveAccountSecret`
 * throws "unauthorized" BEFORE any bb.js/WASM touch (jsdom-safe).
 */

import { beforeEach, describe, expect, test } from "vitest"
import { FakeBrowserApi } from "@nulo/wallet-core/testing"
import { EventHandler } from "@nulo/wallet-core/utils"
import { ServiceCollection } from "@/wallet/base"
import { LoggerStore } from "@/wallet/logger"
import { ConfigStore } from "@/wallet/config"
import { PROFILE_SERVICE_NAME } from "@/wallet/services/profile/spec"
import { NETWORK_SERVICE_NAME } from "@/wallet/services/network/spec"
import { svc } from "../composition-harness"
import { AccountType } from "./spec"
import { AccountService } from "./service"

/** Run `fn` with a process-level unhandledRejection collector installed.
 *  NOTE: vitest still reports collected rejections as run errors alongside any
 *  assertion failure (it does NOT defer to user listeners) — that's fine here:
 *  when the code under test emits none, there is nothing to report, and when
 *  it regresses, the `seen` assertion is the primary signal. The macrotask
 *  flush matters: Node emits unhandledRejection on the tick boundary, not the
 *  microtask queue. */
async function collectUnhandledRejections(fn: () => Promise<void>): Promise<unknown[]> {
	const seen: unknown[] = []
	const onRejection = (reason: unknown) => {
		seen.push(reason)
	}
	process.on("unhandledRejection", onRejection)
	try {
		await fn()
		await new Promise((resolve) => setTimeout(resolve, 0))
	} finally {
		process.off("unhandledRejection", onRejection)
	}
	return seen
}

describe("AccountService.serializePerTuple — rejection emits NO unhandledrejection", () => {
	let accountService: AccountService

	beforeEach(async () => {
		const api = new FakeBrowserApi()
		api.reset()
		const services = new ServiceCollection()
		services.add(
			svc(PROFILE_SERVICE_NAME, {
				onProfileDeleted: new EventHandler(),
				// The reject lever: an absent master secret makes createAccountInternal
				// throw "unauthorized" before touching bb.js.
				getProfileSecret: async () => undefined,
			}),
		)
		services.add(svc(NETWORK_SERVICE_NAME, { registerChainPurgeSubscriber: () => {} }))
		accountService = new AccountService(new LoggerStore(new ConfigStore()), api)
		services.add(accountService)
		await services.start()
	})

	test("a rejected createAccount rejects the caller and ONLY the caller", async () => {
		const seen = await collectUnhandledRejections(async () => {
			await expect(accountService.createAccount("p1", 1, AccountType.Nulo_v1, "A")).rejects.toThrow("unauthorized")
		})
		expect(seen).toEqual([])
	})

	test("a rejected ensureDefaultAccount (empty store → create path) rejects the caller and ONLY the caller", async () => {
		const seen = await collectUnhandledRejections(async () => {
			await expect(accountService.ensureDefaultAccount("p1", 1, AccountType.Nulo_v1, "A")).rejects.toThrow("unauthorized")
		})
		expect(seen).toEqual([])
	})

	test("after a rejected create, the SAME tuple's queue still advances (no watchdog — a wedge would hang forever)", async () => {
		await expect(accountService.createAccount("p1", 1, AccountType.Nulo_v1, "A")).rejects.toThrow("unauthorized")
		// The queue advanced past the rejection: the next op on the same tuple runs
		// (and rejects on its own merits, rather than hanging behind a wedged slot).
		await expect(accountService.createAccount("p1", 1, AccountType.Nulo_v1, "B")).rejects.toThrow("unauthorized")
	})
})
