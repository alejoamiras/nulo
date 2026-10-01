/**
 * The sponsor's Fee Juice, read from the node before a send proves. Nulo's own sponsor is the
 * sandbox's funded SponsoredFPC. The unfunded one is a second SponsoredFPC (salt 1) that is never
 * deployed or funded: the playground registers it and Settings adds it by hand, the kernel names it
 * as the fee payer, and the node would refuse its send for want of a balance.
 */
import { getContractInstanceFromInstantiationParams } from "@aztec-labs/aztec.js/contracts"
import { Fr } from "@aztec-labs/aztec.js/fields"
import { SponsoredFPCContractArtifact } from "@aztec-labs/noir-contracts.js/SponsoredFPC"
import type { Page } from "puppeteer"
import { expect, inject } from "vitest"
import type { AztecTestConfig } from "../fixtures/aztec"
import {
	clickByTestId,
	connectPlayground,
	type ExtensionContext,
	openPopup,
	replaceInputValue,
	test,
	waitForHash,
} from "../fixtures/extension"
import { fillSendForm, navigateToSettings, setActiveSendType } from "../fixtures/helpers"
import { assertPgOk, callExpectingNoPopup, setPgTextarea, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveCapabilities, waitForPopup } from "../fixtures/popups"
import { serializeInstance } from "../fixtures/selfpay-phase"
import { openSend, waitForFee } from "../fixtures/send-page"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const UNFUNDED_NAME = "Salt one"

async function waitForVerdict(page: Page, verdict: "funded" | "short", timeout = 90_000): Promise<void> {
	try {
		await page.waitForFunction(
			(want: string) => document.querySelector('[data-testid="fee-settings-card"]')?.getAttribute("data-sponsor-funding") === want,
			{ timeout, polling: 250 },
			verdict,
		)
	} catch (e) {
		const seen = await page.evaluate(
			() => document.querySelector('[data-testid="fee-settings-card"]')?.getAttribute("data-sponsor-funding") ?? null,
		)
		throw new Error(`the fee card never read the sponsor as ${verdict}: data-sponsor-funding is ${seen}`, { cause: e })
	}
}

/** From now on, records whether the short-sponsor notice is ever drawn, so "never" is not one late look. */
async function watchShortNotice(page: Page): Promise<() => Promise<boolean>> {
	await page.evaluate(() => {
		const w = window as unknown as { sawSponsorShort?: boolean }
		const look = () => {
			if (document.querySelector('[data-testid="fee-sponsor-short"]')) w.sawSponsorShort = true
		}
		w.sawSponsorShort = false
		new MutationObserver(look).observe(document.body, { childList: true, subtree: true })
		look()
	})
	return () => page.evaluate(() => (window as unknown as { sawSponsorShort?: boolean }).sawSponsorShort === true)
}

const triggerText = (page: Page) =>
	page.evaluate(() => document.querySelector('[data-testid="send-fee-method-trigger"]')?.textContent?.trim() ?? "")

/** Registers the salt-1 SponsoredFPC through the playground, then adds it in Settings. Returns its row id. */
async function addUnfundedSponsor(ctx: ExtensionContext, address: string, instanceJson: string): Promise<string> {
	const pg = await connectPlayground(ctx)
	await pg.evaluate(() => {
		const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')
		if (!select) throw new Error("no bundle select")
		select.value = "basic"
		select.dispatchEvent(new Event("change", { bubbles: true }))
	})
	const seqGrant = await snapshotResultSeq(pg)
	const capabilities = waitForPopup(ctx, "capabilities", { timeout: 60_000 })
	await clickByTestId(pg, "pg-btn-requestCapabilities")
	await approveCapabilities(await capabilities)
	await waitForPgResult(pg, "requestCapabilities", seqGrant, 30_000)
	await setPgTextarea(pg, "contractInstance", instanceJson)
	const registered = await callExpectingNoPopup(ctx, pg, "registerContract", () => clickByTestId(pg, "pg-btn-registerContract"))
	await assertPgOk(pg, registered, "fee-sponsor-funding:registerContract")
	await pg.close()

	const page = await openPopup(ctx)
	await waitForHash(page, "#/popup/general")
	await navigateToSettings(page, "fpcs")
	await clickByTestId(page, "fpc-new-btn")
	await page.waitForSelector('[data-testid="fpc-address-input"]', { visible: true, timeout: 10_000 })
	await replaceInputValue(page, '[data-testid="fpc-name-input"]', UNFUNDED_NAME)
	await replaceInputValue(page, '[data-testid="fpc-address-input"]', address)
	await page.waitForFunction(() => !document.querySelector<HTMLButtonElement>('[data-testid="new-fpc-submit"]')?.disabled, {
		timeout: 10_000,
	})
	await clickByTestId(page, "new-fpc-submit")
	const id = await page.waitForFunction(
		async (addr: string) => {
			const rows = (await chrome.storage.local.get(null)) as Record<string, unknown>
			for (const [key, raw] of Object.entries(rows)) {
				if (!key.startsWith("nulo:core:fpcs@")) continue
				const row = (typeof raw === "string" ? JSON.parse(raw) : raw) as { id?: string; address?: string }
				if (row?.address?.toLowerCase() === addr.toLowerCase()) return row.id
			}
			return false
		},
		{ timeout: 60_000, polling: 500 },
		address,
	)
	const fpcId = (await id.jsonValue()) as string
	await page.close()
	return fpcId
}

