import { describe, expect, test } from "bun:test"
import { type ApiRequest, GECKO_ID, NOTES_END, NOTES_START, RECOVERY, requiredSourcePaths } from "./publish-firefox-amo"
import { type ApiResponse, type Files, POLL_INTERVAL_MS, type RunIO, runPublishFirefoxAmo, VALIDATION_DEADLINE_MS } from "./publish-firefox-amo-run"

const SECRET = "SECRET-A1B2"
const FIREFOX_MANIFEST = {
	version: "0.27.0.0",
	version_name: "0.27.0",
	browser_specific_settings: { gecko: { id: GECKO_ID, data_collection_permissions: { required: ["financialAndPaymentInfo"] } } },
}
const LISTING = `# Listing\n${NOTES_START}\nTesting information for the reviewer.\n${NOTES_END}\n`

type Step = ApiResponse | Error | ((req: ApiRequest) => ApiResponse)

interface Fixture {
	manifest?: unknown
	sourceEntries?: string[]
	sourceSize?: number
	listing?: string
	missing?: string[]
}

/** A scripted API plus an in-memory file system; running out of steps throws (reported without the secret). */
function harness(steps: Step[], fx: Fixture = {}) {
	const calls: { req: ApiRequest; authorization: string; timeoutMs: number }[] = []
	const lines: string[] = []
	let clock = 1_700_000_000_000
	let n = 0
	const missing = new Set(fx.missing ?? [])
	const files: Files = {
		exists: (p) => !missing.has(p),
		size: () => fx.sourceSize ?? 30e6,
		bytes: () => new Uint8Array([0x50, 0x4b]),
		text: () => fx.listing ?? LISTING,
		zipEntries: () => fx.sourceEntries ?? [...requiredSourcePaths("0.27.0"), "nulo-0.27.0/README.md"],
		zipManifest: (p) => {
			if (missing.has(p)) throw new Error("zip missing")
			return "manifest" in fx ? fx.manifest : FIREFOX_MANIFEST
		},
	}
	const io: RunIO = {
		async fetch(req, authorization, timeoutMs) {
			calls.push({ req, authorization, timeoutMs })
			const step = steps.shift()
			if (step === undefined) throw new Error(`unexpected call ${req.url}`)
			if (step instanceof Error) throw step
			return typeof step === "function" ? step(req) : step
		},
		files,
		log: (l) => lines.push(l),
		now: () => clock,
		sleep: async (ms) => {
			clock += ms
		},
		jti: () => `jti-${n++}`,
	}
	return { io, calls, lines, output: () => lines.join("\n"), kinds: () => calls.map((c) => kind(c.req)) }
}

const ok = (json: unknown, status = 200): ApiResponse => ({ status, json })
const env = (over: Record<string, string | undefined> = {}) => ({
	MODE: "publish",
	DRY_RUN: "false",
	AMO_JWT_ISSUER: "user:123:456",
	AMO_JWT_SECRET: SECRET,
	VERSION: "0.27.0",
	ZIP_PATH: "dist/release/nulo-firefox-0.27.0.zip",
	SOURCE_PATH: "dist/source/nulo-0.27.0-source.zip",
	LISTING_PATH: "apps/extension/store/listing.md",
	...over,
})
function kind(req: ApiRequest) {
	if (req.url.endsWith("/addons/upload/")) return "upload"
	if (req.url.includes("/addons/upload/")) return "upload-status"
	if (req.method === "PATCH") return "source"
	if (req.url.endsWith("/versions/")) return "version"
	return "list"
}
const timeout = () => Object.assign(new Error("t"), { name: "TimeoutError" })

const VALID = ok({ processed: true, valid: true })
const CREATED = ok({ id: 9001, version: "0.27.0.0", channel: "listed", file: { status: "unreviewed" } }, 201)
const SOURCED = ok({ id: 9001, source: "https://addons.mozilla.org/x/source.zip" })

