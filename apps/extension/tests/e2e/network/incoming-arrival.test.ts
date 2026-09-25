/**
 * Arrivals on a live sandbox. A receipt plays once, where it is first shown: on Home its row
 * glows and the hero's chip rises; on any other popup page, once the popup's first read has
 * seeded, a snack names it and Home then plays nothing; a receipt the first read already finds,
 * and an imported account's history, play nothing new. Receipts come from the sandbox minter: a
 * private note is released through the incoming-poll gate, a public transfer is found by the
 * scheduler on its own (the gate matches notes only and releases itself after 15 s, too soon to
 * hold a note across a lock and an unlock).
 *
 * Run zero-retry: the file-scoped `tokenReadyExtension` accumulates receipts, so a retry would
 * replay against a wallet that has already played them.
 *
 * @requires-proverless — formal marker scanned by scripts/e2e/agent.sh: the incoming-poll gate is
 * compiled into proverless builds only.
 */
import type { Page } from "puppeteer"
import { afterAll, expect, inject, onTestFinished } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import { extensionUrl, gotoExtensionPage, isFirefox, newPage, stopBackground } from "../fixtures/browser"
import { TEST_PASSWORD } from "../fixtures/constants"
import { clickByTestId, openPopup, patchPagePolling, test, waitForHash } from "../fixtures/extension"
import {
	clickNavTab,
	createAndActivateProfile,
	ensureUnlocked,
	getAccountAddress,
	importToken,
	lockWallet,
	navigateByHash,
	navigateToSettings,
	refreshBalances,
	seedUsdQuoteAndReload,
	switchAccountByAddress,
	switchToLocalNetwork,
	waitForHomeTotal,
	waitForToast,
} from "../fixtures/helpers"
import { holdIncomingPoll, readIncomingPollStatus, releaseIncomingPoll, waitForIncomingPollPhase } from "../fixtures/incoming-poll-gate"
import { confirmImport, exportAccountBody, previewImport } from "../helpers/account-io"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const D = 10n ** 18n
const RECEIPT_BUDGET_MS = 180_000
/** The Token constructor's symbol limit. */
const HOSTILE_SYMBOL = "H".repeat(31)
/** Markup-like text and a bidi override, 1,000 characters: longer than any UI path accepts. */
const HOSTILE_NAME = "\u202e<b>x</b>".repeat(112).slice(0, 1_000)
const sel = (testId: string) => `[data-testid="${testId}"]`

type Config = AztecTestConfig
type Sender = Awaited<ReturnType<typeof createSender>>

let sender: Sender | undefined
let hostileToken: string | undefined

afterAll(async () => {
	await sender?.cleanup()
})

async function createSender(config: Config) {
	const { createTestWallet, createSponsoredFeeOptions, mintPublicTokens } = await import("../fixtures/aztec")
	const { wallet, accounts, node, cleanup } = await createTestWallet(config.nodeUrl)
	const feeOptions = await createSponsoredFeeOptions(wallet)
	await mintPublicTokens(wallet, config.tokenAddress, config.minterAddress, 10_000n * D, config.minterAddress, feeOptions)
	return { wallet, minter: accounts[0], node, feeOptions, cleanup }
}

async function senderFor(config: Config): Promise<Sender> {
	sender ??= await createSender(config)
	return sender
}

/** A public transfer from the minter; the scheduler finds it without a refresh. */
async function sendPublic(config: Config, to: string, amount: bigint, token = config.tokenAddress): Promise<void> {
	const { transferPublicTokens } = await import("../fixtures/aztec")
	const s = await senderFor(config)
	await transferPublicTokens(s.wallet, token, config.minterAddress, to, amount, s.feeOptions)
}

/** A private note minted to `to`; returns its tx hash, which the incoming-poll gate matches. */
async function sendPrivate(config: Config, to: string, amount: bigint): Promise<string> {
	const { mintPrivateTokens } = await import("../fixtures/aztec")
	const s = await senderFor(config)
	return mintPrivateTokens(s.wallet, s.node, config.tokenAddress, to, amount, config.minterAddress, s.feeOptions)
}

/** Closes `page` when the test ends, pass or fail: a page left open on Home would claim, and so
 *  silence, the next test's receipts. */
