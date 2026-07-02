/**
 * Network-suite coverage for the sender-aware delete-confirm path.
 * Requires a running local Aztec node so the address can actually be
 * registered as a sender via PXE.
 */
import { expect, inject, beforeAll } from "vitest"
import { test, openPopup, waitForHash, clickByTestId, replaceInputValue } from "../fixtures/extension"
import { addContact, closeStuckPopup, navigateToSettings, waitForToast } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

// PXE's `registerSender` validates that the address is a point on the Grumpkin
// curve (only ~50% of random x-coordinates qualify). Hand-rolled hex constants
// don't track upstream curve-membership / encoding changes in @aztec/aztec.js,
// so we generate fresh valid addresses per-run via `AztecAddress.random()`.
// The values are stable for the duration of one vitest file (beforeAll once)
// so individual tests still operate on consistent identities across their
// internal steps.
let ADDR_SENDER = ""
let ADDR_PERSIST = ""
let ADDR_MIGRATE_OLD = ""
let ADDR_MIGRATE_NEW = ""
let ADDR_DROP_OLD = ""
let ADDR_DROP_NEW = ""

beforeAll(async () => {
	if (!hasConfig) return
	const { AztecAddress } = await import("@aztec/aztec.js/addresses")
	const generated = await Promise.all(Array.from({ length: 6 }, () => AztecAddress.random()))
	;[ADDR_SENDER, ADDR_PERSIST, ADDR_MIGRATE_OLD, ADDR_MIGRATE_NEW, ADDR_DROP_OLD, ADDR_DROP_NEW] = generated.map((a) => a.toString())
})

test.skipIf(!hasConfig)(
	"delete-confirm exposes unregister-sender toggle for a registered-sender contact and unregisters on submit",
	{
		timeout: 60_000,
	},
	async ({ localNetworkExtension }) => {
		const page = await openPopup(localNetworkExtension)
		await waitForHash(page, "#/popup/general")

		await navigateToSettings(page, "contacts")
		await addContact(page, "SenderContact", ADDR_SENDER, { registerAsSender: true })

		// The sender chip on the row indicates active-network sender registration succeeded.
		await page.waitForSelector('[data-testid="contact-row"][data-contact-name="SenderContact"] [data-testid="contact-sender-chip"]', {
			visible: true,
			timeout: 10_000,
		})

		// Open the delete-confirm
		const rowSelector = '[data-testid="contact-row"][data-contact-name="SenderContact"]'
		await page.waitForSelector(rowSelector, { visible: true, timeout: 5_000 })
		await page.evaluate((sel: string) => {
			const row = document.querySelector<HTMLElement>(sel)
			row?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
			row?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }))
			row?.querySelector<HTMLElement>('[data-testid="contact-delete"]')?.click()
		}, rowSelector)
		await page.waitForSelector('[data-testid="confirm-submit"]', { visible: true, timeout: 5_000 })

		// The toggle is present, defaulted ON.
		await page.waitForSelector('[data-testid="confirm-toggle"]', { visible: true, timeout: 5_000 })
		const initialState = await page.evaluate(() =>
			document.querySelector('[data-testid="confirm-toggle"]')?.getAttribute("data-toggle-active"),
		)
		expect(initialState).toBe("true")

		// Submit with toggle ON — both contact and sender are removed.
		await clickByTestId(page, "confirm-submit")
		await page.waitForFunction((sel: string) => !document.querySelector(sel), { timeout: 30_000 }, rowSelector)
		// "Contact deleted" only fires after BOTH deleteContact AND deleteSender
		// resolve in the confirm callback (pages/settings/contacts/index.vue).
		// Without this wait, the next addContact races the in-flight deleteSender
		// RPC and the popup's senderAddresses set never gets the onSenderDeleted
		// event, so the chip lingers on the re-added contact.
		await waitForToast(page, "Contact deleted", 30_000)

		// Re-add the same address WITHOUT toggling sender on. If the previous
		// sender registration had stayed orphan in PXE, the new row would
		// render the sender chip on first load (active-network sender set
		// includes this address). With the cleanup wired up, the chip must be
		// ABSENT on the freshly-added contact.
		await addContact(page, "ReAdded", ADDR_SENDER, { registerAsSender: false })
		await page.waitForSelector('[data-testid="contact-row"][data-contact-name="ReAdded"]', {
			visible: true,
			timeout: 10_000,
		})
		const senderChipPresent = await page.evaluate(
			() => !!document.querySelector('[data-testid="contact-row"][data-contact-name="ReAdded"] [data-testid="contact-sender-chip"]'),
		)
		expect(senderChipPresent).toBe(false)
	},
)

