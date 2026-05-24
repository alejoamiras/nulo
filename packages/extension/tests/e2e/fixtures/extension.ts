import puppeteer, { TimeoutError, type Browser, type Page, type ConsoleMessage } from "puppeteer"
import { test as base, inject } from "vitest"
import { switchToLocalNetwork, importToken, getAccountAddress, refreshBalances } from "./helpers"
import type { AztecTestConfig } from "./aztec"

export interface ExtensionContext {
	browser: Browser
	extensionId: string
	consoleErrors: string[]
	pageErrors: Error[]
}

/** Launch a fresh browser with the extension and wait for SW liveness.
 *  Exported so test files that need a fully-clean extension (no profile
 *  registered, no networks switched) can build their own fixture. */
export async function launchExtension(): Promise<ExtensionContext> {
	const extensionPath = inject("extensionPath")

	// Headless `true` (the modern default in Puppeteer 24+) supports MV3
	// extensions (offscreen docs, SW, chrome.storage, chrome.runtime.Port).
	// `"new"` was the predecessor name that's now deprecated as a value;
	// passing it here historically generated a deprecation warning that we
	// ignored. Setting HEADLESS=0 in the environment flips to windowed mode
	// for local debugging.
	const headless: boolean = process.env.HEADLESS !== "0"
	const browser = await puppeteer.launch({
		headless,
		args: [
			`--disable-extensions-except=${extensionPath}`,
			`--load-extension=${extensionPath}`,
			"--no-sandbox",
			"--disable-setuid-sandbox",
			"--window-size=400,600",
			// Prevent Chrome from throttling background/offscreen tabs. Headless
			// Chrome doesn't have a "focused" page, so without these flags the
			// renderer backgrounds the tab and rAF gets throttled to ~1Hz —
			// which freezes Vue's `<Transition>` classes mid-enter and breaks
			// any test that depends on a popup actually rendering.
			"--disable-renderer-backgrounding",
			"--disable-backgrounding-occluded-windows",
			"--disable-features=CalculateNativeWinOcclusion",
		],
		ignoreDefaultArgs: ["--disable-extensions"],
		// Default protocolTimeout is 180_000ms — bump to 300_000 because the
		// wallet's argon2 KDF unlock + bb.js wasm boot can spike CDP latency
		// past 3 minutes on cold first run when vitest's worker pool has
		// the host under memory pressure. Past timeouts (e.g. profile-export
		// reveal flow) showed the unlock completed eventually but the CDP
		// reply was lost because the call timed out.
		protocolTimeout: 300_000,
	})

	// Discover extension ID from service worker target
	const workerTarget = await browser.waitForTarget(
		(target) => target.type() === "service_worker" && target.url().includes("service-worker-loader"),
		{ timeout: 30_000 },
	)
	const extensionId = new URL(workerTarget.url()).hostname

	// Wait for SW to fully initialize (liveness signal in chrome.storage.session).
	// runtime.ts writes the first liveness immediately after initWalletSdkHandler;
	// 30s timeout matches the helper in sw-resilience.test.ts and gives headroom
	// for slow CI runners on cold-boot Barretenberg wasm + service-graph init.
	const pages = await browser.pages()
	const blankPage = pages[0]
	patchPagePolling(blankPage)
	await blankPage.goto(`chrome-extension://${extensionId}/src/popup/index.html`, {
		waitUntil: "domcontentloaded",
	})
	await blankPage.waitForFunction(
		async () => {
			try {
				const result = await chrome.storage.session.get("nulo:liveness")
				return !!result["nulo:liveness"]
			} catch {
				return false
			}
		},
		{ timeout: 30_000, polling: 500 },
	)

	// Default: bypass the new onboarding tab flow for all e2e tests. Existing
	// tests (registration, import-paths, passkey-paths, etc.) drive the
	// popup-based create/import flows directly via openPopup. Setting
	// onboardingCompleted=true makes popup/pages/register.vue + import.vue
	// skip their redirect-to-tab logic. Tests that specifically exercise the
	// onboarding tab flow (tests/e2e/onboarding-tab.test.ts) reset this flag
	// in their own setup before driving the tab.
	await blankPage.evaluate(async () => {
		await chrome.storage.local.set({ "nulo:onboarding:completed": true })
	})

	await blankPage.goto("about:blank")

	return { browser, extensionId, consoleErrors: [], pageErrors: [] }
}

/** Open the onboarding tab directly. Use in tests that exercise the tab
 *  flow; complementary to `openPopup` which targets the popup HTML.
 *  Clears the `onboardingCompleted` flag first so the redirect predicates
 *  in register/import/profile-new behave as they would on a fresh install. */
export async function openOnboarding(ctx: ExtensionContext): Promise<Page> {
	// Reset onboardingCompleted=false so the onboarding flow runs as on
	// fresh install (launchExtension seeded it to true by default).
	const setupPage = await ctx.browser.newPage()
	patchPagePolling(setupPage)
	await setupPage.goto(`chrome-extension://${ctx.extensionId}/src/popup/index.html`, { waitUntil: "domcontentloaded" })
	await setupPage.evaluate(async () => {
		await chrome.storage.local.set({ "nulo:onboarding:completed": false })
	})
	await setupPage.close()

	const page = await ctx.browser.newPage()
	patchPagePolling(page)
	await page.setViewport({ width: 720, height: 900 })
	await page.bringToFront()

	ctx.consoleErrors = []
	ctx.pageErrors = []

	page.on("console", (msg: ConsoleMessage) => {
		if (msg.type() === "error") {
			ctx.consoleErrors.push(msg.text())
		}
	})
	page.on("pageerror", (err: Error) => {
		ctx.pageErrors.push(err)
	})

	const url = `chrome-extension://${ctx.extensionId}/src/onboarding/index.html#/onboarding/welcome`
	await page.goto(url, { waitUntil: "domcontentloaded" })
	// Wait for Vue mount: welcome CTA must render.
	await page.waitForSelector('[data-testid="onboarding-welcome-create"]', { visible: true, timeout: 30_000 })
	return page
}

