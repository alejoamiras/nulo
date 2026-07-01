import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Page } from "puppeteer"
import { afterEach, describe, expect, test } from "vitest"
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

const ROOT = "nulo:e2e:mig-fixture"
const VERSION_KEY = "nulo:schema:version"
const RUNNING_KEY = "nulo:schema:running"
const BACKUP_KEY = "nulo:schema:backup"
const ATTEMPTS_KEY = "nulo:schema:attempts"
const BLOCKED_KEY = "nulo:schema:blocked"
const BOOM_KEY = "nulo:e2e:migration-boom"
const HOLD_KEY = "nulo:e2e:migration-hold"

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
	const rows = await storageGet(page, [`${ROOT}@a`, `${ROOT}@b`])
	expect(JSON.parse(rows[`${ROOT}@a`] as string)).toEqual({ name: "alpha", keep: 1 })
	expect(JSON.parse(rows[`${ROOT}@b`] as string)).toEqual({ name: "beta" })
	const journal = await storageGet(page, [RUNNING_KEY, BACKUP_KEY, ATTEMPTS_KEY, BLOCKED_KEY])
	expect(journal).toEqual({})
}

describe.skipIf(!HAS_FIXTURE)("storage migration through the real boot path", () => {
	let ctx: ExtensionContext | undefined
	let profileDir: string

	/** Fresh install on a persistent profile, stamped at max, pre-shape seeded. */
	async function launchAndSeed(extra: Record<string, unknown> = {}): Promise<void> {
		profileDir = mkdtempSync(join(tmpdir(), "nulo-mig-e2e-"))
		ctx = await launchExtension({ userDataDir: profileDir })
		const page = await openPopup(ctx)
		await waitForVersion(page, 2)
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

	afterEach(async () => {
		await ctx?.browser.close()
		ctx = undefined
		rmSync(profileDir, { recursive: true, force: true })
	})

	test("transforms seeded pre-shape rows and checkpoints the version", async () => {
		await launchAndSeed()
		const page = await relaunch()
		await waitForVersion(page, 2)
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
		// resume-restore can't resurrect it) and cold-boot again: restore → re-run.
		await storageRemove(page, [BOOM_KEY])
		if (ctx) await ctx.browser.close()
		const page2 = await relaunch()
		await waitForVersion(page2, 2)
		await expectTransformed(page2)
		expect(await page2.$("[data-testid='migration-blocked']")).toBeNull()
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
		await waitForVersion(page, 2)
		await page.waitForSelector("[data-testid='migration-updating']", { hidden: true, timeout: 10_000 })
		await expectTransformed(page) // transformed exactly once, no resurrection
	})

	test("a crash mid-migration converges on the next boot (restore + re-run)", async () => {
		await launchAndSeed({ [HOLD_KEY]: 1 })
		const page = await relaunch()
		await waitForKeyPresent(page, RUNNING_KEY) // journal armed: running + backup
		await waitForKeyPresent(page, BACKUP_KEY)
		// THE CRASH: kill the whole browser while the migration is mid-flight.
		if (ctx) await ctx.browser.close()

		// Next cold boot: journal interrupted → restore → re-run. The fixture
		// parks on the still-present hold; release it and watch it converge.
		const page2 = await relaunch()
		await waitForKeyPresent(page2, RUNNING_KEY)
		await storageRemove(page2, [HOLD_KEY])
		await waitForVersion(page2, 2)
		await expectTransformed(page2)
	})
})
