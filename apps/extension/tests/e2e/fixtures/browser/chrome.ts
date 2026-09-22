import type { Browser, CDPSession, Page, Target } from "puppeteer"
import puppeteer from "puppeteer"
import { cdpInterceptRpc } from "./chrome-rpc-intercept"
import { cdpVirtualAuthenticator } from "./chrome-webauthn"
import type { BrowserDriver, LaunchOptions, LaunchedBrowser, PxeHostState } from "./index"

const SCHEME = "chrome-extension://"

/** The offscreen document is a target of its own, so its visibility is read in it over CDP. */
async function pxeHostState(page: Page): Promise<PxeHostState> {
	const count = await page.evaluate(async () => (await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] })).length)
	const documentUrl = `${SCHEME}${new URL(page.url()).hostname}/src/offscreen/index.html`
	const visibility: string[] = []
	for (const target of page.browser().targets()) {
		if (target.url().split("?")[0] !== documentUrl) continue
		const session = await target.createCDPSession()
		try {
			const { result } = await session.send("Runtime.evaluate", { expression: "document.visibilityState", returnByValue: true })
			visibility.push(String(result.value))
		} finally {
			await session.detach().catch(() => {})
		}
	}
	return { count, visibility }
}

async function launch({ extensionPath, userDataDir, headless }: LaunchOptions): Promise<LaunchedBrowser> {
	// Headless `true` supports MV3 extensions — offscreen documents, the service worker,
	// `chrome.storage` and `chrome.runtime.Port` all work.
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
			// Artifact mode runs the production bundle, where token seeds resolve for real and a
			// resolved quote would break `fiat-display`'s "no fiat on a fresh wallet". Block the
			// price host only: blocking RPC makes the node client retry, which pushes profile
			// deletion past the reset specs' waits and fails three of them.
			...(process.env.NULO_E2E_ARTIFACT_RUN === "1" ? ["--host-resolver-rules=MAP api.coingecko.com 127.0.0.1:1"] : []),
		],
		ignoreDefaultArgs: ["--disable-extensions"],
		// The default 180s is not enough for a cold first run: argon2 unlock plus the bb.js wasm
		// boot can hold a CDP reply past it while the worker pool has the host under memory
		// pressure, and the call then times out on work that did complete.
		protocolTimeout: 300_000,
	})
	// Chrome owns nothing outside its own process tree, so closing the browser is the whole
	// teardown. A driver that also owns a WebDriver process reaps it here instead.
	return { browser, close: () => browser.close() }
}

const STOP_WORKER_BUDGET_MS = 15_000
const WORKER_PROBE_BUDGET_MS = 2_000

/** The worker global's creation time: only a new worker instance produces a newer value. The
 *  whole probe — attach included, since Puppeteer's attach carries the 300 s protocol timeout — races
 *  the budget. An attached session is released the moment the budget expires (a session left on a
 *  stopping worker is the very hazard `stopBackground` exists to avoid), and one that attaches
 *  after expiry is released without evaluating. Release is requested, never awaited: the caller's
 *  budget must not depend on Chrome answering a detach. */
async function readWorkerTimeOrigin(target: Target, budgetMs: number): Promise<number> {
	let session: CDPSession | undefined
	let expired = false
	const release = () => session?.detach().catch(() => {})
	const probe = (async () => {
		session = await target.createCDPSession()
		if (expired) throw new Error("worker probe attached after its budget")
		const { result } = await session.send("Runtime.evaluate", { expression: "performance.timeOrigin", returnByValue: true })
		return Number(result.value)
	})()
	let timer: ReturnType<typeof setTimeout> | undefined
	const timeout = new Promise<never>((_, reject) => {
		timer = setTimeout(() => {
			expired = true
			release()
			reject(new Error("worker probe timed out"))
		}, budgetMs)
	})
	try {
		return await Promise.race([probe, timeout])
	} finally {
		if (timer) clearTimeout(timer)
		probe.then(release, release)
	}
}

const isServiceWorkerOf = (extensionId: string) => (t: Target) => t.type() === "service_worker" && t.url().includes(extensionId)

/** MV3 reaps an idle worker, so "none right now" is an answer a caller may have to tolerate. */
const backgroundAlive = async (browser: Browser, extensionId: string): Promise<boolean> =>
	browser.targets().some(isServiceWorkerOf(extensionId))

/**
 * Terminate the extension's service worker and wait until the ORIGINAL worker instance is gone.
 *
 * Chrome parks a stopped worker's DevTools host while any session is attached and hands that host
 * to the worker's next start; an MV3 extension worker restarts within milliseconds of stopping. A
 * stop issued through an attached session (Puppeteer's `worker.close()`) therefore often leaves
 * the restarted worker under the original target id, and `targetdestroyed` never fires. So the
 * stop is an UNATTACHED `Target.closeTarget` from the browser session, and "gone" has two proofs:
 * the identity-keyed `targetdestroyed` (the fast path), or — because a session this helper does
 * not own, such as Puppeteer's own auto-attach on every worker start, can still park the host —
 * a newer `performance.timeOrigin` on whichever worker target is live. The fallback probes attach
 * only after a normal destroy would long have landed; a still-stopping worker met by that attach is
 * parked, not resurrected, and cannot yield a newer origin. `Runtime.terminateExecution` is not an
 * alternative — it leaves the worker running.
 */
