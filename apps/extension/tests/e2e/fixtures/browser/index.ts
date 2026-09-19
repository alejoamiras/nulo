import type { Browser } from "puppeteer"
import { chromeDriver } from "./chrome"
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
}

const DRIVERS: Partial<Record<BrowserKind, BrowserDriver>> = { chrome: chromeDriver }

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

export const extensionUrl = (extensionId: string, path: string): string => driver.extensionUrl(extensionId, path)
export const launchBrowser = (opts: LaunchOptions): Promise<LaunchedBrowser> => driver.launch(opts)
