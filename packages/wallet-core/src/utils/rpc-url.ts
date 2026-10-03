export type RpcTransportVerdict =
	| { allowed: true }
	| { allowed: false; refusal: "non-loopback-http"; host: string }
	| { allowed: false; refusal: "scheme"; scheme: string }

/**
 * The wallet's RPC transport rule: `https:` to any host, `http:` only to loopback as
 * `URL.hostname` spells it (IPv6 keeps its brackets, so `[::1]` is the literal). Userinfo is not
 * judged here: the extension's schema refuses it, the node-factory adapter does not.
 */
export function rpcTransportVerdict(url: URL): RpcTransportVerdict {
	const scheme = url.protocol.slice(0, -1)
	if (scheme === "https") return { allowed: true }
	if (scheme === "http") {
		const host = url.hostname.toLowerCase()
		if (host === "localhost" || host === "127.0.0.1" || host === "[::1]") return { allowed: true }
		return { allowed: false, refusal: "non-loopback-http", host }
	}
	return { allowed: false, refusal: "scheme", scheme }
}
