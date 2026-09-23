// The policy every response of the RP host must carry, owned by the tests and hand-written: the
// Worker exports its own copy, and the two must be independent so a weakened header changes the
// implementation without moving the expectation.
export const RP_HOST = "passkey.nulo.sh"

export const EXPECTED_POLICY: Record<string, string> = {
	"content-security-policy": "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'; sandbox",
	"permissions-policy": "publickey-credentials-create=(), publickey-credentials-get=()",
	"strict-transport-security": "max-age=31536000; includeSubDomains",
	"x-content-type-options": "nosniff",
	"x-frame-options": "DENY",
	"referrer-policy": "no-referrer",
	"x-robots-tag": "noindex",
}

// A page with no script and no outbound reference of any kind.
export const INERT_HTML = /<script|<iframe|<link|<object|<embed|\ssrc=|\shref=|\son[a-z]+=|javascript:/i
