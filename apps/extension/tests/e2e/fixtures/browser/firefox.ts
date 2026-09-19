import { type ChildProcess, spawn } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import type { Browser, Page, Target } from "puppeteer"
import { reservePort } from "../../../../scripts/e2e/resolve-ports"
import { type BiDiAttachment, attachPuppeteerOverBiDi } from "./bidi-attach"
import type { BrowserDriver, LaunchOptions, LaunchedBrowser } from "./index"
import {
	LAUNCH_ENV,
	newLaunchMarker,
	newProfileDir,
	ownedByThisRun,
	ownedProcesses,
	reapOrphanLaunches,
	recordLaunch,
	releaseLaunch,
} from "./ownership"
import { WebDriverSession } from "./webdriver-classic"

const SCHEME = "moz-extension://"

/** Extension-page WebAuthn landed in Firefox 150; 153 is the line this suite is exercised on. */
const MIN_MAJOR = 153

interface LaunchContext {
	/**
	 * The classic channel. Puppeteer's BiDi session has no WebAuthn module and no window handles, so
	 * the passkey fixtures and the window finders reach through here.
	 */
	session: WebDriverSession
	profileDir: string
	/** The manifest id, which is what `installAddon` returns — NOT the per-profile UUID. */
	addonId: string
}

/** Keyed by the `Browser` rather than carried on the shared launch interface, so nothing
 *  Chrome-side has to know this channel exists. */
const contexts = new WeakMap<Browser, LaunchContext>()

function contextFor(browser: Browser): LaunchContext {
	const context = contexts.get(browser)
	if (!context) throw new Error("no WebDriver classic session for this browser — is it a Firefox launch?")
	return context
}

export const classicSessionFor = (browser: Browser): WebDriverSession => contextFor(browser).session

/** One sweep per process, before the first launch claims ports or writes a record. */
let sweep: Promise<string[]> | undefined

async function launch({ extensionPath, userDataDir, headless }: LaunchOptions): Promise<LaunchedBrowser> {
	sweep ??= reapOrphanLaunches()
	const reaped = await sweep
	if (reaped.length) console.warn(`[firefox] reaped ${reaped.length} orphaned launch(es): ${reaped.join(", ")}`)

	const marker = newLaunchMarker()
	// Built before anything exists to clean up, so every failure below has the same one way out.
	const record = ownedByThisRun({
		marker,
		pid: 0,
		profileDir: userDataDir ?? "",
		ownsProfile: userDataDir === undefined,
		label: "geckodriver",
	})
	try {
		// A caller-supplied directory belongs to the caller: a relaunch-on-the-same-profile test
		// exists to prove data survives teardown, so deleting it would destroy the fixture.
		if (!userDataDir) record.profileDir = newProfileDir(marker)
		const { profileDir } = record
		mkdirSync(profileDir, { recursive: true })

		const { gecko, base } = await spawnGeckodriver(marker)
		record.pid = gecko.pid
		record.label = `geckodriver:${base}`
		recordLaunch(record)

		const session = await WebDriverSession.open(base, capabilities({ profileDir, headless }))
		assertVersion(session.capabilities.browserVersion)
		// Teardown owns a process by the marker in its environment. A Firefox that did not inherit
		// it would outlive every release unnoticed, so that is a launch failure, not a later leak.
		if (ownedProcesses(marker).length < 2) throw new Error("Firefox did not inherit the launch marker, so teardown could not own it")
		const addonId = await session.installAddon(extensionPath)
		const attachment = await attachPuppeteerOverBiDi(session.capabilities, session.sessionId)
		const { browser } = attachment
		contexts.set(browser, { session, profileDir, addonId })
		const stopWatching = watchForSilentCloses(session, attachment)
		return {
			browser,
			close: async () => {
				stopWatching()
				try {
					// Disconnect first: the BiDi transport is a client of a session the classic channel
					// owns, and ending the session under it produces a socket error on the way out.
					await browser.disconnect().catch(() => {})
					await session.close().catch(() => {})
				} finally {
					await releaseLaunch(record)
				}
			},
		}
	} catch (err) {
		await releaseLaunch(record)
		throw err
	}
}

