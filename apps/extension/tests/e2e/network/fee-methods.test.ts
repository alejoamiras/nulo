import { inject, expect } from "vitest"
import { test, openPopup, waitForHash, replaceInputValue, clickByTestId } from "../fixtures/extension"
import {
	PXE_ANCHOR_SYNC_WORKAROUND_MS,
	fillSendForm,
	refreshBalances,
	sendTransfer,
	selectFeeMethod,
	setActiveSendType,
	waitForToast,
	waitForTxConfirmation,
} from "../fixtures/helpers"
import {
	openReviewFromStrip,
	openSend,
	readReview,
	readSendInputs,
	type SendAction,
	shotSend,
	submitSend,
	waitForFee,
	waitForReview,
	waitForReviewClosed,
	waitForReviewReady,
	waitForSendGone,
	waitForTag,
} from "../fixtures/send-page"
import { pointerClick } from "../helpers/legal-drivers"
import { coveredAt, tabAround, waitForFocus } from "../helpers/pointer-probes"
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
		expect: "send",
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

// ── The fee source follows the transfer's origin, and the page says what the fee publishes ────────
//
// Three funding shapes, one fixture each: no gas (tokenReady), public gas only (feeJuiceReady),
// both (feeJuiceImported). Send keeps its fee picks under its own storage key; the fixtures are
// file-scoped and earlier tests pick methods, so every test here starts by clearing that key and
// can therefore assert DEFAULTS, not leftovers. Every state a walk visits is read whole — the tag,
// the footer's action and the strip's `you` must agree (`waitForFee` / `waitForTag`) — and every
// send names what the footer must offer, so a real send is also a check on the gate.

const SEND_PICKS_KEY = "nulo:ui:sendFeePaymentMethods"

async function clearSendPicks(page: Page): Promise<void> {
	await page.evaluate((key: string) => chrome.storage.local.remove(key), SEND_PICKS_KEY)
}

async function readSendPicks(page: Page): Promise<unknown> {
	return page.evaluate(async (key: string) => (await chrome.storage.local.get(key))[key], SEND_PICKS_KEY)
}

async function fillAndSubmit(page: Page, destination: string, amount: string, expect: SendAction): Promise<void> {
	await fillSendForm(page, { amount, destination })
	await submitSend(page, { expect })
	await waitForToast(page, "Transaction submitted", 60_000)
	await waitForSendGone(page)
}

/** Still on the Send page with no submission toast after `dwellMs` — what a first click on "Review send" must leave behind. */
async function expectNothingSent(page: Page, dwellMs: number): Promise<void> {
	await new Promise((r) => setTimeout(r, dwellMs))
	const state = await page.evaluate(() => ({
		onSend: Boolean(document.querySelector('[data-testid="send-destination-field"]')),
		toast: (document.body.textContent ?? "").toLowerCase().includes("transaction submitted"),
	}))
	expect(state).toEqual({ onSend: true, toast: false })
}

test.skipIf(!hasConfig)(
	"no gas at all: both origins default to the sponsor, nothing warns, and the optional review sends at once",
	{ timeout: 300_000 },
	async ({ tokenReadyExtension }) => {
		const self = tokenReadyExtension.accountAddress
		const page = await openPopup(tokenReadyExtension)
		await waitForHash(page, "#/popup/general")
		await clearSendPicks(page)
		await openSend(page)

		// Private is the page's default origin. Both balances read as zero, so the walk ends on the sponsor.
		const privateOrigin = await waitForFee(page, "private", "sponsored")
		expect(privateOrigin).toMatchObject({ tag: null, action: "send", strip: { you: "hidden", to: "hidden", amount: "hidden" } })
		await shotSend(page, "strip-all-hidden")

		await setActiveSendType(page, "send-from-type", "public")
		const publicOrigin = await waitForFee(page, "public", "sponsored")
		expect(publicOrigin).toMatchObject({ tag: null, action: "send", strip: { you: "public", to: "hidden", amount: "public" } })

		// Nothing was picked, so nothing was remembered.
		expect(await readSendPicks(page)).toBeUndefined()

		// A send nobody gated, reviewed anyway: the sheet opened from the strip is armed at once.
		await setActiveSendType(page, "send-to-type", "public")
		await shotSend(page, "strip-public-send")
		await fillSendForm(page, { amount: "1", destination: self })
		await openReviewFromStrip(page)
		expect(await readReview(page)).toMatchObject({
			you: "public",
			to: "public",
			amount: "public",
			payer: "contract",
			ready: true,
			remedyHref: null,
		})
		await shotSend(page, "sheet-not-gated", "send-review-submit")
		await pointerClick(page, "send-review-submit")
		await waitForToast(page, "Transaction submitted", 60_000)
		await waitForSendGone(page)
		await waitForTxConfirmation(page, { amount: "1", fromType: "public", toType: "public", timeout: 120_000 })
		await page.close()
	},
)

