import { expect, inject } from "vitest"
import type { Page } from "puppeteer"
import { clickByTestId, openPopup, test, type ExtensionContext } from "../fixtures/extension"
import { createAccount } from "../fixtures/helpers"
import { assertPgOk, callExpectingNoPopup, snapshotResultSeq, waitForPgResult } from "../fixtures/playground"
import { approveCapabilities, rejectCapabilities, waitForPopup, waitForPopupClosed } from "../fixtures/popups"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const lower = (s: string) => s.toLowerCase()

type PickerRow = { id: string; granted: boolean; selected: boolean }
type GrantedEntry = { alias: string; item: string }
type SessionRow = {
	accounts: string[]
	accountAliases?: Record<string, string>
	capabilityGrants?: Array<{ capability: { type: string; canCreateAuthWit?: boolean } }>
}

async function readPickerRows(popup: Page): Promise<PickerRow[]> {
	await popup.waitForSelector('[data-testid="cap-account-item"]', { timeout: 60_000 })
	return popup.evaluate(() =>
		[...document.querySelectorAll<HTMLElement>('[data-testid="cap-account-item"]')].map((r) => ({
			id: (r.getAttribute("data-account-id") ?? "").toLowerCase(),
			granted: r.getAttribute("data-granted") === "true",
			selected: r.getAttribute("data-selected") === "true",
		})),
	)
}

/** The one dApp session row the wallet stores for the playground, as persisted (MAC field included). */
async function readSessionRow(popup: Page): Promise<SessionRow> {
	return popup.evaluate(async () => {
		const all = await chrome.storage.local.get(null)
		const rows = Object.entries(all)
			.filter(([key]) => key.startsWith("nulo:core:dappSessions@"))
			.map(([, value]) => (typeof value === "string" ? JSON.parse(value) : value))
		if (rows.length !== 1) throw new Error(`expected one dApp session row, found ${rows.length}`)
		return rows[0] as SessionRow
	})
}

async function requestAccountsAgain(ctx: ExtensionContext, page: Page): Promise<{ popup: Page; seq: number }> {
	const seq = await snapshotResultSeq(page)
	const popupP = waitForPopup(ctx, "capabilities", { timeout: 60_000 })
	await clickByTestId(page, "pg-btn-requestCapabilities")
	return { popup: await popupP, seq }
}

async function grantedAccounts(ctx: ExtensionContext, page: Page, label: string): Promise<GrantedEntry[]> {
	const result = await callExpectingNoPopup(ctx, page, "getAccounts", () => clickByTestId(page, "pg-btn-getAccounts"))
	await assertPgOk(page, result, label)
	return (result.resultJson as GrantedEntry[]).map((e) => ({ alias: e.alias, item: lower(e.item) }))
}

async function addWalletAccount(ctx: ExtensionContext, name: string): Promise<void> {
	const setupPage = await openPopup(ctx)
	await createAccount(setupPage, name)
	await setupPage.close()
}

/**
 * A session granted ONE account is widened to a second one on a repeat `accounts` request: the
 * popup lists both, the held row is locked and pre-selected, approving adds only the new one and
 * keeps the first's alias; a later decline (a third account exists) keeps the grant, its flags and
 * both aliases exactly as they were.
 */
test.skipIf(!hasConfig)(
	"cap-widening — a repeat accounts request adds a new wallet account to the session; a decline keeps the grant",
	{ timeout: 240_000 },
	async ({ dappConnectedExtension }) => {
		const ctx = dappConnectedExtension
		const page = ctx.playgroundPage

		// The first grant names the account with a per-dApp alias that is NOT the wallet's default
		// name, so a widening that rewrote it with the picker's default would be caught.
		await page.evaluate(() => {
			const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')!
			select.value = "accounts"
			select.dispatchEvent(new Event("change", { bubbles: true }))
		})
		const initialGrant = await requestAccountsAgain(ctx, page)
		const firstRows = await readPickerRows(initialGrant.popup)
		const first = firstRows[0]?.id
		if (!first) throw new Error("capabilities popup returned no accounts")
		const aliasA = "dapp-alias-A"
		await approveCapabilities(initialGrant.popup, { accounts: [first], aliases: { [first]: aliasA } })
		await assertPgOk(page, await waitForPgResult(page, "requestCapabilities", initialGrant.seq, 30_000), "cap-widening:grant")
		const a = lower(first)
		const initial = await grantedAccounts(ctx, page, "cap-widening:initial")
		expect(initial).toEqual([{ alias: aliasA, item: a }])

		await addWalletAccount(ctx, "Second")

		const widen = await requestAccountsAgain(ctx, page)
		const rows = await readPickerRows(widen.popup)
		expect(rows).toHaveLength(2)
		const held = rows.find((r) => r.id === a)
		const fresh = rows.find((r) => r.id !== a)
		expect(held).toEqual({ id: a, granted: true, selected: true })
		expect(fresh?.granted).toBe(false)
		expect(fresh?.selected).toBe(false)
		// A locked row ignores the click: still selected afterwards.
		await widen.popup.evaluate((id: string) => {
			document.querySelector<HTMLElement>(`[data-testid="cap-account-item"][data-account-id="${id}"]`)?.click()
		}, first)
		expect((await readPickerRows(widen.popup)).find((r) => r.id === a)?.selected).toBe(true)

		await approveCapabilities(widen.popup, { accounts: [fresh!.id] })
		const widened = await waitForPgResult(page, "requestCapabilities", widen.seq, 30_000)
		await assertPgOk(page, widened, "cap-widening:approve")

		const afterWiden = await grantedAccounts(ctx, page, "cap-widening:after-approve")
		expect(afterWiden.map((e) => e.item).sort()).toEqual([a, fresh!.id].sort())
		expect(afterWiden.find((e) => e.item === a)?.alias).toBe(aliasA)

		await addWalletAccount(ctx, "Third")

		const decline = await requestAccountsAgain(ctx, page)
		const rowsOnDecline = await readPickerRows(decline.popup)
		expect(
			rowsOnDecline
				.filter((r) => r.granted)
				.map((r) => r.id)
				.sort(),
		).toEqual([a, fresh!.id].sort())
		expect(rowsOnDecline.filter((r) => !r.granted)).toHaveLength(1)
		await rejectCapabilities(decline.popup)
		const declined = await waitForPgResult(page, "requestCapabilities", decline.seq, 30_000)
		expect(declined.status).toBe("error")
		await waitForPopupClosed(decline.popup)

		const afterDecline = await grantedAccounts(ctx, page, "cap-widening:after-decline")
		expect(afterDecline).toEqual(afterWiden)

		const inspector = await openPopup(ctx)
		const session = await readSessionRow(inspector)
		await inspector.close()
		expect(session.accounts.map((caip) => lower(caip.slice(caip.lastIndexOf(":") + 1))).sort()).toEqual([a, fresh!.id].sort())
		const accountsGrant = session.capabilityGrants?.find((g) => g.capability.type === "accounts")?.capability
		expect(accountsGrant?.canCreateAuthWit).toBe(true)
		const aliasOfA = Object.entries(session.accountAliases ?? {}).find(([caip]) => lower(caip).endsWith(a))?.[1]
		expect(aliasOfA).toBe(aliasA)
	},
)
