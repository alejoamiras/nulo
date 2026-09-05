import puppeteer, { TimeoutError, type Browser, type Page, type ConsoleMessage } from "puppeteer"
import { test as base, inject } from "vitest"
import {
	captureBalanceBaseline,
	createAccount,
	getAccountAddress,
	importToken,
	switchToLocalNetwork,
	waitForFreshBalanceRow,
} from "./helpers"
import { snapshotResultSeq, waitForPgResult } from "./playground"
import { waitForPopup, approveCapabilities } from "./popups"
import { TEST_PASSWORD } from "./constants"
import type { AztecTestConfig } from "./aztec"

export interface ExtensionContext {
	browser: Browser
	extensionId: string
	consoleErrors: string[]
	pageErrors: Error[]
}

/** Launch a fresh browser with the extension and wait for SW liveness.
 *  Exported so test files that need a fully-clean extension (no profile
 *  registered, no networks switched) can build their own fixture.
 *
 *  `userDataDir` persists the Chrome profile (chrome.storage.local included)
 *  across launches — closing the browser and relaunching on the same dir is a
 *  REAL extension cold boot over surviving data, the faithful way to exercise
 *  update/crash paths (CDP `Runtime.terminateExecution` leaves an
 *  unrevivable zombie SW — see migration.test.ts). `waitForLiveness: false`
 *  skips the liveness gate for boots expected to park or fail before the
 *  heartbeat starts (a held or failing storage migration). */
