/**
 * The I/O runner around publish-chrome-store.ts. Reads its inputs from the environment, opens the
 * release zip, and drives preflight → upload → (poll) → publish, or in `check` mode a single
 * `fetchStatus` that proves the credential and the item id. Every side effect is injected so each
 * branch is unit-testable with no network and no secret.
 *
 * Logging contract: never a request, a header, the token or a raw exception. Errors are reduced to
 * the API's own strings, truncated; non-JSON bodies are reported by status code alone.
 */

import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync } from "node:fs"
import {
	type ApiRequest,
	type ItemStatus,
	PUBLISH_TYPES,
	type RevisionStatus,
	type PublishResponse,
	type PublishType,
	type StoreWarning,
	type UploadResponse,
	acceptedWarnings,
	apiError,
	compareStoreVersions,
	interpretAcceptedPublish,
	interpretAsyncUploadState,
	interpretPreflight,
	interpretPublish,
	interpretUpload,
	listed,
	parseStoreVersion,
	publishRequest,
	statusRequest,
	truncate,
	uploadRequest,
} from "./publish-chrome-store"

export const REQUEST_TIMEOUT_MS = 15_000
export const UPLOAD_DEADLINE_MS = 3 * 60_000
export const POLL_INTERVAL_MS = 5_000

export interface ApiResponse {
	status: number
	/** Parsed JSON body, or null when the body is not JSON. */
	json: unknown
}

export interface ZipReader {
	/** The zip's `manifest.json`, parsed. Throws if absent or unreadable. */
	manifest(zipPath: string): unknown
	bytes(zipPath: string): Uint8Array
}

export interface RunIO {
	fetch(req: ApiRequest, timeoutMs: number): Promise<ApiResponse>
	zip: ZipReader
	log(line: string): void
	/** One Markdown line for the job summary, where an accepted store warning stays visible after the log scrolls. */
	summary(line: string): void
	now(): number
	sleep(ms: number): Promise<void>
}

export type RunResult = { exit: 0 | 1 }

/** A workflow command with its data escaped the way the runner unescapes it, so API text cannot forge a second command. */
const command = (name: string, data: string) => `::${name}::${data.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A").replace(/##\[/g, "## [")}`
/**
 * An ordinary line that may carry API text: no line break (a `::` command counts only at the
 * start of a physical line) and no `##[`, which the runner's legacy parser accepts anywhere.
 */
