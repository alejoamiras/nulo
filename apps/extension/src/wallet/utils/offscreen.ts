export const OFFSCREEN_READY_MESSAGE = "OFFSCREEN_READY"
export const OFFSCREEN_PING = "OFFSCREEN_PING"
export const OFFSCREEN_PONG = "OFFSCREEN_PONG"
export const OFFSCREEN_KEEPALIVE = "OFFSCREEN_KEEPALIVE"
/** F-10: broadcast (Firefox only) so a stale offscreen from a prior SW
 *  instance recognizes it's been superseded and self-closes. Payload:
 *  `{ type: OFFSCREEN_ADOPT_INSTANCE, token }`. */
export const OFFSCREEN_ADOPT_INSTANCE = "OFFSCREEN_ADOPT_INSTANCE"

let offscreenTimeout: NodeJS.Timeout
let offscreenPromise: Promise<void> | null = null
let resolveOffscreenPromise: () => void
let rejectOffscreenPromise: (reason: string) => void

const HEALTH_CHECK_TIMEOUT_MS = 3_000
const READY_TIMEOUT_MS = 10_000

const path = "src/offscreen/index.html"
/** Lazy URL — `chrome.runtime.getURL` is unavailable when this module is
 *  imported under vitest's node env. Computing on-demand keeps the import
 *  graph clean for tests that pull NetworkService → PxeServiceClient. */
let _offscreenUrl: string | undefined
function offscreenUrl(): string {
	if (_offscreenUrl === undefined) _offscreenUrl = chrome.runtime.getURL(path)
	return _offscreenUrl
}

/**
 * True on Chromium-based browsers that ship the MV3 `chrome.offscreen` API.
 * Firefox MV3 does NOT, so the Firefox build path uses a hidden minimized
 * window hosting the same offscreen.html instead. Pattern adapted from
 * Grego's extension-wallet (`extension-wallet/src/background/offscreen-
 * lifecycle.ts`).
 *
 * Behind a feature flag in spirit: Firefox parity is gated on manual
 * verification. The same code ships in both Chrome and Firefox bundles;
 * the runtime check decides which path executes. Chrome carries ~30
 * lines of dead code from the Firefox branch.
 */
function hasOffscreenApi(): boolean {
	return typeof chrome !== "undefined" && typeof chrome.offscreen !== "undefined"
}

/**
 * Firefox-only: ID of the hidden minimized window hosting offscreen.html.
 * Module-level so close/create can coordinate. Survives only the SW
 * lifetime — see the SW-restart-leak caveat in `ensureOffscreenRunning`.
 */
let firefoxOffscreenWindowId: number | null = null

/**
 * F-10: per-SW-lifetime token stamped into the Firefox offscreen window's URL,
 * so a stale window (leaked across a SW restart) can recognize it's been
 * superseded and self-close. Lazy so `crypto.randomUUID` isn't invoked at
 * import time under vitest's node env.
 */
let _firefoxInstanceToken: string | undefined
function firefoxInstanceToken(): string {
	if (_firefoxInstanceToken === undefined) _firefoxInstanceToken = crypto.randomUUID()
	return _firefoxInstanceToken
}

/**
 * F-10: decide whether an incoming `OFFSCREEN_ADOPT_INSTANCE` broadcast means
 * THIS offscreen window has been superseded and should self-close. True only
 * when: the offscreen has a token (`myInstanceToken !== null`, i.e. Firefox),
 * the sender is the same-extension SW (matching `runtime.id`, no `tab`), the
 * message is an ADOPT, and it names a DIFFERENT instance token. Pure so the
 * two-stale-plus-one-fresh case is unit-testable.
 */
export function isSupersededByAdopt(
	message: unknown,
	sender: chrome.runtime.MessageSender | undefined,
	myInstanceToken: string | null,
): boolean {
	if (myInstanceToken === null) return false
	const m = message as { type?: unknown; token?: unknown } | null
	return (
		sender?.id === chrome.runtime.id && sender.tab === undefined && m?.type === OFFSCREEN_ADOPT_INSTANCE && m.token !== myInstanceToken
	)
}

const onOffscreenReady = (message: unknown) => {
	if (message === OFFSCREEN_READY_MESSAGE) {
		chrome.runtime.onMessage.removeListener(onOffscreenReady)
		clearTimeout(offscreenTimeout)
		resolveOffscreenPromise()
		offscreenPromise = null
	}
	return false
}
const onOffscreenTimeout = () => {
	chrome.runtime.onMessage.removeListener(onOffscreenReady)
	// Fence FIRST (before the close): bumping the sequence invalidates the
	// current pass, so when the close below makes its still-pending
	// `createDocument` reject with "closed before fully loading", the retry
	// branch sees a stale pass id and propagates instead of re-creating an
	// untracked document (unguarded, that once produced a false-success pass).
	passSeq += 1
	// Kill the half-initialized offscreen so it doesn't become a ghost.
	closeOffscreen().catch(() => {})
	rejectOffscreenPromise("Offscreen is not responding")
	offscreenPromise = null
}

