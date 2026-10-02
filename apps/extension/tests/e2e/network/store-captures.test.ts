/**
 * Store captures, opt-in: `STORE_CAPTURES=1` writes the five popup screens `scripts/store-art.ts`
 * frames (home, send, history, security, approve) into `store/captures/`, at the popup's 360×600
 * and 2× (720×1200 PNGs). Skipped in every other run, and on Firefox: the listings show the Chrome
 * build.
 *
 * Every frame is the real UI over real sandbox state, staged to read as a V6 testnet wallet. The
 * sandbox network is renamed "Testnet" through the wallet's own rename, after the seeded testnet
 * row is renamed out of the way, since network names are unique. The wallet holds only USD Coin
 * and Fee Juice: the harness token is never imported, and no harness transaction touches the
 * captured account. USD Coin is priced at $1 by the seeded quote, with the price host refused, so a
 * live quote cannot move the totals.
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { Page } from "puppeteer"
import { describe, expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { interceptRpc, isFirefox } from "../fixtures/browser"
import {
	clickByTestId,
	type ExtensionContext,
	grantCapBundle,
	launchExtension,
	replaceInputValue,
	test,
	waitForHash,
} from "../fixtures/extension"
import {
	addContact,
	captureBalanceBaseline,
	clickNavTab,
	closeStuckPopup,
	type FeeMethodSubtitle,
	importToken,
	navigateByHash,
	navigateToSettings,
	openNetworkDetail,
	PXE_ANCHOR_SYNC_WORKAROUND_MS,
	seedUsdQuoteAndReload,
	selectFeeMethod,
	selectSendToken,
	setActiveSendType,
	setInputAndBlur,
	setTheme,
	switchToLocalNetwork,
	waitForFreshBalanceRow,
	waitForHomeTotal,
	waitForToast,
	waitForTokenCardAmount,
	waitForTxConfirmation,
} from "../fixtures/helpers"
import { openPlayground } from "../fixtures/playground"
import { approveConnect, approveVerify, waitForPopup } from "../fixtures/popups"
import { openSend, submitSend, waitForFee, waitForSendGone } from "../fixtures/send-page"
import { gotoPopupImport, importSeed, POPUP_IMPORT_SHELL, TEST_PASSWORD, waitForActiveAccount } from "../helpers/import-drivers"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined

const OUT_DIR = resolve(__dirname, "../../../store/captures")
const VIEWPORT = { width: 360, height: 600, deviceScaleFactor: 2 }
const REDUCED_MOTION = [{ name: "prefers-reduced-motion", value: "reduce" }]
const PRICE_HOST = "https://api.coingecko.com"
/** One USD Coin in base units: six decimals, as on Ethereum. */
const USDC = 10n ** 6n
const CONTACT = "Alice"

type Chain = Awaited<ReturnType<typeof stageChain>>

/**
 * The script side: a recovery phrase whose first account is deployed with public and private Fee
 * Juice, a USD Coin token the sandbox minter controls, and the sandbox account that plays the
 * contact.
 */
async function stageChain(config: AztecTestConfig) {
	const aztec = await import("../fixtures/aztec")
	const { wallet, accounts, node, cleanup } = await aztec.createTestWallet(config.nodeUrl)
	try {
		const [minterAddress, aliceAddress] = accounts
		if (!aliceAddress) throw new Error("the sandbox registered fewer than two accounts")
		const minter = minterAddress.toString()
		const fee = await aztec.createSponsoredFeeOptions(wallet)
		const usdc = await aztec.deployTestToken(wallet, minterAddress, fee, "USDC", "USD Coin", 6)
		// The sandbox mints a block only for a transaction; each forced one mints to the minter.
		const forceBlock = () => aztec.mintPublicTokens(wallet, usdc, minter, 1n, minter, fee)
		const funded = await aztec.setupPreFundedAccount(wallet, node, minterAddress, { forceBlock })
		return {
			aztec,
			wallet,
			node,
			fee,
			usdc,
			minter,
			// Contacts are stored lowercase, and the Send field resolves a contact by exact address.
			alice: aliceAddress.toString().toLowerCase(),
			words: funded.words,
			account: funded.accountAddress.toString(),
			cleanup,
		}
	} catch (err) {
		await cleanup()
		throw err
	}
}

