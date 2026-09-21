import type { Browser, CDPSession } from "puppeteer"
import { extensionUrl } from "../fixtures/browser"

export type RpcInterception = { kind: "refuse" } | { kind: "redirect"; to: string }

export interface ArmedInterception {
	/** Requests intercepted so far. */
	hits: () => number
	/** Every arming or reply failure on a target whose requests this helper must control. A test
	 *  checks this after its scenario: a request that escaped to the real seed endpoint is a
	 *  failed test, however the scenario itself came out. */
	failures: () => string[]
	stop: () => Promise<void>
}

type PausedRequest = { requestId: string; request: { url: string } }
type TargetInfo = { type: string; url: string }
type AttachedToTarget = { sessionId: string; targetInfo: TargetInfo; waitingForDebugger: boolean }

/**
 * Reroute every request the extension makes to `fromOrigin` (the compiled-in seed endpoint the
 * test cannot change) without binding that origin's port. The stub keeps an ephemeral, run-owned
 * port.
 *
 * Interception must be armed on a target BEFORE its first request, and Puppeteer's target
 * discovery cannot guarantee that: it resumes a new target (`Runtime.runIfWaitingForDebugger`)
 * in the same tick it emits `targetcreated`, so anything armed from that event races the
 * target's first fetch. The offscreen document boots lazily at the import's account-state leg
 * and its FIRST request is the PXE boot call — on a slow runner that request escaped to the
 * real (refused) seed port and the registration leg fast-failed. So this helper runs its own
 * auto-attach from the browser target with `waitForDebuggerOnStart`: Chrome holds a new
 * target's first navigation until EVERY waiting client resumes it (a navigation throttle per
 * DevTools session, cleared only by that session's resume), so a target only runs once
 * `Fetch.enable` has landed on our session. Existing targets arrive through the same event (not
 * waiting) and are armed in place. Dedicated workers fetch through their document's loader, so
 * the document's session sees their requests and the worker targets themselves are not attached.
 */
export async function interceptRpc(
	browser: Browser,
	extensionId: string,
	fromOrigin: string,
	mode: RpcInterception,
): Promise<ArmedInterception> {
	const origin = new URL(fromOrigin).origin
	const sessions = new Set<CDPSession>()
	const initialArms: Promise<void>[] = []
	const failures: string[] = []
	let hits = 0
	let armedServiceWorker = false
	let settled = false
	const debug = process.env.NULO_E2E_INTERCEPT_LOG === "1"
	const log = (msg: string) => {
		if (debug) console.log(`[rpc-intercept] ${msg}`)
	}
	const fail = (msg: string) => {
		failures.push(msg)
		log(`FAILURE ${msg}`)
	}
	// A target that went away while being armed (Chrome's transient about:blank pages do) issued
	// no request; only a live target that could not be armed or resumed is a failure.
	const failUnlessGone = (msg: string, e: unknown) => {
		if (/target closed|session closed|detached/i.test(String(e))) log(`${msg}: ${e}`)
		else fail(`${msg}: ${e}`)
	}

	const isExtensionWorker = (info: TargetInfo) => info.type === "service_worker" && info.url.startsWith(extensionUrl(extensionId, "/"))

	const arm = async (session: CDPSession, label: string, info: TargetInfo) => {
		sessions.add(session)
		session.on("Fetch.requestPaused", (event: PausedRequest) => {
			const url = new URL(event.request.url)
			hits++
			log(`${label}: ${mode.kind} ${url.pathname}`)
			const reply =
				mode.kind === "refuse"
					? session.send("Fetch.failRequest", { requestId: event.requestId, errorReason: "ConnectionRefused" })
					: session.send("Fetch.continueRequest", { requestId: event.requestId, url: `${mode.to}${url.pathname}${url.search}` })
			reply.catch((e) => fail(`${label}: reply to ${url.pathname} failed: ${e}`))
		})
		await session.send("Fetch.enable", { patterns: [{ urlPattern: `${origin}/*`, requestStage: "Request" }] })
		if (isExtensionWorker(info)) armedServiceWorker = true
	}

	const root = await browser.target().createCDPSession()
	sessions.add(root)
	const stop = async () => {
		await root.send("Target.setAutoAttach", { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }).catch(() => {})
		// Detaching the root disposes every session attached under it; the loop covers the rest.
		for (const session of [root, ...sessions]) await session.detach().catch(() => {})
	}

	root.on("Target.attachedToTarget", (event: AttachedToTarget) => {
		const { type, url } = event.targetInfo
		const label = `${type}:${url.split("/").slice(-2).join("/")}`
		const child = root.connection()?.session(event.sessionId)
		if (!child) {
			// Puppeteer registers the session before re-emitting the event, so this cannot happen; if it
			// does, a held target could never be resumed through a session we do not have — tear the
			// whole attachment tree down (detaching releases every hold) rather than hang the run.
			fail(`${label}: session ${event.sessionId} not registered; detaching`)
			void stop()
			return
		}
		log(`attached ${label}${event.waitingForDebugger ? " (held)" : ""}`)
		// Resume in `finally`: a target left waiting for the debugger would hang the run.
		const armed = arm(child, label, event.targetInfo)
			.catch((e) => failUnlessGone(`${label}: Fetch.enable failed`, e))
			.finally(() => child.send("Runtime.runIfWaitingForDebugger").catch((e) => failUnlessGone(`${label}: resume failed`, e)))
		if (!settled) initialArms.push(armed)
	})

	try {
		await root.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })
		// Chrome delivers `Target.attachedToTarget` for every existing browser-level target before it
		// answers the `Target.setAutoAttach` that requested them, so the arms kicked off so far are
		// the existing targets'; later ones report through `failures`.
		settled = true
		await Promise.all(initialArms)
		// The service worker issues the preflight probe: without interception there the test would
		// dial the real seed endpoint — possibly another run's node — and prove nothing.
		if (!armedServiceWorker) throw new Error("rpc-intercept: the extension's service worker target is not armed")
		if (failures.length) throw new Error(`rpc-intercept: ${failures.join("; ")}`)
	} catch (e) {
		await stop()
		throw e
	}
	return { hits: () => hits, failures: () => [...failures], stop }
}
