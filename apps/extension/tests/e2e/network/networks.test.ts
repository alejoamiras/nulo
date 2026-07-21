import { expect, inject } from "vitest"
import { test, openPopup, waitForHash } from "../fixtures/extension"
import { switchToLocalNetwork, navigateToSettings } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasLocalNetwork = aztecConfig !== undefined

test.skipIf(!hasLocalNetwork)("default network present on fresh popup", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	// Header renders a network-button once a network is selected. The default
	// name varies based on prior test state, so just assert the control exists.
	await page.waitForSelector('[data-testid="network-button"]', { visible: true, timeout: 5_000 })

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test.skipIf(!hasLocalNetwork)("switch to Local Network", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await switchToLocalNetwork(page)

	// Confirm the header reflects the switch
	await page.waitForFunction(
		() => {
			const btn = document.querySelector('[data-testid="network-button"]')
			return btn?.textContent?.toLowerCase().includes("local")
		},
		{ timeout: 10_000 },
	)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test.skipIf(!hasLocalNetwork)("networks page lists all 3 defaults", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await navigateToSettings(page, "networks")

	// Network names are config-driven and stable across UI redesigns
	for (const name of ["Alpha Mainnet", "Testnet", "Local Network"]) {
		await page.waitForSelector(`text/${name}`, { visible: true, timeout: 5_000 })
	}

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})

test.skipIf(!hasLocalNetwork)("network switch to Local persists in header", async ({ registeredExtension }) => {
	const page = await openPopup(registeredExtension)
	await waitForHash(page, "#/popup/general")

	await switchToLocalNetwork(page)

	await page.waitForFunction(
		() => {
			const btn = document.querySelector('[data-testid="network-button"]')
			return btn && !btn.textContent?.toLowerCase().includes("testnet")
		},
		{ timeout: 10_000 },
	)

	expect(registeredExtension.consoleErrors).toEqual([])
	expect(registeredExtension.pageErrors).toEqual([])
})
