export const TARGETS: ReadonlyMap<string, string> = new Map([
	["tools.nulo.sh", "https://unleashed-mainnet.alejo-amiras.workers.dev"],
	["testnet.tools.nulo.sh", "https://unleashed-testnet.alejo-amiras.workers.dev"],
])

export default {
	fetch(request: Request): Response {
		const url = new URL(request.url)
		const origin = TARGETS.get(url.hostname)
		if (origin === undefined) return new Response(null, { status: 404, headers: { "cache-control": "no-store" } })
		// The pathname and search setters cannot replace the authority, so the target keeps its origin
		// whatever the request carries; the encoded path and query pass through byte for byte.
		const target = new URL(origin)
		target.pathname = url.pathname
		target.search = url.search
		// A temporary destination: a 302 under no-store keeps browsers from persisting the redirect.
		return new Response(null, { status: 302, headers: { location: target.href, "cache-control": "no-store" } })
	},
}
