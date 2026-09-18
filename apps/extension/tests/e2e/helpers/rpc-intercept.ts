import type { Browser, CDPSession } from "puppeteer"

export type RpcInterception = { kind: "refuse" } | { kind: "redirect"; to: string }

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
 * target's first navigation (and a new worker's start) until EVERY waiting client resumes it,
 * so a target only runs once `Fetch.enable` has landed on our session. Existing targets arrive
 * through the same event (not waiting) and are armed in place.
 */
export async function interceptRpc(
	browser: Browser,
	extensionId: string,
	fromOrigin: string,
	mode: RpcInterception,
): Promise<{ stop: () => Promise<void>; hits: () => number }> {
	const origin = new URL(fromOrigin).origin
	const sessions = new Set<CDPSession>()
	const initialArms: Promise<void>[] = []
	let hits = 0
	let armedServiceWorker = false
	const debug = process.env.NULO_E2E_INTERCEPT_LOG === "1"
	const log = (msg: string) => {
		if (debug) console.log(`[rpc-intercept] ${msg}`)
	}

	// The service worker issues the preflight probe: without interception there the test would
	// dial the real seed endpoint — possibly another run's node — and prove nothing.
	const isExtensionWorker = (info: TargetInfo) =>
		info.type === "service_worker" && info.url.startsWith(`chrome-extension://${extensionId}/`)

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
			reply.catch(() => {})
		})
		listenForChildren(session, label)
		try {
			await session.send("Fetch.enable", { patterns: [{ urlPattern: `${origin}/*`, requestStage: "Request" }] })
			if (isExtensionWorker(info)) armedServiceWorker = true
		} catch (e) {
			// Dedicated workers have no Fetch domain; their requests pause on the owning document's session.
			if (isExtensionWorker(info)) throw new Error(`rpc-intercept: Fetch.enable failed on ${label}: ${e}`)
			log(`${label}: Fetch.enable failed: ${e}`)
		}
		// Nested targets (a document's dedicated workers) attach under this session, held the same way.
		await session
			.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })
			.catch((e) => log(`${label}: setAutoAttach failed: ${e}`))
	}

	const listenForChildren = (parent: CDPSession, parentLabel: string) => {
		parent.on("Target.attachedToTarget", (event: AttachedToTarget) => {
			const { type, url } = event.targetInfo
			const label = `${parentLabel}>${type}:${url.split("/").slice(-2).join("/")}`
			const child = childSession(parent, event.sessionId)
			if (!child) {
				log(`${label}: session ${event.sessionId} not registered`)
				return
			}
			log(`attached ${label}${event.waitingForDebugger ? " (held)" : ""}`)
			// Resume in `finally`: a target left waiting for the debugger would hang the run. A failure on
			// a non-required target is logged; on the service worker it is thrown to the caller below.
			const armed = arm(child, label, event.targetInfo).finally(() => child.send("Runtime.runIfWaitingForDebugger").catch(() => {}))
			if (!settled) initialArms.push(armed)
			else armed.catch((e) => log(`${label}: arm failed: ${e}`))
		})
	}

	// Chrome delivers `Target.attachedToTarget` for every EXISTING target before it answers the
	// `Target.setAutoAttach` that requested them, so `initialArms` is complete once it resolves.
	let settled = false
	const root = await browser.target().createCDPSession()
	sessions.add(root)
	listenForChildren(root, "")
	await root.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })
	settled = true
	await Promise.all(initialArms)
	if (!armedServiceWorker) throw new Error("rpc-intercept: the extension's service worker target is not present")
	return {
		hits: () => hits,
		stop: async () => {
			await root.send("Target.setAutoAttach", { autoAttach: false, waitForDebuggerOnStart: false, flatten: true }).catch(() => {})
			for (const session of sessions) await session.detach().catch(() => {})
		},
	}
}

/** Puppeteer registers every flattened child session on the connection before it re-emits the
 *  parent's `Target.attachedToTarget`, so the lookup is synchronous. `_session` is the connection's
 *  registry accessor — internal, but the only way to reach a session Puppeteer did not create a
 *  Target for. */
function childSession(parent: CDPSession, sessionId: string): CDPSession | undefined {
	const connection = parent.connection() as { _session?: (id: string) => CDPSession | undefined } | undefined
	return connection?._session?.(sessionId)
}
