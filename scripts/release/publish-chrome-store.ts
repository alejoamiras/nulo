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

/** `blockOnWarnings: false` is sent only by the one retry `acceptedWarnings` licenses. */
export function publishRequest(publisherId: string, itemId: string, token: string, publishType: PublishType, blockOnWarnings = true): ApiRequest {
	return {
		url: itemUrl(publisherId, itemId, "publish"),
		method: "POST",
		headers: { ...auth(token), "Content-Type": "application/json" },
		body: JSON.stringify({ publishType, blockOnWarnings }),
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

/** Google's documented ItemState values whose meaning for an upload is known; anything else fails closed. */
const KNOWN_REVISION_STATES = new Set(["PENDING_REVIEW", "STAGED", "PUBLISHED", "PUBLISHED_TO_TESTERS", "REJECTED", "CANCELLED"])

/** A revision object as the API sent it: absent is valid, anything present must be an object with a known state. */
function revisionState(revision: unknown): { kind: "absent" } | { kind: "known"; revision: RevisionStatus } | { kind: "unknown"; state: unknown } {
	if (revision === undefined) return { kind: "absent" }
	if (typeof revision !== "object" || revision === null) return { kind: "unknown", state: revision }
	const r = revision as RevisionStatus
	return typeof r.state === "string" && KNOWN_REVISION_STATES.has(r.state) ? { kind: "known", revision: r } : { kind: "unknown", state: r.state }
}

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
	const submitted = revisionState(status.submittedItemRevisionStatus)
	if (submitted.kind === "unknown") return { ok: false, reason: `submitted revision has an unknown state ${str(submitted.state)}` }
	if (submitted.kind === "known" && submitted.revision.state === "PENDING_REVIEW") {
		return { ok: false, reason: "a submitted revision is pending review; cancel it in the dashboard or wait for the verdict" }
	}
	const published = revisionState(status.publishedItemRevisionStatus)
	if (published.kind === "unknown") return { ok: false, reason: `published revision has an unknown state ${str(published.state)}` }
	for (const [label, revision] of [
		["published", published],
		["submitted", submitted],
	] as const) {
		if (revision.kind !== "known") continue
		const { distributionChannels } = revision.revision
		// Absent is "no channel"; present-but-not-a-list is a shape this script cannot read, so it fails.
		if (distributionChannels !== undefined && !Array.isArray(distributionChannels)) {
			return { ok: false, reason: `${label} revision carries an unreadable distributionChannels ${str(distributionChannels)}` }
		}
		for (const channel of distributionChannels ?? []) {
			const crx = typeof channel === "object" && channel !== null ? channel.crxVersion : undefined
			const theirs = typeof crx === "string" ? parseStoreVersion(crx) : null
			if (!theirs) return { ok: false, reason: `${label} revision carries an unreadable crxVersion ${str(crx)}` }
			if (compareStoreVersions(theirs, ours) >= 0) {
				return { ok: false, reason: `${label} revision is at ${crx}, not lower than ${version}` }
			}
		}
	}
	const describe = (r: ReturnType<typeof revisionState>) => (r.kind === "known" ? r.revision.state : "none")
	return { ok: true, summary: `preflight ok: published ${describe(published)}, submitted ${describe(submitted)}` }
}

export interface UploadResponse {
	itemId?: string
	uploadState?: string
	crxVersion?: string
	[k: string]: unknown
}

export type UploadOutcome = { kind: "done" } | { kind: "poll" } | { kind: "fail"; reason: string }

/**
 * The docs spell the in-progress state two ways; both mean "poll `fetchStatus.lastAsyncUploadState`".
 * Every upload response must name our item, whatever its state: an async answer for another item
 * must never lead to polling — and then publishing — ours.
 */
export function interpretUpload(res: UploadResponse, itemId: string, version: string): UploadOutcome {
	if (res.itemId !== itemId) return { kind: "fail", reason: `upload answered for item ${str(res.itemId)}, expected ${itemId}` }
	switch (res.uploadState) {
		case "SUCCEEDED": {
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
export function interpretAsyncUploadState(status: ItemStatus, itemId: string): UploadOutcome {
	if (status.itemId !== itemId) return { kind: "fail", reason: `fetchStatus answered for item ${str(status.itemId)}, expected ${itemId}` }
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

/**
 * Store warnings a publish may proceed past, by their `reason`. BROAD_HOST_USAGE comes from the
 * content script matching every http(s) page, which offering the wallet on every page requires.
 * `apps/extension/src/manifest.test.ts` pins the explicit host permissions, the content-script
 * matches and the absence of optional grants, so a wider grant fails the unit tests instead of
 * hiding behind this entry. Adding a reason here is a reviewed code change, never a CI variable.
 */
export const ACCEPTED_WARNINGS: ReadonlySet<string> = new Set(["BROAD_HOST_USAGE"])

export interface StoreWarning {
	reason: string
	description: string
}

const ERROR_INFO = "type.googleapis.com/google.rpc.ErrorInfo"
const WARNINGS_INFO = "type.googleapis.com/google.chrome.webstore.v2.WarningsInfo"
/** Detail types known to carry no warning of their own. Any other type fails closed: it might. */
const INERT_DETAILS = new Set(["type.googleapis.com/google.rpc.LocalizedMessage", "type.googleapis.com/google.rpc.Help"])

type Detail = { kind: "confirmation" } | { kind: "warnings"; warnings: StoreWarning[] } | { kind: "inert" } | { kind: "unreadable" }

const record = (v: unknown): Record<string, unknown> | null =>
	typeof v === "object" && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null
/** How many warnings or details any one line lists; the rest is counted, never rendered. */
const MAX_LISTED = 10
const asList = (v: unknown): unknown[] => {
	if (v === undefined) return []
	return Array.isArray(v) ? v : [v]
}

/** A `warnings` list as `WarningsInfo` carries it: null unless every entry names a reason. */
export function readWarnings(value: unknown): StoreWarning[] | null {
	if (!Array.isArray(value)) return null
	const warnings: StoreWarning[] = []
	for (const entry of value) {
		const w = record(entry)
		if (!w || typeof w.reason !== "string" || w.reason === "") return null
		warnings.push({ reason: w.reason, description: typeof w.description === "string" ? w.description : "" })
	}
	return warnings
}

export interface PublishResponse {
	state?: string
	warningInfo?: { warnings?: unknown[] }
	error?: { code?: number; message?: string; status?: string; details?: unknown[] }
	[k: string]: unknown
}

/**
 * Warnings arrive in two envelopes: `warningInfo.warnings` on a 200, `error.details` on the 4xx
 * that `blockOnWarnings` produces. A readable warning is rendered as `reason: description` so
 * every reason survives the truncation; anything else is its JSON, truncated.
 */
export function collectWarnings(res: PublishResponse): string[] {
	const found = [...asList(record(res.warningInfo)?.warnings), ...asList(res.error?.details)]
	return found.slice(0, MAX_LISTED).flatMap(describeEntry).slice(0, MAX_LISTED).map((w) => truncate(w, 200))
}

/** A `WarningsInfo` detail or a bare `Warning` (the 200 envelope's shape) reads as its reasons; anything else is opaque. */
function describeEntry(entry: unknown): string[] {
	const d = record(entry)
	const list = d?.["@type"] === WARNINGS_INFO ? d.warnings : [entry]
	const warnings = d && (d["@type"] === WARNINGS_INFO || !("@type" in d)) ? readWarnings(list) : null
	if (!warnings) return [typeof entry === "string" ? entry : JSON.stringify(entry)]
	return warnings.map((w) => (w.description ? `${w.reason}: ${w.description}` : w.reason))
}

export function interpretPublish(res: PublishResponse, httpStatus: number): Verdict {
	const warnings = collectWarnings(res)
	if (httpStatus >= 400) {
		return { ok: false, reason: `publish refused (HTTP ${httpStatus}): ${apiError(res)}${warnings.length ? `; warnings: ${warnings.join(" | ")}` : ""}` }
	}
	// A success that still lists warnings is a success — the store did what it was asked — but the warnings are shown.
	const noted = warnings.length ? `; warnings: ${warnings.join(" | ")}` : ""
	switch (res.state) {
		case "PENDING_REVIEW":
			return { ok: true, summary: `submitted: the revision is in review${noted}` }
		case "STAGED":
			return { ok: true, summary: `approved and staged: publish it from the dashboard within 30 days${noted}` }
		case "PUBLISHED":
		case "PUBLISHED_TO_TESTERS":
			return { ok: true, summary: `live (${res.state})${noted}` }
		case "REJECTED":
			return { ok: false, reason: `publish rejected${warnings.length ? `: ${warnings.join(" | ")}` : ""}` }
		default:
			return { ok: false, reason: `publish returned state ${str(res.state)}${noted}` }
	}
}

function classifyDetail(detail: unknown, itemId: string): Detail {
	const d = record(detail)
	const type = d?.["@type"]
	if (typeof type !== "string" || !d) return { kind: "unreadable" }
	if (INERT_DETAILS.has(type)) return { kind: "inert" }
	if (type === WARNINGS_INFO) {
		const warnings = readWarnings(d.warnings)
		return warnings ? { kind: "warnings", warnings } : { kind: "unreadable" }
	}
	if (type !== ERROR_INFO) return { kind: "unreadable" }
	const ours = d.reason === "MANUAL_CONFIRMATION_REQUIRED" && d.domain === "chromewebstore.googleapis.com" && record(d.metadata)?.itemId === itemId
	return ours ? { kind: "confirmation" } : { kind: "unreadable" }
}

/**
 * The warnings a refused publish may proceed past, or null: never retry. Non-null only for the
 * exact shape `blockOnWarnings: true` produces — HTTP 400 FAILED_PRECONDITION, no success fields,
 * one ErrorInfo confirming our item, every detail readable, at least one warning and all of them
 * accepted.
 */
export function acceptedWarnings(res: PublishResponse, httpStatus: number, itemId: string): StoreWarning[] | null {
	if (httpStatus !== 400 || res.error?.status !== "FAILED_PRECONDITION" || !Array.isArray(res.error.details)) return null
	// A refusal carrying the success envelope's fields is no shape this script knows.
	if (res.state !== undefined || res.warningInfo !== undefined) return null
	const details = res.error.details.map((d) => classifyDetail(d, itemId))
	if (details.some((d) => d.kind === "unreadable") || details.filter((d) => d.kind === "confirmation").length !== 1) return null
	const warnings = details.flatMap((d) => (d.kind === "warnings" ? d.warnings : []))
	return warnings.length > 0 && warnings.every((w) => ACCEPTED_WARNINGS.has(w.reason)) ? warnings : null
}

/**
 * The verdict on the retry made without `blockOnWarnings`. The store then lists what it ignored
 * in `warningInfo`; the submission exists at this point, so anything outside the accepted set is
 * reported as a failure for the owner to review — the script never cancels a submission.
 */
export function interpretAcceptedPublish(res: PublishResponse, httpStatus: number): Verdict {
	const verdict = interpretPublish(res, httpStatus)
	if (!verdict.ok || res.warningInfo === undefined) return verdict
	const info = record(res.warningInfo)
	// proto3 JSON omits an empty repeated field, so a `warningInfo` without `warnings` is "none".
	const warnings = info ? readWarnings(info.warnings ?? []) : null
	const strangers = warnings?.filter((w) => !ACCEPTED_WARNINGS.has(w.reason)).map((w) => truncate(w.reason, 80)) ?? null
	if (strangers?.length === 0) return verdict
	const what = strangers ? listed(strangers) : "an unreadable warningInfo"
	return { ok: false, reason: `the store took the submission but reports ${what} outside the accepted warnings; review it in the dashboard and cancel it there if that is wrong` }
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
/** The first MAX_LISTED entries, then a count: output stays bounded whatever the store sends. */
export const listed = (items: string[]) => (items.length > MAX_LISTED ? `${items.slice(0, MAX_LISTED).join(", ")} (+${items.length - MAX_LISTED} more)` : items.join(", "))
const str = (v: unknown) => (v === undefined ? "<absent>" : JSON.stringify(v))