/** History's two receipts: 1,000 USDC sent publicly by the minter, 300 USDC arriving privately. */
async function deliverReceipts(chain: Chain): Promise<void> {
	const { aztec, wallet, node, fee, usdc, minter, account } = chain
	await aztec.mintPublicTokens(wallet, usdc, minter, 1_000n * USDC, minter, fee)
	await aztec.transferPublicTokens(wallet, usdc, minter, account, 1_000n * USDC, fee)
	await aztec.mintPrivateTokens(wallet, node, usdc, account, 300n * USDC, minter, fee)
}

async function renameNetwork(page: Page, from: string, to: string): Promise<void> {
	await navigateByHash(page, "#/popup/settings/networks")
	await openNetworkDetail(page, from)
	await clickByTestId(page, "network-detail-rename")
	await replaceInputValue(page, '[data-testid="network-name-input"]', to)
	await clickByTestId(page, "edit-network-submit")
	await waitForToast(page, "Network is updated", 10_000)
	await closeStuckPopup(page)
}

/** The wallet side, all through the UI. Leaves the page on Home with USD Coin imported. */
async function stageWallet(page: Page, chain: Chain): Promise<void> {
	await importSeed(page, chain.words.join(" "), TEST_PASSWORD, POPUP_IMPORT_SHELL)
	await switchToLocalNetwork(page)
	await waitForActiveAccount(page, chain.account, 60_000)
	await navigateToSettings(page, "appearance")
	await setTheme(page, "dark")
	await renameNetwork(page, "Testnet", "Aztec Testnet")
	await renameNetwork(page, "Local Network", "Testnet")
	await navigateByHash(page, "#/popup/settings/contacts")
	await addContact(page, CONTACT, chain.alice)
	await navigateByHash(page, "#/popup/general")
	await importToken(page, chain.usdc)
}

/** Waits on Home until the USD Coin row is freshly projected with exactly these balances. */
async function waitForUsdc(page: Page, chain: Chain, publicUnits: bigint, privateUnits: bigint, baseline: number): Promise<void> {
	await waitForFreshBalanceRow(page, {
		account: chain.account,
		tokenContract: chain.usdc,
		expectedPublicRaw: String(publicUnits * USDC),
		expectedPrivateRaw: String(privateUnits * USDC),
		baselineUpdatedAt: baseline,
		timeoutMs: 180_000,
	})
}

async function waitForReceipt(page: Page, kind: string): Promise<void> {
	await page.waitForFunction(
		(label: string) =>
			[...document.querySelectorAll('[data-testid="tx-incoming-kind-chip"]')].some((chip) => chip.textContent?.trim() === label),
		{ timeout: 180_000, polling: 1_000 },
		kind,
	)
}

async function receive(page: Page, chain: Chain): Promise<void> {
	const baseline = await captureBalanceBaseline(page, chain.account, chain.usdc)
	await deliverReceipts(chain)
	await waitForUsdc(page, chain, 1_000n, 300n, baseline)
	await navigateByHash(page, "#/popup/activity")
	await waitForReceipt(page, "Public → Public")
	await waitForReceipt(page, "Received privately")
	await navigateByHash(page, "#/popup/general")
}

