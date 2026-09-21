import { describe, expect, test } from "bun:test"
import type { ApiRequest } from "./publish-chrome-store"
import { type ApiResponse, POLL_INTERVAL_MS, REQUEST_TIMEOUT_MS, type RunIO, UPLOAD_DEADLINE_MS, runPublishChromeStore } from "./publish-chrome-store-run"

const ITEM = "abcdefghijklmnopabcdefghijklmnop"
const TOKEN = "TOKEN-A1B2"
const CHROME_MANIFEST = { version: "0.27.0.0", version_name: "0.27.0", name: "Nulo V5" }

type Step = ApiResponse | Error | ((req: ApiRequest) => ApiResponse)

/** A scripted API: each call consumes the next step; running out throws (which the runner reports without the token). */
function harness(steps: Step[], manifest: unknown = CHROME_MANIFEST) {
	const calls: ApiRequest[] = []
	const lines: string[] = []
	let clock = 0
	const io: RunIO = {
		async fetch(req) {
			calls.push(req)
			const step = steps.shift()
			if (step === undefined) throw new Error(`unexpected call ${req.url}`)
			if (step instanceof Error) throw step
			return typeof step === "function" ? step(req) : step
		},
		zip: { manifest: () => manifest, bytes: () => new Uint8Array([0x50, 0x4b]) },
		log: (l) => lines.push(l),
		now: () => clock,
		sleep: async (ms) => {
			clock += ms
		},
	}
	return { io, calls, lines, output: () => lines.join("\n") }
}

const ok = (json: unknown, status = 200): ApiResponse => ({ status, json })
const status = (over: Record<string, unknown> = {}) => ok({ itemId: ITEM, ...over })
const env = (over: Record<string, string | undefined> = {}) => ({
	MODE: "publish",
	DRY_RUN: "false",
	CWS_ACCESS_TOKEN: TOKEN,
	CWS_PUBLISHER_ID: "pub",
	CWS_ITEM_ID: ITEM,
	CWS_PUBLISH_TYPE: "STAGED_PUBLISH",
	VERSION: "0.27.0",
	ZIP_PATH: "dist/release/nulo-chrome-0.27.0.zip",
	...over,
})
const kind = (req: ApiRequest) => req.url.slice(req.url.lastIndexOf(":") + 1)

describe("inputs", () => {
	test("an unset or unknown MODE exits 1", async () => {
		for (const MODE of [undefined, "", "deploy"]) {
			const h = harness([])
			expect((await runPublishChromeStore(env({ MODE }), h.io)).exit).toBe(1)
			expect(h.calls).toHaveLength(0)
		}
	})

	test("DRY_RUN=maybe and an unknown CWS_PUBLISH_TYPE exit 1 before any request", async () => {
		for (const over of [{ DRY_RUN: "maybe" }, { CWS_PUBLISH_TYPE: "INSTANT" }]) {
			const h = harness([])
			expect((await runPublishChromeStore(env(over), h.io)).exit).toBe(1)
			expect(h.calls).toHaveLength(0)
		}
	})

	test("a Firefox zip is refused", async () => {
		const h = harness([], { ...CHROME_MANIFEST, browser_specific_settings: { gecko: { id: "wallet@nulo.sh" } } })
		expect((await runPublishChromeStore(env(), h.io)).exit).toBe(1)
		expect(h.output()).toContain("Firefox build")
		expect(h.calls).toHaveLength(0)
	})

	test("version_name must equal VERSION and version must be four integers derived from it", async () => {
		for (const manifest of [{ ...CHROME_MANIFEST, version_name: "0.26.0" }, { ...CHROME_MANIFEST, version: "0.27.0" }, { ...CHROME_MANIFEST, version: "0.28.0.0" }]) {
			const h = harness([], manifest)
			expect((await runPublishChromeStore(env(), h.io)).exit).toBe(1)
		}
	})
})

describe("dry run", () => {
	test("makes zero requests and needs no token", async () => {
		const h = harness([new Error("must not be called")])
		const r = await runPublishChromeStore(env({ DRY_RUN: "true", CWS_ACCESS_TOKEN: undefined }), h.io)
		expect(r.exit).toBe(0)
		expect(h.calls).toHaveLength(0)
		expect(h.output()).toContain("no request was made")
	})
})