async function stopBackground(browser: Browser, extensionId: string): Promise<void> {
	const isExtensionWorker = isServiceWorkerOf(extensionId)
	const swTarget = await browser.waitForTarget(isExtensionWorker, { timeout: STOP_WORKER_BUDGET_MS })
	const originBefore = await readWorkerTimeOrigin(swTarget, WORKER_PROBE_BUDGET_MS)

	let settled = false
	let onDestroyed: (target: Target) => void = () => {}
	const destroyed = new Promise<void>((resolve) => {
		onDestroyed = (target) => {
			if (target === swTarget) resolve()
		}
	})
	browser.on("targetdestroyed", onDestroyed)

	const browserSession = await browser.target().createCDPSession()
	let deadlineTimer: ReturnType<typeof setTimeout> | undefined
	try {
		// The id comes from the browser's own target list (public protocol), matched on the same
		// predicate as the Target above, so no private `_targetId` read is needed.
		const { targetInfos } = await browserSession.send("Target.getTargets")
		const info = targetInfos.find((t) => t.type === "service_worker" && t.url.includes(extensionId))
		if (!info) throw new Error("stopBackground: the browser lists no service-worker target for the extension")
		const { success } = await browserSession.send("Target.closeTarget", { targetId: info.targetId })
		if (!success) throw new Error("stopBackground: Target.closeTarget reported failure")

		const restarted = (async () => {
			await new Promise((r) => setTimeout(r, 2_000))
			while (!settled) {
				const live = browser.targets().find(isExtensionWorker)
				const origin = live ? await readWorkerTimeOrigin(live, WORKER_PROBE_BUDGET_MS).catch(() => undefined) : undefined
				if (origin !== undefined && origin > originBefore) return
				await new Promise((r) => setTimeout(r, 250))
			}
		})()
		const deadline = new Promise<never>((_, reject) => {
			deadlineTimer = setTimeout(
				() =>
					reject(
						new Error(
							`stopBackground: the service-worker target was still alive ${STOP_WORKER_BUDGET_MS / 1000}s after close()`,
						),
					),
				STOP_WORKER_BUDGET_MS,
			)
		})
		// One race, so a probe stuck in a CDP round trip can neither hide the destroy event nor
		// outlive the budget.
		await Promise.race([destroyed, restarted, deadline])
	} finally {
		settled = true
		if (deadlineTimer) clearTimeout(deadlineTimer)
		browser.off("targetdestroyed", onDestroyed)
		browserSession.detach().catch(() => {})
	}
}

/** The MV3 service worker is the first extension context Chrome starts, and its URL carries the id. */
async function discoverExtensionId(browser: Browser): Promise<string> {
	const worker = await browser.waitForTarget(
		(target) => target.type() === "service_worker" && target.url().includes("service-worker-loader"),
		{ timeout: 30_000 },
	)
	return new URL(worker.url()).hostname
}

export const chromeDriver: BrowserDriver = {
	kind: "chrome",
	scheme: SCHEME,
	credentialOutlivesPage: false,
	launch,
	extensionUrl: (extensionId, path) => `${SCHEME}${extensionId}${path}`,
	newPage: (browser) => browser.newPage(),
	discoverExtensionId,
	gotoExtensionPage: async (page, url) => {
		await page.goto(url, { waitUntil: "domcontentloaded" })
	},
	reloadExtensionPage: async (page) => {
		await page.reload({ waitUntil: "domcontentloaded" })
	},
	waitForTarget: (browser, predicate, timeout) => browser.waitForTarget(predicate, { timeout }),
	waitForOpenedUrl: async (browser, url, timeout) => {
		await browser.waitForTarget((target) => target.type() === "page" && target.url() === url, { timeout })
	},
	interceptRpc: (browser, extensionId, fromOrigin, mode) => cdpInterceptRpc(browser, `${SCHEME}${extensionId}/`, fromOrigin, mode),
	// Chrome treats evaluated script as a user gesture and has no focused-window precondition.
	prepareClick: async () => {},
	pickFile: async (page, open, filePath) => {
		const [chooser] = await Promise.all([page.waitForFileChooser({ timeout: 10_000 }), open()])
		await chooser.accept([filePath])
	},
	virtualAuthenticator: cdpVirtualAuthenticator,
	holdNextCredentialGet: async () => {},
	pxeHostState,
	stopBackground,
	backgroundAlive,
	openScratchPage: async (browser, extensionId) => {
		const page = await browser.newPage()
		try {
			await page.goto(`${SCHEME}${extensionId}/src/popup/index.html`, { waitUntil: "domcontentloaded" })
			return page
		} catch (err) {
			// The caller retries a detached frame with a fresh page and never sees this one.
			await page.close().catch(() => {})
			throw err
		}
	},
}