/** Register a profile with a test password. Leaves the extension on #/popup/general. */
async function registerProfile(ctx: ExtensionContext): Promise<void> {
	const page = await openPopup(ctx)

	await waitForHash(page, "#/popup/register")

	// Wait for GlobalLoader to disappear (SW must connect first)
	await page.waitForFunction(() => !document.querySelector('[data-testid="global-loader"]'), {
		timeout: 30_000,
		polling: 500,
	})

	await clickByTestId(page, "register-create-btn")

	// Wait for RegisterPopup submit button to mount
	await page.waitForSelector('[data-testid="register-submit-btn"]', {
		visible: true,
		timeout: 30_000,
	})

	// Profile name is required at submit time (F1: pre-create explicit
	// naming). Without typing, validateName() short-circuits the handler.
	await replaceInputValue(page, '[data-testid="register-name-input"]', "Test Profile")

	await page.waitForSelector('input[placeholder="Strong password"]', {
		visible: true,
		timeout: 30_000,
	})

	const testPassword = "TestPassword123!"
	await typeIntoInput(page, "Strong password", testPassword)
	await typeIntoInput(page, "Repeat password", testPassword)

	// Submit (waitForFunction inside clickByTestId gates on :disabled)
	await clickByTestId(page, "register-submit-btn")

	await waitForHash(page, "#/popup/general", 30_000)
	await page.waitForSelector('[data-testid="balance-amount"]', { visible: true, timeout: 30_000 })
	await page.close()
}

/**
 * Drive the wallet-sdk handshake through the local @nulo/playground page:
 *   1) Open the playground (?test=1 disables HMR + persistence)
 *   2) Click `pg-btn-connect` — fires `WalletManager.getAvailableWallets`
 *   3) Approve at `/windows/discover` (testid `discover-allow-btn`)
 *   4) After ECDH key exchange, approve at `/windows/verify`
 *   5) Wait for the playground status pill to flip to `connected`
 *
 * Returns the dApp Page so the caller can keep driving it; the caller is
 * responsible for closing it (or letting the browser teardown handle it).
 */
async function connectPlayground(ctx: ExtensionContext): Promise<Page> {
	const { openPlayground } = await import("./playground")
	const { waitForPopup, approveDiscover, approveVerify } = await import("./popups")

	const dappPage = await openPlayground(ctx)

	// Set up popup listeners BEFORE the click so we don't miss the events.
	const discoverP = waitForPopup(ctx, "discover", { timeout: 30_000 })

	// Bumped from 5s to 30s — under network-suite load the playground vite
	// server cold-load + dapp Vue mount can take 10-20s; clickByTestId polls
	// for ~10s on its own which is still usually enough, but the explicit
	// waitForSelector here was the load-bearing 5s timeout that cascaded
	// into ~40 fixture failures.
	await dappPage.waitForSelector('[data-testid="pg-btn-connect"]', { visible: true, timeout: 30_000 })
	await clickByTestId(dappPage, "pg-btn-connect")

	const discoverPage = await discoverP
	await approveDiscover(discoverPage)

	const verifyPage = await waitForPopup(ctx, "verify", { timeout: 30_000 })
	await approveVerify(verifyPage)

	await dappPage.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 20_000 })
	return dappPage
}

// ── Fixtures ────────────────────────────────────────────────────────────

