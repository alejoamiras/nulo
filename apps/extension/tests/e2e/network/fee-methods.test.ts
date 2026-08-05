import { inject, expect } from "vitest"
import { test, openPopup, waitForHash, replaceInputValue, clickByTestId } from "../fixtures/extension"
import { PXE_ANCHOR_SYNC_WORKAROUND_MS, sendTransfer, selectFeeMethod, setActiveSendType, waitForToast } from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

// Fee method tests use separate fixtures from transfer tests.
// Each test verifies a different fee payment method via the FeeSettingsCard UI.

test.skipIf(!hasConfig)("sponsored FPC is default fee method", { timeout: 180_000 }, async ({ tokenReadyExtension }) => {
	const page = await openPopup(tokenReadyExtension)
	await waitForHash(page, "#/popup/general")

	// Open SendPopup
	await page.evaluate(() => {
		;(document.querySelector('[data-testid="actions-send"]') as HTMLElement)?.click()
	})
	await page.waitForSelector('[data-testid="send-from-type"]', { timeout: 10_000 })

	// Wait for FPC auto-discovery to complete
	await page.waitForFunction(
		() => {
			const trigger = document.querySelector('[data-testid="send-fee-method-trigger"]')
			return trigger?.textContent?.includes("Sponsored")
		},
		{ timeout: 30_000, polling: 1_000 },
	)

	const triggerText = await page.evaluate(() => document.querySelector('[data-testid="send-fee-method-trigger"]')?.textContent?.trim())
	console.log(`[fee-methods] Default fee method: "${triggerText}"`)
	expect(triggerText).toContain("Sponsored")

	console.log("✓ Sponsored FPC is the default fee method")
	await page.close()
})

// SKIP: clusters A+B (tokenReadyExtension importToken cascade + feeJuiceImportedExtension cascade).
// See implementations-plan/network-test-triage/plan.md — un-skip on cluster fix.
test.skipIf(!hasConfig)("transfer with sponsored FPC fee", { timeout: 180_000 }, async ({ tokenReadyExtension }) => {
	const page = await openPopup(tokenReadyExtension)
	await waitForHash(page, "#/popup/general")

	await sendTransfer(page, {
		fromType: "public",
		toType: "public",
		amount: "1",
		destination: tokenReadyExtension.accountAddress,
	})
	console.log("✓ Transfer with Sponsored FPC submitted")
	await page.close()
})

// Phase 2F WS3: re-enabled via feeJuiceImportedExtension fixture, which
// pre-funds the imported account directly on-chain (matching what the
// extension's importPlain flow derives), so the extension's PXE sees both
// public + private FJ balances without needing a UI-level claim.
// SKIP: clusters A+B (tokenReadyExtension importToken cascade + feeJuiceImportedExtension cascade).
// See implementations-plan/network-test-triage/plan.md — un-skip on cluster fix.
test.skipIf(!hasConfig)("transfer with public Fee Juice", { timeout: 300_000 }, async ({ feeJuiceImportedExtension }) => {
	const page = await openPopup(feeJuiceImportedExtension)
	await waitForHash(page, "#/popup/general")

	// Open SendPopup
	await page.evaluate(() => {
		;(document.querySelector('[data-testid="actions-send"]') as HTMLElement)?.click()
	})
	await page.waitForSelector('[data-testid="send-from-type"]', { timeout: 10_000 })

	// Toggle to public→public. The SendTypesCard toggle is guarded by
	// async-loaded token capability flags, so use the polling helper
	// instead of a single click + sleep.
	await setActiveSendType(page, "send-from-type", "public")
	await setActiveSendType(page, "send-to-type", "public")

	// Wait for amount input to be enabled
	await page.waitForFunction(
		() => {
			const input = document.querySelector('[data-testid="send-amount-input"]') as HTMLInputElement
			return input && !input.disabled
		},
		{ timeout: 60_000, polling: 2_000 },
	)

	// Enter amount + destination via the v-model-aware helper
	await replaceInputValue(page, '[data-testid="send-amount-input"]', "1")
	await replaceInputValue(page, '[data-testid="send-destination-field"] input', feeJuiceImportedExtension.accountAddress)

	// Now switch fee method to Fee Juice (AFTER entering details, so the re-estimation uses FJ)
	await selectFeeMethod(page, "public")
	console.log("[fee-methods] Switched to Fee Juice (public)")

	// Wait for send button to become clickable (re-estimation with Fee Juice)
	await page.waitForFunction(
		() => {
			const btn = document.querySelector('[data-testid="send-submit"]') as HTMLElement
			return btn && getComputedStyle(btn).pointerEvents !== "none"
		},
		{ timeout: 120_000, polling: 3_000 },
	)

	await new Promise((r) => setTimeout(r, PXE_ANCHOR_SYNC_WORKAROUND_MS))

	// Submit
	await page.waitForSelector('[data-testid="send-submit"]', { visible: true })
	await page.evaluate(() => document.querySelector('[data-testid="send-submit"]')?.scrollIntoView({ block: "center" }))
	await clickByTestId(page, "send-submit")

	// Wait for toast
	await waitForToast(page, "Transaction submitted", 60_000)

	console.log("✓ Transfer with Fee Juice (public) submitted")
	await page.close()
})

