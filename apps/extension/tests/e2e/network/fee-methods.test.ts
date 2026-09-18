import { inject, expect } from "vitest"
import { test, openPopup, waitForHash, replaceInputValue, clickByTestId } from "../fixtures/extension"
import {
	type FeeMethodSubtitle,
	PXE_ANCHOR_SYNC_WORKAROUND_MS,
	refreshBalances,
	sendTransfer,
	selectFeeMethod,
	setActiveSendType,
	waitForToast,
	waitForTxConfirmation,
} from "../fixtures/helpers"
import type { AztecTestConfig } from "../fixtures/aztec"
import type { Page } from "puppeteer"

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
	// re-skeletoning through a fresh PXE read. 10s absorbs loaded-CI popup
	// boot variance while staying far under the 60s cold-path budget above.
	const reopened = await openPopup(feeJuiceImportedExtension)
	await waitForHash(reopened, "#/popup/general")
	await reopened.waitForSelector('[data-testid="gas-balance-public"]', { visible: true, timeout: 10_000 })
	const reopenedText = await reopened.evaluate(
		() => document.querySelector('[data-testid="gas-balance-public"]')?.textContent?.trim() || "",
	)
	expect(reopenedText).toContain("FJ")
	expect(reopenedText).not.toBe("0 FJ")

	console.log("✓ Reopened popup paints gas balance from the warm cache")
	await reopened.close()
})

// ── The fee source follows the transfer's origin, and warns when it names the sender ──────────────
//
// Three funding shapes, one fixture each: no gas (tokenReady), public gas only (feeJuiceReady),
// both (feeJuiceImported). Send keeps its fee picks under its own storage key; the fixtures are
// file-scoped and earlier tests pick methods, so every test here starts by clearing that key and
// can therefore assert DEFAULTS, not leftovers.

const SEND_PICKS_KEY = "nulo:ui:sendFeePaymentMethods"
const NOTICE = '[data-testid="send-fee-privacy-notice"]'

type FeeView = { method: string | null; noticeShape: string | null; remedyHref: string | null; origin: string | null }

async function clearSendPicks(page: Page): Promise<void> {
	await page.evaluate((key: string) => chrome.storage.local.remove(key), SEND_PICKS_KEY)
}

async function readSendPicks(page: Page): Promise<unknown> {
	return page.evaluate(async (key: string) => (await chrome.storage.local.get(key))[key], SEND_PICKS_KEY)
}

async function openSend(page: Page): Promise<void> {
	await page.evaluate(() => {
		;(document.querySelector('[data-testid="actions-send"]') as HTMLElement)?.click()
	})
	await page.waitForSelector('[data-testid="send-from-type"]', { timeout: 10_000 })
}

async function feeView(page: Page): Promise<FeeView> {
	return page.evaluate((noticeSelector: string) => {
		const notice = document.querySelector(noticeSelector)
		return {
			method: document.querySelector('[data-testid="send-fee-method-trigger"]')?.getAttribute("data-fee-method") ?? null,
			noticeShape: notice?.getAttribute("data-notice-shape") ?? null,
			remedyHref: document.querySelector('[data-testid="send-fee-privacy-remedy"]')?.getAttribute("href") ?? null,
			origin: document.querySelector('[data-testid="fee-settings-card"]')?.getAttribute("data-origin") ?? null,
		}
	}, NOTICE)
}

/** Waits until the card, under `origin`, has settled on `method` — a default takes a balance read to
 *  land, so this is the signal, never a sleep. On timeout the error carries what the card showed. */
async function waitForFee(page: Page, origin: "private" | "public", method: FeeMethodSubtitle, timeout = 90_000): Promise<FeeView> {
	try {
		await page.waitForFunction(
			({ o, m }: { o: string; m: string }) =>
				document.querySelector('[data-testid="fee-settings-card"]')?.getAttribute("data-origin") === o &&
				document.querySelector('[data-testid="send-fee-method-trigger"]')?.getAttribute("data-fee-method") === m,
			{ timeout, polling: 250 },
			{ o: origin, m: method },
		)
	} catch (e) {
		throw new Error(`fee card never settled on ${method} under a ${origin} origin; it shows ${JSON.stringify(await feeView(page))}`, {
			cause: e,
		})
	}
	return feeView(page)
}

