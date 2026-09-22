/**
 * The I/O runner around publish-firefox-amo.ts. Reads its inputs from the environment, checks the
 * zip, the source archive and the reviewer notes, then drives upload → poll → version → source, or
 * in `check` mode one author-scoped list that proves the key pair. Every side effect is injected so
 * each branch is unit-testable with no network and no secret.
 *
 * Logging contract: never a request, a header, the secret, a JWT or a raw exception. Errors are
 * reduced to the API's own strings, truncated; non-JSON bodies are reported by status code alone.
 */

import { execFileSync } from "node:child_process"
import { randomUUID } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import {
	type ApiRequest,
	apiError,
	checkFirefoxManifest,
	checkSourceArchive,
	GECKO_ID,
	interpretOwnAddons,
	interpretSource,
	interpretUploadCreate,
	interpretUploadStatus,
	interpretVersion,
	jwt,
	ownAddonsRequest,
	RECOVERY,
	reviewerNotes,
	sourceRequest,
	uploadRequest,
	uploadStatusRequest,
	versionRequest,
} from "./publish-firefox-amo"

export const REQUEST_TIMEOUT_MS = 15_000
/** The upload of a 41 MB zip and its server-side validation are one request each; both get the long timeout. */
export const UPLOAD_TIMEOUT_MS = 120_000
export const VALIDATION_DEADLINE_MS = 5 * 60_000
export const POLL_INTERVAL_MS = 5_000

export interface ApiResponse {
	status: number
	/** Parsed JSON body, or null when the body is not JSON. */
	json: unknown
}

export interface Files {
	exists(path: string): boolean
	size(path: string): number
	bytes(path: string): Uint8Array
	text(path: string): string
	/** Entry names of a zip, as `unzip -Z1` prints them. Throws if unreadable. */
	zipEntries(path: string): string[]
	/** The zip's `manifest.json`, parsed. Throws if absent or unreadable. */
	zipManifest(path: string): unknown
}

export interface RunIO {
	fetch(req: ApiRequest, authorization: string, timeoutMs: number): Promise<ApiResponse>
	files: Files
	log(line: string): void
	/** Milliseconds. */
	now(): number
	sleep(ms: number): Promise<void>
	jti(): string
}

export type RunResult = { exit: 0 | 1 }

const fail = (io: RunIO, reason: string): RunResult => {
	io.log(`::error::publish-firefox-amo: ${reason}`)
	return { exit: 1 }
}

/** Nothing raw reaches the log: an unexpected throw anywhere below is reported by its class name only. */
export async function runPublishFirefoxAmo(env: Record<string, string | undefined>, io: RunIO): Promise<RunResult> {
	try {
		return await run(env, io)
	} catch (e) {
		return fail(io, `unexpected failure (${e instanceof Error ? e.name : typeof e})`)
	}
}

async function run(env: Record<string, string | undefined>, io: RunIO): Promise<RunResult> {
	const mode = env.MODE
	if (mode !== "publish" && mode !== "check") return fail(io, `MODE must be "publish" or "check" (got ${JSON.stringify(mode ?? null)})`)
	return mode === "check" ? runCheck(env, io) : runPublish(env, io)
}

interface Auth {
	issuer: string
	secret: string
}

/** The secret is masked once; every JWT minted from it is masked before it is used. */
function readAuth(env: Record<string, string | undefined>, io: RunIO): Auth | null {
	const issuer = env.AMO_JWT_ISSUER ?? ""
	const secret = env.AMO_JWT_SECRET ?? ""
	if (!issuer || !secret) return null
	io.log(`::add-mask::${secret}`)
	return { issuer, secret }
}

/** Proves the key pair: the author-scoped list must contain our add-on. Any state is a valid answer here. */
async function runCheck(env: Record<string, string | undefined>, io: RunIO): Promise<RunResult> {
	const auth = readAuth(env, io)
	if (!auth) return fail(io, "AMO_JWT_ISSUER and AMO_JWT_SECRET are required")
	const res = await call(io, auth, ownAddonsRequest(), "list add-ons", REQUEST_TIMEOUT_MS)
	if (!res.ok) return fail(io, res.reason)
	const mine = interpretOwnAddons(res.json, GECKO_ID)
	if (!mine.ok) return fail(io, mine.reason)
	io.log(`check ok: ${GECKO_ID} is authored by this key pair — status ${mine.value}`)
	return { exit: 0 }
}

interface Inputs {
	version: string
	storeVersion: string
	zipPath: string
	sourcePath: string
	notes: string
}