test.skipIf(!hasConfig)(
	"public gas only: a private send is defaulted to Fee Juice, tagged in both wordings, and sends only through the sheet",
	{ timeout: 600_000 },
	async ({ feeJuiceReadyExtension }) => {
		const self = feeJuiceReadyExtension.accountAddress

		// A public-origin send already names the sender: Fee Juice is the matched default, silently, one tap.
		{
			const page = await openPopup(feeJuiceReadyExtension)
			await waitForHash(page, "#/popup/general")
			await clearSendPicks(page)
			await openSend(page)
			await setActiveSendType(page, "send-from-type", "public")
			await setActiveSendType(page, "send-to-type", "private")
			const shield = await waitForFee(page, "public", "public")
			expect(shield).toMatchObject({ tag: null, action: "send", strip: { you: "public", to: "hidden", amount: "public" } })

			// Shield 100 so there is a private balance to send from — paid with that same default.
			await fillAndSubmit(page, self, "100", "send")
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
			expect(defaulted).toMatchObject({
				tag: "private-private",
				action: "review",
				strip: { you: "exposed", to: "hidden", amount: "hidden" },
			})
			expect(await readSendPicks(page)).toBeUndefined()
			await shotSend(page, "tag-private-private", "send-fee-privacy-notice")
			await shotSend(page, "strip-fee-payer")

			await setActiveSendType(page, "send-to-type", "public")
			const toPublic = await waitForTag(page, "private-public")
			expect(toPublic).toMatchObject({
				method: "public",
				action: "review",
				strip: { you: "exposed", to: "public", amount: "public" },
			})
			await shotSend(page, "tag-private-public", "send-fee-privacy-notice")

			await setActiveSendType(page, "send-to-type", "private")
			await waitForTag(page, "private-private")

			// A sponsor that does not name the account is one tap away, and lifts the gate with the tag.
			await selectFeeMethod(page, "sponsored")
			expect(await waitForTag(page, null)).toMatchObject({ action: "send", strip: { you: "hidden" } })
			await selectFeeMethod(page, "public")
			await waitForTag(page, "private-private")

			// The gated send: the footer reads "Review send" and only opens the sheet. Nothing goes out,
			// and while the sheet is up the footer is under it — nothing stays clickable below a modal.
			await fillSendForm(page, { amount: "10", destination: self })
			await pointerClick(page, "send-submit")
			await waitForReview(page, true)
			await expectNothingSent(page, 1_500)
			expect(await coveredAt(page, "send-submit")).not.toBeNull()
			const review = await readReview(page)
			expect(review).toMatchObject({ you: "exposed", shape: "private-private", to: "hidden", amount: "hidden", payer: "account" })
			expect(review.remedyHref).toMatch(/^https:\/\//)
			await shotSend(page, "sheet-gated", "send-review-submit")

			// The trap: Tab never leaves the sheet; Escape closes it and hands focus back to the opener.
			const visited = await tabAround(page, 12)
			expect(visited).toContain("send-review-submit")
			expect(visited).not.toContain("send-submit")
			expect(visited).not.toContain("send-publish-strip")
			expect(visited).not.toContain("send-amount-input")
			await page.keyboard.press("Escape")
			await waitForReviewClosed(page)
			await waitForFocus(page, "send-submit")

			// The form survived the round trip, gate included.
			expect(await readSendInputs(page)).toEqual({ amount: "10", destination: self })
			expect((await waitForTag(page, "private-private")).action).toBe("review")

			// Reopened from the strip, armed after the wait, sent from the sheet alone — paid by the account.
			await openReviewFromStrip(page)
			await waitForReviewReady(page)
			await pointerClick(page, "send-review-submit")
			await waitForToast(page, "Transaction submitted", 60_000)
			await waitForSendGone(page)
			await waitForTxConfirmation(page, { amount: "10", fromType: "private", toType: "private", timeout: 120_000 })
			await page.close()
		}
	},
)

test.skipIf(!hasConfig)(
	"both gases held: each origin defaults to its own, a hand-picked sponsor sends in one tap, a hand-picked Fee Juice through the sheet, and the pick is kept per origin",
	{ timeout: 600_000 },
	async ({ feeJuiceImportedExtension }) => {
		const self = feeJuiceImportedExtension.accountAddress

		{
			const page = await openPopup(feeJuiceImportedExtension)
			await waitForHash(page, "#/popup/general")
			await clearSendPicks(page)
			await openSend(page)

			const privateDefault = await waitForFee(page, "private", "private")
			expect(privateDefault).toMatchObject({ tag: null, action: "send", strip: { you: "hidden" } })

			await setActiveSendType(page, "send-from-type", "public")
			const publicDefault = await waitForFee(page, "public", "public")
			expect(publicDefault).toMatchObject({ tag: null, action: "send", strip: { you: "public" } })

			// Shield so the private sends below have something to spend (public origin → its default payer).
			await setActiveSendType(page, "send-to-type", "private")
			await fillAndSubmit(page, self, "100", "send")
			await waitForTxConfirmation(page, { amount: "100", fromType: "public", toType: "private", timeout: 120_000 })
			await page.close()
		}

		// A hand-picked sponsor: HIDDEN, one tap, the sheet never opens.
		{
			const page = await openPopup(feeJuiceImportedExtension)
			await waitForHash(page, "#/popup/general")
			await refreshBalances(page)
			await openSend(page)
			await setActiveSendType(page, "send-from-type", "private")
			await setActiveSendType(page, "send-to-type", "private")
			await waitForFee(page, "private", "private")

			await selectFeeMethod(page, "sponsored")
			expect(await waitForTag(page, null)).toMatchObject({ method: "sponsored", action: "send", strip: { you: "hidden" } })
			await fillAndSubmit(page, self, "5", "send")
			await waitForTxConfirmation(page, { amount: "5", fromType: "private", toType: "private", timeout: 120_000 })
			await page.close()
		}

		// A hand-picked Fee Juice: the tag, then the private → public wording, sent through the sheet.
		{
			const page = await openPopup(feeJuiceImportedExtension)
			await waitForHash(page, "#/popup/general")
			await refreshBalances(page)
			await openSend(page)
			await setActiveSendType(page, "send-from-type", "private")
			await setActiveSendType(page, "send-to-type", "private")
			// The pick survived: the sponsor, previewed while balances load and then in effect.
			await waitForFee(page, "private", "sponsored")
			await waitForTag(page, null)

			await selectFeeMethod(page, "public")
			expect(await waitForTag(page, "private-private")).toMatchObject({ action: "review", strip: { you: "exposed" } })

			await setActiveSendType(page, "send-to-type", "public")
			await waitForTag(page, "private-public")

			await fillSendForm(page, { amount: "10", destination: self })
			await pointerClick(page, "send-submit")
			await waitForReview(page, true)
			expect(await readReview(page)).toMatchObject({
				you: "exposed",
				shape: "private-public",
				to: "public",
				amount: "public",
				payer: "account",
			})
			await waitForReviewReady(page)
			await pointerClick(page, "send-review-submit")
			await waitForToast(page, "Transaction submitted", 60_000)
			await waitForSendGone(page)
			await waitForTxConfirmation(page, { amount: "10", fromType: "private", toType: "public", timeout: 120_000 })
			await page.close()
		}

		// A fresh popup: the pick survived, per origin, and still gates.
		{
			const page = await openPopup(feeJuiceImportedExtension)
			await waitForHash(page, "#/popup/general")
			await openSend(page)
			// The trigger previews the saved pick while balances load, and a preview pays nothing — so the
			// tag, not the trigger, is the signal that Fee Juice is the method in effect.
			await waitForFee(page, "private", "public")
			expect(await waitForTag(page, "private-private", 90_000)).toMatchObject({ action: "review" })

			// A public origin has no sender left to protect: the tag goes, and that origin keeps its own default.
			await setActiveSendType(page, "send-from-type", "public")
			expect(await waitForFee(page, "public", "public")).toMatchObject({ tag: null, action: "send", strip: { you: "public" } })

			// Back to private: the pick made under THIS origin returns, and the tag with it.
			await setActiveSendType(page, "send-from-type", "private")
			await setActiveSendType(page, "send-to-type", "private")
			await waitForFee(page, "private", "public")
			await waitForTag(page, "private-private")
			expect(await readSendPicks(page)).toEqual({ [self]: { private: { type: "fj" } } })

			await clearSendPicks(page)
			await page.close()
		}
	},
)
