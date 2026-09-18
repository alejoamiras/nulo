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
}

export interface LaunchedBrowser {
	browser: Browser
	/** Releases everything this launch owns, browser process included. */
	close(): Promise<void>
}

export interface BrowserDriver {
	readonly kind: BrowserKind
	/** Extension URL scheme, trailing `//` included. */
	readonly scheme: string
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

/** Why a whole file cannot run on Firefox. A capability the browser lacks, never a failing test. */
export const CHROME_ONLY = {
	backgroundKill: "kills the MV3 service worker over CDP; Firefox exposes no background context",
	cdpFetch: "arms CDP Fetch interception on held targets; BiDi has no equivalent",
} as const

export const extensionUrl = (extensionId: string, path: string): string => driver.extensionUrl(extensionId, path)
export const launchBrowser = (opts: LaunchOptions): Promise<LaunchedBrowser> => driver.launch(opts)
export const newPage = (browser: Browser): Promise<Page> => driver.newPage(browser)
export const discoverExtensionId = (browser: Browser): Promise<string> => driver.discoverExtensionId(browser)
export const gotoExtensionPage = (page: Page, url: string): Promise<void> => driver.gotoExtensionPage(page, url)
export const reloadExtensionPage = (page: Page): Promise<void> => driver.reloadExtensionPage(page)
export const isTargetGone = (text: string): boolean => driver.targetGone?.test(text) ?? false
export const waitForTarget = (browser: Browser, predicate: (target: Target) => boolean, timeout: number): Promise<Target> =>
	driver.waitForTarget(browser, predicate, timeout)
export const openScratchPage = (browser: Browser, extensionId: string, opts: { freshProfile: boolean }): Promise<Page> =>
	driver.openScratchPage(browser, extensionId, opts)