function closeAtEnd(page: Page): Page {
	onTestFinished(() => page.close().catch(() => undefined))
	return page
}

type Triple = { profileId: string; networkId: string; account: string }

async function activeTriple(page: Page): Promise<Triple> {
	const triple = await page.evaluate(async () => {
		const profileId = (await chrome.storage.local.get("nulo:ui:lastActiveProfile"))["nulo:ui:lastActiveProfile"]
		const account = (await chrome.storage.local.get("nulo:ui:activeAccount"))["nulo:ui:activeAccount"]
		const activeKey = `nulo:core:active-network@${profileId}`
		const networkId = (await chrome.storage.local.get(activeKey))[activeKey]
		return { profileId, account, networkId }
	})
	const { profileId, networkId, account } = triple
	if (typeof profileId !== "string" || typeof networkId !== "string" || typeof account !== "string") {
		throw new Error(`could not resolve the active (profile, network, account): ${JSON.stringify(triple)}`)
	}
	return { profileId, networkId, account }
}

type StoredRecord = { id: string; txHash: string; contract: string; l2BlockNumber: number; discoveredAt: number }

/** Every committed incoming record of `account`, from storage. */
async function storedRecords(page: Page, account: string): Promise<StoredRecord[]> {
	return page.evaluate(async (want: string) => {
		const all = await chrome.storage.local.get(null)
		return Object.entries(all)
			.filter(([key, value]) => key.startsWith("nulo:core:incoming-transfers@") && typeof value === "string")
			.map(([, value]) => JSON.parse(value as string))
			.filter((rec) => rec.accountAddress === want)
	}, account)
}

/** The first record of `account` whose id `known` does not hold, polled from storage. */
async function waitForNewRecord(page: Page, account: string, known: Set<string>, contract?: string): Promise<StoredRecord> {
	const deadline = Date.now() + RECEIPT_BUDGET_MS
	while (Date.now() < deadline) {
		const fresh = (await storedRecords(page, account)).find((r) => !known.has(r.id) && (!contract || r.contract === contract))
		if (fresh) return fresh
		await new Promise((r) => setTimeout(r, 1_000))
	}
	throw new Error(`no new incoming record for ${account} within ${RECEIPT_BUDGET_MS}ms`)
}

async function readJson<T>(page: Page, key: string): Promise<T | undefined> {
	const raw = await page.evaluate(async (k: string) => (await chrome.storage.local.get(k))[k], key)
	return typeof raw === "string" ? (JSON.parse(raw) as T) : undefined
}

type Recording = {
	first: Record<string, string | null>
	ever: Record<string, boolean>
	animation: Record<string, string>
	chips: { text: string; animation: string }[]
	snacks: string[]
}

/**
 * Records, from now on, how each incoming row first rendered (its `data-arriving` and animation),
 * whether it ever played, each arrival chip and each snack title, by receipt id: the one the row's
 * link opens. A row that plays does so from its first rendered DOM, so the first sight is the
 * evidence.
 */
