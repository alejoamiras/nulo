import { isSenderAtUrl, isTrustedInternalSender } from "@nulo/extension-messaging/offscreen"

export const OFFSCREEN_READY_MESSAGE = "OFFSCREEN_READY"
export const OFFSCREEN_PING = "OFFSCREEN_PING"
export const OFFSCREEN_PONG = "OFFSCREEN_PONG"
export const OFFSCREEN_KEEPALIVE = "OFFSCREEN_KEEPALIVE"

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
export function offscreenUrl(): string {
	if (_offscreenUrl === undefined) _offscreenUrl = chrome.runtime.getURL(path)
	return _offscreenUrl
}

/** True iff `sender` is the offscreen document itself — the only legitimate source of a PXE
 *  response, READY or PONG. Exact document URL; the Firefox frame's `?instance=` query is ignored
 *  here (`isLiveOffscreenSender` reads it). A same-extension page that opens or embeds the
 *  offscreen URL still passes: that is the transport's documented boundary, not a hole these
 *  checks close. */
export function isOffscreenDocumentSender(sender: chrome.runtime.MessageSender | undefined): boolean {
	return isSenderAtUrl(sender, offscreenUrl())
}

/**
 * True on Chromium-based browsers that ship the MV3 `chrome.offscreen` API. Firefox MV3 does not,
 * so there the same offscreen.html is hosted as an <iframe> of the background page. The same code
 * ships in both bundles; the runtime check decides which branch executes.
 */
function hasOffscreenApi(): boolean {
	return typeof chrome !== "undefined" && typeof chrome.offscreen !== "undefined"
}

/**
 * Firefox-only: the frame hosting offscreen.html, and the generation stamped into its URL. A frame
 * inherits the background page's `visible`, so its timers run unthrottled — in a minimized window
 * Firefox clamps every timer to one per second, and the PXE's node client waits on a zero-delay
 * timer per RPC batch. The frame dies with the background page; the next request re-creates it.
 */
let firefoxOffscreenFrame: { element: HTMLIFrameElement; generation: string } | null = null

/** The `?instance=` generation a sender's URL carries, or null when the URL is absent or malformed. */
function senderGeneration(sender: chrome.runtime.MessageSender): string | null {
	if (sender.url === undefined) return null
	try {
		return new URL(sender.url).searchParams.get("instance")
	} catch {
		return null
	}
}

/**
 * True iff `sender` is the offscreen document THIS module currently tracks. On Firefox that is the
 * connected frame with the matching generation: a frame removed on READY timeout or a failed health
 * check can still have a READY or PONG in flight, and by URL alone that message would open its
 * successor's gate, or pass the successor's health check and let a request reach a document whose
 * PXE is not up. Chrome's `chrome.offscreen` allows one document, so the URL check is the whole test.
 */
function isLiveOffscreenSender(sender: chrome.runtime.MessageSender | undefined): boolean {
	if (!isOffscreenDocumentSender(sender) || sender === undefined) return false
	if (hasOffscreenApi()) return true
	const frame = firefoxOffscreenFrame
	return frame?.element.isConnected === true && senderGeneration(sender) === frame.generation
}

/**
 * B-17: the offscreen answers a health PING with PONG only once its PXE services
 * are actually initialized — not merely when the document has loaded. A PONG
 * returned during init let the SW (after an SW restart that left a mid-init
 * document alive) adopt that document and dispatch a PXE RPC before `PxeService`
 * existed — a missing-handler timeout instead of a clean readiness wait. The
 * PING listener is still installed early; it just withholds PONG until services
 * are ready, so `isOffscreenHealthy` treats a still-initializing document as
 * not-yet-adoptable and the caller recreates + waits for READY.
 */
export function shouldRespondPong(message: unknown, servicesReady: boolean, sender: chrome.runtime.MessageSender | undefined): boolean {
	return message === OFFSCREEN_PING && servicesReady && isTrustedInternalSender(sender)
}

