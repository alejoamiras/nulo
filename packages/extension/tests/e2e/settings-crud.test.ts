import { expect } from "vitest"
import { test, openPopup, waitForHash, clickByTestId, replaceInputValue } from "./fixtures/extension"
import { deleteNetworkRow, navigateToSettings } from "./fixtures/helpers"

// Scope note: `addNetwork` probes RPC, `addFpc` probes PXE, `addToken`
// fetches metadata — all require a live Aztec node. Persistence-style
// CRUD (add → reopen → delete) lives in the network suite. Here we
// cover what's reachable on a non-network harness: form validation,
// popup UX, and `deleteNetwork` (storage-only, no probing).

test("networks page lists the default networks", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "networks")
	await page.waitForSelector('[data-testid="network-row"]', { visible: true, timeout: 5_000 })

	const rows = await page.$$('[data-testid="network-row"]')
	expect(rows.length).toBeGreaterThanOrEqual(2)
	// Each row has both id and name attributes (the selector contract)
	for (const row of rows) {
		const id = await row.evaluate((el) => el.getAttribute("data-network-id"))
		const name = await row.evaluate((el) => el.getAttribute("data-network-name"))
		expect(id).toBeTruthy()
		expect(name).toBeTruthy()
	}

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("NewNetworkPopup keeps submit disabled with empty name", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "networks")
	await clickByTestId(page, "network-new-btn")
	await page.waitForSelector('[data-testid="new-network-submit"]', { visible: true, timeout: 5_000 })

	// Default RPC is prefilled, but name is empty → submit disabled
	const disabledBeforeName = await page.evaluate(() => {
		const btn = document.querySelector('[data-testid="new-network-submit"]') as HTMLButtonElement | null
		return btn?.disabled ?? null
	})
	expect(disabledBeforeName).toBe(true)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("NewNetworkPopup flags a duplicate name", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "networks")

	// Read the first existing network's name from the row contract
	const existingName = await page.evaluate(() => {
		const row = document.querySelector('[data-testid="network-row"]') as HTMLElement | null
		return row?.getAttribute("data-network-name") ?? null
	})
	expect(existingName).toBeTruthy()

	await clickByTestId(page, "network-new-btn")
	await page.waitForSelector('[data-testid="network-name-input"]', { visible: true, timeout: 5_000 })

	await replaceInputValue(page, '[data-testid="network-name-input"]', existingName as string)

	// Submit must remain disabled because the duplicate-check trips
	const disabled = await page.evaluate(() => {
		const btn = document.querySelector('[data-testid="new-network-submit"]') as HTMLButtonElement | null
		return btn?.disabled ?? null
	})
	expect(disabled).toBe(true)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("delete network row via confirm popup", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	// Read the active chain name from the header globe BEFORE we
	// navigate — the detail-page delete flow guards against deleting the
	// active network. Pick any other row.
	const activeName =
		(await page.evaluate(() => document.querySelector('[data-testid="network-button"]')?.textContent?.trim() ?? "")) || ""

	await navigateToSettings(page, "networks")
	await page.waitForSelector('[data-testid="network-row"]', { visible: true, timeout: 5_000 })

	const candidate = await page.evaluate((active: string) => {
		const rows = [...document.querySelectorAll<HTMLElement>('[data-testid="network-row"]')]
		for (const row of rows) {
			const name = row.getAttribute("data-network-name") ?? ""
			if (name && name !== active) return { name }
		}
		return null
	}, activeName)
	expect(candidate).toBeTruthy()

	const beforeCount = (await page.$$('[data-testid="network-row"]')).length
	await deleteNetworkRow(page, candidate!.name)
	const afterCount = (await page.$$('[data-testid="network-row"]')).length
	expect(afterCount).toBe(beforeCount - 1)

	expect(registeredExtension.pageErrors).toEqual([])
})

test("NewFpcPopup keeps submit disabled with no inputs", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "fpcs")
	// fpcs list may or may not be present; the new-btn always is on this page
	await page.waitForSelector('[data-testid="fpc-new-btn"]', { visible: true, timeout: 10_000 })
	await clickByTestId(page, "fpc-new-btn")
	await page.waitForSelector('[data-testid="new-fpc-submit"]', { visible: true, timeout: 5_000 })

	const disabled = await page.evaluate(() => {
		const btn = document.querySelector('[data-testid="new-fpc-submit"]') as HTMLButtonElement | null
		return btn?.disabled ?? null
	})
	expect(disabled).toBe(true)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("NewFpcPopup invalid hex address surfaces inline warning", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "fpcs")
	await clickByTestId(page, "fpc-new-btn")
	await page.waitForSelector('[data-testid="fpc-address-input"]', { visible: true, timeout: 5_000 })

	await replaceInputValue(page, '[data-testid="fpc-name-input"]', "Test FPC")
	await replaceInputValue(page, '[data-testid="fpc-address-input"]', "not-a-hex-address")

	// Inline "Invalid FPC address" warning surfaces (no testid yet — assert
	// via the submit-disabled side effect, which is the actual contract).
	const disabled = await page.evaluate(() => {
		const btn = document.querySelector('[data-testid="new-fpc-submit"]') as HTMLButtonElement | null
		return btn?.disabled ?? null
	})
	expect(disabled).toBe(true)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("manage-fpcs page renders the synthetic Public Fee Juice anchor row", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "fpcs")
	// On a non-network harness the protocol FPCs aren't auto-discovered (no
	// PXE), but the synthetic row is rendered in the page itself and must
	// always be present at the top.
	await page.waitForSelector('[data-fpc-id="public-fj"]', { visible: true, timeout: 5_000 })

	const synthetic = await page.evaluate(() => {
		const row = document.querySelector('[data-fpc-id="public-fj"]') as HTMLElement | null
		return {
			present: !!row,
			synthetic: row?.getAttribute("data-fpc-synthetic"),
			editBtn: !!row?.querySelector('[data-testid="fpc-edit-btn"]'),
			deleteBtn: !!row?.querySelector('[data-testid="fpc-delete-btn"]'),
		}
	})
	expect(synthetic.present).toBe(true)
	expect(synthetic.synthetic).toBe("public-fj")
	expect(synthetic.editBtn).toBe(false)
	expect(synthetic.deleteBtn).toBe(false)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("NewTokenPopup invalid contract surfaces error-text", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "tokens")
	await clickByTestId(page, "token-import-btn")
	await page.waitForSelector('[data-testid="token-address-input"]', { visible: true, timeout: 5_000 })

	await replaceInputValue(page, '[data-testid="token-address-input"]', "not-hex")
	await page.waitForSelector('[data-testid="error-text"]', { visible: true, timeout: 3_000 })
	const importDisabled = await page.evaluate(() => {
		const btn = document.querySelector('[data-testid="import-token-button"]') as HTMLButtonElement | null
		return btn?.disabled ?? null
	})
	expect(importDisabled).toBe(true)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})
