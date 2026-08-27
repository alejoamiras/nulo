import { expect } from "vitest"
import { test, openPopup, waitForHash, clickByTestId, replaceInputValue } from "./fixtures/extension"
import { navigateToSettings, openNetworkDetail } from "./fixtures/helpers"

// Scope note: `addEndpoint` / `updateEndpoint` probe the candidate URL
// via Aztec `getNodeInfo()` and reject on chainId mismatch — the
// "happy path" tests below cover form validation + popup UX + page
// wiring without hitting the network. The full
// add → setPrimary → delete cycle requires a live Aztec node and
// lives in the network suite.

test("network detail page renders chain info + endpoints section", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "networks")
	await page.waitForSelector('[data-testid="network-row"]', { visible: true, timeout: 5_000 })

	const firstName = await page.evaluate(() => {
		const row = document.querySelector('[data-testid="network-row"]') as HTMLElement | null
		return row?.getAttribute("data-network-name") ?? null
	})
	expect(firstName).toBeTruthy()

	await openNetworkDetail(page, firstName as string)

	// Chain section: rename row + chain-id row
	await page.waitForSelector('[data-testid="network-detail-rename"]', { visible: true, timeout: 5_000 })

	// Endpoints section: at least one endpoint row + add-endpoint CTA
	await page.waitForSelector('[data-testid="endpoint-row"]', { visible: true, timeout: 5_000 })
	await page.waitForSelector('[data-testid="endpoint-add-btn"]', { visible: true, timeout: 5_000 })

	const endpointCount = (await page.$$('[data-testid="endpoint-row"]')).length
	expect(endpointCount).toBeGreaterThanOrEqual(1)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("NewEndpointPopup keeps submit disabled with empty URL", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "networks")
	await page.waitForSelector('[data-testid="network-row"]', { visible: true, timeout: 5_000 })

	const firstName = await page.evaluate(() => {
		const row = document.querySelector('[data-testid="network-row"]') as HTMLElement | null
		return row?.getAttribute("data-network-name") ?? null
	})
	expect(firstName).toBeTruthy()

	await openNetworkDetail(page, firstName as string)
	await clickByTestId(page, "endpoint-add-btn")
	await page.waitForSelector('[data-testid="add-endpoint-submit"]', { visible: true, timeout: 5_000 })

	// Default URL field is empty → submit must be disabled
	const disabled = await page.evaluate(() => {
		const btn = document.querySelector('[data-testid="add-endpoint-submit"]') as HTMLButtonElement | null
		return btn?.disabled ?? null
	})
	expect(disabled).toBe(true)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("EditEndpointPopup pre-fills with current values + isDirty guard keeps save disabled", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "networks")
	await page.waitForSelector('[data-testid="network-row"]', { visible: true, timeout: 5_000 })

	const firstName = await page.evaluate(() => {
		const row = document.querySelector('[data-testid="network-row"]') as HTMLElement | null
		return row?.getAttribute("data-network-name") ?? null
	})
	expect(firstName).toBeTruthy()

	await openNetworkDetail(page, firstName as string)

	// Click the edit icon on the first endpoint row. The icon is rendered
	// inside the `#right` slot Tooltip, so click via dispatchEvent on the
	// scoped testid to bypass tooltip hover-show timing.
	await page.waitForSelector('[data-testid="endpoint-edit-btn"]', { visible: true, timeout: 5_000 })
	await page.evaluate(() => {
		const btn = document.querySelector('[data-testid="endpoint-edit-btn"]') as HTMLElement | null
		btn?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
	})

	await page.waitForSelector('[data-testid="edit-endpoint-submit"]', { visible: true, timeout: 5_000 })

	// Verify URL field pre-filled with the current endpoint URL (non-empty)
	const initialUrl = await page.evaluate(() => {
		const input = document.querySelector('[data-testid="endpoint-rpc-input"] input') as HTMLInputElement | null
		return input?.value ?? ""
	})
	expect(initialUrl.length).toBeGreaterThan(5)

	// Save must be disabled because nothing changed (isDirty === false)
	const disabledFresh = await page.evaluate(() => {
		const btn = document.querySelector('[data-testid="edit-endpoint-submit"]') as HTMLButtonElement | null
		return btn?.disabled ?? null
	})
	expect(disabledFresh).toBe(true)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("Single-endpoint network hides the delete-endpoint icon (last-endpoint guard)", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "networks")
	await page.waitForSelector('[data-testid="network-row"]', { visible: true, timeout: 5_000 })

	const firstName = await page.evaluate(() => {
		const row = document.querySelector('[data-testid="network-row"]') as HTMLElement | null
		return row?.getAttribute("data-network-name") ?? null
	})
	expect(firstName).toBeTruthy()

	await openNetworkDetail(page, firstName as string)
	await page.waitForSelector('[data-testid="endpoint-row"]', { visible: true, timeout: 5_000 })

	const endpointCount = (await page.$$('[data-testid="endpoint-row"]')).length
	const deleteCount = (await page.$$('[data-testid="endpoint-delete-btn"]')).length

	// Default seeds give one endpoint per network. The delete icon is
	// rendered v-if="not-primary AND endpoints.length > 1" — so on a single-
	// endpoint network, no delete icon appears anywhere.
	expect(endpointCount).toBe(1)
	expect(deleteCount).toBe(0)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test("NewEndpointPopup invalid URL surfaces inline RPC-didn't-respond error", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "networks")
	await page.waitForSelector('[data-testid="network-row"]', { visible: true, timeout: 5_000 })

	const firstName = await page.evaluate(() => {
		const row = document.querySelector('[data-testid="network-row"]') as HTMLElement | null
		return row?.getAttribute("data-network-name") ?? null
	})
	expect(firstName).toBeTruthy()

	await openNetworkDetail(page, firstName as string)
	await clickByTestId(page, "endpoint-add-btn")
	await page.waitForSelector('[data-testid="add-endpoint-submit"]', { visible: true, timeout: 5_000 })

	// A reachable-but-non-aztec URL: addEndpoint will fail at probe time.
	// "http://localhost:1" reliably refuses the connection cross-platform,
	// short-circuiting before any 30s aztec-rpc timeout.
	await replaceInputValue(page, '[data-testid="endpoint-rpc-input"] input', "http://localhost:1")

	await page.evaluate(() => {
		const btn = document.querySelector('[data-testid="add-endpoint-submit"]') as HTMLButtonElement | null
		btn?.click()
	})

	// Wait for the "Something went wrong." / "RPC didn't respond." error to
	// surface in the input's #right slot (any text-error suffices — exact
	// copy varies by failure mode and is asserted in unit tests).
	await page.waitForFunction(
		() => {
			const slotErrors = document.querySelectorAll('[data-testid="endpoint-rpc-input"] .fade')
			if (slotErrors.length > 0) return true
			// Fallback: probe the body text for either of the two error messages
			// the popup surfaces on probe failure.
			const txt = (document.body.textContent ?? "").toLowerCase()
			return txt.includes("rpc didn't respond") || txt.includes("something went wrong")
		},
		{ timeout: 30_000, polling: 500 },
	)

	// Submit stays disabled (errorText is non-empty)
	const disabledAfterError = await page.evaluate(() => {
		const btn = document.querySelector('[data-testid="add-endpoint-submit"]') as HTMLButtonElement | null
		return btn?.disabled ?? null
	})
	expect(disabledAfterError).toBe(true)

	expect(registeredExtension.pageErrors).toEqual([])
})

test("seeded dRPC endpoint row is titled 'dRPC', never the raw provider URL", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "networks")
	// Both dRPC-backed seeds carry the label; Alpha V5 is deterministic across smoke's
	// default-active variants (the seed set is fixed even when Testnet is active).
	await page.waitForSelector('[data-testid="network-row"][data-network-name="Alpha V5"]', { visible: true, timeout: 5_000 })
	await openNetworkDetail(page, "Alpha V5")

	await page.waitForSelector('[data-testid="endpoint-row"]', { visible: true, timeout: 5_000 })
	const rowText = await page.evaluate(() => document.querySelector('[data-testid="endpoint-row"]')?.textContent ?? "")
	expect(rowText).toContain("dRPC")

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})