/**
 * The reservations are held until the moment before spawn: geckodriver binds both ports
 * immediately, so there is no gap for the kernel to hand one to an outgoing connection.
 */
async function spawnGeckodriver(marker: string): Promise<{ gecko: ChildProcess & { pid: number }; base: string }> {
	const reserved = [await reservePort()]
	try {
		reserved.push(await reservePort())
	} finally {
		if (reserved.length < 2) await reserved[0].release()
	}
	const [http, bidi] = reserved
	await Promise.all([http.release(), bidi.release()])
	const gecko = spawn(
		geckodriverPath(),
		// Without system access Firefox limits remote navigation to web-safe schemes and refuses
		// `moz-extension://` on both channels; geckodriver rejects the Firefox-side flag when it
		// arrives through capabilities, so this is the only place it can be set.
		["--host", "127.0.0.1", "--port", String(http.port), "--websocket-port", String(bidi.port), "--allow-system-access"],
		// Detached so a signal to this run's own group — a Ctrl-C — cannot stop it half-way through a
		// session. The marker is how teardown finds it, and the Firefox that inherits it.
		{ detached: true, stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, [LAUNCH_ENV]: marker } },
	)
	// Without a listener a missing binary surfaces as an unhandled `error` event, not a rejection.
	const failed = new Promise<never>((_, reject) =>
		gecko.once("error", (err) => reject(new Error(`geckodriver did not start: ${err.message}`))),
	)
	const started = new Promise<void>((resolve) => gecko.once("spawn", resolve))
	await Promise.race([started, failed])
	if (gecko.pid === undefined) throw new Error("geckodriver did not start")
	return { gecko: gecko as ChildProcess & { pid: number }, base: `http://127.0.0.1:${http.port}` }
}

/** `spawn` reports a missing binary as a bare ENOENT, which reads as a crash rather than a missing
 *  prerequisite. geckodriver is not installed by any repo script and is rarely on PATH. */
function geckodriverPath(): string {
	const configured = process.env.GECKODRIVER
	if (configured && !existsSync(configured)) throw new Error(`GECKODRIVER=${configured} does not exist`)
	return configured ?? "geckodriver"
}

/** Newest first, by the version digits in a Puppeteer cache directory name. */
export function newestFirefoxDir(dirs: readonly string[]): string | undefined {
	const digits = (dir: string): number[] => (dir.match(/\d+/g) ?? []).map(Number)
	return [...dirs].sort((a, b) => {
		const [va, vb] = [digits(a), digits(b)]
		for (let i = 0; i < Math.max(va.length, vb.length); i++) {
			const delta = (vb[i] ?? 0) - (va[i] ?? 0)
			if (delta !== 0) return delta
		}
		return 0
	})[0]
}

/**
 * Puppeteer's `executablePath({ browser: "firefox" })` builds the path from the CHROME build id,
 * so it names a directory that was never installed and geckodriver rejects it as "not a Firefox
 * executable". Resolve from what the cache actually holds.
 */
function resolveFirefoxBinary(): string {
	const configured = process.env.FIREFOX_PATH
	if (configured) {
		if (!existsSync(configured)) throw new Error(`FIREFOX_PATH=${configured} does not exist`)
		return configured
	}
	const root = path.join(process.env.PUPPETEER_CACHE_DIR ?? path.join(homedir(), ".cache", "puppeteer"), "firefox")
	const installed = (existsSync(root) ? readdirSync(root) : []).filter((dir) => existsSync(path.join(root, dir, "firefox", "firefox")))
	const newest = newestFirefoxDir(installed)
	if (!newest) throw new Error(`no Firefox installed under ${root} — run \`bunx puppeteer browsers install firefox\` or set FIREFOX_PATH`)
	return path.join(root, newest, "firefox", "firefox")
}

