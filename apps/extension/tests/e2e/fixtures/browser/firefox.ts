import { spawn } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync } from "node:fs"
import path from "node:path"
import puppeteer, { type Browser } from "puppeteer"
import { reservePort } from "../../../../scripts/e2e/resolve-ports"
import { E2E_DATA_ROOT } from "../../lockfile"
import { attachPuppeteerOverBiDi } from "./bidi-attach"
import type { BrowserDriver, LaunchOptions, LaunchedBrowser } from "./index"
import { type LaunchOwnership, ownedByThisRun, readStartTime, reapOrphanLaunches, recordLaunch, releaseLaunch } from "./ownership"
import { WebDriverSession } from "./webdriver-classic"

const SCHEME = "moz-extension://"

/** Extension-page WebAuthn landed in Firefox 150; 153 is the line this suite is exercised on. */
const MIN_MAJOR = 153

/**
 * The classic channel for a launched browser. Puppeteer's BiDi session has no WebAuthn module and
 * no window handles, so the passkey fixtures and the window finders reach through here. Keyed by
 * the `Browser` rather than carried on the shared launch interface, so nothing Chrome-side has to
 * know this channel exists.
 */
const classicSessions = new WeakMap<Browser, WebDriverSession>()

export function classicSessionFor(browser: Browser): WebDriverSession {
	const session = classicSessions.get(browser)
	if (!session) throw new Error("no WebDriver classic session for this browser — is it a Firefox launch?")
	return session
}

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
		["--host", "127.0.0.1", "--port", String(http.port), "--websocket-port", String(bidi.port)],
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
		const session = await WebDriverSession.open(`http://127.0.0.1:${http.port}`, await capabilities({ profileDir, headless }))
		assertVersion(session.capabilities.browserVersion)
		await session.installAddon(extensionPath)
		const browser = await attachPuppeteerOverBiDi(session.capabilities, session.sessionId)
		classicSessions.set(browser, session)
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

async function capabilities({ profileDir, headless }: { profileDir: string; headless: boolean }): Promise<Record<string, unknown>> {
	return {
		// Asks geckodriver for a BiDi endpoint on the session it owns, which is what makes one
		// browser drivable from both channels at once.
		webSocketUrl: true,
		"moz:firefoxOptions": {
			// The string overload of `executablePath` names a CHROME release channel, and every
			// overload returns a promise — passing it unawaited sends geckodriver `binary: {}`.
			binary: process.env.FIREFOX_PATH ?? (await puppeteer.executablePath({ browser: "firefox" })),
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

export const firefoxDriver: BrowserDriver = {
	kind: "firefox",
	scheme: SCHEME,
	launch,
	extensionUrl: (extensionId, path) => `${SCHEME}${extensionId}${path}`,
}
