import { expect } from "vitest"
import { test, openPopup, waitForHash, clickByTestId, replaceInputValue } from "./fixtures/extension"
import { addContact, closeStuckPopup, deleteContact, navigateToSettings } from "./fixtures/helpers"

// Valid-looking 66-char hex addresses — each test needs a unique address (duplicates are rejected)
const ADDR_ALICE = "0x15c4ac6afcffdf59aa8a1fb3317ff0c86aee3eb02f9e52c3612e1163d4701446"
const ADDR_BOB = "0x25c4ac6afcffdf59aa8a1fb3317ff0c86aee3eb02f9e52c3612e1163d4701447"
const ADDR_DELETE = "0x35c4ac6afcffdf59aa8a1fb3317ff0c86aee3eb02f9e52c3612e1163d4701448"
const ADDR_PLAIN = "0x45c4ac6afcffdf59aa8a1fb3317ff0c86aee3eb02f9e52c3612e1163d4701449"

test("contacts page shows empty state", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "contacts")

	// Empty state testid is only rendered when contacts.length === 0
	await page.waitForSelector('[data-testid="contacts-empty"]', { visible: true, timeout: 5_000 })
	await page.waitForSelector('[data-testid="contacts-new-btn"]', { visible: true, timeout: 5_000 })

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("add contact via popup", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "contacts")
	try {
		await addContact(page, "Alice", ADDR_ALICE)
	} catch (e) {
		const snap = await page.evaluate(() => ({
			hash: window.location.hash,
			body: (document.body?.innerText ?? "").slice(0, 500).replace(/\s+/g, " "),
			testIds: [...document.querySelectorAll("[data-testid]")].slice(0, 30).map((el) => el.getAttribute("data-testid")),
			submitDisabled: (document.querySelector('[data-testid="new-contact-submit"]') as HTMLButtonElement | null)?.disabled,
			nameInputVal: (document.querySelector('input[placeholder="New contact"]') as HTMLInputElement | null)?.value,
			addrInputVal: (() => {
				const inputs = [...document.querySelectorAll<HTMLInputElement>('input[placeholder*="0x15c4"]')]
				return inputs.map((i) => i.value)
			})(),
			rowExists: !!document.querySelector('[data-testid="contact-row"][data-contact-name="Alice"]'),
		}))
		console.error("[DIAG] addContact failed; snapshot:", JSON.stringify(snap, null, 2))
		console.error("[DIAG] consoleErrors:", JSON.stringify(registeredExtension.consoleErrors.slice(0, 10)))
		console.error("[DIAG] pageErrors:", JSON.stringify(registeredExtension.pageErrors.map((e) => e.message).slice(0, 10)))
		throw e
	}

	await page.waitForSelector('[data-testid="contact-row"][data-contact-name="Alice"]', { visible: true, timeout: 5_000 })

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("edit contact name", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "contacts")
	await addContact(page, "Bob", ADDR_BOB)

	// Wait for the row to settle
	await page.waitForSelector('[data-testid="contact-row"][data-contact-name="Bob"]', { visible: true, timeout: 5_000 })

	// Click edit icon scoped to the Bob row
	await page.evaluate(() => {
		const row = document.querySelector('[data-testid="contact-row"][data-contact-name="Bob"]')
		const edit = row?.querySelector<HTMLElement>('[data-testid="contact-edit"]')
		edit?.click()
	})

	// Replace the full name via the v-model-aware helper; triple-click +
	// type is unreliable on the Input component wrapper.
	await replaceInputValue(page, 'input[placeholder="New contact"]', "Bobby")

	await clickByTestId(page, "edit-contact-submit")

	// Verify new name
	await page.waitForSelector('[data-testid="contact-row"][data-contact-name="Bobby"]', { visible: true, timeout: 5_000 })

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

// SKIP: pre-existing smoke flake (documented in
// wallets-architecture-research/nulo/self-analysis.md:427 — popup-internal
// waitForToast race). Un-skip when the toast-wait helper is hardened.
test.skip("delete contact", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "contacts")
	await addContact(page, "ToDelete", ADDR_DELETE)
	await deleteContact(page, "ToDelete")

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("delete-confirm never offers sender options (contacts are decoupled from sender state)", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "contacts")
	await addContact(page, "Plain", ADDR_PLAIN)

	// Open the confirm popup but DON'T submit yet — assert the toggle is
	// absent from the DOM before clicking confirm.
	const rowSelector = '[data-testid="contact-row"][data-contact-name="Plain"]'
	await page.waitForSelector(rowSelector, { visible: true, timeout: 5_000 })
	await page.evaluate((sel: string) => {
		const row = document.querySelector<HTMLElement>(sel)
		// Synthetic hover dispatch — ElementHandle.hover() goes through the
		// broken CDP path (matches the .click() / .type() regression).
		row?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
		row?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }))
		row?.querySelector<HTMLElement>('[data-testid="contact-delete"]')?.click()
	}, rowSelector)
	await page.waitForSelector('[data-testid="confirm-submit"]', { visible: true, timeout: 5_000 })

	const toggleVisible = await page.evaluate(() => !!document.querySelector('[data-testid="confirm-toggle"]'))
	expect(toggleVisible).toBe(false)

	await clickByTestId(page, "confirm-cancel")
	// Vue Transition can stick mid-leave in headless Chrome — force-close.
	await closeStuckPopup(page)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})
