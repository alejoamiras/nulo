import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import type { Browser, Page, Target } from "puppeteer"
import { reservePort } from "../../../../scripts/e2e/resolve-ports"
import { E2E_DATA_ROOT } from "../../lockfile"
import { attachPuppeteerOverBiDi } from "./bidi-attach"
import type { BrowserDriver, LaunchOptions, LaunchedBrowser } from "./index"
import { type LaunchOwnership, ownedByThisRun, readStartTime, reapOrphanLaunches, recordLaunch, releaseLaunch } from "./ownership"
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

	// Held until the moment before spawn: geckodriver binds both immediately, so there is no
	// build-length gap for the kernel to hand one of them to an outgoing connection.
	const [http, bidi] = [await reservePort(), await reservePort()]
	// A caller-supplied directory belongs to the caller: a relaunch-on-the-same-profile test exists
	// to prove data survives teardown, so deleting it would destroy the fixture, not clean up.
	const profileDir = userDataDir ?? freshProfileDir()
	mkdirSync(profileDir, { recursive: true })

	await Promise.all([http.release(), bidi.release()])
	const gecko = spawn(
		geckodriverPath(),
		// Without system access Firefox limits remote navigation to web-safe schemes and refuses
		// `moz-extension://` on both channels; geckodriver rejects the Firefox-side flag when it
		// arrives through capabilities, so this is the only place it can be set.
		["--host", "127.0.0.1", "--port", String(http.port), "--websocket-port", String(bidi.port), "--allow-system-access"],
		// Detached so the pid is its own group leader: teardown signals the group, never a name.
		{ detached: true, stdio: ["ignore", "ignore", "inherit"] },
	)
	if (!gecko.pid) throw new Error("geckodriver did not start")
	const record: LaunchOwnership = ownedByThisRun({
		pid: gecko.pid,
		startTime: readStartTime(gecko.pid) ?? "",
		profileDir,
		ownsProfile: userDataDir === undefined,
		label: `geckodriver:${http.port}`,
	})
	recordLaunch(record)

	try {
		const session = await WebDriverSession.open(`http://127.0.0.1:${http.port}`, capabilities({ profileDir, headless }))
		assertVersion(session.capabilities.browserVersion)
		const addonId = await session.installAddon(extensionPath)
		const browser = await attachPuppeteerOverBiDi(session.capabilities, session.sessionId)
		contexts.set(browser, { session, profileDir, addonId })
		return {
			browser,
			close: async () => {
				// Disconnect first: the BiDi transport is a client of a session the classic channel
				// owns, and ending the session under it produces a socket error on the way out.
				await browser.disconnect().catch(() => {})
				await session.close().catch(() => {})
				await releaseLaunch(record)
			},
		}
	} catch (err) {
		await releaseLaunch(record)
		throw err
	}
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

/** Real disk, never tmpfs: a profile a killed Firefox still holds open would pin its store in RAM. */
function freshProfileDir(): string {
	const root = path.join(E2E_DATA_ROOT, "firefox-profiles")
	mkdirSync(root, { recursive: true })
	return mkdtempSync(path.join(root, "profile-"))
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

const ONBOARDING_COMPLETED = "nulo:onboarding:completed"

async function firstRunTab(browser: Browser): Promise<Page> {
	const deadline = Date.now() + 15_000
	while (Date.now() < deadline) {
		const tab = (await browser.pages()).find((page) => page.url().includes("/src/onboarding/"))
		if (tab) return tab
		await new Promise((resolve) => setTimeout(resolve, 250))
	}
	throw new Error("a fresh Firefox profile never opened the first-run onboarding tab")
}

/**
 * The popup reads the onboarding flag before it mounts and closes itself when the flag is unset and
 * no profile exists. Preload scripts do not run in extension documents, so `close()` cannot be
 * stubbed; the flag is raised first instead, from the one extension page a fresh install is
 * guaranteed to have. That tab must be MOUNTED before the write: it reads the same flag on mount
 * and would replace itself with a popup window. The launch fixture sets the flag itself once it
 * has closed that tab, so raising it early changes the order, not the settled state. A reused
 * profile finished onboarding on an earlier launch.
 */
async function openScratchPage(browser: Browser, extensionId: string, { freshProfile }: { freshProfile: boolean }): Promise<Page> {
	if (freshProfile) {
		const host = await firstRunTab(browser)
		await host.waitForSelector('[data-testid="onboarding-welcome-create"]', { timeout: 30_000 })
		await host.evaluate(async (key) => chrome.storage.local.set({ [key]: true }), ONBOARDING_COMPLETED)
	}
	const page = await browser.newPage()
	await gotoExtensionPage(page, `${SCHEME}${extensionId}/src/popup/index.html`)
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

/** The classic handle list is Firefox's own account of which windows exist. */
async function isPageGone(page: Page): Promise<boolean> {
	if (page.isClosed()) return true
	return !(await classicSessionFor(page.browser()).windowHandles()).includes(contextIdOf(page))
}

export const firefoxDriver: BrowserDriver = {
	kind: "firefox",
	scheme: SCHEME,
	launch,
	extensionUrl: (extensionId, path) => `${SCHEME}${extensionId}${path}`,
	discoverExtensionId,
	gotoExtensionPage,
	openScratchPage,
	isPageGone,
	waitForTarget,
	// Firefox reports a closed window as a missing browsing context, per command.
	targetGone: /no such frame|Browsing Context with id \S+ not found|DiscardedBrowsingContext/i,
}