/** Opt-in capture of the popup (`NULO_E2E_SHOT_DIR`): a popup-surface change ships with a picture of it. */
async function shot(page: Page, name: string): Promise<void> {
	const dir = process.env.NULO_E2E_SHOT_DIR
	if (!dir) return
	await page.evaluate((s: string) => document.querySelector(s)?.scrollIntoView({ block: "center" }), NOTICE)
	await page.screenshot({ path: `${dir}/${name}.png` as `${string}.png` })
}

async function fillAndSubmit(page: Page, destination: string, amount: string): Promise<void> {
	await page.waitForFunction(
		() => {
			const input = document.querySelector('[data-testid="send-amount-input"]') as HTMLInputElement
			return input && !input.disabled
		},
		{ timeout: 60_000, polling: 2_000 },
	)
	await replaceInputValue(page, '[data-testid="send-amount-input"]', amount)
	await replaceInputValue(page, '[data-testid="send-destination-field"] input', destination)
	await page.waitForFunction(
		() => {
			const btn = document.querySelector('[data-testid="send-submit"]') as HTMLElement
			return btn && getComputedStyle(btn).pointerEvents !== "none"
		},
		{ timeout: 180_000, polling: 3_000 },
	)
	await new Promise((r) => setTimeout(r, PXE_ANCHOR_SYNC_WORKAROUND_MS))
	await page.evaluate(() => document.querySelector('[data-testid="send-submit"]')?.scrollIntoView({ block: "center" }))
	await clickByTestId(page, "send-submit")
	await waitForToast(page, "Transaction submitted", 60_000)
}

test.skipIf(!hasConfig)(
	"no gas at all: both origins default to the sponsor, and nothing warns",
	{ timeout: 180_000 },
	async ({ tokenReadyExtension }) => {
		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general")
		await clearSendPicks(page)
		await openSend(page)

		// Private is the page's default origin. Both balances read as zero, so the walk ends on the sponsor.
		const privateOrigin = await waitForFee(page, "private", "sponsored")
		expect(privateOrigin.noticeShape).toBeNull()

		await setActiveSendType(page, "send-from-type", "public")
		const publicOrigin = await waitForFee(page, "public", "sponsored")
		expect(publicOrigin.noticeShape).toBeNull()

		// Nothing was picked, so nothing was remembered.
		expect(await readSendPicks(page)).toBeUndefined()
		await page.close()
	},
)

