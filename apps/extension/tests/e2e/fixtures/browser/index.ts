import type { Browser } from "puppeteer"
import { chromeDriver } from "./chrome"

export type BrowserKind = "chrome" | "firefox"

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
}

/** An unrecognised value must not silently run the suite on Chrome and report a pass for a
 *  browser that never started. */
function selectDriver(): BrowserDriver {
	const requested = process.env.NULO_E2E_BROWSER ?? "chrome"
	if (requested === "chrome") return chromeDriver
	throw new Error(`NULO_E2E_BROWSER=${requested} is not a browser this suite can drive`)
}

export const driver = selectDriver()
export const BROWSER: BrowserKind = driver.kind
export const EXTENSION_SCHEME = driver.scheme

export const extensionUrl = (extensionId: string, path: string): string => driver.extensionUrl(extensionId, path)
export const launchBrowser = (opts: LaunchOptions): Promise<LaunchedBrowser> => driver.launch(opts)
