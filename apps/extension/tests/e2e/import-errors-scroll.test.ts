/**
 * The full-backup import's errors screen opens with its warning whole in view, and never rests with
 * the popup hero's title cut by the sticky bar: where the scroller's end carries the title past the
 * bar, the screen lands there; otherwise it scrolls only as far as the warning needs. Real layout,
 * so both browsers: the popup at its 360x600 size, onboarding at the launcher's window.
 *
 * A synthetic backup. Its local-chain item names a sender and the local seed is refused, so a
 * Retry is offered (four footer buttons, a three-line warning); an item on a chain no seed serves
 * is dropped and recorded, which beside it adds the "review the details" clause (four lines) and
 * alone leaves no Retry (three buttons).
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Page } from "puppeteer"
import { expect } from "vitest"
import { restoreWarningText } from "@/components/composite/import/restore-warning"
import { LOCAL_L1_CHAIN_ID } from "@/utils/chain-ids"
import { interceptRpc } from "./fixtures/browser"
import { launchExtension, test } from "./fixtures/extension"
import {
	buildSyntheticBackup,
	deriveNuloAccountAddress,
	gotoOnboardingImport,
	gotoPopupImport,
	makeRecoveryTriple,
	ONBOARDING_IMPORT_SHELL,
	POPUP_IMPORT_SHELL,
	submitFullBackupImport,
	TEST_PASSWORD,
	writeBackupToTemp,
} from "./helpers/import-drivers"

const LOCAL_RPC = process.env.VITE_LOCAL_NETWORK_RPC_URL ?? "http://localhost:8080"

type Items = "local" | "custom" | "both"

async function backupFile(items: Items): Promise<string> {
	const { masterBase64, entropyBase64 } = await makeRecoveryTriple()
	const address = await deriveNuloAccountAddress(masterBase64, LOCAL_L1_CHAIN_ID)
	const local = { networkId: "syn-local", chainId: 0, senders: [{ address }], contracts: [] }
	const custom = { networkId: "syn-custom", chainId: 424242, senders: [{ address }], contracts: [] }
	const accountState = items === "local" ? [local] : items === "custom" ? [custom] : [custom, local]
	const backup = buildSyntheticBackup({
		masterBase64,
		entropyBase64,
		accountAddress: address,
		extraData: { "account-state": accountState },
	})
	return writeBackupToTemp(backup, `${items}.json`)
}

async function onErrorsScreen(items: Items, surface: "popup" | "onboarding", fn: (page: Page) => Promise<void>): Promise<void> {
	const file = await backupFile(items)
	const profileDir = mkdtempSync(join(tmpdir(), "nulo-errors-scroll-"))
	const ctx = await launchExtension({ userDataDir: profileDir })
	let armed: Awaited<ReturnType<typeof interceptRpc>> | undefined
	try {
		armed = await interceptRpc(ctx.browser, ctx.extensionId, LOCAL_RPC, { kind: "refuse" })
		const page = surface === "popup" ? await gotoPopupImport(ctx) : await gotoOnboardingImport(ctx)
		await submitFullBackupImport(page, file, TEST_PASSWORD, surface === "popup" ? POPUP_IMPORT_SHELL : ONBOARDING_IMPORT_SHELL)
		await page.waitForSelector('[data-testid="import-full-backup-continue-btn"]', { visible: true, timeout: 90_000 })
		await fn(page)
	} finally {
		await armed?.stop()
		await ctx.close()
		rmSync(profileDir, { recursive: true, force: true })
	}
}

/** Reads until the scroll position holds still, so a measurement sees where the open landed. */
async function settledScrollTop(page: Page): Promise<number> {
	const read = () =>
		page.evaluate(() => {
			const scroller = document.querySelector('[data-testid="collapsing-hero-scroller"]')
			return scroller ? scroller.scrollTop : (document.scrollingElement?.scrollTop ?? 0)
		})
	let last = await read()
	for (let i = 0; i < 20; i++) {
		await new Promise((r) => setTimeout(r, 100))
		const now = await read()
		if (now === last) return now
		last = now
	}
	return last
}

