/**
 * Chrome Web Store publishing, the pure half: builds the three API v2 requests and interprets
 * their responses. It never sees where the token comes from and never logs; the runner
 * (publish-chrome-store-run.ts) owns I/O, masking and exit codes.
 *
 * API reference: https://developer.chrome.com/docs/webstore/api (v2; v1 sunsets 2026-10-15).
 */

export const CWS_API = "https://chromewebstore.googleapis.com"

export type PublishType = "DEFAULT_PUBLISH" | "STAGED_PUBLISH"
export const PUBLISH_TYPES: readonly PublishType[] = ["DEFAULT_PUBLISH", "STAGED_PUBLISH"]

export interface ApiRequest {
	url: string
	method: "GET" | "POST"
	headers: Record<string, string>
	body?: Uint8Array | string
}

const itemUrl = (publisherId: string, itemId: string, suffix: string) =>
	`${CWS_API}/${suffix === "upload" ? "upload/" : ""}v2/publishers/${publisherId}/items/${itemId}:${suffix}`

const auth = (token: string) => ({ Authorization: `Bearer ${token}` })

export function uploadRequest(publisherId: string, itemId: string, token: string, zip: Uint8Array): ApiRequest {
	return {
		url: itemUrl(publisherId, itemId, "upload"),
		method: "POST",
		headers: { ...auth(token), "Content-Type": "application/zip" },
		body: zip,
	}
}

export function statusRequest(publisherId: string, itemId: string, token: string): ApiRequest {
	return { url: itemUrl(publisherId, itemId, "fetchStatus"), method: "GET", headers: auth(token) }
}

export function publishRequest(publisherId: string, itemId: string, token: string, publishType: PublishType): ApiRequest {
	return {
		url: itemUrl(publisherId, itemId, "publish"),
		method: "POST",
		headers: { ...auth(token), "Content-Type": "application/json" },
		body: JSON.stringify({ publishType, blockOnWarnings: true }),
	}
}

/**
 * Store versions are 1–4 dot-separated integers; compared as integer tuples padded to four parts
 * (`0.9.0.0` < `0.10.0.0`), never as strings or semver.
 */
export function parseStoreVersion(v: string): number[] | null {
	const parts = v.split(".")
	if (parts.length < 1 || parts.length > 4 || parts.some((p) => !/^\d+$/.test(p) || Number(p) > 65535)) return null
	return [...parts.map(Number), 0, 0, 0].slice(0, 4)
}

export function compareStoreVersions(a: number[], b: number[]): -1 | 0 | 1 {
	for (let i = 0; i < 4; i++) {
		if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
	}
	return 0
}

/** The subset of `fetchStatus` this script reads. Field names follow the API's JSON exactly. */
export interface ItemStatus {
	itemId?: string
	takenDown?: boolean
	publishedItemRevisionStatus?: RevisionStatus
	submittedItemRevisionStatus?: RevisionStatus
	lastAsyncUploadState?: string
	[k: string]: unknown
}

export interface RevisionStatus {
	state?: string
	distributionChannels?: { crxVersion?: string; [k: string]: unknown }[]
	[k: string]: unknown
}

const KNOWN_REVISION_STATES = new Set([
	"ITEM_STATE_UNSPECIFIED",
	"PENDING_REVIEW",
	"STAGED",
	"PUBLISHED",
	"PUBLISHED_TO_TESTERS",
	"REJECTED",
	"TAKEN_DOWN",
	"CANCELLED",
	"DEPLOYING",
	"UNPUBLISHED",
])

export type Verdict = { ok: true; summary: string } | { ok: false; reason: string }

/**
 * Whether an upload of `version` may proceed. An absent revision object is valid (nothing
 * published or submitted); a present one with an unknown state is not, because its meaning for
 * the upload is unknown too.
 */
export function interpretPreflight(status: ItemStatus, itemId: string, version: string): Verdict {
	if (status.itemId !== itemId) return { ok: false, reason: `fetchStatus answered for item ${str(status.itemId)}, expected ${itemId}` }
	if (status.takenDown === true) return { ok: false, reason: "the item is taken down; resolve that in the dashboard first" }
	const ours = parseStoreVersion(version)
	if (!ours) return { ok: false, reason: `version ${version} is not a store version (1–4 integers)` }
	const submitted = status.submittedItemRevisionStatus
	if (submitted !== undefined) {
		if (typeof submitted.state !== "string" || !KNOWN_REVISION_STATES.has(submitted.state)) {
			return { ok: false, reason: `submitted revision has an unknown state ${str(submitted.state)}` }
		}
		if (submitted.state === "PENDING_REVIEW") {
			return { ok: false, reason: "a submitted revision is pending review; cancel it in the dashboard or wait for the verdict" }
		}
	}
	const published = status.publishedItemRevisionStatus
	if (published !== undefined && (typeof published.state !== "string" || !KNOWN_REVISION_STATES.has(published.state))) {
		return { ok: false, reason: `published revision has an unknown state ${str(published.state)}` }
	}
	for (const [label, revision] of [
		["published", published],
		["submitted", submitted],
	] as const) {
		for (const channel of revision?.distributionChannels ?? []) {
			const theirs = channel.crxVersion === undefined ? null : parseStoreVersion(channel.crxVersion)
			if (!theirs) return { ok: false, reason: `${label} revision carries an unreadable crxVersion ${str(channel.crxVersion)}` }
			if (compareStoreVersions(theirs, ours) >= 0) {
				return { ok: false, reason: `${label} revision is at ${channel.crxVersion}, not lower than ${version}` }
			}
		}
	}
	return { ok: true, summary: `preflight ok: published ${published?.state ?? "none"}, submitted ${submitted?.state ?? "none"}` }
}