export const test = base.extend<{
	/** Fresh browser with extension loaded, no profile. */
	extension: ExtensionContext
	/** Fresh browser with extension + registered profile on #/popup/general. */
	registeredExtension: ExtensionContext
	/** Like `registeredExtension` but a fresh browser per test. Use this
	 *  for tests that wipe profile/account state mid-flow (reset-profile,
	 *  destructive recovery flows) so the wipe doesn't leak into siblings. */
	registeredExtensionPerTest: ExtensionContext
	/** Registered extension + Local Network + dapp connected via @nulo/playground.
	 *  File-scoped: shared across tests in the same file. Use `dappConnectedExtensionPerTest`
	 *  for parameterized files where each case needs a clean session. */
	dappConnectedExtension: ExtensionContext & { playgroundPage: Page }
	/** Like `dappConnectedExtension` but per-test fresh browser/session. Use this
	 *  for files with multiple parameterized cases (sim-methods, authwit-variants,
	 *  tx-sendTx-multicall) so cap state from one case doesn't leak to the next. */
	dappConnectedExtensionPerTest: ExtensionContext & { playgroundPage: Page }
	/** Fresh browser with extension loaded, **no profile registered**. Per-test
	 *  scope. Use for tests that drive the import or register flow from
	 *  scratch (e.g. tests/e2e/import-paths.test.ts). */
	freshExtensionPerTest: ExtensionContext
	/** Registered + switched to Local Network. */
	localNetworkExtension: ExtensionContext
	/** Local network + token imported + public tokens minted to account. */
	tokenReadyExtension: ExtensionContext & { accountAddress: string }
	/** Token ready + FeeJuice bridged and claimed to account. */
	feeJuiceReadyExtension: ExtensionContext & { accountAddress: string }
	/** Extension imports a pre-funded account via importPlain. The account has
	 *  both public + private FeeJuice on Local Network, ready for fee-methods.test
	 *  scenarios. WS3 (Phase 2F) re-enable. */
	feeJuiceImportedExtension: ExtensionContext & { accountAddress: string }
}>({
	extension: [
		// biome-ignore lint/correctness/noEmptyPattern: vitest fixture API requires {} destructuring
		async ({}, use) => {
			const ctx = await launchExtension()
			await use(ctx)
			await ctx.browser.close()
		},
		{ scope: "file" },
	],

	registeredExtension: [
		// biome-ignore lint/correctness/noEmptyPattern: vitest fixture API requires {} destructuring
		async ({}, use) => {
			const ctx = await launchExtension()
			await registerProfile(ctx)
			await use(ctx)
			await ctx.browser.close()
		},
		{ scope: "file" },
	],

	registeredExtensionPerTest: [
		// biome-ignore lint/correctness/noEmptyPattern: vitest fixture API requires {} destructuring
		async ({}, use) => {
			const ctx = await launchExtension()
			await registerProfile(ctx)
			await use(ctx)
			await ctx.browser.close()
		},
		{ scope: "test" },
	],

	freshExtensionPerTest: [
		// biome-ignore lint/correctness/noEmptyPattern: vitest fixture API requires {} destructuring
		async ({}, use) => {
			const ctx = await launchExtension()
			await use(ctx)
			await ctx.browser.close()
		},
		{ scope: "test" },
	],

	dappConnectedExtension: [
		async ({ registeredExtension }, use) => {
			// CRITICAL: switch to Local Network BEFORE connecting the playground.
			// The playground passes Fr.ZERO chainInfo (= chainId 0 = Local Network);
			// without this switch the extension defaults to Testnet, where there are
			// no accounts → cap-account-item list is empty → every accounts/sendTx/
			// sim test fails. (Confirmed by Codex audit run 1 — Codex 2026-04-26.)
			const setupPage = await openPopup(registeredExtension)
			await waitForHash(setupPage, "#/popup/general", 30_000)
			await switchToLocalNetwork(setupPage)
			await setupPage.close()
			const playgroundPage = await connectPlayground(registeredExtension)
			await use(Object.assign(registeredExtension, { playgroundPage }))
		},
		{ scope: "file" },
	],

	dappConnectedExtensionPerTest: [
		// biome-ignore lint/correctness/noEmptyPattern: vitest fixture API requires {} destructuring
		async ({}, use) => {
			// Phase-tag each setup step. A failure here previously surfaced
			// downstream as `Cannot read properties of undefined (reading
			// 'playgroundPage')` — the test body destructured the fixture
			// result, but use() never ran because setup threw. The tag
			// converts that opaque collapse into a precise origin line.
			const phase = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
				try {
					return await fn()
				} catch (err) {
					const msg = err instanceof Error ? err.message : String(err)
					throw new Error(`[dappConnectedExtensionPerTest:${name}] ${msg}`)
				}
			}
			const ctx = await phase("launchExtension", () => launchExtension())
			await phase("registerProfile", () => registerProfile(ctx))
			const setupPage = await phase("openPopup", () => openPopup(ctx))
			await phase("waitForHashGeneral", () => waitForHash(setupPage, "#/popup/general", 30_000))
			await phase("switchToLocalNetwork", () => switchToLocalNetwork(setupPage))
			await setupPage.close()
			const playgroundPage = await phase("connectPlayground", () => connectPlayground(ctx))
			await use(Object.assign(ctx, { playgroundPage }))
			await ctx.browser.close()
		},
		{ scope: "test" },
	],

	localNetworkExtension: [
		// biome-ignore lint/correctness/noEmptyPattern: vitest fixture API requires {} destructuring
		async ({}, use) => {
			const ctx = await launchExtension()
			await registerProfile(ctx)
			const page = await openPopup(ctx)
			await waitForHash(page, "#/popup/general", 30_000)
			await switchToLocalNetwork(page)
			await page.close()
			await use(ctx)
			await ctx.browser.close()
		},
		{ scope: "file" },
	],

	tokenReadyExtension: [
		// biome-ignore lint/correctness/noEmptyPattern: vitest fixture API requires {} destructuring
		async ({}, use) => {
			const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
			if (!aztecConfig) throw new Error("aztecTestConfig not provided — is the local Aztec node running?")

			const ctx = await launchExtension()
			await registerProfile(ctx)

			const page = await openPopup(ctx)
			await waitForHash(page, "#/popup/general", 30_000)
			await switchToLocalNetwork(page)

			const accountAddress = await getAccountAddress(page)
			console.log("[tokenReady] Extension account address:", accountAddress)
			console.log("[tokenReady] Token address:", aztecConfig.tokenAddress)

			// Lazy import to avoid loading WASM for smoke tests (Lesson #4)
			const { createTestWallet, createSponsoredFeeOptions, mintPublicTokens } = await import("./aztec")
			let walletCleanup: (() => Promise<void>) | undefined
			try {
				const { wallet, cleanup } = await createTestWallet(aztecConfig.nodeUrl)
				walletCleanup = cleanup
				const feeOptions = await createSponsoredFeeOptions(wallet)
				await mintPublicTokens(
					wallet,
					aztecConfig.tokenAddress,
					accountAddress,
					1000n * 10n ** 18n,
					aztecConfig.minterAddress,
					feeOptions,
				)
			} finally {
				await walletCleanup?.()
			}

			await importToken(page, aztecConfig.tokenAddress)

			// Poll: refresh balances until the minted amount is visible in the extension.
			// The extension's PXE syncs blocks independently and may take 30-60s on
			// a fresh node. Each refresh triggers a simulateTx which advances the
			// sync. Tightened from 30×5s=150s to 40×1.5s=60s — the extra retries
			// keep the same observability while halving total budget on the slow
			// path; on the happy path balance appears in 2-4 retries either way.
			const maxRetries = 40
			for (let i = 0; i < maxRetries; i++) {
				await refreshBalances(page)
				const bodyText = await page.evaluate(() => document.body.innerText)
				if (bodyText.includes("1,000")) {
					console.log(`[tokenReady] Balance visible after ${i + 1} refresh(es) (~${((i + 1) * 1.5).toFixed(1)}s)`)
					break
				}
				if (i % 10 === 9) {
					console.log(`[tokenReady] Still waiting for balance... (${i + 1}/${maxRetries} retries)`)
				}
				if (i === maxRetries - 1) {
					console.warn("[tokenReady] Balance not visible after all retries (~60s) — tests may fail")
				}
				await new Promise((r) => setTimeout(r, 1_500))
			}

			await page.close()

			await use(Object.assign(ctx, { accountAddress }))
			await ctx.browser.close()
		},
		{ scope: "file" },
	],

	feeJuiceReadyExtension: [
		// biome-ignore lint/correctness/noEmptyPattern: vitest fixture API requires {} destructuring
		async ({}, use) => {
			const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
			if (!aztecConfig) throw new Error("aztecTestConfig not provided — is the local Aztec node running?")

			const ctx = await launchExtension()
			await registerProfile(ctx)

			const page = await openPopup(ctx)
			await waitForHash(page, "#/popup/general", 30_000)
			await switchToLocalNetwork(page)

			const accountAddress = await getAccountAddress(page)
			console.log("[feeJuiceReady] Extension account address:", accountAddress)

			const { createTestWallet, createSponsoredFeeOptions, mintPublicTokens, bridgeFeeJuice, waitForL1ToL2Message, claimFeeJuice } =
				await import("./aztec")
			let walletCleanup: (() => Promise<void>) | undefined
			try {
				const { wallet, accounts, node, cleanup } = await createTestWallet(aztecConfig.nodeUrl)
				walletCleanup = cleanup
				const minterAddress = accounts[0]
				const feeOptions = await createSponsoredFeeOptions(wallet)

				// Mint tokens (same as tokenReadyExtension)
				await mintPublicTokens(
					wallet,
					aztecConfig.tokenAddress,
					accountAddress,
					1000n * 10n ** 18n,
					aztecConfig.minterAddress,
					feeOptions,
				)

				// Bridge FeeJuice from L1 → L2
				console.log("[feeJuiceReady] Bridging FeeJuice from L1...")
				const claim = await bridgeFeeJuice(node, accountAddress)

				// Wait for L1→L2 message to arrive on L2
				console.log("[feeJuiceReady] Waiting for L1→L2 message...")
				await waitForL1ToL2Message(node, claim.messageHash.toString(), 90_000)

				// Claim FeeJuice on L2 (use SponsoredFPC to pay for the claim tx)
				console.log("[feeJuiceReady] Claiming FeeJuice on L2...")
				await claimFeeJuice(wallet, accountAddress, minterAddress, claim, feeOptions)
				console.log("[feeJuiceReady] FeeJuice claimed successfully")
			} finally {
				await walletCleanup?.()
			}

			await importToken(page, aztecConfig.tokenAddress)

			// Poll for token balance. Tightened from 30 × 5s = 150s to
			// 60 × 1.5s = 90s — matches the tokenReadyExtension cadence
			// in PR #70 (extension.ts:329-344). Faster happy-path detection
			// with a slightly shorter total budget.
			const maxRetries = 60
			for (let i = 0; i < maxRetries; i++) {
				await refreshBalances(page)
				const bodyText = await page.evaluate(() => document.body.innerText)
				if (bodyText.includes("1,000")) {
					console.log(`[feeJuiceReady] Balance visible after ${i + 1} refresh(es)`)
					break
				}
				if (i === maxRetries - 1) {
					console.warn("[feeJuiceReady] Balance not visible after all retries")
				}
				await new Promise((r) => setTimeout(r, 1_500))
			}

			await page.close()
			await use(Object.assign(ctx, { accountAddress }))
			await ctx.browser.close()
		},
		{ scope: "file" },
	],

	feeJuiceImportedExtension: [
		// biome-ignore lint/correctness/noEmptyPattern: vitest fixture API requires {} destructuring
		async ({}, use) => {
			const aztecConfig = inject("aztecTestConfig") as AztecTestConfig | undefined
			if (!aztecConfig) throw new Error("aztecTestConfig not provided — is the local Aztec node running?")

			// Phase 1: setup pre-funded account on-chain (script-side).
			const { createTestWallet, setupPreFundedAccount, createSponsoredFeeOptions, mintPublicTokens } = await import("./aztec")
			const { wallet, accounts, node, cleanup } = await createTestWallet(aztecConfig.nodeUrl)
			let prefunded: { masterBase64: string; accountAddress: { toString(): string } }
			try {
				const feePayer = accounts[0]
				if (!feePayer) throw new Error("expected at least one sandbox-deployed test account")
				prefunded = await setupPreFundedAccount(wallet, node, feePayer)
				console.log(`[feeJuiceImported] pre-funded account: ${prefunded.accountAddress.toString()}`)

				// Mint test tokens for the imported account so transfer flows have
				// something to send (matches feeJuiceReadyExtension's pattern at :330).
				const feeOptions = await createSponsoredFeeOptions(wallet)
				await mintPublicTokens(
					wallet,
					aztecConfig.tokenAddress,
					prefunded.accountAddress.toString(),
					1000n * 10n ** 18n,
					aztecConfig.minterAddress,
					feeOptions,
				)
				console.log("[feeJuiceImported] minted test tokens for imported account")
			} finally {
				await cleanup()
			}

			// Phase 2: launch fresh extension + import the master via importPlain.
			const ctx = await launchExtension()
			const page = await openPopup(ctx)

			await waitForHash(page, "#/popup/register", 30_000)
			await page.waitForFunction(() => !document.querySelector('[data-testid="global-loader"]'), {
				timeout: 30_000,
				polling: 500,
			})

			// Navigate to import page (the register page has an "Import" link, but
			// direct hash nav is simpler for tests).
			await page.evaluate(() => {
				window.location.hash = "#/popup/import"
			})
			await waitForHash(page, "#/popup/import", 5_000)

			await page.waitForSelector('[data-testid="import-option-private-key"]', { visible: true, timeout: 30_000 })
			await clickByTestId(page, "import-option-private-key")

			await page.waitForSelector('[data-testid="import-private-key-input"] input', { visible: true, timeout: 30_000 })
			await page.evaluate(
				({ secretKey, pwd }: { secretKey: string; pwd: string }) => {
					const setVal = (sel: string, v: string) => {
						const input = document.querySelector<HTMLInputElement>(sel)
						if (!input) throw new Error(`input not found: ${sel}`)
						const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
						setter?.call(input, v)
						input.dispatchEvent(new Event("input", { bubbles: true }))
					}
					// F2: profile name is required at submit time.
					setVal('[data-testid="import-name-input"] input', "Imported Profile")
					setVal('[data-testid="import-private-key-input"] input', secretKey)
					setVal('[data-testid="import-password-input"] input', pwd)
					setVal('[data-testid="import-password-confirm-input"] input', pwd)
				},
				{ secretKey: prefunded.masterBase64, pwd: "TestPassword123!" },
			)

			await page.waitForFunction(
				() => {
					const btn = document.querySelector<HTMLButtonElement>('[data-testid="import-private-key-submit-btn"]')
					return btn && !btn.disabled
				},
				{ timeout: 5_000, polling: 100 },
			)
			await clickByTestId(page, "import-private-key-submit-btn")
			await waitForHash(page, "#/popup/general", 30_000)

			// Switch to Local Network — popup auto-creates a Local-chain account
			// with the SAME address the script pre-funded.
			await switchToLocalNetwork(page)

			// Wait for nulo:ui:activeAccount to settle on the Local-chain address.
			const accountAddress = prefunded.accountAddress.toString()
			await page.waitForFunction(
				async (expected: string) => {
					const r = await chrome.storage.local.get("nulo:ui:activeAccount")
					return r["nulo:ui:activeAccount"] === expected
				},
				{ timeout: 30_000, polling: 500 },
				accountAddress,
			)
			console.log(`[feeJuiceImported] extension account on Local: ${accountAddress}`)

			// Trigger gas-balance-card render by visiting general; both balances
			// should be non-zero (script pre-funded both public + private FJ).
			await page.waitForSelector('[data-testid="gas-balance-public"]', { visible: true, timeout: 30_000 })
			await page.waitForFunction(
				() => {
					const pub = document.querySelector('[data-testid="gas-balance-public"]')?.textContent ?? ""
					const priv = document.querySelector('[data-testid="gas-balance-private"]')?.textContent ?? ""
					const nonZero = (s: string) => /\d/.test(s) && !/^0(\.0+)?\s*FJ/i.test(s.trim())
					return nonZero(pub) && nonZero(priv)
				},
				{ timeout: 60_000, polling: 2_000 },
			)
			console.log("[feeJuiceImported] gas-balance card shows non-zero public + private FJ")

			// Import the test token + wait for it to render in the balance list,
			// matching feeJuiceReadyExtension's :356-371 pattern. The send flow
			// needs a token registered before send-from-type is selectable.
			await importToken(page, aztecConfig.tokenAddress)
			// Tightened from 30 × 5s = 150s to 60 × 1.5s = 90s — matches the
			// tokenReadyExtension cadence in PR #70 (extension.ts:329-344). Same
			// total budget shape (or shorter), but happy-path detection is ~3×
			// faster.
			const maxRetries = 60
			for (let i = 0; i < maxRetries; i++) {
				await refreshBalances(page)
				const bodyText = await page.evaluate(() => document.body.innerText)
				if (bodyText.includes("1,000")) {
					console.log(`[feeJuiceImported] token balance visible after ${i + 1} refresh(es)`)
					break
				}
				if (i === maxRetries - 1) {
					console.warn("[feeJuiceImported] token balance not visible after all retries")
				}
				await new Promise((r) => setTimeout(r, 1_500))
			}

			await page.close()
			await use(Object.assign(ctx, { accountAddress }))
			await ctx.browser.close()
		},
		{ scope: "file" },
	],
})

