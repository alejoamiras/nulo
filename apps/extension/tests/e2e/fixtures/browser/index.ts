import type { Browser, Page, Target } from "puppeteer"
import { chromeDriver } from "./chrome"
import { firefoxDriver } from "./firefox"
import { type BrowserKind, resolveBrowserKind } from "./selection"

export type { BrowserKind }

export interface LaunchOptions {
	/** Unpacked extension directory, as the run's global setup resolved it. */
	extensionPath: string
	/** Persists profile state across launches, which is what makes a relaunch a real cold boot. */
	userDataDir?: string
	headless: boolean
	/** `false` drops the fixed window size a driver launches with; only Chrome's launch has one. */
	fixedWindowSize?: boolean
}

export interface LaunchedBrowser {
	browser: Browser
	/** Releases everything this launch owns, browser process included. */
	close(): Promise<void>
}

export interface VirtualAuthenticator {
	/** Removes every authenticator this setup added. Safe once the pages that held them are gone. */
	cleanup(): Promise<void>
}

export type RpcInterception = { kind: "refuse" } | { kind: "redirect"; to: string }

export interface ArmedInterception {
	/** Requests intercepted so far. */
	hits: () => Promise<number>
	/** Every arming or reply failure on a request this interception must control. A test checks
	 *  this after its scenario: a request that escaped to the real endpoint is a failed test,
	 *  however the scenario itself came out. */
	failures: () => Promise<string[]>
	stop: () => Promise<void>
}

/**
 * The documents hosting the PXE — Chrome's offscreen document, Firefox's background-page frame —
 * and each one's own `visibilityState`. Visibility is what keeps a document's timers unthrottled.
 */
export interface PxeHostState {
	count: number
	visibility: string[]
}