export async function launchExtension(opts: { userDataDir?: string; waitForLiveness?: boolean } = {}): Promise<ExtensionContext> {
	const { userDataDir, waitForLiveness = true } = opts
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
		...(userDataDir ? { userDataDir } : {}),
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
			// Artifact mode runs the PRODUCTION bundle, so Alpha is active and its
			// default-token seeds are real — a first account now triggers a seed
			// pass that can resolve. `fiat-display` asserts no fiat renders on a
			// fresh wallet, and a resolved seed plus a resolved quote would break
			// that, so the PRICE host is blocked. Deliberately not the RPC host:
			// blocking that makes the node client retry, which delays profile
			// deletion past the reset specs' waits (measured — it fails three specs
			// that pass without it). A seeded token card is harmless here; no smoke
			// assertion looks at the token list.
			...(process.env.NULO_E2E_ARTIFACT_RUN === "1" ? ["--host-resolver-rules=MAP api.coingecko.com 127.0.0.1:1"] : []),
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

	// The scratch page is ours, not `pages()[0]`: puppeteer can hand back a page
	// whose frame is half-initialized and detaches during the first navigation
	// (`openPopup` documents the same sequence and applies the same remedy), and
	// the only fix is to discard the page and re-create it — which we may not do
	// to Chrome's own startup page. That page is therefore left untouched, which
	// also guarantees the browser always keeps one open.
	let blankPage: Page | undefined
	for (let attempt = 1; ; attempt++) {
		let candidate: Page | undefined
		try {
			candidate = await browser.newPage()
			patchPagePolling(candidate)
			await candidate.goto(`chrome-extension://${extensionId}/src/popup/index.html`, {
				waitUntil: "domcontentloaded",
			})
			blankPage = candidate
			break
		} catch (err) {
			// `newPage()` itself can throw the detach, so it lives inside the try;
			// `candidate` is undefined in that case and there is nothing to close.
			await candidate?.close().catch(() => {})
			if (attempt >= 2 || !isFrameDetachError(err)) throw err
		}
	}
	// Wait for SW to fully initialize (liveness signal in chrome.storage.session).
	// runtime.ts writes the first liveness immediately after initWalletSdkHandler;
	// 30s timeout matches the helper in sw-resilience.test.ts and gives headroom
	// for slow CI runners on cold-boot Barretenberg wasm + service-graph init.
	if (waitForLiveness) {
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
	}

	// `onInstalled` opens the extension's first-run tab and stores its id in session storage; both
	// happen during the worker's boot, which the liveness wait above has already seen complete, so
	// the poll is a bound, not a race we expect to lose. Close the tab BEFORE marking onboarding
	// complete: an onboarding page that mounts and reads the completed flag replaces itself with a
	// popup window and drops the tracked id, leaving an untracked extension page in this browser.
	// Every e2e drives the popup flows directly; the tab-flow specs open their own tab.
	const firstRunTabClosed = await blankPage.evaluate(async () => {
		const key = "nulo:onboarding:tab-id"
		for (let attempt = 0; attempt < 20; attempt++) {
			const id = (await chrome.storage.session.get(key))[key]
			if (typeof id === "number") {
				await chrome.tabs.remove(id).catch(() => {})
				await chrome.storage.session.remove(key)
				return true
			}
			await new Promise((r) => setTimeout(r, 250))
		}
		return false
	})
	if (!firstRunTabClosed) console.warn("[launchExtension] no first-run tab id within 5s — an onboarding page may linger")

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

	await blankPage.close()

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
		// "Client disconnected" is the benign SW-port-close cascade — pending
		// background-port RPCs reject en-masse when the SW restarts (e.g. during
		// account switch). Prod already treats it as benign (offscreen
		// `isBenignSwDisconnect`); filter it here too so the `consoleErrors`
		// assertions only catch UNEXPECTED errors, not this known noise.
		// STRUCTURAL BLIND SPOT — root-caused + probe-verified (flake-ledger:
		// consoleErrors entry, closed permanent-by-design): the console-sniffer
		// (`utils/console-sniffer.ts`, first module script in the popup/
		// onboarding/offscreen entry pages — the setup page carries no sniffer)
		// reroutes app `console.*` over LoggerService RPC to the SW realm;
		// the native page console never fires on the success path, so CDP's
		// consoleAPICalled never emits and this listener structurally cannot see
		// app console output. Browser-emitted entries (e.g. "Unchecked
		// runtime.lastError") bypass the patch and DO arrive. App-log evidence
		// channel: `fixtures/journal.ts` readSwLogTrail (SW session-storage
		// ring, 2s flush debounce). `pageerror` below IS reliable for uncaught
		// throws + unhandled rejections (probe-verified) — an error the app
		// catches and merely logs is invisible to BOTH fixture arrays
		// (`consoleErrors` AND `pageErrors`; it does reach the SW log ring);
		// prefer DOM/storage/stage evidence for app-level failures.
		if (msg.type() === "error" && !msg.text().includes("Client disconnected")) {
			ctx.consoleErrors.push(msg.text())
		}
	})
	page.on("pageerror", (err: Error) => {
		// Mirror the consoleErrors filter above: the benign SW-port-close
		// cascade also surfaces as an UNHANDLED REJECTION (pageerror) when a
		// fire-and-forget RPC (e.g. app.vue's account-switch syncTransactions)
		// is in flight during an MV3 service-worker restart. Same known noise,
		// same filter — everything else still fails the assertion.
		if (err.message?.includes("Client disconnected")) return
		ctx.pageErrors.push(err)
	})

	const url = `chrome-extension://${ctx.extensionId}/src/onboarding/index.html#/onboarding/welcome`
	await page.goto(url, { waitUntil: "domcontentloaded" })
	// Wait for Vue mount: welcome CTA must render.
	await page.waitForSelector('[data-testid="onboarding-welcome-create"]', { visible: true, timeout: 30_000 })
	return page
}

/** Register a profile with a test password. Leaves the extension on #/popup/general.
 *  Exported so the Phase 3 cold-shard warm-up tap (and any other test infra that
 *  drives the full register flow outside the fixture pipeline) can reuse it. */