// Phase 2F WS3 follow-up: same fixture, exercise PrivateFPC.pay_fee path.
// The fixture pre-funded the PrivateFPC's internal balance for the imported
// account via bridgeForMint + claim + mint (all from the same-secret script
// wallet, so msg_sender == claimer). This test verifies the FpcStrategy can
// spend that balance to sponsor a transfer.
// SKIP: clusters A+B (tokenReadyExtension importToken cascade + feeJuiceImportedExtension cascade).
// See implementations-plan/network-test-triage/plan.md — un-skip on cluster fix.
test.skipIf(!hasConfig)("transfer with private Fee Juice", { timeout: 300_000 }, async ({ feeJuiceImportedExtension }) => {
	const page = await openPopup(feeJuiceImportedExtension)
	await waitForHash(page, "#/popup/general")

	// Open SendPopup
	await page.evaluate(() => {
		;(document.querySelector('[data-testid="actions-send"]') as HTMLElement)?.click()
	})
	await page.waitForSelector('[data-testid="send-from-type"]', { timeout: 10_000 })

	// Toggle to public→public (the token transfer itself is public; fee payment
	// is what's private — paid via PrivateFPC's internal FJ balance). Use the
	// polling helper so we don't no-op while async token-capability flags
	// are still arriving.
	await setActiveSendType(page, "send-from-type", "public")
	await setActiveSendType(page, "send-to-type", "public")

	// Wait for amount input to be enabled
	await page.waitForFunction(
		() => {
			const input = document.querySelector('[data-testid="send-amount-input"]') as HTMLInputElement
			return input && !input.disabled
		},
		{ timeout: 60_000, polling: 2_000 },
	)

	await replaceInputValue(page, '[data-testid="send-amount-input"]', "1")
	await replaceInputValue(page, '[data-testid="send-destination-field"] input', feeJuiceImportedExtension.accountAddress)

	// Switch fee method to Private Fee Juice — exercises FpcStrategy paying
	// via PrivateFPC.pay_fee using the FPC's internal balance.
	await selectFeeMethod(page, "private")
	console.log("[fee-methods] Switched to Fee Juice (private)")

	// Wait for re-estimation (private path involves more PXE work — note proofs
	// for FPC scope, etc. — so allow generous timeout).
	await page.waitForFunction(
		() => {
			const btn = document.querySelector('[data-testid="send-submit"]') as HTMLElement
			return btn && getComputedStyle(btn).pointerEvents !== "none"
		},
		{ timeout: 180_000, polling: 3_000 },
	)

	await new Promise((r) => setTimeout(r, PXE_ANCHOR_SYNC_WORKAROUND_MS))

	await page.waitForSelector('[data-testid="send-submit"]', { visible: true })
	await page.evaluate(() => document.querySelector('[data-testid="send-submit"]')?.scrollIntoView({ block: "center" }))
	await clickByTestId(page, "send-submit")

	await waitForToast(page, "Transaction submitted", 60_000)

	console.log("✓ Transfer with Fee Juice (private) submitted")
	await page.close()
})

// Phase 2F WS3: re-enabled via feeJuiceImportedExtension. The fixture pre-funds
// the imported account directly so getGasBalances reads non-zero public AND
// private FeeJuice (PrivateFPC.balance_of) without UI claim flow.
// SKIP: clusters A+B (tokenReadyExtension importToken cascade + feeJuiceImportedExtension cascade).
// See implementations-plan/network-test-triage/plan.md — un-skip on cluster fix.
test.skipIf(!hasConfig)("gas balance card shows non-zero FeeJuice", { timeout: 120_000 }, async ({ feeJuiceImportedExtension }) => {
	const page = await openPopup(feeJuiceImportedExtension)
	await waitForHash(page, "#/popup/general")

	// Wait for GasBalanceCard to load and show a non-zero public FJ balance
	// The gas balance refreshes async after the PXE syncs blocks
	await page.waitForSelector('[data-testid="gas-balance-public"]', { visible: true, timeout: 60_000 })

	const balanceText = await page.evaluate(() => document.querySelector('[data-testid="gas-balance-public"]')?.textContent?.trim() || "")
	console.log(`[gas-balance] Public FJ balance: "${balanceText}"`)

	// Should contain "FJ" and NOT be "0 FJ"
	expect(balanceText).toContain("FJ")
	expect(balanceText).not.toBe("0 FJ")

	console.log("✓ Gas balance card shows non-zero FeeJuice")
	await page.close()

	// Warm-cache reopen: the SW-side reader serves last-known balances via
	// peek, so a reopened popup paints the value near-instantly instead of
	// re-skeletoning through a fresh PXE read. 5s is ~10x the peek round-trip
	// plus popup boot, yet far under the 60s cold-path budget above.
	const reopened = await openPopup(feeJuiceImportedExtension)
	await waitForHash(reopened, "#/popup/general")
	await reopened.waitForSelector('[data-testid="gas-balance-public"]', { visible: true, timeout: 5_000 })
	const reopenedText = await reopened.evaluate(
		() => document.querySelector('[data-testid="gas-balance-public"]')?.textContent?.trim() || "",
	)
	expect(reopenedText).toContain("FJ")
	expect(reopenedText).not.toBe("0 FJ")

	console.log("✓ Reopened popup paints gas balance from the warm cache")
	await reopened.close()
})
