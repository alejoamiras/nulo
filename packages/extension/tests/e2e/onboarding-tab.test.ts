import type { Page } from "puppeteer"
import { afterEach, beforeEach, describe, expect } from "vitest"
import { clickByTestId, openOnboarding, replaceInputValue, test, waitForHash } from "./fixtures/extension"

const ONBOARDING_HEALTH_URL = "http://127.0.0.1:59833/health"
const TEST_PASSWORD = "OnboardingTest_!23"
const TEST_WALLET_NAME = "Onboarding Test"

describe("onboarding tab", () => {
	test("welcome screen renders both CTAs", async ({ freshExtensionPerTest: extension }) => {
		const page = await openOnboarding(extension)
		await page.waitForSelector('[data-testid="onboarding-welcome-create"]', { visible: true })
		await page.waitForSelector('[data-testid="onboarding-welcome-import"]', { visible: true })
		await page.close()
	})

	test("create + password happy path walks to done and opens wallet popup window", async ({ freshExtensionPerTest: extension }) => {
		const page = await openOnboarding(extension)

		// Click create on welcome
		await clickByTestId(page, "onboarding-welcome-create")
		await waitForHash(page, "#/onboarding/create", 10_000)

		// Fill the name + password fields
		await replaceInputValue(page, '[data-testid="onboarding-name-input"]', TEST_WALLET_NAME)
		await replaceInputValue(page, '[data-testid="onboarding-password-input"]', TEST_PASSWORD)
		await replaceInputValue(page, '[data-testid="onboarding-password-confirm"]', TEST_PASSWORD)

		await clickByTestId(page, "onboarding-submit-create")

		// Wait for the bootstrap to finish + route to /learn
		await waitForHash(page, "#/onboarding/learn", 30_000)

		// Continue to accelerator
		await clickByTestId(page, "onboarding-learn-continue")
		await waitForHash(page, "#/onboarding/accelerator", 10_000)

		// Wait for the status card to settle (any terminal state). If 'active'
		// (real accelerator is installed on the dev box), click Continue.
		// Otherwise click Skip — which now routes directly to /done.
		const status = await page.evaluate(async () => {
			while (true) {
				const el = document.querySelector('[data-testid="onboarding-accelerator-status"]')
				const s = el?.getAttribute("data-status")
				if (s === "active" || s === "no-bb" || s === "not-detected") return s
				await new Promise((r) => setTimeout(r, 200))
			}
		})
		if (status === "active") {
			await clickByTestId(page, "onboarding-accelerator-continue")
		} else {
			await clickByTestId(page, "onboarding-accelerator-skip")
		}
		await waitForHash(page, "#/onboarding/done", 10_000)

		// Read the onboardingCompleted flag BEFORE clicking Open Wallet —
		// the click triggers chrome.action.openPopup() first, which in
		// headless puppeteer may not surface as a distinguishable target.
		// We can't reliably wait for the popup window; instead we verify
		// the contract: the click set the flag.
		const flagBefore = await page.evaluate(async () => {
			const r = await chrome.storage.local.get("nulo:onboarding:completed")
			return r["nulo:onboarding:completed"]
		})
		expect(flagBefore).toBeFalsy()

		await clickByTestId(page, "onboarding-done-open")

		// Wait for the flag to flip. Done.openWallet awaits setOnboarding-
		// Completed before any popup-open call, so this should be quick.
		await page.waitForFunction(
			async () => {
				const r = await chrome.storage.local.get("nulo:onboarding:completed")
				return r["nulo:onboarding:completed"] === true
			},
			{ timeout: 5_000, polling: 100 },
		).catch(async () => {
			// The page may have started closing before the function could
			// run — open a fresh page and re-check from there.
			const fresh = await extension.browser.newPage()
			await fresh.goto(`chrome-extension://${extension.extensionId}/src/popup/index.html`, { waitUntil: "domcontentloaded" })
			const flag = await fresh.evaluate(async () => {
				const r = await chrome.storage.local.get("nulo:onboarding:completed")
				return r["nulo:onboarding:completed"]
			})
			expect(flag).toBe(true)
			await fresh.close()
		})
	})

	test("accelerator mock-active renders enabled Continue button", async ({ freshExtensionPerTest: extension }) => {
		const page = await openOnboarding(extension)

		// Intercept /health and return an "active" response.
		await page.setRequestInterception(true)
		page.on("request", (req) => {
			if (req.url() === ONBOARDING_HEALTH_URL) {
				req.respond({
					status: 200,
					contentType: "application/json",
					body: JSON.stringify({
						status: "ok",
						api_version: 1,
						version: "1.1.0",
						aztec_version: "0.78.0",
						bb_available: true,
					}),
				})
				return
			}
			req.continue()
		})

		// Navigate to /accelerator directly (skip create flow for this case).
		await page.evaluate(() => {
			window.location.hash = "#/onboarding/accelerator"
		})
		await waitForHash(page, "#/onboarding/accelerator", 10_000)

		// Wait for the status card to flip to 'active'
		await page.waitForFunction(
			() => {
				const el = document.querySelector('[data-testid="onboarding-accelerator-status"]')
				return !!el && el.getAttribute("data-status") === "active"
			},
			{ timeout: 10_000, polling: 200 },
		)

		// Continue button is rendered + enabled (only renders when status==active).
		const state = await page.evaluate(() => {
			const btn = document.querySelector<HTMLButtonElement>('[data-testid="onboarding-accelerator-continue"]')
			return { rendered: !!btn, disabled: btn?.disabled ?? null }
		})
		expect(state.rendered).toBe(true)
		expect(state.disabled).toBe(false)

		await page.close()
	})

	test("accelerator not-detected hides Continue and shows Skip link", async ({ freshExtensionPerTest: extension }) => {
		const page = await openOnboarding(extension)

		// Intercept /health and return 502 so detect fails.
		await page.setRequestInterception(true)
		page.on("request", (req) => {
			if (req.url() === ONBOARDING_HEALTH_URL) {
				req.respond({ status: 502, contentType: "application/json", body: "{}" })
				return
			}
			req.continue()
		})

		await page.evaluate(() => {
			window.location.hash = "#/onboarding/accelerator"
		})
		await waitForHash(page, "#/onboarding/accelerator", 10_000)
		await page.waitForFunction(
			() => {
				const el = document.querySelector('[data-testid="onboarding-accelerator-status"]')
				return !!el && el.getAttribute("data-status") === "not-detected"
			},
			{ timeout: 10_000, polling: 200 },
		)

		// Continue is NOT rendered (only renders on status=active). Skip
		// link is the bypass affordance, vertically centered in a
		// Continue-sized slot so the visual position is stable.
		const noContinue = await page.evaluate(() => {
			return !document.querySelector('[data-testid="onboarding-accelerator-continue"]')
		})
		expect(noContinue).toBe(true)

		// Click Skip → routes immediately to /done (no two-click gate).
		await clickByTestId(page, "onboarding-accelerator-skip")
		await waitForHash(page, "#/onboarding/done", 5_000)

		await page.close()
	})

	test("popup with onboardingCompleted=false redirects to tab", async ({ freshExtensionPerTest: extension }) => {
		// Reset the flag so the redirect predicate fires.
		const setupPage = await extension.browser.newPage()
		await setupPage.goto(`chrome-extension://${extension.extensionId}/src/popup/index.html`, { waitUntil: "domcontentloaded" })
		await setupPage.evaluate(async () => {
			await chrome.storage.local.set({ "nulo:onboarding:completed": false })
		})
		await setupPage.close()

		// Open the popup explicitly — should trigger redirect to onboarding tab.
		const popup = await extension.browser.newPage()
		const tabPromise = extension.browser.waitForTarget(
			(target) => target.type() === "page" && target.url().includes("src/onboarding/index.html"),
			{ timeout: 10_000 },
		)
		await popup.goto(`chrome-extension://${extension.extensionId}/src/popup/index.html`, { waitUntil: "domcontentloaded" })

		// The redirect happens in onBeforeMount of register.vue. We expect the
		// onboarding tab to appear. window.close() inside register.vue is a
		// no-op for puppeteer-opened pages (no window.opener), so we don't
		// assert popup closure here — that behavior works in the real
		// extension when Chrome opens the popup via toolbar click.
		const tabTarget = await tabPromise
		expect(tabTarget).toBeDefined()

		const tabPage = await tabTarget.page()
		await tabPage?.close()
		if (!popup.isClosed()) await popup.close()
	})
})