describe("check mode", () => {
	test("needs no zip, makes exactly one GET, applies no eligibility rule", async () => {
		const h = harness([status({ submittedItemRevisionStatus: { state: "PENDING_REVIEW", distributionChannels: [{ crxVersion: "0.27.0.0" }] } })], undefined)
		const r = await runPublishChromeStore(env({ MODE: "check", ZIP_PATH: undefined, VERSION: undefined }), h.io)
		expect(r.exit).toBe(0)
		expect(h.calls.map(kind)).toEqual(["fetchStatus"])
		expect(h.calls[0].method).toBe("GET")
		expect(h.output()).toContain("PENDING_REVIEW")
		expect(h.output()).toContain(`::add-mask::${TOKEN}`)
	})

	test("fails on a foreign itemId", async () => {
		const h = harness([status({ itemId: "someone-else" })], undefined)
		expect((await runPublishChromeStore(env({ MODE: "check" }), h.io)).exit).toBe(1)
	})
})

describe("publish flow", () => {
	const succeeded = ok({ itemId: ITEM, uploadState: "SUCCEEDED", crxVersion: "0.27.0.0" })

	test("SUCCEEDED publishes without polling, even with no lastAsyncUploadState anywhere", async () => {
		const h = harness([status(), succeeded, ok({ state: "PENDING_REVIEW" })])
		const r = await runPublishChromeStore(env(), h.io)
		expect(r.exit).toBe(0)
		expect(h.calls.map(kind)).toEqual(["fetchStatus", "upload", "publish"])
		expect(h.calls[1].headers["Content-Type"]).toBe("application/zip")
		expect(JSON.parse(h.calls[2].body as string)).toEqual({ publishType: "STAGED_PUBLISH", blockOnWarnings: true })
		expect(h.output()).toContain("in review")
	})

	test("IN_PROGRESS and UPLOAD_IN_PROGRESS poll fetchStatus until SUCCEEDED", async () => {
		for (const spelling of ["IN_PROGRESS", "UPLOAD_IN_PROGRESS"]) {
			const h = harness([
				status(),
				ok({ itemId: ITEM, uploadState: spelling }),
				status({ lastAsyncUploadState: "IN_PROGRESS" }),
				status({ lastAsyncUploadState: "SUCCEEDED" }),
				ok({ state: "STAGED" }),
			])
			expect((await runPublishChromeStore(env(), h.io)).exit).toBe(0)
			expect(h.calls.map(kind)).toEqual(["fetchStatus", "upload", "fetchStatus", "fetchStatus", "publish"])
			expect(h.output()).toContain("30 days")
		}
	})

	test("an exhausted deadline never reaches publish", async () => {
		const polls = Math.ceil(UPLOAD_DEADLINE_MS / POLL_INTERVAL_MS) + 2
		const h = harness([status(), ok({ itemId: ITEM, uploadState: "IN_PROGRESS" }), ...Array.from({ length: polls }, () => status({ lastAsyncUploadState: "IN_PROGRESS" }))])
		expect((await runPublishChromeStore(env(), h.io)).exit).toBe(1)
		expect(h.calls.map(kind)).not.toContain("publish")
		expect(h.output()).toContain("still in progress")
	})

	test("a crxVersion mismatch, FAILED, NOT_FOUND and unspecified stop before publish", async () => {
		const bad = [
			ok({ itemId: ITEM, uploadState: "SUCCEEDED", crxVersion: "0.26.0.0" }),
			ok({ itemId: ITEM, uploadState: "FAILED" }),
			ok({ itemId: ITEM, uploadState: "NOT_FOUND" }),
			ok({ itemId: ITEM, uploadState: "UPLOAD_STATE_UNSPECIFIED" }),
		]
		for (const response of bad) {
			const h = harness([status(), response])
			expect((await runPublishChromeStore(env(), h.io)).exit).toBe(1)
			expect(h.calls.map(kind)).toEqual(["fetchStatus", "upload"])
		}
	})

	test("an async upload answered for another item is never polled to a publish", async () => {
		const h = harness([
			status(),
			ok({ itemId: "different", uploadState: "IN_PROGRESS" }),
			status({ itemId: "different", lastAsyncUploadState: "SUCCEEDED" }),
			ok({ state: "PUBLISHED" }),
		])
		expect((await runPublishChromeStore(env(), h.io)).exit).toBe(1)
		expect(h.calls.map(kind)).toEqual(["fetchStatus", "upload"])
	})

	test("a malformed 200 body and a throwing zip reader are reported by class, never raw", async () => {
		const malformed = harness([status({ publishedItemRevisionStatus: null })])
		expect((await runPublishChromeStore(env(), malformed.io)).exit).toBe(1)
		expect(malformed.calls.map(kind)).toEqual(["fetchStatus"])
		expect(malformed.output()).toContain("unknown state")

		const boom = harness([status()])
		boom.io.zip.bytes = () => {
			throw new Error(`disk says ${TOKEN}`)
		}
		expect((await runPublishChromeStore(env(), boom.io)).exit).toBe(1)
		expect(boom.output()).toContain("unexpected failure (Error)")
		expect(boom.output()).not.toContain("disk says")
	})

	test("preflight refusals make no upload", async () => {
		const h = harness([status({ takenDown: true })])
		expect((await runPublishChromeStore(env(), h.io)).exit).toBe(1)
		expect(h.calls.map(kind)).toEqual(["fetchStatus"])
	})

	test("PUBLISHED and REJECTED are reported distinctly; warnings from both envelopes reach the output", async () => {
		const live = harness([status(), succeeded, ok({ state: "PUBLISHED", warningInfo: { warnings: ["minor icon warning"] } })])
		expect((await runPublishChromeStore(env(), live.io)).exit).toBe(0)
		expect(live.output()).toContain("live")

		const rejected = harness([status(), succeeded, ok({ state: "REJECTED", warningInfo: { warnings: ["bad manifest"] } })])
		expect((await runPublishChromeStore(env(), rejected.io)).exit).toBe(1)
		expect(rejected.output()).toContain("bad manifest")

		const blocked = harness([status(), succeeded, ok({ error: { code: 400, message: "warnings block publish", details: [{ reason: "LARGE_ICON" }] } }, 400)])
		expect((await runPublishChromeStore(env(), blocked.io)).exit).toBe(1)
		expect(blocked.output()).toContain("LARGE_ICON")
	})

	test("a non-JSON 502 is reported by status code only", async () => {
		const h = harness([{ status: 502, json: null }])
		expect((await runPublishChromeStore(env(), h.io)).exit).toBe(1)
		expect(h.output()).toContain("HTTP 502 with a non-JSON body")
	})

	test("a per-request timeout is reported as such", async () => {
		const timeout = new Error("The operation timed out")
		timeout.name = "TimeoutError"
		const h = harness([timeout])
		expect((await runPublishChromeStore(env(), h.io)).exit).toBe(1)
		expect(h.output()).toContain(`timed out after ${REQUEST_TIMEOUT_MS / 1000}s`)
	})
})

