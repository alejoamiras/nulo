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
): Promise<() => Promise<void>> {
	const origin = new URL(fromOrigin).origin
	const sessions = new Set<CDPSession>()
	const debug = process.env.NULO_E2E_INTERCEPT_LOG === "1"
	const log = (msg: string) => {
		if (debug) console.log(`[rpc-intercept] ${msg}`)
	}

	const arm = async (session: CDPSession, label: string) => {
		sessions.add(session)
		session.on("Fetch.requestPaused", (event: PausedRequest) => {
			const url = new URL(event.request.url)
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
		await session
			.send("Fetch.enable", { patterns: [{ urlPattern: `${origin}/*`, requestStage: "Request" }] })
			.catch((e) => log(`${label}: Fetch.enable failed: ${e}`))
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
		let session: CDPSession
		try {
			session = await target.createCDPSession()
		} catch (e) {
			log(`attach ${type} ${url} failed: ${e}`)
			return
		}
		log(`attached ${type} ${url}`)
		await arm(session, `${type}:${url.split("/").slice(-2).join("/")}`)
	}
	const onCreated = (target: Target) => {
		attach(target).catch(() => {})
	}
	browser.on("targetcreated", onCreated)
	await Promise.all(browser.targets().map(attach))
	return async () => {
		browser.off("targetcreated", onCreated)
		for (const session of sessions) await session.detach().catch(() => {})
	}
}