function capabilities({ profileDir, headless }: { profileDir: string; headless: boolean }): Record<string, unknown> {
	return {
		// Asks geckodriver for a BiDi endpoint on the session it owns, which is what makes one
		// browser drivable from both channels at once.
		webSocketUrl: true,
		"moz:firefoxOptions": {
			binary: resolveFirefoxBinary(),
			args: ["-profile", profileDir, ...(headless ? ["-headless"] : [])],
			prefs: {
				// Without both of these the virtual authenticator is never consulted and
				// `credentials.create` never settles — it does not fail, it hangs.
				"security.webauth.webauthn_enable_softtoken": true,
				"security.webauth.webauthn_enable_usbtoken": false,
			},
		},
	}
}

function assertVersion(browserVersion: string): void {
	const major = Number.parseInt(browserVersion, 10)
	if (Number.isNaN(major) || major < MIN_MAJOR) {
		throw new Error(`Firefox ${browserVersion} is below the ${MIN_MAJOR} floor this suite and the shipped manifest require`)
	}
	console.log(`[firefox] ${browserVersion}`)
}

/**
 * Firefox mints a per-profile UUID for every add-on and serves its pages from that, not from the
 * manifest id — so the id this suite needs exists nowhere until the add-on is loaded, and
 * `installAddon`'s return value is the wrong one. The profile's own pref map is the authority;
 * an open add-on page is the fallback for the window before Firefox has flushed prefs to disk.
 */
export function uuidFromPrefs(prefsText: string, addonId: string): string | undefined {
	const pref = /user_pref\("extensions\.webextensions\.uuids",\s*"((?:[^"\\]|\\.)*)"\);/.exec(prefsText)
	if (!pref?.[1]) return undefined
	try {
		return (JSON.parse(JSON.parse(`"${pref[1]}"`) as string) as Record<string, string>)[addonId]
	} catch {
		// A half-flushed prefs.js is a normal race, not a failure: the caller polls.
		return undefined
	}
}

function hostFromPrefs({ profileDir, addonId }: LaunchContext): string | undefined {
	const prefs = path.join(profileDir, "prefs.js")
	return existsSync(prefs) ? uuidFromPrefs(readFileSync(prefs, "utf8"), addonId) : undefined
}

/** Reading a handle's URL switches to it, so this is second: it costs the caller's focus. */
async function hostFromWindows({ session }: LaunchContext): Promise<string | undefined> {
	const open = (await session.windowsWithUrls()).find((window) => window.url.startsWith(SCHEME))
	return open && new URL(open.url).hostname
}

async function discoverExtensionId(browser: Browser): Promise<string> {
	const context = contextFor(browser)
	const deadline = Date.now() + 30_000
	while (Date.now() < deadline) {
		const host = hostFromPrefs(context) ?? (await hostFromWindows(context).catch(() => undefined))
		if (host) return host
		await new Promise((resolve) => setTimeout(resolve, 250))
	}
	throw new Error(`no per-profile UUID for ${context.addonId} in prefs.js and no open ${SCHEME} window after 30s`)
}

/**
 * A classic window handle and a BiDi browsing-context id are the same string in Firefox — both come
 * from the tab's id — which is what lets a `Page` be addressed on the classic channel at all.
 * Puppeteer keeps the id on an internal field, so a rename there must fail here, not navigate
 * whichever window happens to be current.
 */
function contextIdOf(page: Page): string {
	const id = (page.mainFrame() as unknown as { _id?: unknown })._id
	if (typeof id !== "string" || !id) throw new Error("puppeteer no longer exposes the BiDi context id on Frame._id")
	return id
}

async function gotoExtensionPage(page: Page, url: string): Promise<void> {
	await classicSessionFor(page.browser()).navigateWindow(contextIdOf(page), url)
}

