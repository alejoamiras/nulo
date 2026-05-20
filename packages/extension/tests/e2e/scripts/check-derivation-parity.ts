/**
 * W3.0 — Derivation parity check.
 *
 * Verifies that an account address derived externally via Nulo's formulae
 * matches the address the extension produces post-importPlain + Local Network
 * switch. If they match, the WS3 fixture's setupPreFundedAccount approach is
 * viable. If not, fix the derivation BEFORE building the fixture.
 *
 * Run: bun run tests/e2e/scripts/check-derivation-parity.ts
 *
 * Per Codex audit Q2: chainId for Local Network is hardcoded `0` in
 * network/service.ts:85 (NOT pxe.getNodeInfo().l1ChainId).
 *
 * Per audit Q3: importPlain only opens the profile session; the popup's
 * onActiveProfileChanged → initNetworks → initAccount creates the first
 * account on the active network (default Testnet). Switching to Local
 * creates a SECOND account on chainId 0 — that's the one we compare.
 */
import { fileURLToPath } from "node:url"
import path from "node:path"
import puppeteer from "puppeteer"
import { Fr } from "@aztec/foundation/curves/bn254"
import { poseidon2Hash } from "@aztec/foundation/crypto/sync"
import { NuloAccount } from "@nulo/aztec-runtime/account"
import { createLogger } from "@aztec/foundation/log"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const EXTENSION_PATH = path.resolve(__dirname, "../../../dist/chrome")
const TEST_PASSWORD = "TestPassword123!"

// Mirrors AccountType.Nulo_v1 from packages/extension/src/wallet/services/account/spec.ts:5
// SECURITY: must match the enum exactly — used in poseidon2Hash for key derivation.
const ACCOUNT_TYPE_NULO_V1 = 0
// Local Network chainId per packages/extension/src/wallet/services/network/service.ts:85
const LOCAL_NETWORK_CHAIN_ID = 0

async function deriveExpectedAddress(master: Fr): Promise<{ address: string; masterBase64: string }> {
	const logger = createLogger("derivation-parity")
	const accountSecret = poseidon2Hash([master, new Fr(LOCAL_NETWORK_CHAIN_ID), new Fr(ACCOUNT_TYPE_NULO_V1), new Fr(0)])
	const accountContract = await NuloAccount.new(accountSecret, logger)
	const masterBase64 = Buffer.from(master.toBuffer()).toString("base64")
	return { address: accountContract.address.toString(), masterBase64 }
}

async function readPopupAddress(page: puppeteer.Page): Promise<string | null> {
	return page.evaluate(() => {
		const el = document.querySelector('[data-testid="account-address"]')
		return el?.textContent?.trim() ?? null
	})
}