// ── Helpers ─────────────────────────────────────────────────────────────

/**
 * Patch a Page so its waiters default to time-based (`polling: 200`)
 * instead of Puppeteer's default `'raf'` (rAF-based) polling.
 *
 * `'raf'` polling is throttled in offscreen / unfocused tabs in modern
 * Chrome. The popup tab can lose focus during async flows when the SW
 * pushes a navigation while another popup window has focus — the page
 * state actually advances, but the waiter never observes it.
 *
 * `waitForFunction` directly accepts `polling`. `waitForSelector` does
 * NOT — it converts to a `waitForFunction` internally with rAF polling
 * baked in. To work around that we re-implement `waitForSelector` on top
 * of `waitForFunction` (running the standard "exists + visible if
 * requested + enabled if requested" predicate in-page). The new
 * implementation honours the same options shape: `{ visible, hidden,
 * timeout }` plus our forced `polling: 200`.
 */
export function patchPagePolling(page: Page): void {
	// ── waitForFunction passthrough ──────────────────────────────────────
	const originalWaitForFunction = page.waitForFunction.bind(page) as Page["waitForFunction"]
	// biome-ignore lint/suspicious/noExplicitAny: signature passthrough for Puppeteer overloads
	;(page as any).waitForFunction = (...args: any[]) => {
		const optionsIdx = args.findIndex((a) => a && typeof a === "object" && ("timeout" in a || "polling" in a))
		if (optionsIdx >= 0) {
			const opts = args[optionsIdx]
			if (!("polling" in opts)) {
				args[optionsIdx] = { ...opts, polling: 200 }
			}
		} else {
			args.splice(1, 0, { polling: 200 })
		}
		return (originalWaitForFunction as unknown as (...a: unknown[]) => unknown)(...args)
	}

	// ── waitForSelector replacement ──────────────────────────────────────
	// Only intercept plain-CSS selectors. Puppeteer also supports prefixed
	// selectors (`text/...`, `xpath/...`, `aria/...`, `pierce/...`); those go
	// through specialized QueryHandlers we don't reimplement. Delegate them
	// to Puppeteer's original waitForSelector.
	const originalWaitForSelector = page.waitForSelector.bind(page) as Page["waitForSelector"]
	const PUPPETEER_PREFIXED_SELECTOR_RE = /^(?:text|xpath|aria|pierce)\//
	// biome-ignore lint/suspicious/noExplicitAny: passthrough for Puppeteer overloads
	;(page as any).waitForSelector = async (selector: string, options: { visible?: boolean; hidden?: boolean; timeout?: number } = {}) => {
		if (PUPPETEER_PREFIXED_SELECTOR_RE.test(selector)) {
			return originalWaitForSelector(selector, options)
		}
		const { visible = false, hidden = false, timeout = 30_000 } = options
		// Use our patched waitForFunction (polling: 200) under the hood.
		// biome-ignore lint/suspicious/noExplicitAny: dynamic invocation on the patched method
		await (page as any).waitForFunction(
			(args: { sel: string; visible: boolean; hidden: boolean }) => {
				const el = document.querySelector<HTMLElement>(args.sel)
				if (args.hidden) {
					if (!el) return true
					const style = window.getComputedStyle(el)
					if (style.display === "none" || style.visibility === "hidden") return true
					const rect = el.getBoundingClientRect()
					return rect.width === 0 || rect.height === 0
				}
				if (!el) return false
				if (args.visible) {
					const style = window.getComputedStyle(el)
					if (style.display === "none" || style.visibility === "hidden") return false
					const rect = el.getBoundingClientRect()
					if (rect.width === 0 || rect.height === 0) return false
				}
				return true
			},
			{ timeout, polling: 200 },
			{ sel: selector, visible, hidden },
		)
		// Original waitForSelector returns an ElementHandle. The replacement
		// returns null because our callers all immediately discard it (and
		// element-handle methods are broken by the same CDP regression that
		// motivated this whole branch — see commit 73b77c6).
		return null
	}
}