/** Edges in viewport px on the popup's errors screen. */
async function popupLanding(page: Page) {
	const scrollTop = await settledScrollTop(page)
	return {
		scrollTop,
		...(await page.evaluate(() => {
			const edges = (testId: string) => {
				const r = (document.querySelector(`[data-testid="${testId}"]`) as HTMLElement).getBoundingClientRect()
				return { top: r.top, bottom: r.bottom }
			}
			const scroller = document.querySelector('[data-testid="collapsing-hero-scroller"]') as HTMLElement
			return {
				maxScroll: scroller.scrollHeight - scroller.clientHeight,
				barBottom: edges("collapsing-hero-header").bottom,
				viewBottom: scroller.getBoundingClientRect().top + scroller.clientHeight,
				title: edges("collapsing-hero-title"),
				accent: edges("collapsing-hero-accent"),
				warning: edges("import-full-backup-warning"),
				warningText: document.querySelector('[data-testid="import-full-backup-warning"]')?.textContent ?? "",
				retryShown: !!document.querySelector('[data-testid="import-full-backup-retry-btn"]'),
			}
		})),
	}
}

type Landing = Awaited<ReturnType<typeof popupLanding>>

/** Scroll offsets snap to whole device pixels, so a nearest scroll can leave an edge up to half a
 *  pixel past the view (a four-line warning at 96.2 lands at 96). */
function expectWarningWhole(l: Landing): void {
	expect(l.warning.top).toBeGreaterThanOrEqual(l.barBottom - 0.5)
	expect(l.warning.bottom).toBeLessThanOrEqual(l.viewBottom + 0.5)
}

test("one network to retry: the open lands at the scroller's end, the title above the bar's bottom edge", {
	timeout: 180_000,
	retry: 0,
}, async () => {
	await onErrorsScreen("local", "popup", async (page) => {
		const l = await popupLanding(page)
		expect(l.retryShown).toBe(true)
		expect(l.warningText).toContain(restoreWarningText(["Local Network"], false))
		expectWarningWhole(l)
		expect(l.scrollTop).toBe(l.maxScroll)
		expect(l.title.bottom).toBeLessThanOrEqual(l.barBottom)
	})
})

test("a network to retry beside another error: the title and the accent bar both land under the bar", {
	timeout: 180_000,
	retry: 0,
}, async () => {
	await onErrorsScreen("both", "popup", async (page) => {
		const l = await popupLanding(page)
		expect(l.retryShown).toBe(true)
		expect(l.warningText).toContain(restoreWarningText(["Local Network"], true))
		expectWarningWhole(l)
		expect(l.title.bottom).toBeLessThanOrEqual(l.barBottom)
		expect(l.accent.bottom).toBeLessThanOrEqual(l.barBottom)
	})
})

test("another error only, no Retry: the hero stays whole", { timeout: 180_000, retry: 0 }, async () => {
	await onErrorsScreen("custom", "popup", async (page) => {
		const l = await popupLanding(page)
		expect(l.retryShown).toBe(false)
		expect(l.warningText).toContain(restoreWarningText([], true))
		expectWarningWhole(l)
		expect(l.title.top).toBeGreaterThanOrEqual(l.barBottom)
	})
})

test("onboarding: the page does not scroll, the warning already in view", { timeout: 180_000, retry: 0 }, async () => {
	await onErrorsScreen("local", "onboarding", async (page) => {
		expect(await settledScrollTop(page)).toBe(0)
		const warning = await page.evaluate(() => {
			const r = (document.querySelector('[data-testid="import-full-backup-warning"]') as HTMLElement).getBoundingClientRect()
			return { top: r.top, bottom: r.bottom, viewport: window.innerHeight }
		})
		expect(warning.top).toBeGreaterThanOrEqual(0)
		expect(warning.bottom).toBeLessThanOrEqual(warning.viewport)
	})
})