const onOffscreenReady = (message: unknown, sender: chrome.runtime.MessageSender | undefined) => {
	if (message === OFFSCREEN_READY_MESSAGE && isLiveOffscreenSender(sender)) {
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
	// B-17: kill the half-initialized offscreen through the serialized close tail
	// so the next pass can join it (see `trackedClose`). The gate below rejects
	// `ready`, which clears the single-flight gate (ensureInFlight) — so a
	// successor pass can begin while this close is still in flight; without
	// joining it, a late-landing `closeDocument()` here tears down the
	// successor's freshly-created document.
	void trackedClose()
	rejectOffscreenPromise("Offscreen is not responding")
	offscreenPromise = null
}

/** B-17: serialize EVERY offscreen close (timeout kill, zombie-adopt kill, and
 *  the create-retry loading-race close) through one tail, and expose its latest
 *  link as `pendingClose`. `closeDocument()` / the frame's removal act on the
 *  singleton offscreen surface, so two closes that overlap in time can compose
 *  destructively: a create-retry close that lands AFTER a successor pass created
 *  a fresh document tears that document down. Serializing means closes settle in
 *  order and a successor that joins `pendingClose` waits for ALL of them before
 *  probing/creating. Identity-guarded so an earlier link settling doesn't null a
 *  newer one. */
let closeTail: Promise<void> = Promise.resolve()
let pendingClose: Promise<void> | null = null
function trackedClose(): Promise<void> {
	const link = closeTail.then(() => closeOffscreen()).catch(() => {})
	closeTail = link
	pendingClose = link
	void link.finally(() => {
		if (pendingClose === link) pendingClose = null
	})
	return link
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
 * Browser-agnostic: both the Chromium offscreen document and the Firefox
 * frame listen on `chrome.runtime.onMessage`, so the ping/pong path is
 * identical.
 */
async function isOffscreenHealthy(): Promise<boolean> {
	return new Promise<boolean>((resolve) => {
		const timer = setTimeout(() => {
			chrome.runtime.onMessage.removeListener(onPong)
			resolve(false)
		}, HEALTH_CHECK_TIMEOUT_MS)

		const onPong = (message: unknown, sender: chrome.runtime.MessageSender | undefined) => {
			if (message === OFFSCREEN_PONG && isLiveOffscreenSender(sender)) {
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
 * Firefox: remove the frame; a removed frame's document is destroyed with it.
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
	firefoxOffscreenFrame?.element.remove()
	firefoxOffscreenFrame = null
}

/**
 * Create the offscreen surface.
 *
 * Chromium: `chrome.offscreen.createDocument` with the WORKERS reason.
 *   Handles the ghost bug where `getContexts()` returns empty but
 *   `createDocument()` throws "single offscreen document".
 * Firefox: an <iframe> of the background page hosting the same
 *   offscreen.html; the `chrome.runtime` message channel works identically
 *   to Chromium's offscreen document.
 */
async function createOffscreen(passId: number) {
	if (hasOffscreenApi()) return createOffscreenChromium(passId)
	createOffscreenFirefox()
}

async function createOffscreenChromium(passId: number) {
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
			// B-17: route through the serialized close tail so this close composes
			// with a concurrent timeout close instead of racing it — a successor
			// joins the tail and can't create into a document this close then tears
			// down out of order.
			await trackedClose()
			// The close suspends: re-check the fence so a timeout landing in
			// the close window can't be followed by an untracked create.
			if (passId !== passSeq) throw err
			await create()
		} else {
			throw err
		}
	}
}

/** Firefox path. Appending is synchronous, so unlike the Chromium branch there is no gap between
 *  the create and the tracker assignment for a timed-out pass to race into. The generation in
 *  the URL is what `isLiveOffscreenSender` matches READY and PONG against. The background page
 *  may run this before `body` exists. */
function createOffscreenFirefox(): void {
	const generation = crypto.randomUUID()
	const element = document.createElement("iframe")
	element.src = `${offscreenUrl()}?instance=${generation}`
	;(document.body ?? document.documentElement).appendChild(element)
	firefoxOffscreenFrame = { element, generation }
}

/**
 * Detect whether the offscreen surface is already alive. Chromium uses the
 * `getContexts` introspection API; Firefox asks whether the tracked frame is
 * still attached — attachment only, readiness is the health check's job.
 */
async function isOffscreenAlreadyRunning(): Promise<boolean> {
	if (hasOffscreenApi()) {
		const existingContexts = await chrome.runtime.getContexts({
			contextTypes: ["OFFSCREEN_DOCUMENT"],
			documentUrls: [offscreenUrl()],
		})
		return existingContexts.length > 0
	}
	return firefoxOffscreenFrame?.element.isConnected === true
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
	// B-17: join a timed-out predecessor's close before probing or creating.
	// onOffscreenTimeout fences + closes but does NOT await the close, and the
	// single-flight gate clears when its `ready` rejects — so without this a
	// successor could probe/create while `closeDocument()` is still in flight and
	// have its new document torn down by that late close.
	if (pendingClose) await pendingClose

	if (await isOffscreenAlreadyRunning()) {
		// Offscreen exists — verify it's actually responsive
		if (await isOffscreenHealthy()) {
			return
		}
		// Zombie offscreen — kill it and recreate below. Through the serialized
		// tail (B-17) so it composes with any other in-flight close.
		await trackedClose()
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
