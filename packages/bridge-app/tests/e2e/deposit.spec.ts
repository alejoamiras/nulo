import { expect, test } from "@playwright/test"

// Drives the real L1→L2 deposit through the app against the local sandbox: the
// in-browser dual-wallet (L1 viem + L2 PXE) runs mint→approve→deposit→claim.
test("deposit-public: bridge USDC L1→L2 through the app", async ({ page }) => {
	await page.goto("/")
	await page.getByTestId("deposit-amount").fill("50")
	await page.getByTestId("deposit-submit").click()

	const success = page.getByTestId("deposit-success")
	await expect(success).toBeVisible()
	await expect(success).toContainText("Bridged 50 USDC to L2")
})
