import type { HTTPRequest, Page } from "puppeteer"
import { afterEach, beforeEach, describe, expect } from "vitest"
import { withTimeoutMessage, clickByTestId, openOnboarding, replaceInputValue, test, waitForHash } from "./fixtures/extension"

// The page probes Presto HTTPS-first; after an HTTPS failure the SDK runs one witness-free HTTP
// diagnostic. Both are intercepted below the TLS handshake, so no certificate is needed.
const PRESTO_HTTPS_HEALTH_URL = "https://127.0.0.1:59834/health"
const PRESTO_HTTP_HEALTH_URL = "http://127.0.0.1:59833/health"
const PRESTO_DETAILED_HEALTH = {
	status: "ok",
	api_version: 1,
	version: "1.1.1",
	aztec_version: "5.2.0",
	available_versions: ["5.2.0"],
	bb_available: true,
	https_port: 59834,
}
/** What Presto serves an origin it has not approved yet. */
const PRESTO_MINIMAL_HEALTH = { status: "ok", api_version: 1 }
const TEST_PASSWORD = "OnboardingTest_!23"
const TEST_PROFILE_NAME = "Onboarding Test"

type HealthAnswer = { status: number; body: unknown } | "refused"

/** Answer the two health probes per scheme; every other request passes through. */
async function interceptHealth(page: Page, answers: { https: HealthAnswer; http: HealthAnswer }): Promise<void> {
	await page.setRequestInterception(true)
	const answer = (req: HTTPRequest, how: HealthAnswer) => {
		if (how === "refused") return req.abort("connectionrefused")
		return req.respond({ status: how.status, contentType: "application/json", body: JSON.stringify(how.body) })
	}
	page.on("request", (req) => {
		if (req.url() === PRESTO_HTTPS_HEALTH_URL) return answer(req, answers.https)
		if (req.url() === PRESTO_HTTP_HEALTH_URL) return answer(req, answers.http)
		return req.continue()
	})
}

async function gotoPrestoStep(page: Page): Promise<void> {
	await page.evaluate(() => {
		window.location.hash = "#/onboarding/presto"
	})
	await waitForHash(page, "#/onboarding/presto", 10_000)
}

const statusCardSelector = (status: string) => `[data-testid="onboarding-presto-status"][data-status="${status}"]`

