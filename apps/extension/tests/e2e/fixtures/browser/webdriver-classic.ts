/**
 * WebDriver classic against geckodriver's HTTP port.
 *
 * Puppeteer drives Firefox over BiDi, and BiDi has neither a WebAuthn module nor window handles.
 * The two capabilities this suite cannot do without — a virtual authenticator that answers a PRF
 * ceremony, and a handle on a window the extension opened itself — exist only on this channel, so
 * both channels stay open against the same session for the life of a launch.
 */

export interface SessionCapabilities {
	browserVersion: string
	/** BiDi endpoint, present because the session was requested with `webSocketUrl: true`. */
	webSocketUrl: string
	[key: string]: unknown
}

export interface WindowWithUrl {
	handle: string
	url: string
}

/** Options for `POST /session/:id/webauthn/authenticator`, per the WebAuthn WebDriver extension. */
export interface VirtualAuthenticatorOptions {
	protocol: "ctap1/u2f" | "ctap2" | "ctap2_1"
	transport: "usb" | "nfc" | "ble" | "smart-card" | "hybrid" | "internal"
	hasResidentKey: boolean
	hasUserVerification: boolean
	isUserVerified: boolean
	extensions?: string[]
}

export class WebDriverError extends Error {
	constructor(
		readonly wdError: string,
		message: string,
	) {
		super(message)
		this.name = "WebDriverError"
	}
}

export class WebDriverSession {
	private constructor(
		private readonly base: string,
		readonly sessionId: string,
		readonly capabilities: SessionCapabilities,
	) {}

	/**
	 * Poll `/status` until geckodriver answers, then open the one session it will allow.
	 * `running` is the spawned driver's liveness: an answer on `base` after it has exited comes
	 * from another launch's geckodriver that won the port, and must not be given a session.
	 */
	static async open(
		base: string,
		capabilities: Record<string, unknown>,
		running: () => boolean,
		timeoutMs = 20_000,
	): Promise<WebDriverSession> {
		const deadline = Date.now() + timeoutMs
		let up = false
		while (!up && running() && Date.now() < deadline) {
			up = await fetch(`${base}/status`, { signal: AbortSignal.timeout(2_000) }).then(
				(r) => r.ok,
				() => false,
			)
			if (!up) await new Promise((resolve) => setTimeout(resolve, 100))
		}
		if (!running()) throw new Error(`geckodriver exited before serving ${base} — most likely another launch took its port; retry`)
		const value = await request(base, "POST", "/session", { capabilities: { alwaysMatch: capabilities } })
		const { sessionId, capabilities: caps } = value as { sessionId?: string; capabilities?: SessionCapabilities }
		if (!sessionId || !caps?.webSocketUrl) {
			throw new Error(`geckodriver returned no session or no BiDi socket: ${JSON.stringify(value).slice(0, 300)}`)
		}
		return new WebDriverSession(base, sessionId, caps)
	}

	private send(method: string, path: string, body?: unknown, timeoutMs?: number): Promise<unknown> {
		return request(this.base, method, `/session/${this.sessionId}${path}`, body, timeoutMs)
	}

	/** Install an unpacked add-on. `temporary` is the only form that accepts an unsigned build. */
	async installAddon(dir: string): Promise<string> {
		return (await this.send("POST", "/moz/addon/install", { path: dir, temporary: true })) as string
	}

	async windowHandles(): Promise<string[]> {
		return (await this.send("GET", "/window/handles", undefined, 5_000)) as string[]
	}

	async switchToWindow(handle: string): Promise<void> {
		await this.send("POST", "/window", { handle })
	}

	async currentUrl(): Promise<string> {
		return (await this.send("GET", "/url")) as string
	}

	private queue: Promise<unknown> = Promise.resolve()

	/** A session has ONE current window, so a switch and the command that depends on it must not
	 *  interleave with another caller's pair — two pages navigating at once would cross over. */
	private exclusive<T>(work: () => Promise<T>): Promise<T> {
		const run = this.queue.then(work, work)
		this.queue = run.catch(() => {})
		return run
	}

	/** Reading a handle's URL requires switching to it, so this leaves the last window focused. */
	windowsWithUrls(): Promise<WindowWithUrl[]> {
		return this.exclusive(async () => {
			const out: WindowWithUrl[] = []
			for (const handle of await this.windowHandles()) {
				await this.switchToWindow(handle)
				out.push({ handle, url: await this.currentUrl() })
			}
			return out
		})
	}

	/** Resolves once the document has loaded, per the session's default page-load strategy. */
	navigateWindow(handle: string, url: string): Promise<void> {
		return this.exclusive(async () => {
			await this.switchToWindow(handle)
			await this.send("POST", "/url", { url })
		})
	}

	refreshWindow(handle: string): Promise<void> {
		return this.exclusive(async () => {
			await this.switchToWindow(handle)
			await this.send("POST", "/refresh", {})
		})
	}

	async addVirtualAuthenticator(options: VirtualAuthenticatorOptions): Promise<string> {
		return (await this.send("POST", "/webauthn/authenticator", options)) as string
	}

	async removeVirtualAuthenticator(id: string): Promise<void> {
		await this.send("DELETE", `/webauthn/authenticator/${id}`)
	}

	/** Short, because everything that releases the launch waits behind it. */
	async close(): Promise<void> {
		await request(this.base, "DELETE", `/session/${this.sessionId}`, undefined, 15_000)
	}
}

/**
 * Every request carries a deadline: a wedged geckodriver otherwise holds the caller forever, and
 * the caller's own timeout cannot interrupt a fetch that is already outstanding. The default is
 * long because a navigation replies only once the page has loaded.
 */
async function request(base: string, method: string, path: string, body?: unknown, timeoutMs = 120_000): Promise<unknown> {
	const res = await fetch(`${base}${path}`, {
		method,
		signal: AbortSignal.timeout(timeoutMs),
		headers: { "content-type": "application/json" },
		body: method === "GET" || method === "DELETE" ? undefined : JSON.stringify(body ?? {}),
	})
	const json = (await res.json()) as { value?: { error?: string; message?: string } }
	if (!res.ok) {
		const error = json.value?.error ?? "unknown error"
		throw new WebDriverError(error, `${method} ${path} → ${error}: ${json.value?.message ?? ""}`)
	}
	return json.value
}
