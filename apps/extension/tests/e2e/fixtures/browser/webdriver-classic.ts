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

	/** Poll `/status` until geckodriver answers, then open the one session it will allow. */
	static async open(base: string, capabilities: Record<string, unknown>, timeoutMs = 20_000): Promise<WebDriverSession> {
		const deadline = Date.now() + timeoutMs
		while (Date.now() < deadline) {
			const up = await fetch(`${base}/status`).then(
				(r) => r.ok,
				() => false,
			)
			if (up) break
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
		const value = await request(base, "POST", "/session", { capabilities: { alwaysMatch: capabilities } })
		const { sessionId, capabilities: caps } = value as { sessionId?: string; capabilities?: SessionCapabilities }
		if (!sessionId || !caps?.webSocketUrl) {
			throw new Error(`geckodriver returned no session or no BiDi socket: ${JSON.stringify(value).slice(0, 300)}`)
		}
		return new WebDriverSession(base, sessionId, caps)
	}

	private send(method: string, path: string, body?: unknown): Promise<unknown> {
		return request(this.base, method, `/session/${this.sessionId}${path}`, body)
	}

	/** Install an unpacked add-on. `temporary` is the only form that accepts an unsigned build. */
	async installAddon(dir: string): Promise<string> {
		return (await this.send("POST", "/moz/addon/install", { path: dir, temporary: true })) as string
	}

	async windowHandles(): Promise<string[]> {
		return (await this.send("GET", "/window/handles")) as string[]
	}

	async switchToWindow(handle: string): Promise<void> {
		await this.send("POST", "/window", { handle })
	}

	async currentUrl(): Promise<string> {
		return (await this.send("GET", "/url")) as string
	}

	/** Reading a handle's URL requires switching to it, so this leaves the last window focused. */
	async windowsWithUrls(): Promise<WindowWithUrl[]> {
		const out: WindowWithUrl[] = []
		for (const handle of await this.windowHandles()) {
			await this.switchToWindow(handle)
			out.push({ handle, url: await this.currentUrl() })
		}
		return out
	}

	async setScriptTimeout(ms: number): Promise<void> {
		await this.send("POST", "/timeouts", { script: ms })
	}

	/** The script's last argument is the completion callback; it runs in the focused window. */
	async executeAsync(script: string, args: unknown[] = []): Promise<unknown> {
		return this.send("POST", "/execute/async", { script, args })
	}

	async executeSync(script: string, args: unknown[] = []): Promise<unknown> {
		return this.send("POST", "/execute/sync", { script, args })
	}

	async addVirtualAuthenticator(options: VirtualAuthenticatorOptions): Promise<string> {
		return (await this.send("POST", "/webauthn/authenticator", options)) as string
	}

	async removeVirtualAuthenticator(id: string): Promise<void> {
		await this.send("DELETE", `/webauthn/authenticator/${id}`)
	}

	async authenticatorCredentials(id: string): Promise<unknown[]> {
		return (await this.send("GET", `/webauthn/authenticator/${id}/credentials`)) as unknown[]
	}

	async close(): Promise<void> {
		await this.send("DELETE", "")
	}
}

async function request(base: string, method: string, path: string, body?: unknown): Promise<unknown> {
	const res = await fetch(`${base}${path}`, {
		method,
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