export interface BrowserDriver {
	readonly kind: BrowserKind
	/** Extension URL scheme, trailing `//` included. */
	readonly scheme: string
	/**
	 * Whether a WebAuthn credential made on one extension page can still be used once that page has
	 * closed. Chrome's virtual authenticator is attached to the page that anchors it and dies with
	 * it; Firefox's belongs to the session. A spec that has to close every extension page before a
	 * background kill reads this to know whether its ceremony may move to a fresh popup.
	 */
	readonly credentialOutlivesPage: boolean
	launch(opts: LaunchOptions): Promise<LaunchedBrowser>
	/** `path` starts at the package root: `/src/popup/index.html#/windows/execute`. */
	extensionUrl(extensionId: string, path: string): string
	/** Every page the suite opens comes from here: where a browser puts a new tab is not neutral. */
	newPage(browser: Browser): Promise<Page>
	/**
	 * The host part of the extension's own URLs, once it is installed. Chrome derives it from the
	 * service-worker target; Firefox MV3 runs a background *script* and has no such target, and
	 * its id is a per-profile UUID that only appears once one of the add-on's own contexts exists.
	 */
	discoverExtensionId(browser: Browser): Promise<string>
	/**
	 * Load one of the extension's own pages into `page`, resolving once its DOM is ready. Firefox
	 * swaps the tab into the extension process on the way, and a BiDi `navigate` across that swap
	 * arrives but strands the `Page` on a dead context — so this cannot be a bare `page.goto`.
	 */
	gotoExtensionPage(page: Page, url: string): Promise<void>
	/** Reload an extension page in place. Over BiDi a reload strands the `Page` just as a navigation does. */
	reloadExtensionPage(page: Page): Promise<void>
	/**
	 * An extension page with `chrome.*` that stays open on a wallet that has not finished onboarding,
	 * for the launch fixture to settle the extension through. It has to be a driver's job because
	 * the popup redirects to the onboarding tab and calls `window.close()`: Chrome ignores the
	 * call on a tab no script opened, Firefox honours it and the page dies under the fixture.
	 */
	openScratchPage(browser: Browser, extensionId: string, opts: { freshProfile: boolean }): Promise<Page>
	/**
	 * Resolve with the first target matching `predicate`, or reject after `timeout` ms. Over BiDi a
	 * window is born `about:blank` and no event reports the URL it then loads, so Puppeteer's own
	 * `waitForTarget` never matches a URL there — while `targets()` does list it, correctly.
	 */
	waitForTarget(browser: Browser, predicate: (target: Target) => boolean, timeout: number): Promise<Target>
	/**
	 * Resolve once a tab or window is showing exactly `url`, or reject after `timeout` ms. For a
	 * document the extension opens with `tabs.create`: over BiDi such a tab stays `about:blank` in
	 * `targets()` for good when what it loads is not HTML, so the URL is read from the browser.
	 * Reading a window's URL means switching to it, so Firefox is left on the last window listed:
	 * call this with nothing focus-dependent (a WebAuthn ceremony, a file pick) still pending.
	 */
	waitForOpenedUrl(browser: Browser, url: string, timeout: number): Promise<void>
	/**
	 * Answer every request the browser makes to `fromOrigin` — whichever of the extension's
	 * contexts issues it — without touching the network. Resolves once no request can escape.
	 */
	interceptRpc(browser: Browser, extensionId: string, fromOrigin: string, mode: RpcInterception): Promise<ArmedInterception>
	/**
	 * Runs before every scripted click. The suite clicks from inside the page, which — unlike a
	 * person's click — neither focuses the window nor, on every browser, counts as a user gesture.
	 */
	prepareClick(page: Page): Promise<void>
	/**
	 * Runs before keys pressed at `page` once the wallet has opened a window from it, after that
	 * window shows its page, and resolves once `page` has focus. Headless Firefox focuses every window
	 * the wallet opens, and a key sent to a page whose window lost focus reaches its focused element
	 * with no default action: Space on a button fires keydown and keyup but no click. A person goes
	 * back to the popup before pressing it.
	 */
	prepareKeys(page: Page): Promise<void>
	/** Answer the file picker that `open` asks for with `filePath`. `open` is a scripted click. */
	pickFile(page: Page, open: () => Promise<void>, filePath: string): Promise<void>
	/** A PRF-capable virtual authenticator. `anchorPage` matters where one is scoped to a page. */
	virtualAuthenticator(browser: Browser, anchorPage: Page): Promise<VirtualAuthenticator>
	/**
	 * With no authenticator left, make the next `credentials.get` on `page` stay pending until its
	 * caller aborts it. Chrome already waits for an authenticator that never comes.
	 */
	holdNextCredentialGet(page: Page): Promise<void>
	/**
	 * Read from an open extension page. The count comes from the browser (`runtime.getContexts` on
	 * Chrome, the background page's frames on Firefox), the visibility from each host document.
	 */
	pxeHostState(page: Page): Promise<PxeHostState>
	/**
	 * End the extension's background — Chrome's service worker, Firefox's event page — and resolve
	 * once THAT instance is gone; every other extension page and `storage.session` stay. Chrome starts
	 * a successor within milliseconds, Firefox only on the add-on's next event, so a caller that needs
	 * one running waits for it (`waitForWorkerLiveness`) after doing something that wakes it.
	 * Close every extension page first: Firefox will not end an event page that one keeps busy.
	 * Rejects by name when no background runs, or when it outlives the call.
	 */
	stopBackground(browser: Browser, extensionId: string): Promise<void>
	/** Whether a background instance runs right now. Both browsers reap an idle one. */
	backgroundAlive(browser: Browser, extensionId: string): Promise<boolean>
	/**
	 * How this driver's protocol words "the window went away under the call", beyond the CDP
	 * phrases the fixtures already match. An approval window closes itself on the click that
	 * resolves it, so that error is the expected end of a click there, not a failure.
	 */
	readonly targetGone?: RegExp
}

const DRIVERS: Partial<Record<BrowserKind, BrowserDriver>> = { chrome: chromeDriver, firefox: firefoxDriver }

