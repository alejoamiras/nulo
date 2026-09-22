/**
 * Firefox Add-ons (AMO) publishing, the pure half: the JWT, the five API v5 requests and their
 * interpreters, plus the checks on the zip, the source archive and the reviewer notes. It never
 * sees where the key pair comes from and never logs; the runner (publish-firefox-amo-run.ts) owns
 * I/O, masking and exit codes.
 *
 * API reference: https://mozilla.github.io/addons-server/topics/api/addons.html (v5) and
 * https://mozilla.github.io/addons-server/topics/api/auth.html (JWT, HS256, exp ≤ iat + 5 min).
 */

import { createHmac } from "node:crypto"

export const AMO_API = "https://addons.mozilla.org/api/v5"
/** The add-on's permanent AMO identity (`browser_specific_settings.gecko.id`). */
export const GECKO_ID = "wallet@nulo.sh"
/** The settled `data_collection_permissions.required`; a build declaring anything else is refused. */
export const DATA_COLLECTION: readonly string[] = ["financialAndPaymentInfo"]
export const SOURCE_MAX_BYTES = 200 * 1024 * 1024
export const JWT_LIFETIME_SEC = 60

const b64url = (s: string | Buffer) => Buffer.from(s).toString("base64url")

/** HS256 JWT for one request. `now` is seconds; AMO refuses `exp` more than five minutes past `iat`. */
export function jwt(issuer: string, secret: string, now: number, jti: string): string {
	const header = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
	const payload = b64url(JSON.stringify({ iss: issuer, jti, iat: now, exp: now + JWT_LIFETIME_SEC }))
	const signature = createHmac("sha256", secret).update(`${header}.${payload}`).digest("base64url")
	return `${header}.${payload}.${signature}`
}

export interface MultipartFile {
	filename: string
	bytes: Uint8Array
	type: string
}

export type ApiRequest =
	| { kind: "json"; url: string; method: "GET" | "POST" | "PATCH"; body?: unknown }
	| { kind: "multipart"; url: string; method: "POST" | "PATCH"; fields: Record<string, string>; files: Record<string, MultipartFile> }

export const uploadRequest = (zip: Uint8Array, filename: string): ApiRequest => ({
	kind: "multipart",
	url: `${AMO_API}/addons/upload/`,
	method: "POST",
	fields: { channel: "listed" },
	files: { upload: { filename, bytes: zip, type: "application/zip" } },
})

export const uploadStatusRequest = (uuid: string): ApiRequest => ({ kind: "json", url: `${AMO_API}/addons/upload/${encodeURIComponent(uuid)}/`, method: "GET" })

export const versionRequest = (guid: string, uuid: string, approvalNotes: string): ApiRequest => ({
	kind: "json",
	url: `${AMO_API}/addons/addon/${encodeURIComponent(guid)}/versions/`,
	method: "POST",
	body: { upload: uuid, approval_notes: approvalNotes },
})

/** "Version source files cannot be uploaded as JSON": the source goes as multipart on a PATCH of the version. */
export const sourceRequest = (guid: string, versionId: number | string, archive: Uint8Array, filename: string): ApiRequest => ({
	kind: "multipart",
	url: `${AMO_API}/addons/addon/${encodeURIComponent(guid)}/versions/${encodeURIComponent(String(versionId))}/`,
	method: "PATCH",
	fields: {},
	files: { source: { filename, bytes: archive, type: "application/zip" } },
})

/** "List all add-ons you are the author of": proves the key pair, unlike the public detail endpoint. Paginated: `url` is a `next` link on later pages. */
export const ownAddonsRequest = (url = `${AMO_API}/addons/addon/?page_size=50`): ApiRequest => ({ kind: "json", url, method: "GET" })
/** Pages of the author-scoped list followed before giving up; the add-on is expected well within them. */
export const OWN_ADDONS_MAX_PAGES = 10

export type Verdict<T> = { ok: true; value: T } | { ok: false; reason: string }

const obj = (v: unknown): Record<string, unknown> | null => (typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null)
export const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)

export function interpretUploadCreate(json: unknown): Verdict<string> {
	const o = obj(json)
	if (!o || typeof o.uuid !== "string" || !o.uuid) return { ok: false, reason: "upload response carries no uuid" }
	return { ok: true, value: o.uuid }
}