async function armRecorder(page: Page): Promise<void> {
	await page.evaluate(() => {
		const rec: Recording = { first: {}, ever: {}, animation: {}, chips: [], snacks: [] }
		;(window as unknown as { __arrivals: Recording }).__arrivals = rec
		const all = (root: Element, selector: string) => [...(root.matches(selector) ? [root] : []), ...root.querySelectorAll(selector)]
		const noteRow = (card: Element) => {
			const href = card.querySelector("[data-row-target]")?.getAttribute("href") ?? ""
			const id = decodeURIComponent(href.replace(/^#?\/popup\/received\//, ""))
			const arriving = card.getAttribute("data-arriving")
			if (!(id in rec.first)) {
				rec.first[id] = arriving
				rec.animation[id] = getComputedStyle(card).animationName
			}
			rec.ever[id] = rec.ever[id] === true || arriving === "true"
		}
		const note = (root: Element) => {
			for (const card of all(root, '[data-testid="tx-incoming-card"]')) noteRow(card)
			for (const chip of all(root, '[data-testid="balance-arrival-chip"]')) {
				rec.chips.push({ text: chip.textContent?.trim() ?? "", animation: getComputedStyle(chip).animationName })
			}
			for (const title of all(root, '[data-testid="snackbar-title"]')) rec.snacks.push(title.textContent?.trim() ?? "")
		}
		const onMutation = (m: MutationRecord) => {
			if (m.type === "attributes") note(m.target as Element)
			for (const n of m.addedNodes) if (n instanceof Element) note(n)
		}
		note(document.body)
		new MutationObserver((mutations) => mutations.forEach(onMutation)).observe(document.body, {
			subtree: true,
			childList: true,
			attributes: true,
			attributeFilter: ["data-arriving"],
		})
	})
}

/** Snacks naming a receipt; other snacks (a token added, an account imported) are not arrivals. */
const receivedSnacks = (rec: Recording) => rec.snacks.filter((title) => title.startsWith("Received"))

const recording = (page: Page) => page.evaluate(() => (window as unknown as { __arrivals: Recording }).__arrivals)

/** Wait until the recorder has seen the row of receipt `id`. */
async function waitForRow(page: Page, id: string): Promise<void> {
	const deadline = Date.now() + RECEIPT_BUDGET_MS
	while (Date.now() < deadline) {
		if (id in (await recording(page)).first) return
		await new Promise((r) => setTimeout(r, 1_000))
	}
	throw new Error(`the row of ${id} never rendered within ${RECEIPT_BUDGET_MS}ms`)
}

/** Wait until the receipt `txHash` delivered is stored and its row seen; returns the receipt's id.
 *  Refreshing balances meanwhile advances the wallet's PXE sync, so a note is discovered sooner. */
async function waitForRowOf(page: Page, account: string, txHash: string): Promise<string> {
	const deadline = Date.now() + RECEIPT_BUDGET_MS
	while (Date.now() < deadline) {
		const record = (await storedRecords(page, account)).find((r) => r.txHash === txHash)
		if (record && record.id in (await recording(page)).first) return record.id
		await refreshBalances(page).catch(() => undefined)
		await new Promise((r) => setTimeout(r, 4_000))
	}
	throw new Error(`the row of ${txHash} never rendered within ${RECEIPT_BUDGET_MS}ms`)
}

/** Drive the PXE until a scan discovers `txHash` and parks at the gate. */
async function driveUntilHeld(page: Page, txHash: string): Promise<void> {
	for (let i = 0; i < 40; i++) {
		await refreshBalances(page).catch(() => undefined)
		for (let j = 0; j < 15; j++) {
			const status = await readIncomingPollStatus(page)
			if (status?.phase === "discovery-held" && status.txHash === txHash) return
			await new Promise((r) => setTimeout(r, 300))
		}
	}
	throw new Error(`the scan never parked at the gate for ${txHash}`)
}

const waitForSeeded = (page: Page) => page.waitForSelector('[data-arrivals-seeded="true"]', { timeout: 60_000 })

type Snack = { title: string; sub: string }

async function waitForReceivedSnack(page: Page, timeout = RECEIPT_BUDGET_MS): Promise<Snack> {
	const card = await waitForToast(page, "Received", timeout, { kind: "success" })
	return card.evaluate((el) => ({
		title: el.querySelector('[data-testid="snackbar-title"]')?.textContent?.trim() ?? "",
		sub: el.querySelector('[data-testid="snackbar-sub"]')?.textContent?.trim() ?? "",
	}))
}

function expectReceivedCopy(snack: Snack): void {
	expect(snack.title.startsWith("Received")).toBe(true)
	expect(snack.sub.startsWith("Private · ") || snack.sub.startsWith("Public · ")).toBe(true)
}

/** View opens the receipt; returns the record it names. */
async function viewReceipt(page: Page, account: string): Promise<StoredRecord> {
	await clickByTestId(page, "snackbar-action")
	await page.waitForFunction(() => window.location.hash.startsWith("#/popup/received/"), { timeout: 10_000 })
	const id = decodeURIComponent((await page.evaluate(() => window.location.hash)).slice("#/popup/received/".length))
	const record = (await storedRecords(page, account)).find((r) => r.id === id)
	if (!record) throw new Error(`View opened ${id}, which is not a stored receipt of ${account}`)
	return record
}

/** Home renders the receipt's row and never plays it. */
async function expectHomePlaysNothingFor(page: Page, id: string): Promise<void> {
	await armRecorder(page)
	await navigateByHash(page, "#/popup/general", 10_000)
	await waitForRow(page, id)
	await new Promise((r) => setTimeout(r, 3_000))
	expect((await recording(page)).ever[id]).toBe(false)
}

/** A popup page opened on `hash`, the way a tab opens it. */
async function openPopupAt(page: Page, extensionId: string, hash: string): Promise<void> {
	patchPagePolling(page)
	await page.setViewport({ width: 360, height: 600 })
	await page.bringToFront()
	await gotoExtensionPage(page, extensionUrl(extensionId, `/src/popup/index.html${hash}`))
	await page.waitForFunction(() => window.location.hash !== "#/" && !document.querySelector('[data-testid="global-loader"]'), {
		timeout: 30_000,
	})
}

async function setAnimationsDisabled(page: Page, disabled: boolean): Promise<void> {
	await navigateToSettings(page, "appearance")
	await page.waitForSelector(sel("animations-toggle"), { visible: true, timeout: 10_000 })
	const active = await page.evaluate(() =>
		document.querySelector('[data-testid="animations-toggle"]')?.getAttribute("data-toggle-active"),
	)
	if ((active === "true") !== disabled) await clickByTestId(page, "animations-toggle")
	await page.waitForFunction(
		(want: boolean) => document.documentElement.classList.contains("noanimations") === want,
		{ timeout: 10_000 },
		disabled,
	)
	await navigateByHash(page, "#/popup/general", 10_000)
	await waitForHomeTotal(page)
}

/** Samples the hero on every animation frame until `stop` is set; returns every distinct string. */
async function armHeroSampler(page: Page): Promise<void> {
	await page.evaluate(() => {
		const w = window as unknown as { __hero: { seen: string[]; stop: boolean } }
		w.__hero = { seen: [], stop: false }
		const read = () => document.querySelector('[data-testid="balance-amount"]')?.textContent?.trim() ?? ""
		const frame = () => {
			const text = read()
			if (w.__hero.seen.at(-1) !== text) w.__hero.seen.push(text)
			if (!w.__hero.stop) requestAnimationFrame(frame)
		}
		requestAnimationFrame(frame)
	})
}

/** A calm arrival on Home: the row glows in place, the chip fades, and the hero never counts. */
async function expectCalmArrival(page: Page, config: Config, account: string): Promise<void> {
	const before = new Set((await storedRecords(page, account)).map((r) => r.id))
	const heroBefore = await page.$eval(sel("balance-amount"), (el) => el.textContent?.trim() ?? "")
	await armRecorder(page)
	await armHeroSampler(page)
	await sendPublic(config, account, 6n * D)
	const record = await waitForNewRecord(page, account, before)
	await waitForRow(page, record.id)
	await page.waitForFunction(
		(was: string) => document.querySelector('[data-testid="balance-amount"]')?.textContent?.trim() !== was,
		{ timeout: RECEIPT_BUDGET_MS },
		heroBefore,
	)
	await new Promise((r) => setTimeout(r, 1_200))
	const seen = await page.evaluate(() => {
		const w = window as unknown as { __hero: { seen: string[]; stop: boolean } }
		w.__hero.stop = true
		return w.__hero.seen
	})
	const rec = await recording(page)
	expect(rec.first[record.id]).toBe("true")
	expect(rec.animation[record.id]).toContain("n-row-glow")
	expect(rec.animation[record.id]).not.toContain("n-row-in")
	expect(rec.chips.at(-1)?.animation).toContain("n-plus-calm")
	expect(seen).toEqual([heroBefore, seen.at(-1)])
}

test.skipIf(!hasConfig)(
	"a receipt sent after a token's floor was read is mined above that floor",
	{ timeout: 600_000, retry: 0 },
	async ({ tokenReadyExtension }) => {
		const config = aztecConfig as Config
		const page = closeAtEnd(await openPopup(tokenReadyExtension))
		await waitForHash(page, "#/popup/general", 30_000)
		const triple = await activeTriple(page)
		const arrival = await readJson<{ sinceBlock: number }>(
			page,
			`nulo:core:incoming-arrivals@${triple.profileId}|${triple.networkId}|${triple.account}`,
		)

		const { deployTestToken, mintPublicTokens } = await import("../fixtures/aztec")
		const s = await senderFor(config)
		hostileToken = await deployTestToken(s.wallet, s.minter, s.feeOptions, HOSTILE_SYMBOL, "Hostile")
		await mintPublicTokens(s.wallet, hostileToken, config.minterAddress, 3n * 10n ** 38n, config.minterAddress, s.feeOptions)

		await importToken(page, hostileToken)
		const trust = await readJson<{ arrivalFloor?: number }>(
			page,
			`nulo:core:incoming-trust@${triple.profileId}|${triple.networkId}|${hostileToken}`,
		)
		const floor = trust?.arrivalFloor
		expect(typeof floor).toBe("number")

		const known = new Set((await storedRecords(page, triple.account)).map((r) => r.id))
		await sendPublic(config, triple.account, D, hostileToken)
		const receipt = await waitForNewRecord(page, triple.account, known, hostileToken)
		console.log(
			`[arrival-tip] account sinceBlock=${arrival?.sinceBlock}; token floor (tip read at import)=${floor}; ` +
				`receipt sent after it mined in block ${receipt.l2BlockNumber}`,
		)
		expect(receipt.l2BlockNumber).toBeGreaterThan(floor as number)
		await page.close()
	},
)

test.skipIf(!hasConfig)(
	"on Home a new receipt's row plays from its first render with the chip, and a reopened popup replays nothing",
	{ timeout: 600_000, retry: 0 },
	async ({ tokenReadyExtension }) => {
		const config = aztecConfig as Config
		const page = closeAtEnd(await openPopup(tokenReadyExtension))
		await waitForHash(page, "#/popup/general", 30_000)
		const account = await getAccountAddress(page)
		await armRecorder(page)
		const txHash = await sendPrivate(config, account, 25n * D)
		const id = await waitForRowOf(page, account, txHash)
		await page.waitForFunction(() => !!document.querySelector('[data-testid="balance-arrival-chip"]'), { timeout: 10_000 })
		const rec = await recording(page)
		expect(rec.first[id]).toBe("true")
		expect(rec.chips.at(-1)?.text.startsWith("+")).toBe(true)
		expect(receivedSnacks(rec)).toEqual([])
		await page.close()

		const reopened = closeAtEnd(await openPopup(tokenReadyExtension))
		await armRecorder(reopened)
		await waitForHash(reopened, "#/popup/general", 30_000)
		await waitForRow(reopened, id)
		await new Promise((r) => setTimeout(r, 3_000))
		const again = await recording(reopened)
		expect(Object.values(again.ever)).not.toContain(true)
		expect(await reopened.$(sel("balance-arrival-chip"))).toBeNull()
		await reopened.close()
	},
)

test.skipIf(!hasConfig)(
	"off Home a receipt opens its snack once the popup has seeded, View opens it, and Home plays nothing — also after a lock and an unlock",
	{ timeout: 900_000, retry: 0 },
	async ({ tokenReadyExtension }) => {
		const config = aztecConfig as Config
		const page = closeAtEnd(await openPopup(tokenReadyExtension))
		await waitForHash(page, "#/popup/general", 30_000)
		const triple = await activeTriple(page)

		const txHash = await sendPrivate(config, triple.account, 7n * D)
		await holdIncomingPoll(page, {
			profileId: triple.profileId,
			networkId: triple.networkId,
			accountAddress: triple.account,
			contract: config.tokenAddress,
			txHash,
		})
		await driveUntilHeld(page, txHash)
		await clickNavTab(page, "settings")
		await waitForHash(page, "#/popup/settings")
		await waitForSeeded(page)
		await releaseIncomingPoll(page)
		await waitForIncomingPollPhase(page, "committed", txHash)
		expectReceivedCopy(await waitForReceivedSnack(page, 30_000))
		const viewed = await viewReceipt(page, triple.account)
		expect(viewed.txHash).toBe(txHash)
		await expectHomePlaysNothingFor(page, viewed.id)

		await lockWallet(page)
		await ensureUnlocked(page, TEST_PASSWORD)
		await waitForHash(page, "#/popup/general", 60_000)
		await clickNavTab(page, "settings")
		await waitForHash(page, "#/popup/settings")
		await waitForSeeded(page)
		await sendPublic(config, triple.account, 3n * D)
		expectReceivedCopy(await waitForReceivedSnack(page))
		const record = await viewReceipt(page, triple.account)
		await expectHomePlaysNothingFor(page, record.id)
		await page.close()
	},
)

test.skipIf(!hasConfig)(
	"a receipt found while no popup page is open opens no snack at the next open, and Home plays it",
	{ timeout: 600_000, retry: 0 },
	async ({ tokenReadyExtension }) => {
		const config = aztecConfig as Config
		const account = tokenReadyExtension.accountAddress
		// The setup page reads storage without mounting the popup shell, where arrivals live.
		const observer = closeAtEnd(await newPage(tokenReadyExtension.browser))
		await gotoExtensionPage(observer, extensionUrl(tokenReadyExtension.extensionId, "/src/setup/index.html#/install"))
		const before = new Set((await storedRecords(observer, account)).map((r) => r.id))
		await sendPublic(config, account, 4n * D)
		const record = await waitForNewRecord(observer, account, before)
		await observer.close()

		const page = closeAtEnd(await newPage(tokenReadyExtension.browser))
		await openPopupAt(page, tokenReadyExtension.extensionId, "#/popup/settings")
		await armRecorder(page)
		await waitForSeeded(page)
		const landed = await page.evaluate(() => window.location.hash)
		console.log(`[arrival] a popup opened at #/popup/settings is on ${landed} once seeded`)
		if (landed !== "#/popup/general") {
			await new Promise((r) => setTimeout(r, 3_000))
			await clickNavTab(page, "general")
		}
		await waitForRow(page, record.id)
		const rec = await recording(page)
		expect(receivedSnacks(rec)).toEqual([])
		expect(rec.first[record.id]).toBe("true")
		await page.close()
	},
)

test.skipIf(!hasConfig)(
	"with animations off, and on Chrome under reduced motion, a receipt glows in place, its chip fades and the hero never counts",
	{ timeout: 900_000, retry: 0 },
	async ({ tokenReadyExtension }) => {
		const config = aztecConfig as Config
		const page = closeAtEnd(await openPopup(tokenReadyExtension))
		await waitForHash(page, "#/popup/general", 30_000)
		await seedUsdQuoteAndReload(page)
		const account = await getAccountAddress(page)
		await setAnimationsDisabled(page, true)
		await expectCalmArrival(page, config, account)
		await setAnimationsDisabled(page, false)

		if (!isFirefox) {
			await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }])
			await expectCalmArrival(page, config, account)
			await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }])
		}
		await page.close()
	},
)

