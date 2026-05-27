/**
 * Controllable JSON-RPC proxy for multi-RPC failover e2e tests.
 *
 * Each test that needs a second "endpoint" can spawn one of these in
 * `beforeAll`. The proxy listens on a random free port (kernel-assigned)
 * and forwards JSON-RPC POSTs to the real upstream (defaults to
 * `LOCAL_NODE_URL`). Tests toggle the mode at runtime to inject failures:
 *
 *   - `"ok"`        — transparent forward (default; behaves like the real
 *                      upstream from the wallet's perspective).
 *   - `"fail-503"`  — return HTTP 503 to every request. Drives the
 *                      classifier's "hard" bucket → cooldown after 2 hits.
 *   - `"wrong-chain"` — intercept `node_getNodeInfo` and rewrite the
 *                      response's `l1ChainId` to a wildly different value
 *                      so the `_getChainId` probe returns a mismatched
 *                      chainId. Used for the `ENDPOINT_CHAIN_MISMATCH`
 *                      promote-rejection test. Other methods forward
 *                      transparently.
 *
 * Why kernel-assigned ports: the global e2e setup already allocates one
 * pack of ports per worktree (anvil, aztec, playground, faucet). This
 * proxy is per-test-file scope, lifetime is short, and we don't need it
 * to survive lockfile reuse. Asking the OS for `:0` and reading back
 * `address.port` is the simplest race-free allocator.
 */
import http from "node:http"
import type { AddressInfo } from "node:net"
import { LOCAL_NODE_URL } from "./aztec"

export type ProxyMode = "ok" | "fail-503" | "wrong-chain"

export interface RpcProxy {
	/** Full URL the wallet should add as an endpoint, e.g.
	 *  `http://127.0.0.1:54234`. */
	readonly url: string
	/** Switch the proxy's behavior at runtime. Returns immediately;
	 *  subsequent requests see the new mode. */
	setMode(mode: ProxyMode): void
	/** Current mode (for assertions / debug logs). */
	getMode(): ProxyMode
	/** Number of upstream requests forwarded since start. Cheap accumulator;
	 *  reset via `resetCounters()`. */
	readonly counts: { forwarded: number; failed: number; intercepted: number }
	resetCounters(): void
	/** Stop the proxy + release the port. */
	close(): Promise<void>
}

export interface StartProxyOptions {
	/** Upstream URL to forward to. Defaults to `LOCAL_NODE_URL`. */
	upstream?: string
	/** Initial mode. Defaults to `"ok"`. */
	initialMode?: ProxyMode
}

export async function startRpcProxy(options: StartProxyOptions = {}): Promise<RpcProxy> {
	const upstream = new URL(options.upstream ?? LOCAL_NODE_URL)
	let mode: ProxyMode = options.initialMode ?? "ok"
	const counts = { forwarded: 0, failed: 0, intercepted: 0 }

	const server = http.createServer((req, res) => {
		if (req.method !== "POST") {
			// JSON-RPC is POST-only; reject anything else so misuse is loud.
			res.statusCode = 405
			res.end()
			return
		}

		// Read the request body before deciding what to do — `wrong-chain`
		// mode needs to inspect the JSON-RPC method before forwarding.
		const chunks: Buffer[] = []
		req.on("data", (c: Buffer) => chunks.push(c))
		req.on("end", () => {
			const body = Buffer.concat(chunks).toString("utf8")

			if (mode === "fail-503") {
				counts.failed += 1
				res.statusCode = 503
				res.setHeader("Content-Type", "application/json")
				res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Service unavailable (proxy injected)" } }))
				return
			}

			// Parse the JSON-RPC envelope so wrong-chain mode can target
			// node_getNodeInfo specifically. Malformed JSON falls through to
			// forward-as-is — the upstream's own validator handles it.
			let parsed: { method?: string; id?: number | string } | undefined
			try {
				parsed = JSON.parse(body)
			} catch {
				parsed = undefined
			}

			const isGetNodeInfo = parsed?.method === "node_getNodeInfo"

			if (mode === "wrong-chain" && isGetNodeInfo) {
				// Forward to upstream, but rewrite l1ChainId in the response.
				forwardAndRewrite(upstream, req, body, parsed, res, counts).catch((err) => {
					console.error("[rpc-proxy] wrong-chain forward failed:", err)
					res.statusCode = 502
					res.end()
				})
				return
			}

			// Default: transparent forward.
			forwardTransparent(upstream, req, body, res, counts).catch((err) => {
				console.error("[rpc-proxy] forward failed:", err)
				res.statusCode = 502
				res.end()
			})
		})

		req.on("error", (err) => {
			console.error("[rpc-proxy] request error:", err)
			res.statusCode = 500
			res.end()
		})
	})

	// `:0` lets the kernel pick a free ephemeral port.
	await new Promise<void>((resolve, reject) => {
		server.once("error", reject)
		server.listen(0, "127.0.0.1", () => resolve())
	})

	const address = server.address() as AddressInfo
	const url = `http://127.0.0.1:${address.port}`

	return {
		url,
		setMode(next) {
			mode = next
		},
		getMode() {
			return mode
		},
		counts,
		resetCounters() {
			counts.forwarded = 0
			counts.failed = 0
			counts.intercepted = 0
		},
		close() {
			return new Promise((resolve, reject) => {
				server.close((err) => (err ? reject(err) : resolve()))
			})
		},
	}
}