/** `resolveBrowserKind` has already rejected anything unsupported, so a kind with no entry here
 *  means this registry drifted from that list — which must fail, never fall back to Chrome. */
function selectDriver(): BrowserDriver {
	const kind = resolveBrowserKind()
	const selected = DRIVERS[kind]
	if (!selected) throw new Error(`NULO_E2E_BROWSER=${kind} is supported but has no registered driver`)
	return selected
}

export const driver = selectDriver()
export const BROWSER: BrowserKind = driver.kind
export const EXTENSION_SCHEME = driver.scheme
export const isFirefox = BROWSER === "firefox"
export const credentialOutlivesPage = driver.credentialOutlivesPage

/** Why a whole file does not run on Firefox: a capability the browser lacks — never a failing test. */
export const CHROME_ONLY = {
	backgroundKillUnderPage: "ends the background under an open extension page; Firefox will not end an event page one keeps busy",
	cdpFetch: "arms CDP Fetch interception on held targets; BiDi has no equivalent",
} as const

/** Why a test does not run on Chrome: a state headless Chrome cannot be driven into — never a failing test. */
export const FIREFOX_ONLY = {
	windowRefocus: "refocuses an approval popup; headless Chrome moves focus only by creating a window",
} as const

/** The launch a background call is made against; every `ExtensionContext` is one. */
export interface BackgroundOwner {
	browser: Browser
	extensionId: string
}

export const extensionUrl = (extensionId: string, path: string): string => driver.extensionUrl(extensionId, path)
export const launchBrowser = (opts: LaunchOptions): Promise<LaunchedBrowser> => driver.launch(opts)
export const newPage = (browser: Browser): Promise<Page> => driver.newPage(browser)
export const discoverExtensionId = (browser: Browser): Promise<string> => driver.discoverExtensionId(browser)
export const gotoExtensionPage = (page: Page, url: string): Promise<void> => driver.gotoExtensionPage(page, url)
export const reloadExtensionPage = (page: Page): Promise<void> => driver.reloadExtensionPage(page)
export const isTargetGone = (text: string): boolean => driver.targetGone?.test(text) ?? false
export const waitForTarget = (browser: Browser, predicate: (target: Target) => boolean, timeout: number): Promise<Target> =>
	driver.waitForTarget(browser, predicate, timeout)
export const waitForOpenedUrl = (browser: Browser, url: string, timeout: number): Promise<void> =>
	driver.waitForOpenedUrl(browser, url, timeout)
export const interceptRpc = (
	browser: Browser,
	extensionId: string,
	fromOrigin: string,
	mode: RpcInterception,
): Promise<ArmedInterception> => driver.interceptRpc(browser, extensionId, fromOrigin, mode)
export const openScratchPage = (browser: Browser, extensionId: string, opts: { freshProfile: boolean }): Promise<Page> =>
	driver.openScratchPage(browser, extensionId, opts)
export const prepareClick = (page: Page): Promise<void> => driver.prepareClick(page)
export const prepareKeys = (page: Page): Promise<void> => driver.prepareKeys(page)
export const pickFile = (page: Page, open: () => Promise<void>, filePath: string): Promise<void> => driver.pickFile(page, open, filePath)
export const virtualAuthenticator = (browser: Browser, anchorPage: Page): Promise<VirtualAuthenticator> =>
	driver.virtualAuthenticator(browser, anchorPage)
export const holdNextCredentialGet = (page: Page): Promise<void> => driver.holdNextCredentialGet(page)
export const pxeHostState = (page: Page): Promise<PxeHostState> => driver.pxeHostState(page)
export const stopBackground = (owner: BackgroundOwner): Promise<void> => driver.stopBackground(owner.browser, owner.extensionId)
export const backgroundAlive = (owner: BackgroundOwner): Promise<boolean> => driver.backgroundAlive(owner.browser, owner.extensionId)
