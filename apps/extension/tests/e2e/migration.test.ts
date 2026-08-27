import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Page } from "puppeteer"
import { afterEach, describe, expect, test } from "vitest"
import { SCHEMA_RUNNING_KEY, SCHEMA_VERSION_KEY } from "@nulo/wallet-core/migration"
import {
	MIGRATION_FIXTURE_BOOM_KEY,
	MIGRATION_FIXTURE_HOLD_KEY,
	MIGRATION_FIXTURE_ROOT,
	MIGRATION_FIXTURE_VERSION,
} from "@/e2e/migration-fixture"
import { type ExtensionContext, launchExtension, openPopup } from "./fixtures/extension"

/**
 * Storage-migration smoke: drives the data-preserving migrator end-to-end
 * through the REAL boot path (SW cold boot → journal → transform → checkpoint)
 * using the build-stamped v2 fixture migration (`src/e2e/migration-fixture.ts`,
 * armed by `VITE_NULO_E2E_MIGRATION_FIXTURE=1` at build time).
 *
 * Skips itself unless the runner declares the loaded build carries the fixture
 * (`NULO_E2E_MIGRATION_FIXTURE=1`) — the release-artifact smoke path runs
 * against production zips, which exclude the fixture by design.
 *
 * Mechanics: a fresh install stamps `nulo:schema:version` at max (2), so each
 * test rewinds the marker to 1, seeds pre-shape rows, and performs a REAL cold
 * boot by closing the whole browser and relaunching on the same persistent
 * `userDataDir` (chrome.storage.local survives on disk). CDP
 * `Runtime.terminateExecution` was tried and rejected: it leaves a zombie SW
 * target that a new extension page never revives (the same reason
 * sw-resilience's respawn tests are CI-skipped). Browser relaunch is MORE
 * faithful anyway — and closing the browser mid-migration IS the crash the
 * journal exists for. Storage is asserted via page.evaluate (raw chrome.* from
 * the page context, not the app's facade); UI assertions use data-testids only.
 */

const HAS_FIXTURE = process.env.NULO_E2E_MIGRATION_FIXTURE === "1"

const ROOT = MIGRATION_FIXTURE_ROOT
const VERSION_KEY = SCHEMA_VERSION_KEY
const RUNNING_KEY = SCHEMA_RUNNING_KEY
const BOOM_KEY = MIGRATION_FIXTURE_BOOM_KEY
const HOLD_KEY = MIGRATION_FIXTURE_HOLD_KEY
const MAX_VERSION = MIGRATION_FIXTURE_VERSION
// Engine-private journal keys, pinned as literals on purpose: the e2e asserts
// the PERSISTED protocol, so an accidental rename must fail here.
const BACKUP_KEY = "nulo:schema:backup"
const ATTEMPTS_KEY = "nulo:schema:attempts"
const BLOCKED_KEY = "nulo:schema:blocked"

const storageSet = (page: Page, items: Record<string, unknown>) => page.evaluate((i) => chrome.storage.local.set(i), items)
const storageRemove = (page: Page, keys: string[]) => page.evaluate((k) => chrome.storage.local.remove(k), keys)
const storageGet = (page: Page, keys: string[]) =>
	page.evaluate((k) => chrome.storage.local.get(k), keys) as Promise<Record<string, unknown>>

/** Deterministic waiter: resolve when the schema version equals `version`. */
const waitForVersion = (page: Page, version: number, timeout = 30_000) =>
	page.waitForFunction(
		async (key, v) => {
			const res = await chrome.storage.local.get(key)
			return res[key] === v
		},
		{ timeout, polling: 250 },
		VERSION_KEY,
		version,
	)

const waitForKeyPresent = (page: Page, key: string, timeout = 30_000) =>
	page.waitForFunction(
		async (k) => {
			const res = await chrome.storage.local.get(k)
			return k in res
		},
		{ timeout, polling: 250 },
		key,
	)

const waitForKeyAbsent = (page: Page, key: string, timeout = 30_000) =>
	page.waitForFunction(
		async (k) => {
			const res = await chrome.storage.local.get(k)
			return !(k in res)
		},
		{ timeout, polling: 250 },
		key,
	)