test.skipIf(!hasConfig)(
	"Nulo's funded sponsor: the fee card reads it as funded and never says it can't pay",
	{ timeout: 240_000 },
	async ({ tokenReadyExtension }) => {
		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general")
		await openSend(page)
		await setActiveSendType(page, "send-from-type", "public")
		await setActiveSendType(page, "send-to-type", "public")
		await waitForFee(page, "public", "sponsored")
		expect(await triggerText(page)).toContain("Sponsored")

		const sawShort = await watchShortNotice(page)
		await fillSendForm(page, { amount: "1", destination: tokenReadyExtension.accountAddress })
		await waitForFee(page, "public", "sponsored")
		await waitForVerdict(page, "funded")
		expect(await triggerText(page)).toContain("Sponsored")
		expect(await sawShort()).toBe(false)
		await page.close()
	},
)

test.skipIf(!hasConfig)(
	"an unfunded sponsor picked by hand: read as short, disabled, and Send falls back to Nulo's sponsor",
	{ timeout: 420_000 },
	async ({ tokenReadyExtension }) => {
		const instance = await getContractInstanceFromInstantiationParams(SponsoredFPCContractArtifact, { salt: new Fr(1) })
		const address = instance.address.toString()
		const fpcId = await addUnfundedSponsor(tokenReadyExtension, address, serializeInstance(instance))
		const row = `[data-testid="send-fee-method-sponsored"][data-fpc-id="${fpcId}"]`

		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general")
		await openSend(page)
		await setActiveSendType(page, "send-from-type", "public")
		await setActiveSendType(page, "send-to-type", "public")
		await waitForFee(page, "public", "sponsored")
		const nuloTrigger = await triggerText(page)

		await clickByTestId(page, "send-fee-method-trigger")
		await page.waitForSelector(row, { visible: true, timeout: 10_000 })
		await page.evaluate((s: string) => document.querySelector<HTMLElement>(s)?.click(), row)
		await page.waitForFunction(
			(name: string) => document.querySelector('[data-testid="send-fee-method-trigger"]')?.textContent?.includes(name),
			{ timeout: 10_000, polling: 100 },
			UNFUNDED_NAME,
		)

		await fillSendForm(page, { amount: "1", destination: tokenReadyExtension.accountAddress })
		await waitForFee(page, "public", "sponsored")
		await waitForVerdict(page, "short")

		// The walk goes on as when the sponsor is missing: Nulo's own sponsor, named by the notice.
		await page.waitForFunction(
			(name: string) => !document.querySelector('[data-testid="send-fee-method-trigger"]')?.textContent?.includes(name),
			{ timeout: 30_000, polling: 250 },
			UNFUNDED_NAME,
		)
		expect(await triggerText(page)).toBe(nuloTrigger)
		const notice = await page.$eval('[data-testid="fee-sponsor-short"]', (el) => el.textContent?.trim())
		expect(notice).toBe("The sponsor can't cover this fee right now, so Sponsored pays it.")
		const view = await waitForFee(page, "public", "sponsored")
		expect(view.action).toBe("send")
		await page.waitForFunction(
			() => {
				const submit = document.querySelector<HTMLElement>('[data-testid="send-submit"]')
				return Boolean(submit) && getComputedStyle(submit as HTMLElement).pointerEvents !== "none"
			},
			{ timeout: 120_000, polling: 1_000 },
		)
		await waitForVerdict(page, "short")

		await clickByTestId(page, "send-fee-method-trigger")
		await page.waitForSelector(row, { visible: true, timeout: 10_000 })
		const short = await page.$eval(row, (el) => ({ disabled: el.getAttribute("aria-disabled"), text: el.textContent ?? "" }))
		expect(short.disabled).toBe("true")
		expect(short.text).toContain("can't pay now")
		await page.close()
	},
)