export async function registerProfile(ctx: ExtensionContext): Promise<void> {
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

	await typeIntoInput(page, "Strong password", TEST_PASSWORD)
	await typeIntoInput(page, "Repeat password", TEST_PASSWORD)

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
 *
 * Exported alongside `registerProfile` so the Phase 3 cold-shard warm-up tap
 * can perform the same setup without going through the fixture pipeline.
 */
export async function connectPlayground(ctx: ExtensionContext): Promise<Page> {
	const { openPlayground } = await import("./playground")
	const { waitForPopup, approveDiscover, approveVerify } = await import("./popups")

	// Internal phase-tag so the outer `[dappConnectedExtensionPerTest:connectPlayground]`
	// error tells us WHICH step inside this function fails. Without this we
	// only know "30s timeout somewhere in here" — useless for triage.
	const step = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
		try {
			return await fn()
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			throw new Error(`connectPlayground:${name} — ${msg}`)
		}
	}

	const dappPage = await step("openPlayground", () => openPlayground(ctx))

	// Set up popup listeners BEFORE the click so we don't miss the events.
	const discoverP = waitForPopup(ctx, "discover", { timeout: 30_000 })

	// Bumped from 5s to 30s — under network-suite load the playground vite
	// server cold-load + dapp Vue mount can take 10-20s; clickByTestId polls
	// for ~10s on its own which is still usually enough, but the explicit
	// waitForSelector here was the load-bearing 5s timeout that cascaded
	// into ~40 fixture failures.
	await step("waitForConnectBtn", () => dappPage.waitForSelector('[data-testid="pg-btn-connect"]', { visible: true, timeout: 30_000 }))
	await step("clickConnect", () => clickByTestId(dappPage, "pg-btn-connect"))

	const discoverPage = await step("awaitDiscoverPopup", () => discoverP)
	// Arm the verify popup wait BEFORE approveDiscover triggers the SW to
	// create the verify window. Codex audit caught: approveDiscover only
	// clicks (popups.ts:126), doesn't wait for close. If verify opens
	// faster than the next waitForPopup, the snapshot at popups.ts:32
	// treats the already-existing target as preExisting and ignores it —
	// the test then hangs for 30s waiting for a NEW verify target that
	// never appears. Race confirmed deterministic on shard 5.
	const verifyP = waitForPopup(ctx, "verify", { timeout: 30_000 })
	await step("approveDiscover", () => approveDiscover(discoverPage))
	const verifyPage = await step("awaitVerifyPopup", () => verifyP)
	await step("approveVerify", () => approveVerify(verifyPage))

	await step("waitForConnectedStatus", () =>
		dappPage.waitForSelector('[data-testid="pg-status"][data-status="connected"]', { timeout: 30_000 }),
	)
	return dappPage
}

// ── Fixture setup helpers ─────────────────────────────────────────────────

/** Wraps each setup step so a throw carries a `[<prefix>:<step>]` tag. Without
 *  it a failure deep in fixture setup surfaces downstream as an opaque
 *  `Cannot read properties of undefined (reading 'playgroundPage')` (the test
 *  body destructures a fixture result that `use()` never produced because setup
 *  threw). The tag converts that collapse into a precise origin line. */
type PhaseTagger = <T>(name: string, fn: () => Promise<T>) => Promise<T>

function makePhase(prefix: string) {
	return async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
		try {
			return await fn()
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err)
			throw new Error(`[${prefix}:${name}] ${msg}`)
		}
	}
}

/** Drive a fresh browser through register → Local Network → playground-connect,
 *  the shared spine of every dapp-connected fixture. `beforeClose` runs after
 *  the network switch but before the setup popup closes (used to create extra
 *  accounts whose cost must land in the fixture hookTimeout, not the test
 *  budget). Returns the connected context plus the `phase` tagger so the caller
 *  can keep tagging its own follow-up steps under the same prefix. */
async function setupConnectedPlayground(
	prefix: string,
	beforeClose?: (page: Page, phase: PhaseTagger) => Promise<void>,
): Promise<{ ctx: ExtensionContext; playgroundPage: Page; phase: PhaseTagger }> {
	const phase = makePhase(prefix)
	const ctx = await phase("launchExtension", () => launchExtension())
	await phase("registerProfile", () => registerProfile(ctx))
	const setupPage = await phase("openPopup", () => openPopup(ctx))
	await phase("waitForHashGeneral", () => waitForHash(setupPage, "#/popup/general", 30_000))
	await phase("switchToLocalNetwork", () => switchToLocalNetwork(setupPage))
	if (beforeClose) await beforeClose(setupPage, phase)
	await setupPage.close()
	const playgroundPage = await phase("connectPlayground", () => connectPlayground(ctx))
	return { ctx, playgroundPage, phase }
}