/** Fills a private → private USD Coin send to the contact and waits for its fee estimate. */
async function fillPrivateSend(page: Page, chain: Chain, amount: string, fee: FeeMethodSubtitle): Promise<void> {
	await openSend(page)
	await selectSendToken(page, "USDC")
	await setActiveSendType(page, "send-from-type", "private")
	await setActiveSendType(page, "send-to-type", "private")
	await page.waitForFunction(
		() => {
			const input = document.querySelector<HTMLInputElement>('[data-testid="send-amount-input"]')
			return !!input && !input.disabled
		},
		{ timeout: 90_000, polling: 1_000 },
	)
	await replaceInputValue(page, '[data-testid="send-amount-input"]', amount)
	// The blur is what turns a typed contact address into the contact's card.
	await setInputAndBlur(page, '[data-testid="send-destination-field"] input', chain.alice)
	await page.waitForSelector(`[data-testid="recipient-card"][data-address="${chain.alice}"]`, { visible: true, timeout: 10_000 })
	await selectFeeMethod(page, fee, { mountTimeoutMs: 30_000 })
	expect(await waitForFee(page, "private", fee)).toMatchObject({
		action: "send",
		strip: { you: "hidden", to: "hidden", amount: "hidden" },
	})
	await page.waitForFunction(
		() => {
			const submit = document.querySelector<HTMLElement>('[data-testid="send-submit"]')
			return !!submit && getComputedStyle(submit).pointerEvents !== "none"
		},
		{ timeout: 180_000, polling: 1_000 },
	)
}

/** A real private send of 50 USDC to the contact, for History's outgoing row. The sponsor pays, so
 *  both Fee Juice balances stay round. */
async function sendToContact(page: Page, chain: Chain): Promise<void> {
	await fillPrivateSend(page, chain, "50", "sponsored")
	await new Promise((r) => setTimeout(r, PXE_ANCHOR_SYNC_WORKAROUND_MS))
	await submitSend(page, { expect: "send" })
	await waitForToast(page, "Transaction submitted", 120_000)
	await waitForSendGone(page)
	await navigateByHash(page, "#/popup/activity")
	await waitForTxConfirmation(page, { amount: "50", fromType: "private", toType: "private", timeout: 180_000 })
	await navigateByHash(page, "#/popup/general")
	await waitForUsdc(page, chain, 1_000n, 250n, await captureBalanceBaseline(page, chain.account, chain.usdc))
}

/** In-page: whatever still loads, refreshes, toasts or moves on screen, named for the diagnostic. */
function unsettled(): string[] {
	const shown = (el: Element) => {
		const box = el.getBoundingClientRect()
		return box.width > 0 && box.height > 0
	}
	const waiting = [
		...document.querySelectorAll(
			'[class*="skeleton" i], [class*="spinner" i], [class*="stale" i], [class*="refreshing" i], [aria-busy="true"], [data-testid="snackbar"]',
		),
	]
		.filter(shown)
		.map((el) => el.getAttribute("data-testid") ?? el.getAttribute("class") ?? el.tagName)
	const moving = [...document.querySelectorAll("[class]")]
		.map((el) => el.getAttribute("class") ?? "")
		.filter((name) => /-(enter|leave)-(from|active|to)\b/.test(name))
	return [...waiting, ...moving]
}

async function settle(page: Page): Promise<void> {
	await page.evaluate(async () => {
		;(document.activeElement as HTMLElement | null)?.blur()
		await document.fonts.ready
	})
	try {
		await page.waitForFunction(`(${unsettled})().length === 0`, { timeout: 90_000, polling: 250 })
	} catch (err) {
		throw new Error(`the page never settled: ${JSON.stringify(await page.evaluate(unsettled))}`, { cause: err })
	}
	await new Promise((r) => setTimeout(r, 750))
}

async function capture(page: Page, name: string): Promise<void> {
	await settle(page)
	const path = resolve(OUT_DIR, `${name}.png`) as `${string}.png`
	await page.screenshot({ path })
	const png = readFileSync(path)
	expect({ width: png.readUInt32BE(16), height: png.readUInt32BE(20) }).toEqual({ width: 720, height: 1200 })
	console.log(`[store-captures] wrote store/captures/${name}.png`)
}