/** Monotonic create-pass fence. Each ensure pass captures `++passSeq`; the
 *  timeout handler bumps it to invalidate the running pass. `createOffscreen`
 *  retries ONLY while its pass id is still current — a mutable boolean here
 *  was insufficient: a NEW pass would reset it, re-arming the timed-out
 *  pass's zombie continuation, whose close-and-retry could then tear down
 *  the new pass's loading document (the cross-caller kill, resurrected). */
let passSeq = 0

/**
 * Check if the existing offscreen document is responsive.
 * Sends a ping and waits for a pong within HEALTH_CHECK_TIMEOUT_MS.
 * Returns true if healthy, false if zombie/unresponsive.
 *
 * Browser-agnostic: both Chromium offscreen and Firefox hidden-window
 * variants listen on `chrome.runtime.onMessage`, so the ping/pong path
 * is identical.
 */
async function isOffscreenHealthy(): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const timer = setTimeout(() => {
			chrome.runtime.onMessage.removeListener(onPong)
			resolve(false)
		}, HEALTH_CHECK_TIMEOUT_MS)

		const onPong = (message: unknown) => {
			if (message === OFFSCREEN_PONG) {
				chrome.runtime.onMessage.removeListener(onPong)
				clearTimeout(timer)
				resolve(true)
			}
			return false
		}

		chrome.runtime.onMessage.addListener(onPong)
		chrome.runtime.sendMessage(OFFSCREEN_PING).catch(() => {
			// No receiver — offscreen is definitely dead
			chrome.runtime.onMessage.removeListener(onPong)
			clearTimeout(timer)
			resolve(false)
		})
	})
}

/**
 * Close the existing offscreen, ignoring errors.
 *
 * Chromium: `chrome.offscreen.closeDocument()`.
 * Firefox: `chrome.windows.remove(firefoxOffscreenWindowId)` if known.
 *   If the window ID is unknown (post-SW-restart, see caveat below) we
 *   can't close it without a `tabs` permission to look it up by URL.
 *   That window is left running; the freshly-created replacement
 *   coexists. Acceptable for behind-feature-flag manual verification;
 *   tracked as a known limitation.
 */
async function closeOffscreen() {
	if (hasOffscreenApi()) {
		try {
			await chrome.offscreen.closeDocument()
		} catch {
			// Already closed or Chrome cleaned it up
		}
		return
	}
	if (firefoxOffscreenWindowId !== null) {
		try {
			await chrome.windows.remove(firefoxOffscreenWindowId)
		} catch {
			// Window already gone (user closed manually, browser quit, etc.)
		}
		firefoxOffscreenWindowId = null
	}
}

/**
 * Create the offscreen surface.
 *
 * Chromium: `chrome.offscreen.createDocument` with the WORKERS reason.
 *   Handles the ghost bug where `getContexts()` returns empty but
 *   `createDocument()` throws "single offscreen document".
 * Firefox: `chrome.windows.create` minimized + unfocused, hosting the
 *   same offscreen.html. The window doesn't take focus and shows in the
 *   taskbar/dock as a Nulo entry; the `chrome.runtime` message channel
 *   works identically to Chromium's offscreen.
 */
async function createOffscreen(passId: number) {
	if (hasOffscreenApi()) {
		const create = () =>
			chrome.offscreen.createDocument({
				url: path,
				reasons: ["WORKERS"],
				justification: "Offscreen document is used for running PXE in it",
			})
		try {
			await create()
		} catch (err) {
			// Two transient shapes get one close-and-retry: the ghost bug
			// ("single offscreen document": getContexts saw none but create says
			// one exists) and the loading race ("closed before fully loading":
			// the document was torn down mid-load, e.g. by browser cleanup —
			// the close is a no-op then, the retry is what matters). ONLY while
			// this pass is still current: the ready-gate timeout bumps `passSeq`
			// and then closes the document, so a timeout-induced rejection (or a
			// zombie continuation surviving into a successor pass) must
			// propagate — its close-and-retry would tear down a document this
			// pass no longer tracks.
			const msg = String(err)
			if (passId === passSeq && (msg.includes("single offscreen document") || msg.includes("closed before fully loading"))) {
				await closeOffscreen()
				// The close suspends: re-check the fence so a timeout landing in
				// the close window can't be followed by an untracked create.
				if (passId !== passSeq) throw err
				await create()
			} else {
				throw err
			}
		}
		return
	}
	// Firefox path. `chrome.windows.create` can resolve to undefined when
	// the browser refuses (rare, but typed that way) — fail loud so the
	// caller's create-promise rejection path runs and the ready-gate can
	// time out cleanly instead of hanging on a missing window id.
	const token = firefoxInstanceToken()
	const win = await chrome.windows.create({
		url: `${chrome.runtime.getURL(path)}?instance=${token}`,
		state: "minimized",
		focused: false,
	})
	if (!win) {
		throw new Error("Firefox offscreen fallback: chrome.windows.create resolved without a window")
	}
	firefoxOffscreenWindowId = win.id ?? null
	// F-10: notify any stale offscreen (a prior SW instance's window, leaked
	// across a SW restart) that a newer instance now owns the offscreen — it
	// self-closes on token mismatch. Broadcast here, before the ready-gate
	// awaits below routes any PXE traffic, so the stale window is gone first.
	chrome.runtime.sendMessage({ type: OFFSCREEN_ADOPT_INSTANCE, token }).catch(() => {})
}

