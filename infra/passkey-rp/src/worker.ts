// The WebAuthn relying-party host for Nulo passkeys. Every origin whose registrable domain
// suffix-matches the RP ID may assert with a credential and evaluate its PRF — the wallet master
// derives from that — so this host serves one static page, runs no script, and never answers
// under /.well-known/webauthn (that file would enable related-origin authorization).

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Nulo passkey host</title>
</head>
<body>
<p>This host anchors Nulo wallet passkeys. It serves no application and runs no script.</p>
</body>
</html>
`

const HEADERS: Record<string, string> = {
	"content-security-policy":
		"default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox",
	"permissions-policy": "publickey-credentials-create=(), publickey-credentials-get=()",
	"strict-transport-security": "max-age=31536000; includeSubDomains",
	"x-content-type-options": "nosniff",
	"x-frame-options": "DENY",
	"referrer-policy": "no-referrer",
	"cache-control": "public, max-age=3600",
	"x-robots-tag": "noindex",
}

function respond(status: number, body: string | null, extra: Record<string, string> = {}): Response {
	return new Response(body, { status, headers: { ...HEADERS, ...extra } })
}

export default {
	fetch(request: Request): Response {
		const url = new URL(request.url)
		// The zone does not force HTTPS and HSTS only covers browsers that already saw it once; the
		// edge reports the visitor's scheme in x-forwarded-proto, request.url may already be https.
		if (url.protocol === "http:" || request.headers.get("x-forwarded-proto") === "http") {
			url.protocol = "https:"
			return respond(301, null, { location: url.href })
		}
		if (request.method !== "GET" && request.method !== "HEAD") return respond(405, null, { allow: "GET, HEAD" })
		if (url.pathname !== "/") return respond(404, null)
		return respond(200, PAGE, { "content-type": "text/html; charset=utf-8" })
	},
}