test.skipIf(!hasConfig)(
	"hostile bounds: a 31-character symbol, 10^38 base units and a 1,000-character account name stay inside the popup",
	{ timeout: 900_000, retry: 0 },
	async ({ tokenReadyExtension }) => {
		const config = aztecConfig as Config
		if (!hostileToken) throw new Error("the tip probe deploys the hostile token; it did not run")
		let page = closeAtEnd(await openPopup(tokenReadyExtension))
		await waitForHash(page, "#/popup/general", 30_000)
		const account = await getAccountAddress(page)
		await page.evaluate(
			async (addr: string, name: string) => {
				const all = await chrome.storage.local.get(null)
				const rows: Record<string, string> = {}
				for (const [key, value] of Object.entries(all)) {
					if (!key.startsWith("nulo:core:accounts@") || typeof value !== "string") continue
					const row = JSON.parse(value)
					if (row.address === addr) rows[key] = JSON.stringify({ ...row, name })
				}
				await chrome.storage.local.set(rows)
			},
			account,
			HOSTILE_NAME,
		)
		await page.close()
		await stopBackground(tokenReadyExtension)
		page = closeAtEnd(await openPopup(tokenReadyExtension))
		await ensureUnlocked(page, TEST_PASSWORD, { decisionBudgetMs: 120_000 })
		await waitForHash(page, "#/popup/general", 120_000)

		await clickNavTab(page, "settings")
		await waitForHash(page, "#/popup/settings")
		await waitForSeeded(page)
		await sendPublic(config, account, 10n ** 38n, hostileToken)
		const snack = await waitForReceivedSnack(page)
		expect(snack.sub).not.toContain("\u202e")
		const layout = await page.evaluate(() => {
			const card = document.querySelector('[data-testid="snackbar"]') as HTMLElement
			const view = document.querySelector('[data-testid="snackbar-action"]') as HTMLElement
			const centre = (el: HTMLElement) => {
				const r = el.getBoundingClientRect()
				return document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2)
			}
			const r = card.getBoundingClientRect()
			return {
				rect: { left: r.left, right: r.right, top: r.top, bottom: r.bottom },
				viewOwn: view.contains(centre(view)),
				cardOwn: card.contains(centre(card)),
			}
		})
		expect(layout.rect.left).toBeGreaterThanOrEqual(0)
		expect(layout.rect.right).toBeLessThanOrEqual(360)
		expect(layout.rect.top).toBeGreaterThanOrEqual(0)
		expect(layout.rect.bottom).toBeLessThanOrEqual(600)
		expect(layout.viewOwn).toBe(true)
		expect(layout.cardOwn).toBe(true)

		await armRecorder(page)
		await clickNavTab(page, "general")
		await waitForHomeTotal(page)
		const before = new Set((await storedRecords(page, account)).map((r) => r.id))
		await sendPublic(config, account, 10n ** 38n, hostileToken)
		const record = await waitForNewRecord(page, account, before, hostileToken)
		await waitForRow(page, record.id)
		const chip = await page.$eval(sel("balance-arrival-chip"), (el) => {
			const r = el.getBoundingClientRect()
			const style = getComputedStyle(el)
			return {
				width: r.width,
				left: r.left,
				right: r.right,
				textOverflow: style.textOverflow,
				cut: el.scrollWidth > el.clientWidth,
			}
		})
		expect(chip.width).toBeLessThanOrEqual(312)
		expect(chip.left).toBeGreaterThanOrEqual(0)
		expect(chip.right).toBeLessThanOrEqual(360)
		expect(chip.textOverflow).toBe("ellipsis")
		expect(chip.cut).toBe(true)
		await page.close()
	},
)