async function runPublish(env: Record<string, string | undefined>, io: RunIO): Promise<RunResult> {
	const dryRun = env.DRY_RUN
	if (dryRun !== "true" && dryRun !== "false") return fail(io, `DRY_RUN must be "true" or "false" (got ${JSON.stringify(dryRun ?? null)})`)
	const inputs = readInputs(env, io)
	if (!inputs.ok) return fail(io, inputs.reason)
	const { version, storeVersion, zipPath, sourcePath, notes } = inputs.value
	io.log(`zip ok: ${zipPath} — manifest version ${storeVersion} (version_name ${version}), gecko id ${GECKO_ID}, settled data declaration`)
	io.log(`source ok: ${sourcePath}; reviewer notes: ${notes.length} chars`)

	if (dryRun === "true") {
		io.log(`dry run: would upload, validate, create version ${storeVersion} on the listed channel and attach the source; no request was made`)
		return { exit: 0 }
	}

	const auth = readAuth(env, io)
	if (!auth) return fail(io, "AMO_JWT_ISSUER and AMO_JWT_SECRET are required")

	const uploaded = await upload(io, auth, io.files.bytes(zipPath), `nulo-firefox-${version}.zip`)
	if (!uploaded.ok) return fail(io, uploaded.reason)
	io.log(`upload ok: ${uploaded.value} validated`)

	const created = await createVersion(io, auth, uploaded.value, notes, storeVersion)
	if (!created.ok) return fail(io, `${created.reason}; ${RECOVERY}`)
	io.log(`version ok: id ${created.value.id}, ${storeVersion} on ${created.value.channel}; file ${created.value.fileStatus}`)

	const attached = await attachSource(io, auth, created.value.id, io.files.bytes(sourcePath), `nulo-${version}-source.zip`)
	if (!attached.ok) return fail(io, `version ${created.value.id} exists but ${attached.reason}; ${RECOVERY}`)

	io.log(`published: version ${created.value.id} (${storeVersion}, ${created.value.channel}, file ${created.value.fileStatus}); source attached; follow it in the Developer Hub`)
	return { exit: 0 }
}

type Checked<T> = { ok: true; value: T } | { ok: false; reason: string }

/** Everything the job needs is checked before any request, so a dry run proves the inputs alone. */
function readInputs(env: Record<string, string | undefined>, io: RunIO): Checked<Inputs> {
	const version = env.VERSION ?? ""
	const zipPath = env.ZIP_PATH ?? ""
	const sourcePath = env.SOURCE_PATH ?? ""
	const listingPath = env.LISTING_PATH ?? ""
	if (!version || !zipPath || !sourcePath || !listingPath) return { ok: false, reason: "VERSION, ZIP_PATH, SOURCE_PATH and LISTING_PATH are required" }

	let manifest: unknown
	try {
		manifest = io.files.zipManifest(zipPath)
	} catch {
		return { ok: false, reason: `cannot read manifest.json from ${zipPath}` }
	}
	const facts = checkFirefoxManifest(manifest, version)
	if (!facts.ok) return facts

	if (!io.files.exists(sourcePath)) return { ok: false, reason: `source archive ${sourcePath} does not exist` }
	let entries: string[]
	try {
		entries = io.files.zipEntries(sourcePath)
	} catch {
		return { ok: false, reason: `cannot list ${sourcePath}` }
	}
	const source = checkSourceArchive(entries, io.files.size(sourcePath), version)
	if (!source.ok) return source

	if (!io.files.exists(listingPath)) return { ok: false, reason: `listing ${listingPath} does not exist` }
	const notes = reviewerNotes(io.files.text(listingPath))
	if (!notes.ok) return notes

	return { ok: true, value: { version, storeVersion: facts.value.storeVersion, zipPath, sourcePath, notes: notes.value } }
}

