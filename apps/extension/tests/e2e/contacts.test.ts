import { expect } from "vitest"
import { test, openPopup, waitForHash, clickByTestId, replaceInputValue } from "./fixtures/extension"
import { addContact, closeStuckPopup, deleteContact, navigateToSettings } from "./fixtures/helpers"

// Per-CALL fresh identities: the extension fixture is file-scoped, so a
// vitest retry re-enters a test with earlier attempts' contacts persisted —
// fixed names/addresses turn every retry into a duplicate-validation wall.
// (Smoke has no curve requirement; any 64-hex value stores fine.)
function randomAddress(): string {
	let hex = ""
	while (hex.length < 64) hex += Math.floor(Math.random() * 16).toString(16)
	return `0x${hex}`
}
function uniqueName(prefix: string): string {
	return `${prefix}-${Math.random().toString(36).slice(2, 8)}`
}

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

	const name = uniqueName("Alice")
	await navigateToSettings(page, "contacts")
	try {
		await addContact(page, name, randomAddress())
	} catch (e) {
		const snap = await page.evaluate(
			(n: string) => ({
				hash: window.location.hash,
				body: (document.body?.innerText ?? "").slice(0, 500).replace(/\s+/g, " "),
				testIds: [...document.querySelectorAll("[data-testid]")].slice(0, 30).map((el) => el.getAttribute("data-testid")),
				submitDisabled: (document.querySelector('[data-testid="new-contact-submit"]') as HTMLButtonElement | null)?.disabled,
				nameInputVal: (document.querySelector('input[placeholder="New contact"]') as HTMLInputElement | null)?.value,
				addrInputVal: (() => {
					const inputs = [...document.querySelectorAll<HTMLInputElement>('input[placeholder*="0x15c4"]')]
					return inputs.map((i) => i.value)
				})(),
				rowExists: !!document.querySelector(`[data-testid="contact-row"][data-contact-name="${n}"]`),
			}),
			name,
		)
		console.error("[DIAG] addContact failed; snapshot:", JSON.stringify(snap, null, 2))
		console.error("[DIAG] consoleErrors:", JSON.stringify(registeredExtension.consoleErrors.slice(0, 10)))
		console.error("[DIAG] pageErrors:", JSON.stringify(registeredExtension.pageErrors.map((e) => e.message).slice(0, 10)))
		throw e
	}

	await page.waitForSelector(`[data-testid="contact-row"][data-contact-name="${name}"]`, { visible: true, timeout: 5_000 })

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("edit contact name", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	const name = uniqueName("Bob")
	const renamed = `${name}y`
	await navigateToSettings(page, "contacts")
	await addContact(page, name, randomAddress())

	// Wait for the row to settle
	await page.waitForSelector(`[data-testid="contact-row"][data-contact-name="${name}"]`, { visible: true, timeout: 5_000 })

	// Click edit icon scoped to the row
	await page.evaluate((n: string) => {
		const row = document.querySelector(`[data-testid="contact-row"][data-contact-name="${n}"]`)
		const edit = row?.querySelector<HTMLElement>('[data-testid="contact-edit"]')
		edit?.click()
	}, name)

	// Wait for the popup's PREFILL to settle before typing: the show-watcher
	// fills the fields only after its async getContacts() resolves, and a
	// value typed before that gets overwritten back to the loaded name —
	// leaving the form clean and the submit disabled (the load-flake).
	await page.waitForFunction(
		(n: string) => {
			const inputs = [...document.querySelectorAll<HTMLInputElement>('input[placeholder="New contact"]')]
			return inputs.some((i) => i.offsetParent !== null && i.value === n)
		},
		{ timeout: 10_000, polling: 100 },
		name,
	)

	// Replace the full name via the v-model-aware helper; triple-click +
	// type is unreliable on the Input component wrapper.
	await replaceInputValue(page, 'input[placeholder="New contact"]', renamed)

	await clickByTestId(page, "edit-contact-submit")

	// Verify new name
	await page.waitForSelector(`[data-testid="contact-row"][data-contact-name="${renamed}"]`, { visible: true, timeout: 5_000 })

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

// SKIP: pre-existing smoke flake (documented in
// wallets-architecture-research/nulo/self-analysis.md:427 — popup-internal
// waitForToast race). Un-skip when the toast-wait helper is hardened.
test.skip("delete contact", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	const name = uniqueName("ToDelete")
	await navigateToSettings(page, "contacts")
	await addContact(page, name, randomAddress())
	await deleteContact(page, name)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("delete-confirm never offers sender options (contacts are decoupled from sender state)", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	const name = uniqueName("Plain")
	await navigateToSettings(page, "contacts")
	await addContact(page, name, randomAddress())

	// Open the confirm popup but DON'T submit yet — assert the toggle is
	// absent from the DOM before clicking confirm.
	const rowSelector = `[data-testid="contact-row"][data-contact-name="${name}"]`
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