test.skipIf(!hasConfig)(
	"an account imported with receipt history plays nothing on its first Home",
	{ timeout: 900_000, retry: 0 },
	async ({ tokenReadyExtension }) => {
		const config = aztecConfig as Config
		if (!hostileToken) throw new Error("the tip probe deploys the hostile token; it did not run")
		const page = closeAtEnd(await openPopup(tokenReadyExtension))
		await waitForHash(page, "#/popup/general", 30_000)
		const source = await getAccountAddress(page)
		const name = await page.evaluate(async (addr: string) => {
			const all = await chrome.storage.local.get(null)
			for (const [key, value] of Object.entries(all)) {
				if (!key.startsWith("nulo:core:accounts@") || typeof value !== "string") continue
				const row = JSON.parse(value)
				if (row.address === addr) return row.name as string
			}
			return ""
		}, source)
		const body = await exportAccountBody(page, name, false)

		await navigateByHash(page, "#/popup/general", 10_000)
		await createAndActivateProfile(page, "History", TEST_PASSWORD)
		await switchToLocalNetwork(page)
		await importToken(page, config.tokenAddress)
		await importToken(page, hostileToken)
		const imported = await previewImport(page, body)
		expect(imported).toBe(source)
		await confirmImport(page)

		await navigateByHash(page, "#/popup/general", 10_000)
		await armRecorder(page)
		await switchAccountByAddress(page, source)
		await page.waitForFunction(() => document.querySelectorAll('[data-testid="tx-incoming-card"]').length > 0, {
			timeout: RECEIPT_BUDGET_MS,
			polling: 1_000,
		})
		await new Promise((r) => setTimeout(r, 5_000))
		const rec = await recording(page)
		expect(Object.keys(rec.first).length).toBeGreaterThan(0)
		expect(Object.values(rec.ever)).not.toContain(true)
		expect(rec.chips).toEqual([])
		expect(receivedSnacks(rec)).toEqual([])
		await page.close()
	},
)