/**
 * The popup closes itself when onboarding is unfinished and no profile exists, and Firefox honours
 * that `window.close()` where Chrome ignores it on a tab no script opened. Preload scripts do not
 * run in extension documents, so the call cannot be stubbed. In exactly that state the onboarding
 * page is the inert one — it only replaces itself once the flag is set or a profile exists — so a
 * fresh profile settles through it instead. A reused profile finished onboarding on an earlier
 * launch, which is the state where the popup stays and the onboarding page would not.
 */
async function openScratchPage(browser: Browser, extensionId: string, { freshProfile }: { freshProfile: boolean }): Promise<Page> {
	const page = await browser.newPage()
	const path = freshProfile ? "/src/onboarding/index.html" : "/src/popup/index.html"
	await gotoExtensionPage(page, `${SCHEME}${extensionId}${path}`)
	return page
}

/** `targets()` is a synchronous read of Puppeteer's own map, so a tight poll costs no round trip. */
async function waitForTarget(browser: Browser, predicate: (target: Target) => boolean, timeout: number): Promise<Target> {
	const deadline = Date.now() + timeout
	while (Date.now() < deadline) {
		const match = browser.targets().find(predicate)
		if (match) return match
		await new Promise((resolve) => setTimeout(resolve, 100))
	}
	throw new Error(`waitForTarget: no matching target after ${timeout}ms`)
}

/**
 * A window that closes itself — every approval window does — is never reported over BiDi, so
 * Puppeteer would keep it in `targets()` and keep its page "open" for good. The classic handle
 * list is Firefox's own account of which windows exist; a context seen there and then missing from
 * two consecutive reads is reported closed. A window BiDi has just announced may not be in the
 * handle list yet, so one never seen there is given much longer before it is judged the same way.
 */
function watchForSilentCloses(session: WebDriverSession, attachment: BiDiAttachment): () => void {
	const watch: SilentCloseWatch = { listed: new Set(), misses: new Map() }
	let reading = false
	const timer = setInterval(async () => {
		if (reading) return
		reading = true
		try {
			const open = attachment.openContexts()
			const handles = new Set(await session.windowHandles())
			for (const context of silentlyClosed(watch, open, handles)) attachment.reportClosed(context)
		} catch {
			// The session is closing or geckodriver is busy; the next tick reads again.
		} finally {
			reading = false
		}
	}, 150)
	timer.unref()
	return () => clearInterval(timer)
}

export interface SilentCloseWatch {
	listed: Set<string>
	misses: Map<string, number>
}

const LISTED_MISSES = 2
/** A window can open, be approved and close between two reads, so "never listed" cannot mean
 *  "never closed" — that target would be stale for good. It is given over a second instead, far
 *  longer than the handle list lags a window BiDi has already announced. */
const UNLISTED_MISSES = 8

/** One read of the handle list: the contexts that have now been missing from it long enough. `open`
 *  must have been taken BEFORE the read, or a window born during it counts a miss it never had. */
export function silentlyClosed(watch: SilentCloseWatch, open: readonly string[], handles: ReadonlySet<string>): string[] {
	const closed: string[] = []
	for (const context of open) {
		if (handles.has(context)) {
			watch.listed.add(context)
			watch.misses.delete(context)
			continue
		}
		const missed = (watch.misses.get(context) ?? 0) + 1
		watch.misses.set(context, missed)
		if (missed >= (watch.listed.has(context) ? LISTED_MISSES : UNLISTED_MISSES)) closed.push(context)
	}
	return closed
}

export const firefoxDriver: BrowserDriver = {
	kind: "firefox",
	scheme: SCHEME,
	launch,
	extensionUrl: (extensionId, path) => `${SCHEME}${extensionId}${path}`,
	discoverExtensionId,
	gotoExtensionPage,
	openScratchPage,
	waitForTarget,
	// Firefox reports a closed window as a missing browsing context, per command.
	targetGone: /no such frame|Browsing Context with id \S+ not found|DiscardedBrowsingContext/i,
}