describe("logging contract", () => {
	test("the token never appears in the output on any error path, except the mask directive", async () => {
		const paths: Step[][] = [
			[status({ itemId: "other" })],
			[status({ takenDown: true })],
			[{ status: 403, json: { error: { message: `denied for ${TOKEN}` } } }],
			[{ status: 502, json: null }],
			[new Error(`socket hang up ${TOKEN}`)],
			[status(), ok({ itemId: ITEM, uploadState: "FAILED" })],
			[status(), ok({ itemId: ITEM, uploadState: "SUCCEEDED", crxVersion: "0.27.0.0" }), ok({ state: "REJECTED" })],
		]
		for (const steps of paths) {
			const h = harness(steps)
			expect((await runPublishChromeStore(env(), h.io)).exit).toBe(1)
			const leaked = h.lines.filter((l) => l.includes(TOKEN) && !l.startsWith("::add-mask::"))
			// The 403 body deliberately echoes the token: the API's message is passed through, so the mask
			// directive is what keeps it out of the log — it must precede every request-derived line.
			const maskAt = h.lines.findIndex((l) => l === `::add-mask::${TOKEN}`)
			expect(maskAt).toBeGreaterThanOrEqual(0)
			for (const line of leaked) expect(h.lines.indexOf(line)).toBeGreaterThan(maskAt)
			expect(h.lines.filter((l) => l.startsWith("::add-mask::"))).toHaveLength(1)
		}
	})
})