type Fit = { scrolled: number } | { error: string }

/** Settles the page, then scrolls it by what `fit` (run in the page) decides. A frame with no clean
 *  scroll is still written, so one run shows every screen, and the test fails at its end. */
async function scrollToFit(page: Page, fit: () => Fit): Promise<void> {
	await settle(page)
	const result = await page.evaluate(fit)
	console.log(`[store-captures] ${fit.name}: ${JSON.stringify(result)}`)
	expect.soft(result, fit.name).toEqual({ scrolled: expect.any(Number) })
}

/**
 * In-page, on Home: the least scroll that shows whole the activity row the bottom nav cuts through,
 * while the rows after it stay hidden and the balance stays whole. A row's box pads its content, so
 * its bottom edge may meet the nav.
 */
function revealCutActivityRow(): Fit {
	const nav = document.querySelector('[data-testid="bottom-nav"]')?.getBoundingClientRect()
	const balance = document.querySelector<HTMLElement>('[data-testid="balance-amount"]')
	let scroller = balance?.parentElement ?? null
	while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
	if (!nav || !balance || !scroller) return { error: "Home has no bottom nav, balance or scroll container" }
	const rows = [
		...document.querySelectorAll('[data-testid="tx-card"], [data-testid="tx-incoming-card"], [data-testid="tx-terminal-card"]'),
	].map((row) => row.getBoundingClientRect())
	const cut = rows.find((row) => row.top < nav.top && row.bottom > nav.top)
	if (!cut) return { scrolled: 0 }
	const need = Math.ceil(cut.bottom - nav.top)
	const later = rows.filter((row) => row.top >= cut.bottom).map((row) => row.top - nav.top)
	const room = Math.floor(Math.min(balance.getBoundingClientRect().top - scroller.getBoundingClientRect().top, ...later))
	if (need > room) return { error: `the cut activity row needs ${need}px of scroll, and Home has ${room}px` }
	scroller.scrollTop += need
	return { scrolled: need }
}

/**
 * In-page, on Send: the least scroll that lifts the amount's conversion line clear of the sticky
 * footer while the transfer-type labels stay below the sticky header.
 */
function clearAmountLine(): Fit {
	const footer = document.querySelector<HTMLElement>('[data-testid="send-footer"]')
	// The header bar and the type labels carry no test id: the back button's and the toggle's parents
	// are their boxes.
	const header = document.querySelector('[data-testid="subpage-back"]')?.parentElement?.getBoundingClientRect()
	const labels = document.querySelector('[data-testid="send-from-type"]')?.parentElement?.getBoundingClientRect()
	let scroller = footer?.parentElement ?? null
	while (scroller && !/auto|scroll/.test(getComputedStyle(scroller).overflowY)) scroller = scroller.parentElement
	const line = ["send-amount-meta", "send-amount-balance", "send-amount-max"]
		.map((id) => document.querySelector(`[data-testid="${id}"]`)?.getBoundingClientRect().bottom)
		.filter((bottom): bottom is number => bottom !== undefined)
	if (!footer || !header || !labels || !scroller || !line.length) return { error: "Send has no footer, header, types or amount line" }
	const need = Math.max(0, Math.ceil(Math.max(...line) + 4 - footer.getBoundingClientRect().top))
	const room = Math.floor(labels.top - header.bottom)
	if (need > room) return { error: `the amount line needs ${need}px of scroll, and Send has ${room}px` }
	scroller.scrollTop += need
	return { scrolled: need }
}

async function captureHome(page: Page): Promise<void> {
	await seedUsdQuoteAndReload(page)
	await waitForHomeTotal(page)
	await page.waitForFunction(() => document.querySelector('[data-testid="balance-amount"]')?.textContent?.trim() === "$1,250.00", {
		timeout: 30_000,
		polling: 250,
	})
	await waitForTokenCardAmount(page, "1,250", "USDC")
	await page.waitForFunction(
		() =>
			["gas-balance-public", "gas-balance-private"].every((id) =>
				/^1,000(\.0+)? FJ$/.test(document.querySelector(`[data-testid="${id}"]`)?.textContent?.trim() ?? ""),
			),
		{ timeout: 90_000, polling: 1_000 },
	)
	await scrollToFit(page, revealCutActivityRow)
	await capture(page, "home")
}

