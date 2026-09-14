import type { Browser, CDPSession, Target } from "puppeteer"

export type RpcInterception = { kind: "refuse" } | { kind: "redirect"; to: string }

type PausedRequest = { requestId: string; request: { url: string } }

/**
 * Reroute every request the extension makes to `fromOrigin` (the compiled-in seed endpoint the
 * test cannot change) without binding that origin's port. The Fetch domain is enabled on the
 * service-worker target, on every extension-owned page/offscreen target that exists or appears
 * later (the offscreen document boots lazily), and — because the PXE fetches from a dedicated
 * worker, whose requests a page-level interception never sees — on every worker auto-attached
 * under those targets. The stub keeps an ephemeral, run-owned port.
 */
export async function interceptRpc(
	browser: Browser,
	extensionId: string,
	fromOrigin: string,
	mode: RpcInterception,
): Promise<{ stop: () => Promise<void>; hits: () => number }> {
	const origin = new URL(fromOrigin).origin
	const sessions = new Set<CDPSession>()
	let hits = 0
	const debug = process.env.NULO_E2E_INTERCEPT_LOG === "1"
	const log = (msg: string) => {
		if (debug) console.log(`[rpc-intercept] ${msg}`)
	}

	const arm = async (session: CDPSession, label: string, required = false) => {
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
		// Dedicated workers spawned by this target get their own session; arm each one too.
		session.on("sessionattached", (child: CDPSession) => {
			arm(child, `${label}>worker`)
				.then(() => child.send("Runtime.runIfWaitingForDebugger").catch(() => {}))
				.catch(() => {})
		})
		try {
			await session.send("Fetch.enable", { patterns: [{ urlPattern: `${origin}/*`, requestStage: "Request" }] })
		} catch (e) {
			// The service worker issues the preflight probe: without interception there the test would
			// dial the real seed endpoint — possibly another run's node — and prove nothing.
			if (required) throw new Error(`rpc-intercept: Fetch.enable failed on ${label}: ${e}`)
			log(`${label}: Fetch.enable failed: ${e}`)
		}
		await session
			.send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: true, flatten: true })
			.catch((e) => log(`${label}: setAutoAttach failed: ${e}`))
	}

	const attached = new WeakSet<Target>()
	// A target's url is still empty when `targetcreated` fires (the popup page and the offscreen
	// document navigate after creation), so attach by TYPE: the test browser holds only the
	// extension and Chrome's own pages, and the pattern scopes what is intercepted anyway.
	const attach = async (target: Target) => {
		const url = target.url()
		const type = target.type()
		if (attached.has(target) || url.startsWith("devtools://")) return
		if (type !== "service_worker" && type !== "other" && type !== "page") return
		if (type === "service_worker" && !url.startsWith(`chrome-extension://${extensionId}/`)) return
		attached.add(target)
		const required = type === "service_worker"
		let session: CDPSession
		try {
			session = await target.createCDPSession()
		} catch (e) {
			if (required) throw new Error(`rpc-intercept: cannot attach to the service worker: ${e}`)
			log(`attach ${type} ${url} failed: ${e}`)
			return
		}
		log(`attached ${type} ${url}`)
		await arm(session, `${type}:${url.split("/").slice(-2).join("/")}`, required)
	}
	const onCreated = (target: Target) => {
		attach(target).catch(() => {})
	}
	browser.on("targetcreated", onCreated)
	await Promise.all(browser.targets().map(attach))
	if (!browser.targets().some((t) => t.type() === "service_worker" && t.url().startsWith(`chrome-extension://${extensionId}/`))) {
		throw new Error("rpc-intercept: the extension's service worker target is not present")
	}
	return {
		hits: () => hits,
		stop: async () => {
			browser.off("targetcreated", onCreated)
			for (const session of sessions) await session.detach().catch(() => {})
		},
	}
}
