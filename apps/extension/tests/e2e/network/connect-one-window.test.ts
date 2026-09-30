import { hashToEmoji } from "@aztec/wallet-sdk/crypto"
import type { Page } from "puppeteer"
import { expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { BROWSER, prepareKeys } from "../fixtures/browser"
import { clickByTestId, openPopup, test, waitForHash } from "../fixtures/extension"
import { openPlayground, selectPgBundle, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveVerify, rejectCapabilities, waitForPopup } from "../fixtures/popups"

/**
 * A new connection's emoji check shows in the connect window itself: Allow keeps that window, the
 * check replaces the connect page, and no other window opens until the dApp asks for permissions.
 * A held Enter at Allow does not carry through the check.
 */

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined

type Created = { id?: number; type?: string }

const ALLOW = '[data-testid="discover-allow-btn"]'
const GRID = '[data-testid="verify-emoji-grid"]'
const TRUST = '[data-testid="verify-always-trust-toggle"] [data-testid="toggle-switch"]'
const REPEATS_KEY = "e2e:enter-repeats"

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

/** Every window the browser creates from now on, as an extension page's listener sees it. */
async function recordCreatedWindows(control: Page): Promise<() => Promise<Created[]>> {
	await control.evaluate(() => {
		const w = window as unknown as { __created: Created[] }
		w.__created = []
		chrome.windows.onCreated.addListener((win) => w.__created.push({ id: win.id, type: win.type }))
	})
	return () => control.evaluate(() => (window as unknown as { __created: Created[] }).__created)
}

/** Each Enter keydown's `repeat`, kept in `sessionStorage` so a reload between the pages loses none. */
async function recordEnterRepeats(page: Page): Promise<void> {
	await page.evaluate((key) => {
		sessionStorage.setItem(key, "[]")
		window.addEventListener(
			"keydown",
			(e) => {
				if (e.key !== "Enter") return
				const seen = JSON.parse(sessionStorage.getItem(key) ?? "[]") as boolean[]
				sessionStorage.setItem(key, JSON.stringify([...seen, e.repeat]))
			},
			true,
		)
	}, REPEATS_KEY)
}

async function showsCheck(page: Page): Promise<boolean> {
	return page
		.evaluate((grid) => location.hash.startsWith("#/windows/verify") && document.querySelector(grid) !== null, GRID)
		.catch((err) => {
			if (page.isClosed()) throw err
			return false
		})
}

/** Hold Enter at the focused Allow until the page shows the check, and a few repeats into it. */
async function holdEnterThroughAllow(page: Page, created: () => Promise<Created[]>): Promise<void> {
	const deadline = Date.now() + 30_000
	try {
		await page.keyboard.down("Enter")
		while (!(await showsCheck(page))) {
			if (Date.now() > deadline) throw new Error("the connect window never showed the check")
			await page.keyboard.down("Enter")
			await sleep(100)
		}
		for (let i = 0; i < 3; i++) {
			await page.keyboard.down("Enter")
			await sleep(100)
		}
		await page.keyboard.up("Enter")
	} catch (err) {
		if (!page.isClosed()) throw err
		// Long enough for a separate check window, if one follows, to reach the record.
		await sleep(5_000)
		throw new Error(`the connect window closed after Allow; windows created: ${JSON.stringify(await created())}`, { cause: err })
	}
}

test.skipIf(!aztecConfig)(
	"a new connection shows its emoji check in the connect window, and no other window opens",
	{ timeout: 180_000 },
	async ({ localNetworkExtension: ctx }) => {
		const control = await openPopup(ctx)
		await waitForHash(control, "#/popup/general", 30_000)
		const dapp = await openPlayground(ctx)
		const created = await recordCreatedWindows(control)

		const discoverP = waitForPopup(ctx, "discover", { timeout: 30_000 })
		await clickByTestId(dapp, "pg-btn-connect")
		const page = await discoverP
		const pageErrors: string[] = []
		// "Client disconnected" is the benign port-close cascade the fixtures filter too.
		page.on("pageerror", (err) => {
			if (!err.message?.includes("Client disconnected")) pageErrors.push(String(err))
		})
		const connectWindow = await page.evaluate(async () => (await chrome.windows.getCurrent()).id)
		await page.waitForFunction(
			(sel) => {
				const allow = document.querySelector<HTMLButtonElement>(sel)
				return !!allow && !allow.disabled
			},
			{ timeout: 30_000, polling: 200 },
			ALLOW,
		)

		await recordEnterRepeats(page)
		await page.evaluate(() => {
			;(window as unknown as { __connectDocument?: boolean }).__connectDocument = true
		})
		await prepareKeys(page)
		await page.focus(ALLOW)
		await holdEnterThroughAllow(page, created)

		const repeats = await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? "[]") as boolean[], REPEATS_KEY)
		expect(repeats, "the driver sent no repeat, so the held Enter proved nothing").toContain(true)
		const sameDocument = await page.evaluate(() => (window as unknown as { __connectDocument?: boolean }).__connectDocument === true)
		console.log(`[connect-one-window] ${BROWSER}: the check loaded ${sameDocument ? "in the same document" : "by a reload"}`)

		const hash = await dapp.waitForFunction(
			() => document.querySelector('[data-testid="pg-verification-hash"]')?.textContent || false,
			{ timeout: 30_000, polling: 200 },
		)
		const shown = await page.evaluate(async (grid) => {
			const [current, lastFocused] = await Promise.all([chrome.windows.getCurrent(), chrome.windows.getLastFocused()])
			const label = (testid: string) => document.querySelector(`[data-testid="${testid}"]`)?.textContent?.trim() ?? null
			return {
				window: current.id,
				lastFocused: lastFocused.id,
				grid: document.querySelector(grid)?.textContent?.replace(/\s/g, "") ?? "",
				header: { account: label("identity-account"), network: label("identity-network") },
				error: document.querySelector('[data-testid="error-text"]')?.textContent ?? null,
			}
		}, GRID)
		expect(shown).toEqual({
			window: connectWindow,
			lastFocused: connectWindow,
			grid: hashToEmoji((await hash.jsonValue()) as string),
			header: { account: "No account shared", network: "Local Network" },
			error: null,
		})
		expect(pageErrors).toEqual([])

		await prepareKeys(page)
		await page.keyboard.press("Enter")
		await page.keyboard.press("Escape")
		await sleep(1_000)
		expect(page.isClosed(), "Enter or Escape closed the check").toBe(false)
		expect(await showsCheck(page)).toBe(true)
		expect(await page.$eval(TRUST, (el) => el.getAttribute("data-toggle-active"))).toBe("false")
		await approveVerify(page)
		expect(await created()).toEqual([{ id: connectWindow, type: "popup" }])

		await dapp.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 30_000 })
		await selectPgBundle(dapp, "accounts")
		const seq = await snapshotResultSeq(dapp)
		const capsP = waitForPopup(ctx, "capabilities", { timeout: 60_000 })
		await clickByTestId(dapp, "pg-btn-requestCapabilities")
		const caps = await capsP
		const capsWindow = await caps.evaluate(async () => (await chrome.windows.getCurrent()).id)
		expect(await created()).toEqual([
			{ id: connectWindow, type: "popup" },
			{ id: capsWindow, type: "popup" },
		])
		await rejectCapabilities(caps)
		expect((await waitForPgResult(dapp, "requestCapabilities", seq, 30_000)).status).toBe("error")
	},
)
