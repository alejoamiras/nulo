// The tools app moved to its own repository and hosts. Released wallets still link the old names
// (the fee card's bridge link), so each one answers with a redirect to the app's new origin.

// The target origin is fixed per host: only the request's path and query are carried, re-serialised
// through URL, so nothing in the request can change where the redirect points.
export const TARGETS: ReadonlyMap<string, string> = new Map([
	["tools.nulo.sh", "https://unleashed-mainnet.alejo-amiras.workers.dev"],
	["testnet.tools.nulo.sh", "https://unleashed-testnet.alejo-amiras.workers.dev"],
])

export default {
	fetch(request: Request): Response {
		const url = new URL(request.url)
		const origin = TARGETS.get(url.hostname)
		if (origin === undefined) return new Response(null, { status: 404, headers: { "cache-control": "no-store" } })
		const target = new URL(origin)
		target.pathname = url.pathname
		target.search = url.search
		// 302, not 301: browsers keep a 301 indefinitely, and the target is not final.
		return new Response(null, { status: 302, headers: { location: target.href, "cache-control": "no-store" } })
	},
}