/**
 * Detect puppeteer detach errors that can occur during the brief CDP race
 * between `browser.newPage()` and the first `page.goto(...)`. These signal
 * a half-initialized frame, not a wallet-side problem — retrying with a
 * fresh page resolves them. Symptom string varies across puppeteer-core
 * versions and timing; match on any of the known phrases.
 */
function isFrameDetachError(err: unknown): boolean {
	const msg = err instanceof Error ? err.message : String(err)
	return /Navigating frame was detached|frame got detached|Session closed|Target closed|Connection closed/i.test(msg)
}

/** Open the extension popup in a new page with error collection. */
export async function openPopup(ctx: ExtensionContext): Promise<Page> {
	// One bounded retry on frame-detach errors: under accumulated suite load,
	// `browser.newPage()` can return a page whose CDP frame is in a half-
	// initialized state, causing the first `page.goto(popupUrl)` to throw
	// "Navigating frame was detached" immediately. The mitigation is simply
	// to close and re-create the page. A broader catch would mask real
	// crashes — match only on known detach-error signatures.
	let attempt = 0
	const maxAttempts = 2
	for (;;) {
		try {
			return await openPopupOnce(ctx)
		} catch (err) {
			attempt += 1
			if (attempt >= maxAttempts || !isFrameDetachError(err)) throw err
			if (process.env.NULO_E2E_OPENPOPUP_LOG === "1") {
				console.log(`[openPopup] retry-on-detach attempt=${attempt}`)
			}
		}
	}
}