test.skipIf(!hasConfig)(
	"delete sender contact with toggle OFF leaves the sender registered",
	{ timeout: 60_000 },
	async ({ localNetworkExtension }) => {
		const page = await openPopup(localNetworkExtension)
		await waitForHash(page, "#/popup/general")

		await navigateToSettings(page, "contacts")
		await addContact(page, "Persistent", ADDR_PERSIST, { registerAsSender: true })

		await page.waitForSelector('[data-testid="contact-row"][data-contact-name="Persistent"] [data-testid="contact-sender-chip"]', {
			visible: true,
			timeout: 10_000,
		})

		// Open delete-confirm
		const rowSelector = '[data-testid="contact-row"][data-contact-name="Persistent"]'
		await page.waitForSelector(rowSelector, { visible: true, timeout: 5_000 })
		await page.evaluate((sel: string) => {
			const row = document.querySelector<HTMLElement>(sel)
			row?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }))
			row?.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }))
			row?.querySelector<HTMLElement>('[data-testid="contact-delete"]')?.click()
		}, rowSelector)
		await page.waitForSelector('[data-testid="confirm-toggle"]', { visible: true, timeout: 5_000 })

		// Flip the toggle OFF — assert the data attribute reflects the flip.
		await page.evaluate(() => {
			document.querySelector<HTMLElement>('[data-testid="confirm-toggle"]')?.click()
		})
		const stateAfterFlip = await page.evaluate(() =>
			document.querySelector('[data-testid="confirm-toggle"]')?.getAttribute("data-toggle-active"),
		)
		expect(stateAfterFlip).toBe("false")

		await clickByTestId(page, "confirm-submit")
		await page.waitForFunction((sel: string) => !document.querySelector(sel), { timeout: 30_000 }, rowSelector)
		await waitForToast(page, "Contact deleted", 30_000)

		// Re-add the same address WITHOUT requesting sender. If the OFF branch
		// honored the user's choice, the sender registration is still in PXE,
		// so the new contact's row reflects it via the sender chip.
		await addContact(page, "ReAddedPersist", ADDR_PERSIST, { registerAsSender: false })
		await page.waitForSelector('[data-testid="contact-row"][data-contact-name="ReAddedPersist"] [data-testid="contact-sender-chip"]', {
			visible: true,
			timeout: 10_000,
		})
	},
)

test.skipIf(!hasConfig)(
	"edit contact address with sender ON migrates the sender registration",
	{ timeout: 60_000 },
	async ({ localNetworkExtension }) => {
		const page = await openPopup(localNetworkExtension)
		await waitForHash(page, "#/popup/general")

		await navigateToSettings(page, "contacts")
		await addContact(page, "Migrate", ADDR_MIGRATE_OLD, { registerAsSender: true })

		await page.waitForSelector('[data-testid="contact-row"][data-contact-name="Migrate"] [data-testid="contact-sender-chip"]', {
			visible: true,
			timeout: 10_000,
		})

		// Open the edit popup, change the address (NOT the toggle).
		await page.evaluate(() => {
			const row = document.querySelector('[data-testid="contact-row"][data-contact-name="Migrate"]')
			row?.querySelector<HTMLElement>('[data-testid="contact-edit"]')?.click()
		})
		await page.waitForSelector('[data-testid="edit-contact-submit"]', { visible: true, timeout: 5_000 })

		await replaceInputValue(page, 'input[placeholder*="0x15c4"]', ADDR_MIGRATE_NEW)

		// Submit is gated on isLoadingSenderState while loadSenderState() awaits
		// getSenders() (PXE init + read — transport-bounded but can run >10s under CI
		// load right after a sender registration). Wait for the toggle to settle:
		// data-toggle-disabled=false (loaded) AND data-toggle-active=true (proves the
		// sender-ON scenario, not a load that defaulted false) before clicking, or
		// clickByTestId races the still-disabled submit. Mirrors the readiness wait below.
		await page.waitForFunction(
			() => {
				const el = document.querySelector('[data-testid="edit-contact-sender-toggle"]')
				return el?.getAttribute("data-toggle-disabled") === "false" && el?.getAttribute("data-toggle-active") === "true"
			},
			{ timeout: 30_000, polling: 100 },
		)

		await clickByTestId(page, "edit-contact-submit")

		// Wait for the submit's post-mutation toast — this only fires after
		// applySenderDelta resolves (whether successfully or with the
		// "migration incomplete" warning). Without this wait, closeStuckPopup
		// races the in-flight add+delete sender pair and the senderAddresses
		// set in the contacts page sees neither end of the migration.
		await page.waitForFunction(
			() => {
				const text = document.body.textContent ?? ""
				return (
					text.includes("Contact is updated") ||
					text.includes("Sender updated") ||
					text.includes("migration incomplete") ||
					text.includes("sender update failed")
				)
			},
			{ timeout: 30_000, polling: 200 },
		)

		// Vue Transition stuck mid-leave under headless rAF — force-close.
		await closeStuckPopup(page)

		// The contact row keeps the same name "Migrate"; the sender chip should
		// still be present (sender registered to the NEW address).
		await page.waitForSelector('[data-testid="contact-row"][data-contact-name="Migrate"] [data-testid="contact-sender-chip"]', {
			visible: true,
			timeout: 10_000,
		})

		// Re-add OLD address as a fresh contact with sender OFF. If the
		// migration was correct, OLD's sender registration was unregistered,
		// so the new row has no chip.
		await addContact(page, "OldAddrCheck", ADDR_MIGRATE_OLD, { registerAsSender: false })
		await page.waitForSelector('[data-testid="contact-row"][data-contact-name="OldAddrCheck"]', {
			visible: true,
			timeout: 10_000,
		})
		const oldChipPresent = await page.evaluate(
			() =>
				!!document.querySelector(
					'[data-testid="contact-row"][data-contact-name="OldAddrCheck"] [data-testid="contact-sender-chip"]',
				),
		)
		expect(oldChipPresent).toBe(false)
	},
)

