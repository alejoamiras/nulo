/**
 * Network-suite coverage for the Advanced senders surface (Settings →
 * Advanced → Account State → Senders) — the ONE place sender registrations
 * are managed now that contacts are decoupled — plus the decoupling pins:
 * adding a contact registers nothing, deleting a contact unregisters
 * nothing, and the contact-row chip is a read-only view of PXE truth.
 * Requires a running local Aztec node (PXE-backed registerSender).
 *
 * Identities are generated PER TEST BODY (not beforeAll): the extension
 * fixture is file-scoped and vitest retries re-enter the test with prior
 * attempts' contacts/senders still present — file-scoped constants turn
 * every retry into a duplicate-validation wall.
 */
import { expect, inject } from "vitest"
import { test, openPopup, waitForHash, clickByTestId, replaceInputValue } from "../fixtures/extension"
import { addContact, closeStuckPopup, navigateByHash, navigateToSettings, waitForToast } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

const SENDERS_HASH = "#/popup/settings/advanced/account-state/senders"
const CONTACTS_HASH = "#/popup/settings/contacts"

/** Valid (on-curve) random address + a name tied to it, fresh per call. */
async function freshIdentity(prefix: string): Promise<{ name: string; address: string }> {
	const { AztecAddress } = await import("@aztec/aztec.js/addresses")
	const address = (await AztecAddress.random()).toString()
	return { name: `${prefix}${address.slice(4, 10)}`, address }
}

/** Hash hops between sub-pages (they render a SubPageHeader, no bottom nav —
 *  navigateToSettings would hang waiting for the nav bar). */
async function gotoSenders(page: Awaited<ReturnType<typeof openPopup>>) {
	await navigateByHash(page, SENDERS_HASH)
	await page.waitForSelector('[data-testid="senders-add-btn"]', { visible: true, timeout: 10_000 })
}
async function gotoContacts(page: Awaited<ReturnType<typeof openPopup>>) {
	await navigateByHash(page, CONTACTS_HASH)
	await page.waitForSelector('[data-testid="contacts-new-btn"]', { visible: true, timeout: 10_000 })
}

async function addSenderViaAdvanced(page: Awaited<ReturnType<typeof openPopup>>, address: string) {
	await clickByTestId(page, "senders-add-btn")
	await page.waitForSelector('[data-testid="new-sender-submit"]', { visible: true, timeout: 5_000 })
	await replaceInputValue(page, 'input[placeholder*="0x1744"]', address)
	await clickByTestId(page, "new-sender-submit")
	// The row renders from the onSenderAdded event only after the PXE
	// registration resolves — this is the deterministic post-mutation signal.
	await page.waitForSelector(`[data-testid="sender-row"][data-sender-address="${address}"]`, {
		visible: true,
		timeout: 30_000,
	})
	await closeStuckPopup(page)
}

test.skipIf(!hasConfig)(
	"adding a contact registers NO sender; Advanced registration lights the read-only chip",
	{ timeout: 120_000 },
	async ({ localNetworkExtension }) => {
		const { name, address } = await freshIdentity("Chip")
		const page = await openPopup(localNetworkExtension)
		await waitForHash(page, "#/popup/general")

		// A freshly-added contact must NOT be registered as a sender.
		await navigateToSettings(page, "contacts")
		await addContact(page, name, address)
		const chipBefore = await page.evaluate(
			(n: string) =>
				!!document.querySelector(`[data-testid="contact-row"][data-contact-name="${n}"] [data-testid="contact-sender-chip"]`),
			name,
		)
		expect(chipBefore).toBe(false)

		// Register the SAME address through the Advanced surface.
		// (Hash hop: sub-pages have no bottom nav for navigateToSettings.)
		await gotoSenders(page)
		await addSenderViaAdvanced(page, address)

		// Back on contacts, the chip reflects the PXE registration.
		await gotoContacts(page)
		await page.waitForSelector(`[data-testid="contact-row"][data-contact-name="${name}"] [data-testid="contact-sender-chip"]`, {
			visible: true,
			timeout: 10_000,
		})

		// Delete the sender from Advanced — the chip clears; the contact stays.
		await gotoSenders(page)
		const rowSelector = `[data-testid="sender-row"][data-sender-address="${address}"]`
		await page.waitForSelector(rowSelector, { visible: true, timeout: 10_000 })
		await page.evaluate((sel: string) => {
			// The delete affordance is an <Icon> (SVG) — SVGElement has no
			// .click(); dispatch a bubbling MouseEvent instead.
			document
				.querySelector(`${sel} [data-testid="sender-delete"]`)
				?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }))
		}, rowSelector)
		await page.waitForSelector('[data-testid="confirm-submit"]', { visible: true, timeout: 5_000 })
		await clickByTestId(page, "confirm-submit")
		await waitForToast(page, "Sender successfully deleted", 30_000)
		await page.waitForFunction((sel: string) => !document.querySelector(sel), { timeout: 10_000 }, rowSelector)
		await closeStuckPopup(page)

		await gotoContacts(page)
		await page.waitForSelector(`[data-testid="contact-row"][data-contact-name="${name}"]`, {
			visible: true,
			timeout: 10_000,
		})
		await page.waitForFunction(
			(n: string) =>
				!document.querySelector(`[data-testid="contact-row"][data-contact-name="${n}"] [data-testid="contact-sender-chip"]`),
			{ timeout: 10_000 },
			name,
		)
	},
)

test.skipIf(!hasConfig)(
	"deleting a contact never unregisters its sender (decoupling pin)",
	{ timeout: 120_000 },
	async ({ localNetworkExtension }) => {
		const { name, address } = await freshIdentity("Keep")
		const page = await openPopup(localNetworkExtension)
		await waitForHash(page, "#/popup/general")

		// Register a sender via Advanced, then add a contact with that address.
		await navigateToSettings(page, "advanced", "account-state", "senders")
		await page.waitForSelector('[data-testid="senders-add-btn"]', { visible: true, timeout: 10_000 })
		await addSenderViaAdvanced(page, address)

		await gotoContacts(page)
		await addContact(page, name, address)
		await page.waitForSelector(`[data-testid="contact-row"][data-contact-name="${name}"] [data-testid="contact-sender-chip"]`, {
			visible: true,
			timeout: 10_000,
		})

		// Delete the contact. The confirm offers NO sender option.
		const rowSelector = `[data-testid="contact-row"][data-contact-name="${name}"]`
		await page.evaluate((sel: string) => {
			const row = document.querySelector<HTMLElement>(sel)
			row?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
			row?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }))
			row?.querySelector<HTMLElement>('[data-testid="contact-delete"]')?.click()
		}, rowSelector)
		await page.waitForSelector('[data-testid="confirm-submit"]', { visible: true, timeout: 5_000 })
		const toggleVisible = await page.evaluate(() => !!document.querySelector('[data-testid="confirm-toggle"]'))
		expect(toggleVisible).toBe(false)

		await clickByTestId(page, "confirm-submit")
		await waitForToast(page, "Contact deleted", 30_000)
		await page.waitForFunction((sel: string) => !document.querySelector(sel), { timeout: 10_000 }, rowSelector)
		await closeStuckPopup(page)

		// The sender registration survives the contact deletion.
		await gotoSenders(page)
		await page.waitForSelector(`[data-testid="sender-row"][data-sender-address="${address}"]`, {
			visible: true,
			timeout: 10_000,
		})
	},
)