/** Seed pre-shape rows + rewind the marker so the NEXT cold boot migrates. */
async function seedPreShape(page: Page, extra: Record<string, unknown> = {}): Promise<void> {
	await storageSet(page, {
		[`${ROOT}@a`]: JSON.stringify({ legacyName: "alpha", keep: 1 }),
		[`${ROOT}@b`]: JSON.stringify({ name: "beta" }),
		[VERSION_KEY]: 1,
		...extra,
	})
}

async function expectTransformed(page: Page): Promise<void> {
	// The version stamps BEFORE the run-level journal clear; wait for the clear
	// so the journal-empty assertion below can't race the final removes.
	await waitForKeyAbsent(page, RUNNING_KEY)
	const rows = await storageGet(page, [`${ROOT}@a`, `${ROOT}@b`])
	expect(JSON.parse(rows[`${ROOT}@a`] as string)).toEqual({ name: "alpha", keep: 1 })
	expect(JSON.parse(rows[`${ROOT}@b`] as string)).toEqual({ name: "beta" })
	const journal = await storageGet(page, [RUNNING_KEY, BACKUP_KEY, ATTEMPTS_KEY, BLOCKED_KEY])
	expect(journal).toEqual({})
}

describe.skipIf(!HAS_FIXTURE)("storage migration through the real boot path", () => {
	let ctx: ExtensionContext | undefined
	let profileDir = ""

	/** Fresh install on a persistent profile, stamped at max, pre-shape seeded. */
	async function launchAndSeed(extra: Record<string, unknown> = {}): Promise<void> {
		profileDir = mkdtempSync(join(tmpdir(), "nulo-mig-e2e-"))
		ctx = await launchExtension({ userDataDir: profileDir })
		const page = await openPopup(ctx)
		await waitForVersion(page, MAX_VERSION)
		await seedPreShape(page, extra)
		await ctx.browser.close()
		ctx = undefined
	}

	/** REAL cold boot over the surviving profile. Liveness gate off: a held or
	 *  failing migration parks the boot before the heartbeat starts. Returns a
	 *  RAW popup page (plain goto, no readiness gate) — `openPopup`'s predicate
	 *  waits for the GlobalLoader to clear, which never happens while the SW is
	 *  parked pre-services; storage evaluation + the barrier testids don't need
	 *  a connected app. */
	async function relaunch(): Promise<Page> {
		ctx = await launchExtension({ userDataDir: profileDir, waitForLiveness: false })
		const page = await ctx.browser.newPage()
		await page.goto(`chrome-extension://${ctx.extensionId}/src/popup/index.html`, { waitUntil: "domcontentloaded" })
		return page
	}

	/** Click the barrier's Retry button, then relaunch the browser over the
	 *  same profile. In production the button's `chrome.runtime.reload()` IS
	 *  the restart; under `--load-extension` Chrome disables the unpacked
	 *  extension on reload (ERR_BLOCKED_BY_CLIENT until a browser restart), so
	 *  the harness substitutes a real cold boot. The chain is still fully
	 *  proven: a boot WITHOUT the button's one-shot token short-circuits at
	 *  the gate and never advances the version — so convergence after this
	 *  helper is convergence THROUGH the written-and-consumed gesture token. */
	async function retryAndReopen(page: Page): Promise<Page> {
		if (!ctx) throw new Error("no extension context")
		await page.click("[data-testid='migration-retry-btn']")
		// Let the token write land before killing the browser (the click
		// handler persists it before calling runtime.reload()).
		await page
			.waitForFunction(
				() =>
					new Promise((r) =>
						chrome.storage.local.get("nulo:schema:retry-requested", (v) => r("nulo:schema:retry-requested" in v)),
					),
				{
					timeout: 5_000,
					polling: 100,
				},
			)
			.catch(() => {})
		await ctx.browser.close()
		return relaunch()
	}

	afterEach(async () => {
		await ctx?.browser.close()
		ctx = undefined
		// Guarded: a failure before mkdtemp must not turn into an rmSync throw
		// that masks the real assertion error.
		if (profileDir) rmSync(profileDir, { recursive: true, force: true })
		profileDir = ""
	})

	test("transforms seeded pre-shape rows and checkpoints the version", async () => {
		await launchAndSeed()
		const page = await relaunch()
		await waitForVersion(page, MAX_VERSION)
		await expectTransformed(page)
	})

	test("a throwing migration fails closed (blocked UX), then retries forward once fixed", async () => {
		await launchAndSeed({ [BOOM_KEY]: 1 })
		const page = await relaunch()
		await waitForKeyPresent(page, BLOCKED_KEY) // breaking failure persisted
		// Fail-closed: version unadvanced, data untouched.
		const state = await storageGet(page, [VERSION_KEY, `${ROOT}@a`])
		expect(state[VERSION_KEY]).toBe(1)
		expect(JSON.parse(state[`${ROOT}@a`] as string)).toEqual({ legacyName: "alpha", keep: 1 })
		// The shell renders the recovery screen, not the app.
		await page.waitForSelector("[data-testid='migration-blocked']", { visible: true, timeout: 10_000 })

		// Fix the cause (the boom key is OUTSIDE the migration footprint, so the
		// resume-restore can't resurrect it) and cold-boot again. The boot GATE
		// short-circuits an ambient wake on a persisted non-terminal block —
		// the engine must NOT run (that no-burn is the N-02 invariant at the
		// UI level): version stays unadvanced and the barrier renders with the
		// Retry button.
		await storageRemove(page, [BOOM_KEY])
		if (ctx) await ctx.browser.close()
		const page2 = await relaunch()
		await page2.waitForSelector("[data-testid='migration-retry-btn']", { visible: true, timeout: 10_000 })
		expect((await storageGet(page2, [VERSION_KEY]))[VERSION_KEY]).toBe(1)

		// The gesture is the retry path: tap → extension reloads → the fresh
		// boot consumes the token, runs the engine, and converges.
		const page3 = await retryAndReopen(page2)
		await waitForVersion(page3, MAX_VERSION)
		await expectTransformed(page3)
		expect(await page3.$("[data-testid='migration-blocked']")).toBeNull()
	})

	test("a popup opened mid-migration shows the Updating barrier and no old-shape write-back occurs", async () => {
		await launchAndSeed({ [HOLD_KEY]: 1 }) // the fixture waits while held
		const page = await relaunch() // migration starts and parks on the hold
		await waitForKeyPresent(page, RUNNING_KEY)
		await page.waitForSelector("[data-testid='migration-updating']", { visible: true, timeout: 10_000 })
		// Mid-flight: data still pre-shape (nothing committed), version unstamped.
		const mid = await storageGet(page, [VERSION_KEY, `${ROOT}@a`])
		expect(mid[VERSION_KEY]).toBe(1)
		expect(JSON.parse(mid[`${ROOT}@a`] as string)).toEqual({ legacyName: "alpha", keep: 1 })

		await storageRemove(page, [HOLD_KEY]) // release
		await waitForVersion(page, MAX_VERSION)
		await page.waitForSelector("[data-testid='migration-updating']", { hidden: true, timeout: 10_000 })
		await expectTransformed(page) // transformed exactly once, no resurrection
	})

	test("a crash mid-migration converges: restore + stand-down, then a gesture retry completes", async () => {
		await launchAndSeed({ [HOLD_KEY]: 1 })
		const page = await relaunch()
		await waitForKeyPresent(page, RUNNING_KEY) // journal armed: running + backup
		await waitForKeyPresent(page, BACKUP_KEY)
		// THE CRASH: kill the whole browser while the migration is mid-flight.
		if (ctx) await ctx.browser.close()

		// Next cold boot: the interrupted journal restores, the interruption is
		// COUNTED, and the boot stands down (one authorization = one up()) —
		// the recoverable barrier renders instead of a silent same-boot re-run.
		const page2 = await relaunch()
		await waitForKeyPresent(page2, BLOCKED_KEY)
		await page2.waitForSelector("[data-testid='migration-retry-btn']", { visible: true, timeout: 10_000 })
		// Pre-shape restored, version unadvanced, nothing half-committed.
		const mid = await storageGet(page2, [VERSION_KEY, `${ROOT}@a`])
		expect(mid[VERSION_KEY]).toBe(1)
		expect(JSON.parse(mid[`${ROOT}@a`] as string)).toEqual({ legacyName: "alpha", keep: 1 })

		// Release the hold so the authorized run can finish, then the gesture:
		// retry → reload → the fresh boot converges, transformed exactly once.
		await storageRemove(page2, [HOLD_KEY])
		const page3 = await retryAndReopen(page2)
		await waitForVersion(page3, MAX_VERSION)
		await expectTransformed(page3)
	})
})