export type UploadStatus = { kind: "processing" } | { kind: "valid" } | { kind: "invalid"; errors: string[] }

/** `processed` then `valid`; when invalid, the validation errors (bounded) are the only useful output. */
export function interpretUploadStatus(json: unknown): Verdict<UploadStatus> {
	const o = obj(json)
	if (!o) return { ok: false, reason: "upload status is not an object" }
	if (o.processed !== true) return { ok: true, value: { kind: "processing" } }
	if (o.valid === true) return { ok: true, value: { kind: "valid" } }
	const validation = obj(o.validation)
	const messages = Array.isArray(validation?.messages) ? validation.messages : []
	const errors = messages
		.map(obj)
		.filter((m): m is Record<string, unknown> => m !== null && m.type === "error")
		.slice(0, 10)
		.map((m) => truncate([m.message, m.description].filter((s): s is string => typeof s === "string").join(" — ") || "error without message", 200))
	return { ok: true, value: { kind: "invalid", errors } }
}

export interface CreatedVersion {
	id: number | string
	version: string
	channel: string
	fileStatus: string
}

/** The version must exist with our manifest version on the listed channel before its source is attached. */
export function interpretVersion(json: unknown, manifestVersion: string): Verdict<CreatedVersion> {
	const o = obj(json)
	if (!o) return { ok: false, reason: "version response is not an object" }
	const id = typeof o.id === "number" || typeof o.id === "string" ? o.id : null
	if (id === null || id === "") return { ok: false, reason: "version response carries no id" }
	if (o.version !== manifestVersion) return { ok: false, reason: `version response is for ${JSON.stringify(o.version ?? null)}, expected ${manifestVersion}` }
	if (o.channel !== "listed") return { ok: false, reason: `version landed on channel ${JSON.stringify(o.channel ?? null)}, expected listed` }
	const file = obj(o.file)
	const fileStatus = typeof file?.status === "string" ? file.status : "unknown"
	return { ok: true, value: { id, version: manifestVersion, channel: "listed", fileStatus } }
}

export function interpretSource(json: unknown): Verdict<true> {
	const o = obj(json)
	if (!o) return { ok: false, reason: "source response is not an object" }
	if (typeof o.source !== "string" || !o.source) return { ok: false, reason: "source response does not name an attached source file" }
	return { ok: true, value: true }
}

export type OwnAddons = { kind: "found"; status: string } | { kind: "next"; url: string; listed: number } | { kind: "absent"; listed: number }

/** One page of the author-scoped list: our `guid`, or the `next` page to read, or the end of the list. */
export function interpretOwnAddons(json: unknown, guid: string): Verdict<OwnAddons> {
	const o = obj(json)
	const results = Array.isArray(o?.results) ? o.results : null
	if (!results) return { ok: false, reason: "add-on list response carries no results" }
	const mine = results.map(obj).find((a) => a?.guid === guid)
	if (mine) return { ok: true, value: { kind: "found", status: typeof mine.status === "string" ? mine.status : "unknown" } }
	const next = typeof o?.next === "string" && o.next.startsWith(`${AMO_API}/`) ? o.next : null
	return { ok: true, value: next ? { kind: "next", url: next, listed: results.length } : { kind: "absent", listed: results.length } }
}

/** The API's error strings, truncated; never the raw body. */
export function apiError(body: unknown): string {
	const o = obj(body)
	if (!o) return "no error detail"
	const parts: string[] = []
	for (const [k, v] of Object.entries(o)) {
		if (typeof v === "string") parts.push(`${k}: ${v}`)
		else if (Array.isArray(v) && v.every((x) => typeof x === "string")) parts.push(`${k}: ${v.join("; ")}`)
	}
	return parts.length ? truncate(parts.join(" | "), 200) : "no error detail"
}

export interface FirefoxManifestFacts {
	/** The manifest's numeric version: what AMO speaks, e.g. `0.27.0.0` for `VERSION=0.27.0`. */
	storeVersion: string
}