/** Drive the playground's requestCapabilities flow for `bundle`, then approve
 *  the cap popup for whichever accounts `pick` selects; returns the granted
 *  addresses. All timeouts match the cold-shard budget (60s for the popup
 *  target + the account-row render — chrome.windows.create + SW handler boot +
 *  loadInteractionPayload's PXE/accountService warmup can each exceed 30s on a
 *  cold CI runner; 30s for the dApp result). `pick` owns the per-fixture
 *  selection + its failure messages (single account vs first-two). */
export async function grantCapBundle(
	ctx: ExtensionContext,
	playgroundPage: Page,
	bundle: "accounts" | "transaction",
	pick: (accountIds: (string | null)[], capPopup: Page) => Promise<string[]>,
): Promise<string[]> {
	await playgroundPage.evaluate((b) => {
		const select = document.querySelector<HTMLSelectElement>('[data-testid="pg-bundle-select"]')
		if (!select) throw new Error("pg-bundle-select not present on playground page")
		select.value = b
		select.dispatchEvent(new Event("change", { bubbles: true }))
	}, bundle)
	const seqGrant = await snapshotResultSeq(playgroundPage)
	const capPopupP = waitForPopup(ctx, "capabilities", { timeout: 60_000 })
	await clickByTestId(playgroundPage, "pg-btn-requestCapabilities")
	const capPopup = await capPopupP
	await capPopup.waitForSelector('[data-testid="cap-account-item"]', { timeout: 60_000 })
	const accountIds = await capPopup.evaluate(() =>
		[...document.querySelectorAll<HTMLElement>('[data-testid="cap-account-item"]')].map((r) => r.getAttribute("data-account-id")),
	)
	const granted = await pick(accountIds, capPopup)
	await approveCapabilities(capPopup, { accounts: granted })
	await waitForPgResult(playgroundPage, "requestCapabilities", seqGrant, 30_000)
	return granted
}