/** Upload, then poll until AMO has validated; the uuid is only usable once `valid`. */
async function upload(io: RunIO, auth: Auth, zip: Uint8Array, filename: string): Promise<Checked<string>> {
	const up = await call(io, auth, uploadRequest(zip, filename), "upload", UPLOAD_TIMEOUT_MS)
	if (!up.ok) return up
	const uuid = interpretUploadCreate(up.json)
	if (!uuid.ok) return uuid
	const deadline = io.now() + VALIDATION_DEADLINE_MS
	while (io.now() < deadline) {
		await io.sleep(POLL_INTERVAL_MS)
		const res = await call(io, auth, uploadStatusRequest(uuid.value), "upload status", REQUEST_TIMEOUT_MS)
		if (!res.ok) return res
		const status = interpretUploadStatus(res.json)
		if (!status.ok) return status
		if (status.value.kind === "valid") return uuid
		if (status.value.kind === "invalid") {
			for (const e of status.value.errors) io.log(`validation error: ${e}`)
			return { ok: false, reason: `AMO validation failed with ${status.value.errors.length} error(s); no version was created` }
		}
	}
	return { ok: false, reason: `upload not validated after ${VALIDATION_DEADLINE_MS / 1000}s; no version was created` }
}

/** From the moment this request is sent, a failure may have left a version behind: the caller appends the recovery. */
async function createVersion(io: RunIO, auth: Auth, uuid: string, notes: string, storeVersion: string) {
	const res = await call(io, auth, versionRequest(GECKO_ID, uuid, notes), "create version", UPLOAD_TIMEOUT_MS)
	if (!res.ok) return res
	return interpretVersion(res.json, storeVersion)
}

async function attachSource(io: RunIO, auth: Auth, versionId: number | string, archive: Uint8Array, filename: string) {
	const res = await call(io, auth, sourceRequest(GECKO_ID, versionId, archive, filename), "attach source", UPLOAD_TIMEOUT_MS)
	if (!res.ok) return res
	return interpretSource(res.json)
}

type CallResult = { ok: true; status: number; json: unknown } | { ok: false; reason: string }

/** One request under its timeout with a fresh, masked JWT. A 4xx/5xx is a failure carrying only the API's strings. */
async function call(io: RunIO, auth: Auth, req: ApiRequest, what: string, timeoutMs: number): Promise<CallResult> {
	const token = jwt(auth.issuer, auth.secret, Math.floor(io.now() / 1000), io.jti())
	io.log(`::add-mask::${token}`)
	let res: ApiResponse
	try {
		res = await io.fetch(req, `JWT ${token}`, timeoutMs)
	} catch (e) {
		const name = e instanceof Error ? e.name : "Error"
		return { ok: false, reason: `${what}: request failed (${name === "TimeoutError" || name === "AbortError" ? `timed out after ${timeoutMs / 1000}s` : name})` }
	}
	if (res.json === null || typeof res.json !== "object") return { ok: false, reason: `${what}: HTTP ${res.status} with a non-JSON body` }
	if (res.status >= 400) return { ok: false, reason: `${what}: HTTP ${res.status} — ${apiError(res.json)}` }
	return { ok: true, status: res.status, json: res.json }
}

/** Bun.Archive reads tar only, so zips are read through `unzip`, present on GitHub's Ubuntu images. */
export const diskFiles: Files = {
	exists: (p) => existsSync(p),
	size: (p) => statSync(p).size,
	bytes: (p) => new Uint8Array(readFileSync(p)),
	text: (p) => readFileSync(p, "utf8"),
	zipEntries: (p) =>
		execFileSync("unzip", ["-Z1", p], { encoding: "utf8", maxBuffer: 64 << 20 })
			.split("\n")
			.filter(Boolean),
	zipManifest(p) {
		if (!existsSync(p)) throw new Error("zip missing")
		return JSON.parse(execFileSync("unzip", ["-p", p, "manifest.json"], { encoding: "utf8", maxBuffer: 1 << 20 }))
	},
}

export async function realFetch(req: ApiRequest, authorization: string, timeoutMs: number): Promise<ApiResponse> {
	const headers: Record<string, string> = { Authorization: authorization, Accept: "application/json" }
	let body: BodyInit | undefined
	if (req.kind === "json") {
		if (req.body !== undefined) {
			headers["Content-Type"] = "application/json"
			body = JSON.stringify(req.body)
		}
	} else {
		const form = new FormData()
		for (const [k, v] of Object.entries(req.fields)) form.append(k, v)
		for (const [k, f] of Object.entries(req.files)) form.append(k, new Blob([f.bytes], { type: f.type }), f.filename)
		body = form
	}
	const res = await fetch(req.url, { method: req.method, headers, body, signal: AbortSignal.timeout(timeoutMs) })
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
	const io: RunIO = {
		fetch: realFetch,
		files: diskFiles,
		log: (line) => console.log(line),
		now: () => Date.now(),
		sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
		jti: () => randomUUID(),
	}
	const { exit } = await runPublishFirefoxAmo(process.env, io)
	process.exit(exit)
}