async function main(): Promise<void> {
	// Use Fr.random() so the 32-byte buffer is always within the BN254 field
	// modulus — `Fr.fromBuffer` is strict (session-manager.ts:210). Random bytes
	// could otherwise exceed modulus and fail at unlock time.
	const master = Fr.random()
	const { address: expectedAddress, masterBase64 } = await deriveExpectedAddress(master)
	console.log(`[derivation-parity] expected address: ${expectedAddress}`)
	console.log(`[derivation-parity] masterBase64: ${masterBase64}`)

	const browser = await puppeteer.launch({
		headless: true,
		args: [
			`--disable-extensions-except=${EXTENSION_PATH}`,
			`--load-extension=${EXTENSION_PATH}`,
			"--no-sandbox",
			"--disable-setuid-sandbox",
		],
		ignoreDefaultArgs: ["--disable-extensions"],
	})

	try {
		const workerTarget = await browser.waitForTarget(
			(t) => t.type() === "service_worker" && t.url().includes("service-worker-loader"),
			{ timeout: 15_000 },
		)
		const extensionId = new URL(workerTarget.url()).hostname
		console.log(`[derivation-parity] extension id: ${extensionId}`)

		// Use a fresh page (matches openPopup fixture pattern) — pages[0] from
		// browser.pages() can be the implicit about:blank with restricted permissions.
		const blank = (await browser.pages())[0]
		await blank.goto(`chrome-extension://${extensionId}/src/popup/index.html`, { waitUntil: "domcontentloaded" })
		await blank.waitForFunction(
			async () => {
				try {
					const r = await chrome.storage.session.get("nulo:liveness")
					return !!r["nulo:liveness"]
				} catch {
					return false
				}
			},
			{ timeout: 15_000, polling: 500 },
		)
		await blank.goto("about:blank")

		const page = await browser.newPage()
		await page.setViewport({ width: 360, height: 600 })
		page.on("console", (msg) => console.log(`[browser-console][${msg.type()}] ${msg.text()}`))
		page.on("pageerror", (err) => console.error(`[browser-pageerror] ${err.message}`))

		await page.goto(`chrome-extension://${extensionId}/src/popup/index.html`, { waitUntil: "domcontentloaded" })

		// Wait for /popup/register (router lands here when no profile exists),
		// global-loader disappears (SW connection up), then navigate to import.
		await page.waitForFunction(() => window.location.hash.includes("/popup/register"), { timeout: 15_000 })
		await page.waitForFunction(() => !document.querySelector('[data-testid="global-loader"]'), {
			timeout: 15_000,
			polling: 500,
		})
		console.log("[derivation-parity] reached /popup/register; navigating to import")
		await page.evaluate(() => {
			window.location.hash = "#/popup/import"
		})
		await page.waitForFunction(() => window.location.hash.includes("/popup/import"), { timeout: 5_000 })

		// Click "Plain Key" import option
		await page.waitForSelector('[data-testid="import-option-private-key"]', { visible: true, timeout: 10_000 })
		await page.click('[data-testid="import-option-private-key"]')

		// Wait for inputs to mount, fill via v-model-aware setter (matches existing
		// e2e fixture pattern at extension.ts:replaceInputValue)
		await page.waitForSelector('[data-testid="import-private-key-input"] input', { visible: true, timeout: 10_000 })
		await page.evaluate(
			({ secretKey, pwd }: { secretKey: string; pwd: string }) => {
				const setVal = (sel: string, v: string) => {
					const input = document.querySelector<HTMLInputElement>(sel)
					if (!input) throw new Error(`input not found: ${sel}`)
					const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
					setter?.call(input, v)
					input.dispatchEvent(new Event("input", { bubbles: true }))
				}
				setVal('[data-testid="import-private-key-input"] input', secretKey)
				setVal('[data-testid="import-password-input"] input', pwd)
				setVal('[data-testid="import-password-confirm-input"] input', pwd)
			},
			{ secretKey: masterBase64, pwd: TEST_PASSWORD },
		)

		// Wait for submit button to be enabled (v-model bindings settled)
		await page.waitForFunction(
			() => {
				const btn = document.querySelector<HTMLButtonElement>('[data-testid="import-private-key-submit-btn"]')
				return btn && !btn.disabled
			},
			{ timeout: 5_000, polling: 100 },
		)

		// Submit + wait for /popup/general redirect
		await page.click('[data-testid="import-private-key-submit-btn"]')
		await page
			.waitForFunction(() => window.location.hash.includes("/popup/general"), { timeout: 30_000 })
			.catch(async () => {
				const hash = await page.evaluate(() => window.location.hash)
				const errText = await page.evaluate(() => {
					const el = document.querySelector('[data-testid*="error"]') ?? document.querySelector(".error")
					return el?.textContent ?? null
				})
				console.error(`[derivation-parity] timeout waiting for /popup/general — hash=${hash}, err=${errText}`)
				throw new Error("import did not redirect")
			})
		console.log("[derivation-parity] reached /popup/general")

		// Switch to Local Network — match helpers.ts:switchToNetwork. The header
		// chip now navigates to Manage Networks; the row drills into the per-
		// network detail page, where "Set as active" performs the switch.
		// SettingItem renders as <a href=null>; raw `.click()` doesn't reliably
		// fire, so the row tap uses a synthetic dispatchEvent like the canonical
		// helper does.
		await page.waitForSelector('[data-testid="network-button"]', { visible: true, timeout: 10_000 })
		await page.click('[data-testid="network-button"]')
		const localRowSel = '[data-testid="network-row"][data-network-name="Local Network"]'
		await page.waitForSelector(localRowSel, { visible: true, timeout: 5_000 })
		await page.evaluate((sel: string) => {
			const row = document.querySelector(sel) as HTMLElement | null
			row?.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
		}, localRowSel)
		await page.waitForSelector('[data-testid="network-set-active"]', { visible: true, timeout: 5_000 })
		await page.click('[data-testid="network-set-active"]')
		console.log("[derivation-parity] switched to Local Network")

		// Wait for the active account address to settle on the Local-chain account
		// (per Codex Q3: switching network creates a SECOND account on chainId 0).
		await page
			.waitForFunction(
				async (expected: string) => {
					const r = await chrome.storage.local.get("nulo:ui:activeAccount")
					return r["nulo:ui:activeAccount"] === expected
				},
				{ timeout: 30_000, polling: 500 },
				expectedAddress,
			)
			.catch(async () => {
				const actual = await page.evaluate(async () => {
					const r = await chrome.storage.local.get("nulo:ui:activeAccount")
					return r["nulo:ui:activeAccount"] ?? null
				})
				console.error(`[derivation-parity] ✗ MISMATCH after Local Network switch`)
				console.error(`  expected: ${expectedAddress}`)
				console.error(`  actual:   ${actual}`)
				throw new Error("derivation parity FAILED")
			})

		console.log("[derivation-parity] ✓ MATCH — derivation parity confirmed")
	} finally {
		await browser.close()
	}
}

main().catch((err) => {
	console.error("[derivation-parity] error:", err)
	process.exit(1)
})