/** The output must never carry the secret nor any JWT minted from it, except inside a mask directive. */
function expectNoSecretLeak(h: ReturnType<typeof harness>) {
	const unmasked = h.lines.filter((l) => !l.startsWith("::add-mask::"))
	expect(unmasked.join("\n")).not.toContain(SECRET)
	for (const c of h.calls) {
		const token = c.authorization.replace(/^JWT /, "")
		expect(h.lines).toContain(`::add-mask::${token}`)
		expect(unmasked.join("\n")).not.toContain(token)
	}
}

describe("inputs", () => {
	test("an unset or unknown MODE exits 1 with no request", async () => {
		for (const MODE of [undefined, "", "deploy"]) {
			const h = harness([])
			expect((await runPublishFirefoxAmo(env({ MODE }), h.io)).exit).toBe(1)
			expect(h.calls).toHaveLength(0)
		}
	})

	test("DRY_RUN must be true or false", async () => {
		const h = harness([])
		expect((await runPublishFirefoxAmo(env({ DRY_RUN: "maybe" }), h.io)).exit).toBe(1)
		expect(h.calls).toHaveLength(0)
	})

	test("a Chrome zip, a wrong gecko id and an unsettled declaration are refused before any request", async () => {
		const gecko = FIREFOX_MANIFEST.browser_specific_settings.gecko
		const manifests = [
			{ version: "0.27.0.0", version_name: "0.27.0" },
			{ ...FIREFOX_MANIFEST, browser_specific_settings: { gecko: { ...gecko, id: "other@nulo.sh" } } },
			{ ...FIREFOX_MANIFEST, browser_specific_settings: { gecko: { ...gecko, data_collection_permissions: { required: ["none"] } } } },
		]
		for (const manifest of manifests) {
			const h = harness([new Error("must not be called")], { manifest })
			expect((await runPublishFirefoxAmo(env(), h.io)).exit).toBe(1)
			expect(h.calls).toHaveLength(0)
		}
	})

	test("a missing, oversized or unprefixed source archive is refused before any request", async () => {
		const fixtures: Fixture[] = [
			{ missing: ["dist/source/nulo-0.27.0-source.zip"] },
			{ sourceSize: 250 * 1024 * 1024 },
			{ sourceEntries: ["apps/extension/store/SOURCE-BUILD.md", "bun.lock"] },
			{ sourceEntries: ["nulo-0.27.0/bun.lock"] },
		]
		for (const fx of fixtures) {
			const h = harness([new Error("must not be called")], fx)
			expect((await runPublishFirefoxAmo(env(), h.io)).exit).toBe(1)
			expect(h.calls).toHaveLength(0)
		}
	})

	test("a listing without a reviewer-notes block is refused before any request", async () => {
		const h = harness([new Error("must not be called")], { listing: "# Listing\nno notes" })
		expect((await runPublishFirefoxAmo(env(), h.io)).exit).toBe(1)
		expect(h.calls).toHaveLength(0)
		expect(h.output()).toContain("reviewer-notes")
	})

	test("a missing key pair fails after the inputs are checked, still with no request", async () => {
		const h = harness([new Error("must not be called")])
		expect((await runPublishFirefoxAmo(env({ AMO_JWT_SECRET: undefined }), h.io)).exit).toBe(1)
		expect(h.calls).toHaveLength(0)
		expect(h.output()).toContain("zip ok")
	})
})

describe("dry run", () => {
	test("checks every input, makes zero requests and needs no key pair", async () => {
		const h = harness([new Error("must not be called")])
		const r = await runPublishFirefoxAmo(env({ DRY_RUN: "true", AMO_JWT_ISSUER: undefined, AMO_JWT_SECRET: undefined }), h.io)
		expect(r.exit).toBe(0)
		expect(h.calls).toHaveLength(0)
		expect(h.output()).toContain("no request was made")
		expect(h.output()).toContain("0.27.0.0")
	})

	test("still refuses a bad zip", async () => {
		const h = harness([], { manifest: { version: "0.27.0.0", version_name: "0.27.0" } })
		expect((await runPublishFirefoxAmo(env({ DRY_RUN: "true" }), h.io)).exit).toBe(1)
	})
})