async function openPopupOnce(ctx: ExtensionContext): Promise<Page> {
	const page = await ctx.browser.newPage()
	patchPagePolling(page)
	await page.setViewport({ width: 360, height: 600 })
	// Bring the new page to the front so the tab is "focused" — defense in
	// depth against rAF throttling. Combined with `--disable-renderer-
	// backgrounding` it prevents Chrome from suspending the offscreen
	// renderer.
	await page.bringToFront()

	ctx.consoleErrors = []
	ctx.pageErrors = []

	page.on("console", (msg: ConsoleMessage) => {
		if (msg.type() === "error") {
			ctx.consoleErrors.push(msg.text())
		}
	})

	page.on("pageerror", (err: Error) => {
		ctx.pageErrors.push(err)
	})

	const popupUrl = `chrome-extension://${ctx.extensionId}/src/popup/index.html`
	// Fast-path-then-fallback for the SW-handshake workaround.
	//
	// Background: the SW's FIRST popup connection on a brand-new tab can
	// lose the wallet-bridge handshake (popup logs "Client disconnected"
	// from `client-*.js` and Vue never mounts; hash stays at "#/" with an
	// empty body). The historical workaround was an unconditional
	// triple-nav (popup → about:blank → popup) — the second load sees a
	// fully-warm SW.
	//
	// Readiness predicate (post-codex audit `019e2dXX`): hash leaves "#/"
	// AND the GlobalLoader is gone. The hash redirect alone fires too
	// early — `app.vue` pushes `/popup/auth` BEFORE `initNetworks()` /
	// `initAccount()` complete, so a fast-path that resolved on hash
	// only would return a popup whose wallet-bridge isn't fully connected
	// yet. `GlobalLoader.vue:13` renders `[data-testid="global-loader"]`
	// when `!isBackgroundConnected`; its absence is the correct
	// "bridge ready" signal.
	//
	// Budget: 2s is provisional and tuned for the prewarmed SW that
	// `launchExtension()` produces (the SW liveness wait at line 70-80
	// runs before any test even starts). On a genuinely cold SW + slow CI,
	// this may need to lengthen — revisit if fallback-count > 0 ever
	// appears in CI logs. P99 of the fast-path was 811ms in smoke,
	// 238ms in network in the spike.
	//
	// Catch: TimeoutError only. A broader catch would mask page crashes,
	// CDP disconnects, etc. as "fast-path failed → try fallback" and bury
	// the real fault.
	//
	// Logging is env-gated so the per-call line doesn't pollute default
	// test output. Set NULO_E2E_OPENPOPUP_LOG=1 to re-emit (useful for
	// counting fallback occurrences in CI artifacts).
	const FAST_PATH_BUDGET_MS = 2_000
	const t0 = Date.now()
	await page.goto(popupUrl, { waitUntil: "domcontentloaded" })
	let path: "fast" | "fallback" = "fast"
	try {
		await page.waitForFunction(
			() => window.location.hash !== "#/" && window.location.hash !== "" && !document.querySelector('[data-testid="global-loader"]'),
			{ timeout: FAST_PATH_BUDGET_MS, polling: 100 },
		)
	} catch (err) {
		if (!(err instanceof TimeoutError)) throw err
		path = "fallback"
		await page.goto("about:blank")
		await page.goto(popupUrl, { waitUntil: "domcontentloaded" })
		await page.waitForFunction(
			() => window.location.hash !== "#/" && window.location.hash !== "" && !document.querySelector('[data-testid="global-loader"]'),
			{ timeout: 30_000, polling: 200 },
		)
	}
	if (process.env.NULO_E2E_OPENPOPUP_LOG === "1") {
		console.log(`[openPopup] path=${path} totalMs=${Date.now() - t0}`)
	}

	return page
}