/** The fee card sits below the fold, under the sticky footer: the frame keeps the recipient, the
 *  token and the amount, and the strip's "you hidden" reads the private Fee Juice pick. */
async function captureSend(page: Page, chain: Chain): Promise<void> {
	await fillPrivateSend(page, chain, "120", "private")
	await scrollToFit(page, clearAmountLine)
	await capture(page, "send")
	await navigateByHash(page, "#/popup/general")
}

async function captureHistory(page: Page): Promise<void> {
	await seedUsdQuoteAndReload(page)
	// The reload's own start-up routing lands on Home; leaving before Home has settled loses the race.
	await waitForHomeTotal(page)
	await clickNavTab(page, "activity")
	await waitForHash(page, "#/popup/activity")
	await page.waitForSelector('[data-testid="activity-feed-root"]', { visible: true, timeout: 15_000 })
	await waitForTxConfirmation(page, { amount: "50", fromType: "private", toType: "private" })
	await waitForReceipt(page, "Public → Public")
	await waitForReceipt(page, "Received privately")
	await capture(page, "history")
	await navigateByHash(page, "#/popup/general")
}

async function captureSecurity(page: Page): Promise<void> {
	await navigateToSettings(page, "security")
	await page.waitForSelector('[data-testid="setting-strict-security-mode"]', { visible: true, timeout: 15_000 })
	await capture(page, "security")
}

async function frameWindow(page: Page): Promise<Page> {
	await page.setViewport(VIEWPORT)
	await page.emulateMediaFeatures(REDUCED_MOTION)
	return page
}

/**
 * The playground's permission request, as the window first shows it. A transfer's approval card is
 * not framed: the standard token names its nonce `_nonce`, so the card falls back to the ABI decode
 * and shows the amount in base units.
 */
async function captureApproval(ctx: ExtensionContext, chain: Chain): Promise<void> {
	const playground = await openPlayground(ctx)
	const opened = waitForPopup(ctx, "discover", { timeout: 30_000 })
	await clickByTestId(playground, "pg-btn-connect")
	await approveVerify(await approveConnect(ctx, await opened))
	await playground.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 30_000 })
	await grantCapBundle(ctx, playground, "transaction", async (accountIds, window) => {
		if (!accountIds.includes(chain.account))
			throw new Error(`the permission window did not offer ${chain.account}: ${accountIds.join(", ")}`)
		await capture(await frameWindow(window), "approve")
		return [chain.account]
	})
}

describe.skipIf(!process.env.STORE_CAPTURES || isFirefox)("store captures", () => {
	test("home, send, history, security and a dApp approval, staged on the sandbox", { timeout: 2_400_000, retry: 0 }, async () => {
		if (!aztecConfig) throw new Error("no sandbox config: run this file through `bun run e2e:agent`")
		const chain = await stageChain(aztecConfig)
		let ctx: ExtensionContext | undefined
		try {
			ctx = await launchExtension()
			await interceptRpc(ctx.browser, ctx.extensionId, PRICE_HOST, { kind: "refuse" })
			const page = await gotoPopupImport(ctx)
			await page.setViewport(VIEWPORT)
			await page.emulateMediaFeatures(REDUCED_MOTION)
			await stageWallet(page, chain)
			await receive(page, chain)
			await sendToContact(page, chain)
			await captureHome(page)
			await captureSend(page, chain)
			await captureHistory(page)
			await captureSecurity(page)
			await captureApproval(ctx, chain)
		} finally {
			await ctx?.close()
			await chain.cleanup()
		}
	})
})