/** Select the first exposed account; throws the canonical empty-popup message. */
const pickFirstAccount = async (accountIds: (string | null)[]): Promise<string[]> => {
	const address = accountIds[0]
	if (!address) throw new Error("capabilities popup returned no accounts")
	return [address]
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
	/** Per-test fresh browser + registered profile + Local Network + dapp
	 *  connected via @nulo/playground + `accounts` capability ALREADY GRANTED
	 *  for the playground origin. Use this for tests that exercise an
	 *  account-cap-gated RPC (registerToken, getAccounts post-grant) without
	 *  paying the cold cap-popup round-trip during the test budget — the
	 *  cap-popup work happens in fixture setup, which has hookTimeout=300s.
	 *  The exposed `accountAddress` is the first account from the cap popup
	 *  (the one the fixture selected on the dApp's behalf).
	 *  See implementations-plan/e2e-stabilization/plan.md §6, §8.4. */
	dappConnectedExtensionWithAccountsCap: ExtensionContext & { playgroundPage: Page; accountAddress: string }
	/** Per-test fresh browser + registered profile + Local Network + dapp
	 *  connected + `transaction` bundle (accounts + transaction caps) ALREADY
	 *  GRANTED for the playground origin. Use this for tests that exercise a
	 *  transaction-cap-gated RPC (sendTx, multicall) without paying the cold
	 *  cap-popup round-trip during the test budget — the cap-popup work happens
	 *  in fixture setup, which has hookTimeout=300s. The exposed `accountAddress`
	 *  is the first account from the cap popup (the one the fixture selected on
	 *  the dApp's behalf).
	 *
	 *  Mirrors the `dappConnectedExtensionWithAccountsCap` pattern; the
	 *  cap-grant inner helper is intentionally duplicated rather than abstracted
	 *  to keep the two fixtures independently auditable. Refactor once we have
	 *  three or more such fixtures (CLAUDE.md "same code in 3 places" threshold).
	 *  See implementations-plan/e2e-stabilization/lessons/phase-3a.md. */
	dappConnectedExtensionWithTransactionCap: ExtensionContext & { playgroundPage: Page; accountAddress: string }
	/** Same as `dappConnectedExtensionWithTransactionCap` BUT pre-grants the
	 *  `transaction` bundle for up to the FIRST TWO accounts the cap popup
	 *  exposes. Use this for tests that characterize multi-account session
	 *  behavior (multi-account-from) without paying the cap-popup cold tax
	 *  during the test budget. The exposed `accountAddresses` is the array
	 *  of granted accounts (1 or 2 entries depending on what the wallet
	 *  exposed). Mirrors the `dappConnectedExtensionWithTransactionCap`
	 *  pattern; the cap-grant inner helper is intentionally duplicated
	 *  rather than abstracted for the same audit-independence reason. */
	dappConnectedExtensionWithFirstTwoAccountsCap: ExtensionContext & {
		playgroundPage: Page
		accountAddresses: string[]
	}
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
			// Switch to Local Network BEFORE connecting the playground. The playground passes
			// Fr.ZERO chainInfo (= chainId 0 = Local Network) while the e2e build seeds Testnet as
			// the active network. The wallet now provisions a chain's default account on a dApp's
			// request, so the mismatch alone no longer empties the account picker (pinned by
			// cap-chain-mismatch.test.ts) — but sendTx/sim tests need the ACTIVE network on the
			// sandbox (funded accounts, fee estimation, sync), which only the switch provides.
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
			const { ctx, playgroundPage } = await setupConnectedPlayground("dappConnectedExtensionPerTest")
			await use(Object.assign(ctx, { playgroundPage }))
			await ctx.browser.close()
		},
		{ scope: "test" },
	],

	dappConnectedExtensionWithAccountsCap: [
		// biome-ignore lint/correctness/noEmptyPattern: vitest fixture API requires {} destructuring
		async ({}, use) => {
			const { ctx, playgroundPage, phase } = await setupConnectedPlayground("dappConnectedExtensionWithAccountsCap")
			// Pre-grant ONLY the `accounts` capability for the playground origin
			// (NOT the wider `basic` bundle). Runs inside the fixture hookTimeout
			// (300s) so the cold cap-popup work doesn't eat any consumer's per-test
			// budget. The selected address is returned so consumers needn't
			// re-derive it from popup rows.
			const [accountAddress] = await phase("grantAccountsCap", () =>
				grantCapBundle(ctx, playgroundPage, "accounts", pickFirstAccount),
			)
			await use(Object.assign(ctx, { playgroundPage, accountAddress }))
			await ctx.browser.close()
		},
		{ scope: "test" },
	],

	dappConnectedExtensionWithTransactionCap: [
		// biome-ignore lint/correctness/noEmptyPattern: vitest fixture API requires {} destructuring
		async ({}, use) => {
			const { ctx, playgroundPage, phase } = await setupConnectedPlayground("dappConnectedExtensionWithTransactionCap")
			// Pre-grant the `transaction` bundle (accounts + transaction caps).
			// Same scope rules as the accounts-cap fixture: per-test, playground
			// origin only, cold cap-popup round-trip paid in hookTimeout (300s).
			const [accountAddress] = await phase("grantTransactionCap", () =>
				grantCapBundle(ctx, playgroundPage, "transaction", pickFirstAccount),
			)
			await use(Object.assign(ctx, { playgroundPage, accountAddress }))
			await ctx.browser.close()
		},
		{ scope: "test" },
	],

	dappConnectedExtensionWithFirstTwoAccountsCap: [
		// biome-ignore lint/correctness/noEmptyPattern: vitest fixture API requires {} destructuring
		async ({}, use) => {
			// Captured in the second-account setup step and referenced by the
			// cap-pick failure message below, so a "<2 accounts exposed" failure
			// discriminates wrong-chain creation from popup-side filtering.
			let postCreateDump = ""
			const { ctx, playgroundPage, phase } = await setupConnectedPlayground(
				"dappConnectedExtensionWithFirstTwoAccountsCap",
				async (setupPage, phase) => {
					// A fresh profile exposes ONE account; multi-account consumers (the
					// from-characterization + the authwit consume-as-caller flow) need a
					// real second account in the cap popup, so create it here where the
					// cost lands in hookTimeout.
					await phase("createSecondAccount", () => createAccount(setupPage, "Second"))
					// Persistence assertion: the row rendering proves only the optimistic
					// appStore push; verify the SERVICE write landed before moving on.
					await phase("assertSecondAccountPersisted", async () => {
						postCreateDump = await setupPage.evaluate(async () => {
							const all = await chrome.storage.local.get(null)
							return Object.entries(all)
								.filter(([k]) => k.startsWith("nulo:core:accounts"))
								.map(([, v]) => (typeof v === "string" ? v : JSON.stringify(v)))
								.join(" ||| ")
						})
						if (!postCreateDump.includes('"Second"')) {
							throw new Error(
								`account "Second" not in storage immediately after creation. Stored: ${postCreateDump.slice(0, 600)}`,
							)
						}
					})
				},
			)

			// Pre-grant the `transaction` bundle to the first 1-or-2 accounts the
			// cap popup exposes. Tests that characterize "wallet picks first session
			// account regardless of opts.from" rely on 2+ accounts granted — but
			// tolerate 1 if that's what the wallet exposed (characterization holds
			// either way).
			const accountAddresses = await phase("grantFirstTwoAccountsTransactionCap", () =>
				grantCapBundle(ctx, playgroundPage, "transaction", async (accountIds, capPopup) => {
					const granted = accountIds.slice(0, Math.min(2, accountIds.length)).filter((a): a is string => !!a)
					if (granted.length === 0) throw new Error("capabilities popup returned no accounts")
					// The fixture creates a second account upstream; if the cap popup
					// exposes fewer, fail HERE with the ids so the discriminator
					// (creation failed vs popup filtered) is in the error itself.
					if (granted.length < 2) {
						// Ground truth from the wallet's own storage: every account row
						// with its chainId, so the failure discriminates wrong-chain
						// creation from popup-side filtering.
						// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: accepted at score 19 — an in-browser diagnostic scanning exactly the account and network roots in serialized or object form
						const storedAccounts = await capPopup.evaluate(async () => {
							const all = await chrome.storage.local.get(null)
							const out: string[] = []
							for (const [k, v] of Object.entries(all)) {
								if (k.startsWith("nulo:core:accounts") || k.startsWith("nulo:core:networks")) {
									// Raw, no shape assumptions — values may be serialized strings.
									out.push(`${k} => ${(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 400)}`)
								}
							}
							return out.join(" ||| ")
						})
						throw new Error(
							`capabilities popup exposed only [${accountIds.join(", ")}] — expected the created second account.\nAT-CAP-TIME: ${storedAccounts}\nPOST-CREATE: ${postCreateDump}`,
						)
					}
					return granted
				}),
			)

			await use(Object.assign(ctx, { playgroundPage, accountAddresses }))
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

			// The extension's PXE syncs blocks independently and may take 30-60s on
			// a fresh node; each refresh advances the sync. Fail-HARD: a fixture
			// that quietly degrades just moves the failure downstream into
			// whichever consumer reads the balance first, with worse evidence —
			// the freshness-gated row wait throws with a storage census instead.
			// Budget: 60s. Token-scoped, so fiat/superstring text cannot satisfy it.
			{
				const baseline = await captureBalanceBaseline(page, accountAddress, aztecConfig.tokenAddress)
				await waitForFreshBalanceRow(page, {
					account: accountAddress,
					tokenContract: aztecConfig.tokenAddress,
					expectedPublicRaw: (1000n * 10n ** 18n).toString(),
					baselineUpdatedAt: baseline,
					timeoutMs: 60_000,
				})
				console.log(`[tokenReady] balance row fresh + exact`)
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

				// Wait for the L1→L2 message to be CLAIMABLE. 5.0 mints no empty blocks, so force L2
				// blocks (a tiny sponsored mint) until the anchor covers the message's checkpoint.
				console.log("[feeJuiceReady] Waiting for L1→L2 message...")
				await waitForL1ToL2Message(
					node,
					claim.messageHash.toString(),
					() =>
						// Self-mint to the TEST wallet's account: each forced block must
						// not add to the extension account, whose balance is asserted
						// EXACTLY by the fail-hard row wait below.
						mintPublicTokens(wallet, aztecConfig.tokenAddress, minterAddress, 1n, minterAddress, feeOptions),
					90_000,
				)

				// Claim FeeJuice on L2 (use SponsoredFPC to pay for the claim tx)
				console.log("[feeJuiceReady] Claiming FeeJuice on L2...")
				await claimFeeJuice(wallet, accountAddress, minterAddress, claim, feeOptions)
				console.log("[feeJuiceReady] FeeJuice claimed successfully")
			} finally {
				await walletCleanup?.()
			}

			await importToken(page, aztecConfig.tokenAddress)

			// Fail-HARD freshness-gated row wait — see tokenReadyExtension's note.
			// Budget: 90s.
			{
				const baseline = await captureBalanceBaseline(page, accountAddress, aztecConfig.tokenAddress)
				await waitForFreshBalanceRow(page, {
					account: accountAddress,
					tokenContract: aztecConfig.tokenAddress,
					expectedPublicRaw: (1000n * 10n ** 18n).toString(),
					baselineUpdatedAt: baseline,
					timeoutMs: 90_000,
				})
				console.log(`[feeJuiceReady] balance row fresh + exact`)
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
			let prefunded: { words: string[]; masterBase64: string; accountAddress: { toString(): string } }
			try {
				const feePayer = accounts[0]
				if (!feePayer) throw new Error("expected at least one sandbox-deployed test account")
				const feeOptions = await createSponsoredFeeOptions(wallet)
				// forceBlock: 5.0 mints no empty blocks, so FJ-claim readiness only advances on a real
				// tx. A tiny sponsored mint is the cheapest block-producer available here.
				prefunded = await setupPreFundedAccount(wallet, node, feePayer, {
					forceBlock: () =>
						mintPublicTokens(wallet, aztecConfig.tokenAddress, feePayer.toString(), 1n, aztecConfig.minterAddress, feeOptions),
				})
				console.log(`[feeJuiceImported] pre-funded account: ${prefunded.accountAddress.toString()}`)

				// Mint test tokens for the imported account so transfer flows have
				// something to send (matches feeJuiceReadyExtension's pattern at :330).
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

			await page.waitForSelector('[data-testid="import-option-seed"]', { visible: true, timeout: 30_000 })
			await clickByTestId(page, "import-option-seed")

			await page.waitForSelector('[data-testid="import-seed-input"] input', { visible: true, timeout: 30_000 })
			await page.evaluate(
				({ seed, pwd }: { seed: string; pwd: string }) => {
					const setVal = (sel: string, v: string) => {
						const input = document.querySelector<HTMLInputElement>(sel)
						if (!input) throw new Error(`input not found: ${sel}`)
						const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
						setter?.call(input, v)
						input.dispatchEvent(new Event("input", { bubbles: true }))
					}
					// F2: profile name is required at submit time.
					setVal('[data-testid="import-name-input"] input', "Imported Profile")
					setVal('[data-testid="import-seed-input"] input', seed)
					setVal('[data-testid="import-password-input"] input', pwd)
					setVal('[data-testid="import-password-confirm-input"] input', pwd)
				},
				{ seed: prefunded.words.join(" "), pwd: TEST_PASSWORD },
			)

			await page.waitForFunction(
				() => {
					const btn = document.querySelector<HTMLButtonElement>('[data-testid="import-seed-submit-btn"]')
					return btn && !btn.disabled
				},
				{ timeout: 5_000, polling: 100 },
			)
			await clickByTestId(page, "import-seed-submit-btn")
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
			// Fail-HARD freshness-gated row wait — see tokenReadyExtension's note.
			{
				const baseline = await captureBalanceBaseline(page, accountAddress, aztecConfig.tokenAddress)
				await waitForFreshBalanceRow(page, {
					account: accountAddress,
					tokenContract: aztecConfig.tokenAddress,
					expectedPublicRaw: (1000n * 10n ** 18n).toString(),
					baselineUpdatedAt: baseline,
					timeoutMs: 90_000,
				})
				console.log(`[feeJuiceImported] token balance row fresh + exact`)
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
			// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: accepted at score 29 — the predicate implements Puppeteer's exact exists / visible / hidden selector semantics in-page
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

/** Await a puppeteer wait and, on TIMEOUT ONLY, replace it with a diagnostic
 *  that names what never happened. Every other failure — frame detach, CDP
 *  disconnect, page crash — keeps its own identity and message, because
 *  relabelling those as "the state never settled" is exactly how a real fault
 *  gets buried under a plausible-looking flake. The original is preserved as
 *  `cause`. Pass a function when the diagnostic has to read live page state. */
export async function withTimeoutMessage<T>(wait: Promise<T>, message: string | (() => string | Promise<string>)): Promise<T> {
	try {
		return await wait
	} catch (err) {
		if (!(err instanceof TimeoutError)) throw err
		let text: string
		try {
			text = typeof message === "function" ? await message() : message
		} catch (diagErr) {
			// A diagnostic that reads a dead page must never replace the timeout
			// it was meant to explain.
			text = `<diagnostic failed: ${diagErr instanceof Error ? diagErr.message : String(diagErr)}>`
		}
		throw new Error(text, { cause: err })
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
	// "Attempted to use detached Frame/Page" is puppeteer's OTHER detach wording
	// (thrown by the handle decorators rather than the navigation path). Without
	// it the retry above cannot see the very failure it exists to absorb.
	return /Navigating frame was detached|frame got detached|Attempted to use detached (Frame|Page)|Session closed|Target closed|Connection closed/i.test(
		msg,
	)
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
	try {
		return await setUpPopupPage(ctx, page)
	} catch (err) {
		// The retry in `openPopup` re-creates the page, so this one must not be
		// left behind: a live target keeps its listeners and its extension
		// connections, which the next attempt then races.
		await page.close().catch(() => {})
		throw err
	}
}

async function setUpPopupPage(ctx: ExtensionContext, page: Page): Promise<Page> {
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
		// "Client disconnected" is the benign SW-port-close cascade — pending
		// background-port RPCs reject en-masse when the SW restarts (e.g. during
		// account switch). Prod already treats it as benign (offscreen
		// `isBenignSwDisconnect`); filter it here too so the `consoleErrors`
		// assertions only catch UNEXPECTED errors, not this known noise.
		// STRUCTURAL BLIND SPOT — root-caused + probe-verified (flake-ledger:
		// consoleErrors entry, closed permanent-by-design): the console-sniffer
		// (`utils/console-sniffer.ts`, first module script in the popup/
		// onboarding/offscreen entry pages — the setup page carries no sniffer)
		// reroutes app `console.*` over LoggerService RPC to the SW realm;
		// the native page console never fires on the success path, so CDP's
		// consoleAPICalled never emits and this listener structurally cannot see
		// app console output. Browser-emitted entries (e.g. "Unchecked
		// runtime.lastError") bypass the patch and DO arrive. App-log evidence
		// channel: `fixtures/journal.ts` readSwLogTrail (SW session-storage
		// ring, 2s flush debounce). `pageerror` below IS reliable for uncaught
		// throws + unhandled rejections (probe-verified) — an error the app
		// catches and merely logs is invisible to BOTH fixture arrays
		// (`consoleErrors` AND `pageErrors`; it does reach the SW log ring);
		// prefer DOM/storage/stage evidence for app-level failures.
		if (msg.type() === "error" && !msg.text().includes("Client disconnected")) {
			ctx.consoleErrors.push(msg.text())
		}
	})

	page.on("pageerror", (err: Error) => {
		// Mirror the consoleErrors filter above: the benign SW-port-close
		// cascade also surfaces as an UNHANDLED REJECTION (pageerror) when a
		// fire-and-forget RPC (e.g. app.vue's account-switch syncTransactions)
		// is in flight during an MV3 service-worker restart. Same known noise,
		// same filter — everything else still fails the assertion.
		if (err.message?.includes("Client disconnected")) return
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
 *  the throttling regardless of focus state.
 *
 *  The 15s default budgets for the bare-default call sites, which are all
 *  cold-boot openers (`openPopup` → first route): SW start + Vue mount +
 *  session hydration exceeds 5s under parallel-agent host load, which made
 *  the alphabetically-last files (the `sw-*` family, paying a fresh cold
 *  boot per single-test file at peak accumulated load) the suite's dominant
 *  flake. A genuinely broken route fails at any timeout; call sites that
 *  need a tighter bound pass one explicitly. */
export async function waitForHash(page: Page, expectedHash: string, timeout = 15_000): Promise<void> {
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
					// Skip natively-disabled AND aria-disabled elements (eg. DropdownItem,
					// which is a <div> that can't carry native `disabled`). Both mean "not
					// clickable yet" — wait for the element to enable rather than firing a
					// programmatic click that bypasses CSS `pointer-events: none`.
					if ((el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true") return false
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