/** Wait for Vue hash router to reach the expected hash.
 *
 *  Explicit `polling: 200` matters: Puppeteer's default is `'raf'`
 *  (requestAnimationFrame) which is THROTTLED in offscreen / unfocused tabs
 *  in modern Chrome. The popup tab is technically focused, but during async
 *  flows where the SW pushes a navigation while another popup window has
 *  focus, the rAF-driven poll can stall — the hash transition lands but
 *  this `waitForFunction` never observes it. Time-based polling avoids
 *  the throttling regardless of focus state. */
export async function waitForHash(page: Page, expectedHash: string, timeout = 5_000): Promise<void> {
	await page.waitForFunction((hash: string) => window.location.hash === hash, { timeout, polling: 200 }, expectedHash)
}

/** Type into an input found by placeholder.
 *
 *  History: previously used `elementHandle.click({ clickCount: 3 })` + `.type()`,
 *  which routes through Puppeteer's CDP element-handle path. Recent
 *  Chrome/Puppeteer combos (24.4x against Chrome 128+) hang on that path with
 *  `Runtime.callFunctionOn timed out`, even though synthetic in-page clicks
 *  work fine. Now we go through the same page.evaluate + prototype-setter
 *  path that `replaceInputValue` uses — robust across CDP regressions and
 *  also faster because there's no real-mouse-event sequence. */
export async function typeIntoInput(page: Page, placeholder: string, text: string): Promise<void> {
	await replaceInputValue(page, `input[placeholder="${placeholder}"]`, text)
}

/** Click a visible enabled button by its text content.
 *  Uses page.evaluate to find the actual <button> element, avoiding
 *  stale references from Puppeteer's text/ selector matching descendant nodes. */
export async function clickButtonByText(page: Page, text: string, timeout = 10_000): Promise<void> {
	await page.waitForFunction(
		(label: string) => {
			const button = [...document.querySelectorAll("button")].find((b) => {
				const normalized = b.textContent?.replace(/\s+/g, " ").trim()
				if (normalized !== label) return false
				const style = window.getComputedStyle(b)
				const rect = b.getBoundingClientRect()
				return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0
			})
			if (!button) return false
			button.click()
			return true
		},
		{ timeout },
		text,
	)
}