export interface UploadResponse {
	itemId?: string
	uploadState?: string
	crxVersion?: string
	[k: string]: unknown
}

export type UploadOutcome = { kind: "done" } | { kind: "poll" } | { kind: "fail"; reason: string }

/** The docs spell the in-progress state two ways; both mean "poll `fetchStatus.lastAsyncUploadState`". */
export function interpretUpload(res: UploadResponse, itemId: string, version: string): UploadOutcome {
	switch (res.uploadState) {
		case "SUCCEEDED": {
			if (res.itemId !== itemId) return { kind: "fail", reason: `upload answered for item ${str(res.itemId)}, expected ${itemId}` }
			const theirs = res.crxVersion === undefined ? null : parseStoreVersion(res.crxVersion)
			const ours = parseStoreVersion(version)
			if (!theirs || !ours || compareStoreVersions(theirs, ours) !== 0) {
				return { kind: "fail", reason: `upload reports crxVersion ${str(res.crxVersion)}, expected ${version}` }
			}
			return { kind: "done" }
		}
		case "IN_PROGRESS":
		case "UPLOAD_IN_PROGRESS":
			return { kind: "poll" }
		case "FAILED":
		case "NOT_FOUND":
		case "UPLOAD_STATE_UNSPECIFIED":
			return { kind: "fail", reason: `upload state ${res.uploadState}` }
		default:
			return { kind: "fail", reason: `upload state ${str(res.uploadState)} is not one this script knows` }
	}
}

/** `lastAsyncUploadState` exists only after an async upload; a missing field while polling is a failure, not "keep waiting". */
export function interpretAsyncUploadState(status: ItemStatus): UploadOutcome {
	switch (status.lastAsyncUploadState) {
		case "SUCCEEDED":
			return { kind: "done" }
		case "IN_PROGRESS":
		case "UPLOAD_IN_PROGRESS":
			return { kind: "poll" }
		case undefined:
			return { kind: "fail", reason: "fetchStatus carries no lastAsyncUploadState while an async upload was expected" }
		default:
			return { kind: "fail", reason: `async upload state ${str(status.lastAsyncUploadState)}` }
	}
}

export interface PublishResponse {
	state?: string
	warningInfo?: { warnings?: unknown[] }
	error?: { code?: number; message?: string; status?: string; details?: unknown[] }
	[k: string]: unknown
}

/** Warnings arrive in two envelopes: `warningInfo.warnings` on a 200, `error.details` on the 4xx that `blockOnWarnings` produces. */
export function collectWarnings(res: PublishResponse): string[] {
	const found: unknown[] = [...(res.warningInfo?.warnings ?? []), ...(res.error?.details ?? [])]
	return found.slice(0, 10).map((w) => truncate(typeof w === "string" ? w : JSON.stringify(w), 200))
}

export function interpretPublish(res: PublishResponse, httpStatus: number): Verdict {
	const warnings = collectWarnings(res)
	if (httpStatus >= 400) {
		return { ok: false, reason: `publish refused (HTTP ${httpStatus}): ${apiError(res)}${warnings.length ? `; warnings: ${warnings.join(" | ")}` : ""}` }
	}
	switch (res.state) {
		case "PENDING_REVIEW":
			return { ok: true, summary: "submitted: the revision is in review" }
		case "STAGED":
			return { ok: true, summary: "approved and staged: publish it from the dashboard within 30 days" }
		case "PUBLISHED":
		case "PUBLISHED_TO_TESTERS":
			return { ok: true, summary: `live (${res.state})` }
		case "REJECTED":
			return { ok: false, reason: `publish rejected${warnings.length ? `: ${warnings.join(" | ")}` : ""}` }
		default:
			return { ok: false, reason: `publish returned state ${str(res.state)}${warnings.length ? `; warnings: ${warnings.join(" | ")}` : ""}` }
	}
}

/** The API's `reason`/`description`/`message` strings, truncated; never the raw body. */
export function apiError(body: unknown): string {
	if (typeof body !== "object" || body === null) return "no error detail"
	const error = (body as { error?: unknown }).error
	const source = typeof error === "object" && error !== null ? (error as Record<string, unknown>) : (body as Record<string, unknown>)
	const parts = ["reason", "description", "message", "status"]
		.map((k) => source[k])
		.filter((v): v is string => typeof v === "string")
	return parts.length ? truncate(parts.join(" — "), 200) : "no error detail"
}

export const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s)
const str = (v: unknown) => (v === undefined ? "<absent>" : JSON.stringify(v))