describe("onboarding tab", () => {
	test("welcome screen renders both CTAs", async ({ freshExtensionPerTest: extension }) => {
		const page = await openOnboarding(extension)
		await page.waitForSelector('[data-testid="onboarding-welcome-create"]', { visible: true })
		await page.waitForSelector('[data-testid="onboarding-welcome-import"]', { visible: true })

		// Pins the a11y decision: app.vue#shell is the page's single `<main>` landmark;
		// OnboardingPage renders a `<div>` to avoid nesting. A future refactor swapping
		// the wrapper to `<main>` / `<section>` would fail this assertion immediately.
		const mainCount = await page.evaluate(() => document.querySelectorAll("main").length)
		expect(mainCount).toBe(1)

		await page.close()
	})

	test("create + password happy path walks to done and opens wallet popup window", async ({ freshExtensionPerTest: extension }) => {
		const page = await openOnboarding(extension)

		// Click create on welcome
		await clickByTestId(page, "onboarding-welcome-create")
		await waitForHash(page, "#/onboarding/create", 10_000)

		// Fill the name + password fields
		await replaceInputValue(page, '[data-testid="onboarding-name-input"]', TEST_PROFILE_NAME)
		await replaceInputValue(page, '[data-testid="onboarding-password-input"]', TEST_PASSWORD)
		await replaceInputValue(page, '[data-testid="onboarding-password-confirm"]', TEST_PASSWORD)

		await clickByTestId(page, "onboarding-submit-create")

		// Wait for the bootstrap to finish + route to /learn
		await waitForHash(page, "#/onboarding/learn", 30_000)

		// Continue from learn routes into the fee-juice explainer step. Skip on
		// learn routes straight to /presto — covered by the dedicated skip test below.
		await clickByTestId(page, "onboarding-learn-continue")
		await waitForHash(page, "#/onboarding/fees", 10_000)

		// Continue from /fees → /presto. Skip on /fees routes to the same
		// destination (the explainer is short; no value in a dedicated
		// skip-to-done shortcut).
		await clickByTestId(page, "onboarding-fees-continue")
		await waitForHash(page, "#/onboarding/presto", 10_000)

		// Wait for the step to settle: the install pitch (no Presto on the box) or a
		// status card in a terminal state. Continue only renders when proving can go
		// native; otherwise Skip routes directly to /done.
		const settled = await withTimeoutMessage(
			page
				.waitForFunction(
					() => {
						const pitch = document.querySelector<HTMLElement>('[data-testid="onboarding-presto-pitch"]')
						if (pitch && pitch.style.display !== "none") return "pitch"
						const s = document.querySelector('[data-testid="onboarding-presto-status"]')?.getAttribute("data-status")
						return s && s !== "idle" && s !== "detecting" ? s : null
					},
					{ timeout: 20_000, polling: 200 },
				)
				.then((handle) => handle.jsonValue()),
			async () => {
				const seen = await page
					.evaluate(
						() => document.querySelector('[data-testid="onboarding-presto-status"]')?.getAttribute("data-status") ?? "<absent>",
					)
					.catch(() => "<unreadable>")
				return `onboarding presto step never settled within 20s (last: ${seen})`
			},
		)
		if (settled === "available" || settled === "downloading") {
			await clickByTestId(page, "onboarding-presto-continue")
		} else {
			await clickByTestId(page, "onboarding-presto-skip")
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
		await page
			.waitForFunction(
				async () => {
					const r = await chrome.storage.local.get("nulo:onboarding:completed")
					return r["nulo:onboarding:completed"] === true
				},
				{ timeout: 5_000, polling: 100 },
			)
			.catch(async () => {
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

	test("the harness can answer the HTTPS health probe before any TLS handshake", async ({ freshExtensionPerTest: extension }) => {
		const page = await openOnboarding(extension)
		await interceptHealth(page, { https: { status: 200, body: PRESTO_MINIMAL_HEALTH }, http: "refused" })
		const body = await page.evaluate(async (url) => (await fetch(url)).json(), PRESTO_HTTPS_HEALTH_URL)
		expect(body).toEqual(PRESTO_MINIMAL_HEALTH)
		await page.close()
	})

	test("presto available renders the connected card and an enabled Continue", async ({ freshExtensionPerTest: extension }) => {
		const page = await openOnboarding(extension)
		// A healthy HTTPS Presto whose cached versions include the wallet's Aztec line.
		await interceptHealth(page, { https: { status: 200, body: PRESTO_DETAILED_HEALTH }, http: "refused" })
		await gotoPrestoStep(page)

		await page.waitForSelector(statusCardSelector("available"), { visible: true, timeout: 10_000 })
		const state = await page.evaluate(() => {
			const btn = document.querySelector<HTMLButtonElement>('[data-testid="onboarding-presto-continue"]')
			return {
				rendered: !!btn,
				disabled: btn?.disabled ?? null,
				skip: !!document.querySelector('[data-testid="onboarding-presto-skip"]'),
			}
		})
		expect(state).toEqual({ rendered: true, disabled: false, skip: false })

		await page.close()
	})

	test("skip links on /learn and /fees both route to /presto (split-handler pin)", async ({ freshExtensionPerTest: extension }) => {
		// Drive the two skip buttons directly: each skip is its own handler routing to
		// /presto (not /done). Without this pin, a future refactor that consolidates
		// handlers could silently fan one of them to the wrong target.
		const page = await openOnboarding(extension)

		await page.evaluate(() => {
			window.location.hash = "#/onboarding/learn"
		})
		await waitForHash(page, "#/onboarding/learn", 10_000)
		await clickByTestId(page, "onboarding-learn-skip")
		await waitForHash(page, "#/onboarding/presto", 10_000)

		await page.evaluate(() => {
			window.location.hash = "#/onboarding/fees"
		})
		await waitForHash(page, "#/onboarding/fees", 10_000)
		await clickByTestId(page, "onboarding-fees-skip")
		await waitForHash(page, "#/onboarding/presto", 10_000)

		await page.close()
	})

	test("nothing listening on either port renders the install pitch; Skip routes to /done", async ({
		freshExtensionPerTest: extension,
	}) => {
		const page = await openOnboarding(extension)
		// Both probes refused is what an uninstalled Presto looks like to the page.
		await interceptHealth(page, { https: "refused", http: "refused" })
		await gotoPrestoStep(page)

		await page.waitForSelector('[data-testid="onboarding-presto-pitch"]', { visible: true, timeout: 10_000 })
		const state = await page.evaluate(() => ({
			card: !!document.querySelector('[data-testid="onboarding-presto-status"]'),
			continue: !!document.querySelector('[data-testid="onboarding-presto-continue"]'),
			retry: !!document.querySelector('[data-testid="onboarding-presto-retry"]'),
		}))
		expect(state).toEqual({ card: false, continue: false, retry: true })

		await clickByTestId(page, "onboarding-presto-skip")
		await waitForHash(page, "#/onboarding/done", 5_000)

		await page.close()
	})

	test("HTTPS refused + a detailed HTTP body without https_port is the encrypted-connection card (https-disabled)", async ({
		freshExtensionPerTest: extension,
	}) => {
		const page = await openOnboarding(extension)
		const { https_port: _omitted, ...withoutHttpsPort } = PRESTO_DETAILED_HEALTH
		await interceptHealth(page, { https: "refused", http: { status: 200, body: withoutHttpsPort } })
		await gotoPrestoStep(page)

		await page.waitForSelector(statusCardSelector("secure-connection-unavailable"), { visible: true, timeout: 10_000 })
		const state = await page.evaluate(() => {
			const card = document.querySelector('[data-testid="onboarding-presto-status"]')
			return {
				diagnosis: card?.getAttribute("data-diagnosis"),
				steps: card?.querySelectorAll("li").length,
				continue: !!document.querySelector('[data-testid="onboarding-presto-continue"]'),
				skip: !!document.querySelector('[data-testid="onboarding-presto-skip"]'),
			}
		})
		expect(state).toEqual({ diagnosis: "https-disabled", steps: 3, continue: false, skip: true })

		await page.close()
	})

	test("HTTPS refused + the minimal HTTP body is the presto-reachable copy", async ({ freshExtensionPerTest: extension }) => {
		const page = await openOnboarding(extension)
		await interceptHealth(page, { https: "refused", http: { status: 200, body: PRESTO_MINIMAL_HEALTH } })
		await gotoPrestoStep(page)

		await page.waitForSelector(statusCardSelector("secure-connection-unavailable"), { visible: true, timeout: 10_000 })
		const diagnosis = await page.evaluate(
			() => document.querySelector('[data-testid="onboarding-presto-status"]')?.getAttribute("data-diagnosis") ?? null,
		)
		expect(diagnosis).toBe("presto-reachable")

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