describe("check mode", () => {
	test("needs no zip, source or listing; exactly one GET to the author-scoped list; masks the secret and the JWT", async () => {
		const h = harness([ok({ results: [{ guid: GECKO_ID, status: "incomplete" }] })], { missing: ["dist/release/nulo-firefox-0.27.0.zip", "dist/source/nulo-0.27.0-source.zip", "apps/extension/store/listing.md"] })
		const r = await runPublishFirefoxAmo(env({ MODE: "check", ZIP_PATH: undefined, SOURCE_PATH: undefined, LISTING_PATH: undefined, VERSION: undefined }), h.io)
		expect(r.exit).toBe(0)
		expect(h.kinds()).toEqual(["list"])
		expect(h.calls[0].req.method).toBe("GET")
		expect(h.calls[0].authorization).toMatch(/^JWT eyJ/)
		expect(h.output()).toContain("incomplete")
		expect(h.lines).toContain(`::add-mask::${SECRET}`)
		expectNoSecretLeak(h)
	})

	test("fails when wallet@nulo.sh is not among the key pair's add-ons, and without a key pair", async () => {
		const h = harness([ok({ results: [{ guid: "other@x" }] })])
		expect((await runPublishFirefoxAmo(env({ MODE: "check" }), h.io)).exit).toBe(1)
		expectNoSecretLeak(h)
		const none = harness([])
		expect((await runPublishFirefoxAmo(env({ MODE: "check", AMO_JWT_ISSUER: undefined }), none.io)).exit).toBe(1)
		expect(none.calls).toHaveLength(0)
	})
})