test.skipIf(!hasConfig)(
	"edit contact address + flip sender OFF drops both old and new from sender list",
	{ timeout: 60_000 },
	async ({ localNetworkExtension }) => {
		const page = await openPopup(localNetworkExtension)
		await waitForHash(page, "#/popup/general")

		await navigateToSettings(page, "contacts")
		await addContact(page, "DropBoth", ADDR_DROP_OLD, { registerAsSender: true })

		await page.waitForSelector('[data-testid="contact-row"][data-contact-name="DropBoth"] [data-testid="contact-sender-chip"]', {
			visible: true,
			timeout: 10_000,
		})

		// Open edit, change address AND flip sender toggle OFF
		await page.evaluate(() => {
			const row = document.querySelector('[data-testid="contact-row"][data-contact-name="DropBoth"]')
			row?.querySelector<HTMLElement>('[data-testid="contact-edit"]')?.click()
		})
		await page.waitForSelector('[data-testid="edit-contact-submit"]', { visible: true, timeout: 5_000 })

		await replaceInputValue(page, 'input[placeholder*="0x15c4"]', ADDR_DROP_NEW)

		// Wait until the toggle is clickable (popup's loadSenderState awaits
		// PXE getSenders to seed desiredIsSender — clicking before that
		// resolves either no-ops while disabled or gets immediately overwritten
		// by the post-load `desiredIsSender = registered` assignment).
		await page.waitForFunction(
			() => {
				const el = document.querySelector('[data-testid="edit-contact-sender-toggle"]')
				return el?.getAttribute("data-toggle-disabled") === "false" && el?.getAttribute("data-toggle-active") === "true"
			},
			{ timeout: 10_000, polling: 100 },
		)
		await clickByTestId(page, "edit-contact-sender-toggle")
		// Verify the click actually flipped the toggle. If the click was a
		// no-op (disabled state slipped through), this surfaces it as a
		// timeout instead of a silent application of the wrong branch in
		// applySenderDelta.
		await page.waitForFunction(
			() => document.querySelector('[data-testid="edit-contact-sender-toggle"]')?.getAttribute("data-toggle-active") === "false",
			{ timeout: 5_000, polling: 100 },
		)
		await clickByTestId(page, "edit-contact-submit")

		// Same toast-wait pattern as test 3 — see rationale there.
		await page.waitForFunction(
			() => {
				const text = document.body.textContent ?? ""
				return (
					text.includes("Contact is updated") ||
					text.includes("Sender updated") ||
					text.includes("migration incomplete") ||
					text.includes("sender update failed")
				)
			},
			{ timeout: 30_000, polling: 200 },
		)

		// Vue Transition stuck mid-leave under headless rAF — force-close.
		await closeStuckPopup(page)

		// The edited row must NO LONGER show the sender chip on the new address.
		await page.waitForFunction(
			() => !document.querySelector('[data-testid="contact-row"][data-contact-name="DropBoth"] [data-testid="contact-sender-chip"]'),
			{ timeout: 10_000 },
		)

		// Re-add OLD address as a fresh contact with sender OFF. The OLD
		// address's sender registration was unregistered as part of the
		// migration step in applySenderDelta — no chip on the new row.
		await addContact(page, "DropOldCheck", ADDR_DROP_OLD, { registerAsSender: false })
		const oldChipPresent = await page.evaluate(
			() =>
				!!document.querySelector(
					'[data-testid="contact-row"][data-contact-name="DropOldCheck"] [data-testid="contact-sender-chip"]',
				),
		)
		expect(oldChipPresent).toBe(false)
	},
)