test.skipIf(!hasConfig)(
	"public gas only: a private send is defaulted to Fee Juice, warns in both wordings, and still sends",
	{ timeout: 600_000 },
	async ({ feeJuiceReadyExtension }) => {
		const self = feeJuiceReadyExtension.accountAddress

		// A public-origin send already names the sender: Fee Juice is the matched default, silently.
		{
			const page = await openPopup(feeJuiceReadyExtension)
			await waitForHash(page, "#/popup/general")
			await clearSendPicks(page)
			await openSend(page)
			await setActiveSendType(page, "send-from-type", "public")
			await setActiveSendType(page, "send-to-type", "private")
			const shield = await waitForFee(page, "public", "public")
			expect(shield.noticeShape).toBeNull()

			// Shield 100 so there is a private balance to send from — paid with that same default.
			await fillAndSubmit(page, self, "100")
			await page.waitForFunction(() => !document.querySelector('[data-testid="send-destination-field"]'), { timeout: 10_000 })
			await waitForTxConfirmation(page, { amount: "100", fromType: "public", toType: "private", timeout: 120_000 })
			await page.close()
		}

		{
			const page = await openPopup(feeJuiceReadyExtension)
			await waitForHash(page, "#/popup/general")
			await refreshBalances(page)
			await openSend(page)
			await setActiveSendType(page, "send-from-type", "private")
			await setActiveSendType(page, "send-to-type", "private")

			// THE case: private gas read as zero, public gas held. Nobody picked anything.
			const defaulted = await waitForFee(page, "private", "public")
			expect(defaulted.noticeShape).toBe("private-private")
			expect(defaulted.remedyHref).toMatch(/^https:\/\//)
			expect(await readSendPicks(page)).toBeUndefined()
			await shot(page, "notice-private-private")

			await setActiveSendType(page, "send-to-type", "public")
			await page.waitForFunction(
				(s: string) => document.querySelector(s)?.getAttribute("data-notice-shape") === "private-public",
				{ timeout: 30_000 },
				NOTICE,
			)
			expect((await feeView(page)).method).toBe("public")
			await shot(page, "notice-private-public")

			await setActiveSendType(page, "send-to-type", "private")
			await page.waitForFunction(
				(s: string) => document.querySelector(s)?.getAttribute("data-notice-shape") === "private-private",
				{ timeout: 30_000 },
				NOTICE,
			)

			// A sponsor that does not name the account is one tap away, and silences the row.
			await selectFeeMethod(page, "sponsored")
			await page.waitForFunction((s: string) => !document.querySelector(s), { timeout: 30_000 }, NOTICE)
			await selectFeeMethod(page, "public")
			await page.waitForSelector(NOTICE)

			// Warn-and-allow: the send goes through, paid by the account.
			await fillAndSubmit(page, self, "10")
			await page.waitForFunction(() => !document.querySelector('[data-testid="send-destination-field"]'), { timeout: 10_000 })
			await waitForTxConfirmation(page, { amount: "10", fromType: "private", toType: "private", timeout: 120_000 })
			await page.close()
		}
	},
)

test.skipIf(!hasConfig)(
	"both gases held: each origin defaults to its own, a hand-picked Fee Juice warns, and the pick is kept per origin",
	{ timeout: 600_000 },
	async ({ feeJuiceImportedExtension }) => {
		const self = feeJuiceImportedExtension.accountAddress

		{
			const page = await openPopup(feeJuiceImportedExtension)
			await waitForHash(page, "#/popup/general")
			await clearSendPicks(page)
			await openSend(page)

			const privateDefault = await waitForFee(page, "private", "private")
			expect(privateDefault.noticeShape).toBeNull()

			await setActiveSendType(page, "send-from-type", "public")
			const publicDefault = await waitForFee(page, "public", "public")
			expect(publicDefault.noticeShape).toBeNull()

			// Shield so the private send below has something to spend (public origin → its default payer).
			await setActiveSendType(page, "send-to-type", "private")
			await fillAndSubmit(page, self, "100")
			await page.waitForFunction(() => !document.querySelector('[data-testid="send-destination-field"]'), { timeout: 10_000 })
			await waitForTxConfirmation(page, { amount: "100", fromType: "public", toType: "private", timeout: 120_000 })
			await page.close()
		}

		{
			const page = await openPopup(feeJuiceImportedExtension)
			await waitForHash(page, "#/popup/general")
			await refreshBalances(page)
			await openSend(page)
			await setActiveSendType(page, "send-from-type", "private")
			await setActiveSendType(page, "send-to-type", "private")
			await waitForFee(page, "private", "private")

			await selectFeeMethod(page, "sponsored")
			expect((await feeView(page)).noticeShape).toBeNull()

			await selectFeeMethod(page, "public")
			await page.waitForSelector(NOTICE)
			expect((await feeView(page)).noticeShape).toBe("private-private")

			await setActiveSendType(page, "send-to-type", "public")
			await page.waitForFunction(
				(s: string) => document.querySelector(s)?.getAttribute("data-notice-shape") === "private-public",
				{ timeout: 30_000 },
				NOTICE,
			)

			// A public origin has no sender left to protect: the row goes, and that origin keeps its own default.
			await setActiveSendType(page, "send-from-type", "public")
			const asPublic = await waitForFee(page, "public", "public")
			expect(asPublic.noticeShape).toBeNull()

			// Back to private: the pick made under THIS origin returns, and the row with it.
			await setActiveSendType(page, "send-from-type", "private")
			await setActiveSendType(page, "send-to-type", "private")
			const back = await waitForFee(page, "private", "public")
			expect(back.noticeShape).toBe("private-private")

			expect(await readSendPicks(page)).toEqual({ [self]: { private: { type: "fj" } } })

			await fillAndSubmit(page, self, "10")
			await page.waitForFunction(() => !document.querySelector('[data-testid="send-destination-field"]'), { timeout: 10_000 })
			await waitForTxConfirmation(page, { amount: "10", fromType: "private", toType: "private", timeout: 120_000 })
			await page.close()
		}

		// A fresh popup: the pick survived, per origin, and still warns.
		{
			const page = await openPopup(feeJuiceImportedExtension)
			await waitForHash(page, "#/popup/general")
			await openSend(page)
			// The trigger previews the saved pick while balances load, and a preview pays nothing — so the
			// row, not the trigger, is the signal that Fee Juice is the method in effect.
			await waitForFee(page, "private", "public")
			await page.waitForFunction(
				(s: string) => document.querySelector(s)?.getAttribute("data-notice-shape") === "private-private",
				{ timeout: 90_000 },
				NOTICE,
			)
			await setActiveSendType(page, "send-from-type", "public")
			expect((await waitForFee(page, "public", "public")).noticeShape).toBeNull()
			await clearSendPicks(page)
			await page.close()
		}
	},
)
