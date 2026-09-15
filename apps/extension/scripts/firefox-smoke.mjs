/**
 * Boots the Firefox build in a real headless Firefox and walks the first-run path:
 * install → create a password profile → home screen with a balance → the hidden offscreen
 * stand-in window exists → lock → unlock. Firefox is driven over WebDriver BiDi because
 * Playwright cannot load extensions into Firefox.
 *
 * Prerequisites: `bun run build:firefox`, and a Firefox Puppeteer can find — either
 * `bunx puppeteer browsers install firefox` or FIREFOX_PATH pointing at a binary.
 * HEADED=1 shows the browser.
 */
import { fileURLToPath } from "node:url"
import puppeteer from "puppeteer"

const DIST = fileURLToPath(new URL("../dist/firefox", import.meta.url))
const PASSWORD = "firefox-smoke-password-1"
const t0 = Date.now()
const log = (...args) => console.log(`${String(Date.now() - t0).padStart(6)}ms`, ...args)
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const browser = await puppeteer.launch({
	browser: "firefox",
	protocol: "webDriverBiDi",
	headless: process.env.HEADED !== "1",
	executablePath: process.env.FIREFOX_PATH,
	args: ["--no-remote"],
})
let page
try {
	await browser.installExtension(DIST)
	log("installed", DIST)

	// The first-run onboarding tab is the one extension page BiDi can reach: tabs the extension
	// opens later are invisible to it, and a web tab may not navigate to moz-extension://.
	for (let i = 0; i < 20 && !page; i++) {
		await sleep(500)
		page = (await browser.pages()).find((p) => p.url().startsWith("moz-extension://"))
	}
	if (!page) throw new Error("no extension page opened after install (first-run tab expected)")
	page.on("pageerror", (error) => log("pageerror:", String(error).slice(0, 200)))
	await page.evaluate((url) => location.assign(url), new URL("/src/popup/index.html#/popup/general", page.url()).href)
	await page.waitForFunction(() => location.pathname.endsWith("/src/popup/index.html"), { timeout: 30_000 })
	log("popup document loaded")
	await page.waitForFunction(() => location.hash.startsWith("#/popup/register"), { timeout: 30_000 })
	await page.waitForFunction(() => !document.querySelector('[data-testid="global-loader"]'), { timeout: 30_000 })
	log("popup reached the register page; background connected")

	// Vue inputs: set through the prototype setter so v-model sees the change.
	const setInput = (testid, value) =>
		page.evaluate(
			({ testid, value }) => {
				const host = [...document.querySelectorAll(`[data-testid="${testid}"]`)].find((el) => el.offsetParent !== null)
				const input = host instanceof HTMLInputElement ? host : host?.querySelector("input")
				if (!input) throw new Error(`no visible input for ${testid}`)
				input.focus()
				Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, value)
				input.dispatchEvent(new Event("input", { bubbles: true }))
				input.dispatchEvent(new Event("change", { bubbles: true }))
			},
			{ testid, value },
		)
	await page.click('[data-testid="register-create-btn"]')
	await page.waitForSelector('[data-testid="register-submit-btn"]', { visible: true, timeout: 30_000 })
	await setInput("register-name-input", "Firefox Smoke")
	await page.waitForSelector('[data-testid="register-password-input"]', { visible: true, timeout: 30_000 })
	await setInput("register-password-input", PASSWORD)
	await setInput("register-password-confirm-input", PASSWORD)
	await page.click('[data-testid="register-submit-btn"]')
	log("profile creation submitted")

	const expectHome = async (label) => {
		await page.waitForFunction(() => location.hash.startsWith("#/popup/general"), { timeout: 60_000 })
		await page.waitForSelector('[data-testid="balance-amount"]', { visible: true, timeout: 120_000 })
		const balance = await page.$eval('[data-testid="balance-amount"]', (el) => el.textContent?.trim())
		log(`${label}: home screen, balance ${balance}`)
	}
	await expectHome("after create")

	// No chrome.offscreen in Firefox: the PXE host is a hidden minimized window instead.
	const windows = await page.evaluate(async () =>
		(await chrome.windows.getAll({ populate: true })).map((w) => ({
			state: w.state,
			urls: (w.tabs ?? []).map((t) => (t.url ?? "").replace(/^moz-extension:\/\/[^/]+\//, "")),
		})),
	)
	const offscreen = windows.find((w) => w.urls.some((u) => u.startsWith("src/offscreen/index.html?instance=")))
	if (!offscreen) throw new Error(`offscreen stand-in window missing: ${JSON.stringify(windows)}`)
	log(`offscreen stand-in window present (${offscreen.state})`)

	await page.click('[data-testid="header-lock"]')
	await page.waitForSelector('[data-testid="auth-password-input"]', { visible: true, timeout: 30_000 })
	log("locked: auth page")
	await setInput("auth-password-input", PASSWORD)
	await page.click('[data-testid="auth-submit"]')
	await expectHome("after unlock")
	log("PASS")
} catch (error) {
	const state = await page
		?.evaluate(() => ({ url: location.href, text: document.body.innerText.replace(/\s+/g, " ").slice(0, 200) }))
		.catch(() => undefined)
	log("FAIL", JSON.stringify(state))
	throw error
} finally {
	await browser.close()
}