describe("publish flow", () => {
	test("upload → poll → version → source succeeds with a fresh JWT per request", async () => {
		const h = harness([ok({ uuid: "u-1" }), ok({ processed: false }), VALID, CREATED, SOURCED])
		const r = await runPublishFirefoxAmo(env(), h.io)
		expect(r.exit).toBe(0)
		expect(h.kinds()).toEqual(["upload", "upload-status", "upload-status", "version", "source"])
		const up = h.calls[0].req
		expect(up.kind === "multipart" && up.fields.channel).toBe("listed")
		const version = h.calls[3].req
		expect(version.kind === "json" && version.body).toEqual({ upload: "u-1", approval_notes: "Testing information for the reviewer." })
		expect(h.calls[4].req.url).toContain("/versions/9001/")
		expect(new Set(h.calls.map((c) => c.authorization)).size).toBe(5)
		expect(h.output()).toContain("version 9001 (0.27.0.0, listed, file unreviewed); source attached; follow it in the Developer Hub")
		expectNoSecretLeak(h)
	})

	test("AMO responses are compared with the manifest's numeric version, not VERSION", async () => {
		const h = harness([ok({ uuid: "u-1" }), VALID, ok({ ...(CREATED.json as object), version: "0.27.0" }, 201)])
		expect((await runPublishFirefoxAmo(env(), h.io)).exit).toBe(1)
		expect(h.kinds()).not.toContain("source")
		expect(h.output()).toContain("expected 0.27.0.0")
	})

	test("valid: false prints bounded errors and never creates a version", async () => {
		const messages = [
			{ type: "error", message: "Manifest is invalid", description: "d".repeat(400) },
			{ type: "warning", message: "ignored" },
		]
		const h = harness([ok({ uuid: "u-1" }), ok({ processed: true, valid: false, validation: { messages } })])
		expect((await runPublishFirefoxAmo(env(), h.io)).exit).toBe(1)
		expect(h.kinds()).toEqual(["upload", "upload-status"])
		const errorLines = h.lines.filter((l) => l.startsWith("validation error: "))
		expect(errorLines).toHaveLength(1)
		expect(errorLines[0].length).toBeLessThanOrEqual("validation error: ".length + 200)
		expect(h.output()).toContain("no version was created")
		expectNoSecretLeak(h)
	})

	test("an upload never processed hits the deadline and creates no version", async () => {
		const polls = Math.ceil(VALIDATION_DEADLINE_MS / POLL_INTERVAL_MS) + 2
		const h = harness([ok({ uuid: "u-1" }), ...Array.from({ length: polls }, () => ok({ processed: false }))])
		expect((await runPublishFirefoxAmo(env(), h.io)).exit).toBe(1)
		expect(h.kinds()).not.toContain("version")
		expect(h.output()).toContain(`${VALIDATION_DEADLINE_MS / 1000}s`)
		expect(h.output()).not.toContain(RECOVERY)
	})

	test("a create response missing its id or carrying another channel fails before any patch", async () => {
		const bodies = [
			{ version: "0.27.0.0", channel: "listed" },
			{ id: 9001, version: "0.27.0.0", channel: "unlisted" },
		]
		for (const body of bodies) {
			const h = harness([ok({ uuid: "u-1" }), VALID, ok(body, 201)])
			expect((await runPublishFirefoxAmo(env(), h.io)).exit).toBe(1)
			expect(h.kinds()).toEqual(["upload", "upload-status", "version"])
			expectNoSecretLeak(h)
		}
	})

	test("a source patch 500 and a create that timed out both fail with the recovery procedure", async () => {
		const patch500 = harness([ok({ uuid: "u-1" }), VALID, CREATED, ok({ detail: "Internal server error" }, 500)])
		expect((await runPublishFirefoxAmo(env(), patch500.io)).exit).toBe(1)
		expect(patch500.output()).toContain("version 9001 exists but")
		expect(patch500.output()).toContain("do NOT re-run")
		expectNoSecretLeak(patch500)

		const createTimeout = harness([ok({ uuid: "u-1" }), VALID, timeout()])
		expect((await runPublishFirefoxAmo(env(), createTimeout.io)).exit).toBe(1)
		expect(createTimeout.kinds()).toEqual(["upload", "upload-status", "version"])
		expect(createTimeout.output()).toContain("timed out")
		expect(createTimeout.output()).toContain("do NOT re-run")
		expectNoSecretLeak(createTimeout)
	})

	test("a duplicate version (400) carries the API's own detail", async () => {
		const h = harness([ok({ uuid: "u-1" }), VALID, ok({ detail: "Version 0.27.0.0 already exists." }, 409)])
		expect((await runPublishFirefoxAmo(env(), h.io)).exit).toBe(1)
		expect(h.output()).toContain("HTTP 409 — detail: Version 0.27.0.0 already exists.")
	})

	test("a non-JSON 502 and an upload timeout are reported by status or by timeout, never raw", async () => {
		const gateway = harness([ok(null, 502)])
		expect((await runPublishFirefoxAmo(env(), gateway.io)).exit).toBe(1)
		expect(gateway.output()).toContain("HTTP 502 with a non-JSON body")
		expectNoSecretLeak(gateway)

		const slow = harness([timeout()])
		expect((await runPublishFirefoxAmo(env(), slow.io)).exit).toBe(1)
		expect(slow.output()).toContain("timed out after 120s")
		expectNoSecretLeak(slow)
	})

	test("an unexpected throw is reported by class name only", async () => {
		const h = harness([ok({ uuid: "u-1" })])
		h.io.jti = () => {
			throw new TypeError(`boom ${SECRET}`)
		}
		expect((await runPublishFirefoxAmo(env(), h.io)).exit).toBe(1)
		expect(h.output()).toContain("unexpected failure (TypeError)")
		expect(h.output()).not.toContain("boom")
		expectNoSecretLeak(h)
	})
})