/**
 * Detect whether the offscreen surface is already alive in this SW
 * lifetime. Chromium uses the `getContexts` introspection API; Firefox
 * relies on the in-memory `firefoxOffscreenWindowId`.
 *
 * Caveat (Firefox SW-restart): when the SW restarts, the in-memory
 * tracker resets to null even if the hidden window is still alive in
 * the browser. The next `ensureOffscreenRunning()` call will then
 * create a new window — leaking the old one. Re-discovering the old
 * window requires `chrome.windows.getAll({populate:true})` + a `tabs`
 * permission to read URLs, which expands the manifest surface beyond
 * what's needed for non-Firefox builds. Tracked as a known limitation
 * of the initial Firefox feature-flag pass; revisit if leaks are
 * observed during manual verification.
 */
async function isOffscreenAlreadyRunning(): Promise<boolean> {
	if (hasOffscreenApi()) {
		const existingContexts = await chrome.runtime.getContexts({
			contextTypes: ["OFFSCREEN_DOCUMENT"],
			documentUrls: [offscreenUrl()],
		})
		return existingContexts.length > 0
	}
	// Firefox: trust the module-local tracker (see SW-restart caveat above).
	return firefoxOffscreenWindowId !== null
}

/**
 * Single-flight gate for the WHOLE ensure sequence (probe → zombie close →
 * create → ready-await). Without it, concurrent cold-start callers race: a
 * second caller's `getContexts` sees the document the first caller is still
 * CREATING, its health ping gets no pong (the loading document hasn't
 * installed its listener yet), and its "zombie" close tears down the loading
 * document — surfacing on the creator as Chrome's "Offscreen document closed
 * before fully loading". Joiners must share one pass, not re-probe.
 */
let ensureInFlight: Promise<void> | null = null

export function ensureOffscreenRunning(): Promise<void> {
	if (!ensureInFlight) {
		ensureInFlight = doEnsureOffscreenRunning().finally(() => {
			ensureInFlight = null
		})
	}
	return ensureInFlight
}

async function doEnsureOffscreenRunning() {
	if (await isOffscreenAlreadyRunning()) {
		// Offscreen exists — verify it's actually responsive
		if (await isOffscreenHealthy()) {
			return
		}
		// Zombie offscreen — kill it and recreate below
		await closeOffscreen()
	}

	if (!offscreenPromise) {
		// Capture the gate LOCALLY: the ready/timeout handlers null the module
		// variable when they settle it, and awaiting the variable after that
		// awaits `null` — an instant false success for every joiner.
		const ready = new Promise<void>((resolve, reject) => {
			resolveOffscreenPromise = resolve
			rejectOffscreenPromise = reject
		})
		offscreenPromise = ready
		const passId = ++passSeq
		offscreenTimeout = setTimeout(onOffscreenTimeout, READY_TIMEOUT_MS)
		chrome.runtime.onMessage.addListener(onOffscreenReady)
		const creating = createOffscreen(passId)
		// Race-loser guard: when the gate times out first, `creating` may reject
		// AFTER this pass already rejected — that late rejection must not surface
		// as an unhandled rejection in the SW.
		creating.catch(() => {})
		try {
			// Race so a `createDocument` that HANGS cannot outlive the gate: the
			// 10s timeout rejects `ready`, the pass rejects, and the single-flight
			// clears — awaiting only the create would wedge every future caller.
			await Promise.race([creating, ready])
		} catch (err) {
			clearTimeout(offscreenTimeout)
			chrome.runtime.onMessage.removeListener(onOffscreenReady)
			offscreenPromise = null
			throw err
		}
		// DELIBERATELY not `await creating` here. A ghost document can emit
		// READY during its close-and-retry teardown, so `ready` can win while
		// `creating` is still replacing the document — an accepted benign race
		// (rare² timing; requests transiently fail; the next pass's probe+ping
		// adopts or replaces the live document). Awaiting `creating` would
		// close that window but reintroduces a wedge: the gate timer is already
		// cleared, so a hung post-READY create would block every caller forever.
		await ready
		return
	}

	await offscreenPromise
}