/** The zip must be the Firefox build of this release with the settled declaration. */
export function checkFirefoxManifest(manifest: unknown, version: string): Verdict<FirefoxManifestFacts> {
	const m = obj(manifest)
	if (!m) return { ok: false, reason: "manifest.json is not an object" }
	if (m.version_name !== version) return { ok: false, reason: `manifest version_name ${JSON.stringify(m.version_name ?? null)} is not VERSION ${version}` }
	const storeVersion = typeof m.version === "string" ? m.version : ""
	if (!/^\d+\.\d+\.\d+\.\d+$/.test(storeVersion)) return { ok: false, reason: `manifest version ${JSON.stringify(storeVersion)} is not four integers` }
	if (!storeVersion.startsWith(`${version.split("-")[0]}.`)) return { ok: false, reason: `manifest version ${storeVersion} does not derive from VERSION ${version}` }
	const gecko = obj(obj(m.browser_specific_settings)?.gecko)
	if (!gecko) return { ok: false, reason: "the zip carries no browser_specific_settings.gecko: that is not the Firefox build" }
	if (gecko.id !== GECKO_ID) return { ok: false, reason: `gecko.id ${JSON.stringify(gecko.id ?? null)} is not ${GECKO_ID}` }
	const required = obj(gecko.data_collection_permissions)?.required
	if (!Array.isArray(required) || required.length !== DATA_COLLECTION.length || !DATA_COLLECTION.every((c, i) => required[i] === c)) {
		return { ok: false, reason: `data_collection_permissions.required ${JSON.stringify(required ?? null)} is not the settled ${JSON.stringify(DATA_COLLECTION)}` }
	}
	return { ok: true, value: { storeVersion } }
}

/** Paths a `git archive --prefix=nulo-<v>/` of the release must contain for a reviewer to rebuild it. */
export const requiredSourcePaths = (version: string) => [`nulo-${version}/apps/extension/store/SOURCE-BUILD.md`, `nulo-${version}/bun.lock`]

/** The archived extension manifest source, whose `version` must be the release's: the build takes its version from the tag, `git archive` keeps the tree's, and the reviewer script refuses a tree at another version. */
export const sourcePackageJsonPath = (version: string) => `nulo-${version}/apps/extension/package.json`

export function checkSourceArchive(entries: readonly string[], sizeBytes: number, version: string, packageJson: string): Verdict<true> {
	if (sizeBytes >= SOURCE_MAX_BYTES) return { ok: false, reason: `source archive is ${sizeBytes} bytes, at or over AMO's 200 MB cap` }
	const present = new Set(entries)
	const missing = [...requiredSourcePaths(version), sourcePackageJsonPath(version)].filter((p) => !present.has(p))
	if (missing.length) return { ok: false, reason: `source archive lacks ${missing.join(", ")} (is it git archive --prefix=nulo-${version}/ of the release?)` }
	let treeVersion: unknown
	try {
		treeVersion = obj(JSON.parse(packageJson))?.version
	} catch {
		return { ok: false, reason: `${sourcePackageJsonPath(version)} in the source archive is not JSON` }
	}
	if (treeVersion !== version) return { ok: false, reason: `the source archive's tree is at version ${JSON.stringify(treeVersion ?? null)}, not ${version}: a reviewer's rebuild would refuse it` }
	return { ok: true, value: true }
}

export const NOTES_START = "<!-- reviewer-notes:start -->"
export const NOTES_END = "<!-- reviewer-notes:end -->"

/** The block `store/listing.md` keeps between its two markers, sent as `approval_notes`. */
export function reviewerNotes(listing: string): Verdict<string> {
	const start = listing.indexOf(NOTES_START)
	const end = listing.indexOf(NOTES_END)
	if (start < 0 || end < 0 || end < start) return { ok: false, reason: "listing.md has no reviewer-notes block between its markers" }
	const notes = listing.slice(start + NOTES_START.length, end).trim()
	if (!notes) return { ok: false, reason: "the reviewer-notes block is empty" }
	return { ok: true, value: notes }
}

/** What to do when the version was created but the run failed afterwards; printed, never acted on. */
export const RECOVERY = [
	"do NOT re-run: the upload is consumed, AMO refuses a duplicate version number, and deleting a version never frees its number;",
	"open the version in the Developer Hub (https://addons.mozilla.org/developers/) and attach the same git-archive source there,",
	"or re-send only the source PATCH for that version id.",
].join(" ")