const plain = (s: string) => s.replace(/[\r\n]+/g, " ").replace(/##\[/g, "## [")
const say = (io: RunIO, line: string) => io.log(plain(line))

const fail = (io: RunIO, reason: string): RunResult => {
	io.log(command("error", `publish-chrome-store: ${reason}`))
	return { exit: 1 }
}

/** Nothing raw reaches the log: an unexpected throw anywhere below is reported by its class name only. */
export async function runPublishChromeStore(env: Record<string, string | undefined>, io: RunIO): Promise<RunResult> {
	try {
		return await run(env, io)
	} catch (e) {
		return fail(io, `unexpected failure (${e instanceof Error ? e.name : typeof e})`)
	}
}

async function run(env: Record<string, string | undefined>, io: RunIO): Promise<RunResult> {
	const mode = env.MODE
	if (mode !== "publish" && mode !== "check") return fail(io, `MODE must be "publish" or "check" (got ${JSON.stringify(mode ?? null)})`)
	const publisherId = env.CWS_PUBLISHER_ID ?? ""
	const itemId = env.CWS_ITEM_ID ?? ""
	if (!publisherId || !itemId) return fail(io, "CWS_PUBLISHER_ID and CWS_ITEM_ID are required")
	return mode === "check" ? runCheck(env, io, publisherId, itemId) : runPublish(env, io, publisherId, itemId)
}

/** Proves the credential: one `fetchStatus`, the item id must be ours. No eligibility rule — a pending review is a valid answer here. */
async function runCheck(env: Record<string, string | undefined>, io: RunIO, publisherId: string, itemId: string): Promise<RunResult> {
	const token = env.CWS_ACCESS_TOKEN ?? ""
	if (!token) return fail(io, "CWS_ACCESS_TOKEN is required in check mode")
	io.log(command("add-mask", token))
	const res = await call(io, statusRequest(publisherId, itemId, token))
	if (!res.ok) return fail(io, res.reason)
	const status = res.json as ItemStatus
	if (status.itemId !== itemId) return fail(io, `fetchStatus answered for item ${JSON.stringify(status.itemId ?? null)}, expected ${itemId}`)
	say(io, `check ok: item ${itemId} — published ${describe(status.publishedItemRevisionStatus)}; submitted ${describe(status.submittedItemRevisionStatus)}`)
	return { exit: 0 }
}

async function runPublish(env: Record<string, string | undefined>, io: RunIO, publisherId: string, itemId: string): Promise<RunResult> {
	const dryRun = env.DRY_RUN
	if (dryRun !== "true" && dryRun !== "false") return fail(io, `DRY_RUN must be "true" or "false" (got ${JSON.stringify(dryRun ?? null)})`)
	const publishType = env.CWS_PUBLISH_TYPE as PublishType
	if (!PUBLISH_TYPES.includes(publishType)) return fail(io, `CWS_PUBLISH_TYPE must be one of ${PUBLISH_TYPES.join(", ")}`)
	const version = env.VERSION ?? ""
	const zipPath = env.ZIP_PATH ?? ""
	if (!version || !zipPath) return fail(io, "VERSION and ZIP_PATH are required")

	const checked = readManifest(io, zipPath, version)
	if (!checked.ok) return fail(io, checked.reason)
	const storeVersion = checked.storeVersion
	say(io, `zip ok: ${zipPath} — manifest version ${storeVersion} (version_name ${version})`)

	if (dryRun === "true") {
		say(io, `dry run: would preflight, upload and publish (${publishType}) item ${itemId} at ${storeVersion}; no request was made`)
		return { exit: 0 }
	}

	const token = env.CWS_ACCESS_TOKEN ?? ""
	if (!token) return fail(io, "CWS_ACCESS_TOKEN is required")
	io.log(command("add-mask", token))

	const pre = await call(io, statusRequest(publisherId, itemId, token))
	if (!pre.ok) return fail(io, pre.reason)
	const verdict = interpretPreflight(pre.json as ItemStatus, itemId, storeVersion)
	if (!verdict.ok) return fail(io, verdict.reason)
	say(io, verdict.summary)

	const up = await call(io, uploadRequest(publisherId, itemId, token, io.zip.bytes(zipPath)))
	if (!up.ok) return fail(io, up.reason)
	let outcome = interpretUpload(up.json as UploadResponse, itemId, storeVersion)
	if (outcome.kind === "poll") outcome = await pollUpload(io, publisherId, itemId, token)
	if (outcome.kind === "fail") return fail(io, outcome.reason)
	say(io, `upload ok: ${storeVersion}`)
	return publish(io, publisherId, itemId, token, publishType)
}

/**
 * Publish with warnings blocking. When the store refuses on warnings that are all accepted, one
 * retry proceeds past them with `blockOnWarnings: false` — the only request that ever sends it,
 * never made twice. The decision is recorded in the job summary before the retry, so a retry
 * that fails or times out still leaves the record of what was authorized.
 */
async function publish(io: RunIO, publisherId: string, itemId: string, token: string, publishType: PublishType): Promise<RunResult> {
	const first = await call(io, publishRequest(publisherId, itemId, token, publishType), true)
	if (!first.ok) return fail(io, first.reason)
	const accepted = acceptedWarnings(first.json as PublishResponse, first.status, itemId)
	if (!accepted) {
		const result = interpretPublish(first.json as PublishResponse, first.status)
		if (!result.ok) return fail(io, result.reason)
		say(io, `publish (${publishType}) ${result.summary}`)
		return { exit: 0 }
	}
	const decision = `the store warns ${describeWarnings(accepted)}; every reason is accepted, so the publish proceeds past it with blockOnWarnings: false`
	io.log(command("warning", `publish-chrome-store: ${decision}`))
	io.summary(plain(`Chrome Web Store: ${decision}.`))
	const retry = await call(io, publishRequest(publisherId, itemId, token, publishType, false), true)
	const result = retry.ok ? interpretAcceptedPublish(retry.json as PublishResponse, retry.status) : { ok: false as const, reason: retry.reason }
	if (!result.ok) {
		io.summary(plain(`Chrome Web Store: the publish past accepted warnings failed — ${result.reason}.`))
		return fail(io, result.reason)
	}
	say(io, `publish (${publishType}) ${result.summary}`)
	io.summary(plain(`Chrome Web Store: ${result.summary}.`))
	return { exit: 0 }
}

const describeWarnings = (warnings: StoreWarning[]) => listed(warnings.map((w) => `${w.reason} ("${truncate(w.description, 120)}")`))

async function pollUpload(io: RunIO, publisherId: string, itemId: string, token: string) {
	const deadline = io.now() + UPLOAD_DEADLINE_MS
	while (io.now() < deadline) {
		await io.sleep(POLL_INTERVAL_MS)
		const res = await call(io, statusRequest(publisherId, itemId, token))
		if (!res.ok) return { kind: "fail" as const, reason: res.reason }
		const outcome = interpretAsyncUploadState(res.json as ItemStatus, itemId)
		if (outcome.kind !== "poll") return outcome
	}
	return { kind: "fail" as const, reason: `upload still in progress after ${UPLOAD_DEADLINE_MS / 1000}s; not publishing` }
}

type CallResult = { ok: true; status: number; json: unknown } | { ok: false; reason: string }

/** One request under the per-request timeout. A 4xx is a failure unless `keep4xx` (the publish call reads its warning envelope). */
async function call(io: RunIO, req: ApiRequest, keep4xx = false): Promise<CallResult> {
	const what = req.url.slice(req.url.lastIndexOf(":") + 1)
	let res: ApiResponse
	try {
		res = await io.fetch(req, REQUEST_TIMEOUT_MS)
	} catch (e) {
		const name = e instanceof Error ? e.name : "Error"
		return { ok: false, reason: `${what}: request failed (${name === "TimeoutError" || name === "AbortError" ? `timed out after ${REQUEST_TIMEOUT_MS / 1000}s` : name})` }
	}
	if (res.json === null || typeof res.json !== "object") return { ok: false, reason: `${what}: HTTP ${res.status} with a non-JSON body` }
	if (res.status >= 400 && !(keep4xx && res.status < 500)) return { ok: false, reason: `${what}: HTTP ${res.status} — ${apiError(res.json)}` }
	return { ok: true, status: res.status, json: res.json }
}

function readManifest(io: RunIO, zipPath: string, version: string): { ok: true; storeVersion: string } | { ok: false; reason: string } {
	let manifest: Record<string, unknown>
	try {
		const parsed = io.zip.manifest(zipPath)
		if (typeof parsed !== "object" || parsed === null) return { ok: false, reason: "manifest.json in the zip is not an object" }
		manifest = parsed as Record<string, unknown>
	} catch {
		return { ok: false, reason: `cannot read manifest.json from ${zipPath}` }
	}
	if ("browser_specific_settings" in manifest) return { ok: false, reason: "the zip carries browser_specific_settings: that is the Firefox build, not the Chrome one" }
	if (manifest.version_name !== version) return { ok: false, reason: `manifest version_name ${JSON.stringify(manifest.version_name ?? null)} is not VERSION ${version}` }
	const storeVersion = typeof manifest.version === "string" ? manifest.version : ""
	const tuple = parseStoreVersion(storeVersion)
	if (!tuple || storeVersion.split(".").length !== 4) return { ok: false, reason: `manifest version ${JSON.stringify(storeVersion)} is not four integers` }
	const fromName = parseStoreVersion(version.split("-")[0])
	if (!fromName || compareStoreVersions(fromName, tuple) !== 0) return { ok: false, reason: `manifest version ${storeVersion} does not derive from VERSION ${version}` }
	return { ok: true, storeVersion }
}

const describe = (r: unknown) => {
	if (r === undefined) return "none"
	if (typeof r !== "object" || r === null) return `<malformed ${JSON.stringify(r)}>`
	const { state, distributionChannels } = r as RevisionStatus
	const channels = Array.isArray(distributionChannels) ? distributionChannels : []
	const versions = channels.map((c) => (typeof c === "object" && c !== null && typeof c.crxVersion === "string" ? c.crxVersion : "?"))
	return `${typeof state === "string" ? state : "<no state>"} (${versions.join(", ") || "no channels"})`
}

/** Bun.Archive reads tar only, so the zip is read through `unzip`, present on GitHub's Ubuntu images. */
export const unzipReader: ZipReader = {
	manifest(zipPath) {
		if (!existsSync(zipPath)) throw new Error("zip missing")
		return JSON.parse(execFileSync("unzip", ["-p", zipPath, "manifest.json"], { encoding: "utf8", maxBuffer: 1 << 20 }))
	},
	bytes(zipPath) {
		return new Uint8Array(execFileSync("cat", [zipPath], { maxBuffer: 256 << 20 }))
	},
}

export async function realFetch(req: ApiRequest, timeoutMs: number): Promise<ApiResponse> {
	const res = await fetch(req.url, { method: req.method, headers: req.headers, body: req.body, signal: AbortSignal.timeout(timeoutMs) })
	const text = await res.text()
	let json: unknown = null
	try {
		json = JSON.parse(text)
	} catch {
		json = null
	}
	return { status: res.status, json }
}

if (import.meta.main) {
	const summaryPath = process.env.GITHUB_STEP_SUMMARY
	const io: RunIO = {
		fetch: realFetch,
		zip: unzipReader,
		log: (line) => console.log(line),
		summary: (line) => (summaryPath ? appendFileSync(summaryPath, `${line}\n`) : console.log(line)),
		now: () => Date.now(),
		sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
	}
	const { exit } = await runPublishChromeStore(process.env, io)
	process.exit(exit)
}