async function forwardTransparent(
	upstream: URL,
	req: http.IncomingMessage,
	body: string,
	res: http.ServerResponse,
	counts: { forwarded: number; failed: number; intercepted: number },
): Promise<void> {
	return new Promise((resolve, reject) => {
		const forward = http.request(
			{
				hostname: upstream.hostname,
				port: upstream.port || 80,
				path: upstream.pathname || "/",
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(body).toString(),
					...(req.headers.host ? {} : {}),
				},
			},
			(upstreamRes) => {
				counts.forwarded += 1
				res.statusCode = upstreamRes.statusCode ?? 502
				for (const [k, v] of Object.entries(upstreamRes.headers)) {
					if (v !== undefined) res.setHeader(k, v as string | string[])
				}
				upstreamRes.pipe(res)
				upstreamRes.on("end", resolve)
				upstreamRes.on("error", reject)
			},
		)
		forward.on("error", reject)
		forward.write(body)
		forward.end()
	})
}

async function forwardAndRewrite(
	upstream: URL,
	_req: http.IncomingMessage,
	body: string,
	_parsed: { method?: string; id?: number | string } | undefined,
	res: http.ServerResponse,
	counts: { forwarded: number; failed: number; intercepted: number },
): Promise<void> {
	return new Promise((resolve, reject) => {
		const forward = http.request(
			{
				hostname: upstream.hostname,
				port: upstream.port || 80,
				path: upstream.pathname || "/",
				method: "POST",
				headers: {
					"Content-Type": "application/json",
					"Content-Length": Buffer.byteLength(body).toString(),
				},
			},
			(upstreamRes) => {
				counts.intercepted += 1
				const chunks: Buffer[] = []
				upstreamRes.on("data", (c: Buffer) => chunks.push(c))
				upstreamRes.on("end", () => {
					const upstreamBody = Buffer.concat(chunks).toString("utf8")
					let rewritten = upstreamBody
					try {
						const json = JSON.parse(upstreamBody)
						if (json?.result && typeof json.result === "object") {
							// Aztec node returns nodeInfo with `l1ChainId` (number).
							// Rewrite to a sentinel that won't collide with any real
							// L1 chain id we care about.
							json.result.l1ChainId = 999_999_999
							rewritten = JSON.stringify(json)
						}
					} catch {
						// Forward as-is if upstream gave us non-JSON.
					}
					res.statusCode = upstreamRes.statusCode ?? 502
					res.setHeader("Content-Type", "application/json")
					res.setHeader("Content-Length", Buffer.byteLength(rewritten).toString())
					res.end(rewritten)
					resolve()
				})
				upstreamRes.on("error", reject)
			},
		)
		forward.on("error", reject)
		forward.write(body)
		forward.end()
	})
}
