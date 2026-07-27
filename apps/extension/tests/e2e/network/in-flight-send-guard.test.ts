/**
 * The in-flight-send switch guard, end to end.
 *
 * A send reads the active account while it builds and proves, so switching
 * mid-flight would let work already under way finish as the wrong account.
 * Rather than detect that drift and unwind it, the account switch is blocked
 * while a send is in flight.
 *
 * The proof gate parks a real send at `proving` — after the record is journaled,
 * before the proof completes — which is precisely the window the guard exists
 * to cover. Requires a PROVERLESS build (`NULO_E2E_PROVERLESS=1`): that is the
 * only build where the gate is compiled in. Run zero-retry
 * (`NULO_E2E_RETRY=0`) — the file mutates on-chain and PXE state, so a retry
 * would re-run against a half-consumed sandbox.
 */
import { expect, inject } from "vitest"
import type { Page } from "puppeteer"
import type { AztecTestConfig } from "../fixtures/aztec"
import { clickByTestId, openPopup, test, waitForHash } from "../fixtures/extension"
import { createSecondAccount, getAccountAddress, refreshBalances, sendTransfer, switchAccountByAddress } from "../fixtures/helpers"
import { holdProofGate, releaseProofGate } from "../fixtures/proof-gate"

const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
const hasConfig = aztecConfig !== undefined

/** Journal stages a send passes through before it is finished. */
const IN_FLIGHT_STAGES = ["queued", "pending", "simulating", "proving", "submitting"]

/** Read the active account straight from the header, without going through the popup. */
async function activeAccount(page: Page): Promise<string> {
	return getAccountAddress(page)
}

/** True once the profile has a journaled send that has not reached a terminal stage. */
async function waitForInFlightSend(page: Page, timeout = 60_000): Promise<void> {
	await page.waitForFunction(
		(stages: string[]) =>
			chrome.storage.local.get(null).then((all: Record<string, unknown>) =>
				Object.entries(all).some(([key, value]) => {
					if (!key.startsWith("nulo:journal@")) return false
					try {
						const row = JSON.parse(String(value)) as { kind?: string; progress?: { stage?: string } }
						return (row.kind === "transfer" || row.kind === "dapp_execute") && stages.includes(String(row.progress?.stage))
					} catch {
						return false
					}
				}),
			),
		{ timeout, polling: 250 },
		IN_FLIGHT_STAGES,
	)
}

/**
 * Try to switch accounts through the popup and report whether it took effect.
 *
 * Deliberately does NOT use `switchAccountByAddress`, which waits for the
 * switch to succeed — the whole point here is that it must not.
 */
async function attemptSwitch(page: Page, address: string): Promise<boolean> {
	await clickByTestId(page, "account-selector")
	await page.waitForSelector('[data-testid="accounts-popup"]', { visible: true, timeout: 5_000 })
	const selector = `[data-testid="account-item"][data-account-address="${address}"]`
	await page.waitForSelector(selector, { visible: true, timeout: 5_000 })
	await page.click(selector)

	// Give the switch a chance to land before concluding it was refused.
	await new Promise((resolve) => setTimeout(resolve, 1_000))
	return (await activeAccount(page)) === address
}

test.skipIf(!hasConfig)(
	"an account switch is refused while a send is in flight, and allowed once it settles",
	{ timeout: 600_000, retry: 0 },
	async ({ tokenReadyExtension }) => {
		// Each step is announced: when this fails, the last line printed names the
		// step that broke, instead of a bare Puppeteer timeout with no context.
		const step = async <T>(label: string, fn: () => Promise<T>): Promise<T> => {
			const started = Date.now()
			try {
				const result = await fn()
				console.log(`[guard-e2e] ${label} ok (${Date.now() - started}ms)`)
				return result
			} catch (err) {
				console.log(`[guard-e2e] ${label} FAILED after ${Date.now() - started}ms: ${(err as Error).message}`)
				throw err
			}
		}

		const page = await openPopup(tokenReadyExtension)
		// The popup's own routing has to settle before anything queries its DOM:
		// the tokens menu is not mounted the instant the page opens, and its
		// helpers wait only ~2s. Every other send test starts this way.
		await step("wait for the home screen", () => waitForHash(page, "#/popup/general", 15_000))
		await step("refreshBalances", () => refreshBalances(page))

		const sender = await step("read active account", () => activeAccount(page))
		const other = await step("create second account", () => createSecondAccount(page, "Guard target"))
		expect(other).not.toBe(sender)
		await step("switch back to sender", () => switchAccountByAddress(page, sender))

		// Hold the gate BEFORE sending so the transfer parks at `proving` — journaled
		// and in flight, proof not done — which is the window the guard covers.
		// Creating an account navigates into settings; the send flow lives on the
		// home screen, so go back before firing it.
		await step("return to the home screen", async () => {
			await page.evaluate(() => {
				window.location.hash = "#/popup/general"
			})
			await waitForHash(page, "#/popup/general", 10_000)
			await refreshBalances(page)
		})

		await step("hold proof gate", () => holdProofGate(page))
		// Deliberately not awaited: it cannot finish until the gate is released.
		const sending = sendTransfer(page, { fromType: "public", toType: "public", amount: "1", destination: other }).catch((err) => {
			console.log(`[guard-e2e] sendTransfer rejected: ${(err as Error).message}`)
			throw err
		})
		try {
			await step("wait for an in-flight send", () => waitForInFlightSend(page))

			// The guard refuses the switch; the header still shows the sender.
			expect(await step("attempt the blocked switch", () => attemptSwitch(page, other))).toBe(false)
			expect(await activeAccount(page)).toBe(sender)
		} finally {
			await releaseProofGate(page)
		}
		await sending

		// Once nothing is in flight the same switch goes through, so the guard
		// gates on the send rather than disabling switching outright.
		await page.waitForFunction(
			(stages: string[]) =>
				chrome.storage.local.get(null).then((all: Record<string, unknown>) =>
					Object.entries(all).every(([key, value]) => {
						if (!key.startsWith("nulo:journal@")) return true
						try {
							const row = JSON.parse(String(value)) as { kind?: string; progress?: { stage?: string } }
							if (row.kind !== "transfer" && row.kind !== "dapp_execute") return true
							return !stages.includes(String(row.progress?.stage))
						} catch {
							return true
						}
					}),
				),
			{ timeout: 180_000, polling: 500 },
			IN_FLIGHT_STAGES,
		)

		await switchAccountByAddress(page, other)
		expect(await activeAccount(page)).toBe(other)
	},
)