/** Replace the full value of an `<input>` identified by a CSS selector,
 *  firing the proper `input` event so Vue v-model updates. Puppeteer's
 *  triple-click → type dance is unreliable on some custom Input wrappers
 *  (the selection gets lost before typing lands).
 *
 *  Picks the LAST matching visible element — Vue often keeps the old popup
 *  mounted for transitions, and the topmost popup is what the user sees.
 *
 *  If the matched element is not itself an `<input>` (e.g., a `data-testid`
 *  forwarded via Vue's `inheritAttrs` lands on the Input component's wrapper
 *  div), descend to the first `<input>` underneath. */
export async function replaceInputValue(page: Page, selector: string, value: string): Promise<void> {
	await page.waitForSelector(selector, { visible: true, timeout: 5_000 })
	await page.evaluate(
		async ({ sel, val }: { sel: string; val: string }) => {
			const candidates = [...document.querySelectorAll<HTMLElement>(sel)].filter((el) => el.offsetParent !== null)
			const matched = candidates[candidates.length - 1]
			if (!matched) throw new Error(`replaceInputValue: no visible match for ${sel}`)
			const input = matched instanceof HTMLInputElement ? matched : (matched.querySelector("input") as HTMLInputElement | null)
			if (!input) throw new Error(`replaceInputValue: no <input> reachable from ${sel}`)
			input.focus()
			// Use the prototype setter so Vue's v-model listener fires
			const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
			setter?.call(input, val)
			input.dispatchEvent(new Event("input", { bubbles: true }))
			input.dispatchEvent(new Event("change", { bubbles: true }))
			// Vue's reactivity flush is microtask-based. Without an explicit
			// flush before this evaluate returns, a quick chain like
			//   replaceInputValue(a) -> replaceInputValue(b) -> clickByTestId(submit)
			// can race the form's :disabled binding — the click sometimes lands
			// while disabled is still true (button stays gated) AND sometimes
			// fires the click handler with stale values, so the submit handler
			// fast-fails silently. Awaiting two microtasks is enough to flush
			// nested computeds in practice.
			await Promise.resolve()
			await Promise.resolve()
		},
		{ sel: selector, val: value },
	)
}

/** Click a visible, enabled element by an arbitrary CSS selector. Same
 *  in-page synthetic-click pattern as `clickByTestId`, just unscoped from
 *  testids — use this when the target's only stable handle is a class
 *  combo, ARIA role, or other non-testid selector. */
export async function clickSelector(page: Page, selector: string, timeout = 10_000): Promise<void> {
	try {
		await page.waitForFunction(
			(sel: string) => {
				const candidates = [...document.querySelectorAll<HTMLElement>(sel)].filter((el) => {
					if ((el as HTMLButtonElement).disabled) return false
					const style = window.getComputedStyle(el)
					if (style.display === "none" || style.visibility === "hidden") return false
					const rect = el.getBoundingClientRect()
					if (rect.width === 0 || rect.height === 0) return false
					return true
				})
				const target = candidates[candidates.length - 1]
				if (!target) return false
				target.click()
				return true
			},
			{ timeout },
			selector,
		)
	} catch (err) {
		if (!isTargetDetachError(err)) throw err
	}
}

/** Click a visible enabled element by `data-testid`. Preferred over text
 *  matching — survives copy/case/i18n churn.
 *
 *  When multiple elements share the same testid (e.g., a stacked popup
 *  transition where the old card is still in the DOM), this picks the LAST
 *  visible+enabled candidate — that's the topmost / freshest one. Empirically
 *  the right choice for popup chains; matches the same pattern in
 *  `replaceInputValue`. */
export async function clickByTestId(page: Page, testId: string, timeout = 10_000): Promise<void> {
	try {
		await page.waitForFunction(
			(id: string) => {
				const candidates = [...document.querySelectorAll<HTMLElement>(`[data-testid="${id}"]`)].filter((el) => {
					if ((el as HTMLButtonElement).disabled) return false
					const style = window.getComputedStyle(el)
					if (style.display === "none" || style.visibility === "hidden") return false
					const rect = el.getBoundingClientRect()
					if (rect.width === 0 || rect.height === 0) return false
					return true
				})
				const target = candidates[candidates.length - 1]
				if (!target) return false
				target.click()
				return true
			},
			{ timeout },
			testId,
		)
	} catch (err) {
		// Approval popups auto-close themselves on the click that resolves the
		// interaction (e.g. cap-approve-btn → resolveInteraction → window.remove).
		// page.waitForFunction is still polling when the Chrome target detaches,
		// throwing nested errors: outer "Waiting failed" / "Error: Waiting failed"
		// with `cause: TargetCloseError("Target closed")` underneath. The click
		// already fired (otherwise the popup wouldn't be closing), so swallow
		// target-detach errors. Re-raise everything else.
		if (!isTargetDetachError(err)) throw err
	}
}

function isTargetDetachError(err: unknown): boolean {
	const messages: string[] = []
	let current: unknown = err
	let depth = 0
	while (current && typeof current === "object" && "message" in current && depth < 5) {
		messages.push(String((current as { message?: string }).message ?? ""))
		current = (current as { cause?: unknown }).cause
		depth++
	}
	const stack = err instanceof Error && typeof err.stack === "string" ? err.stack : ""
	const haystack = `${messages.join(" ")} ${stack}`
	return /Target ?Close(d)?|frame was detached|frame got detached|Session closed/i.test(haystack)
}
