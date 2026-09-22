import { describe, expect, test } from "bun:test"
import {
	apiError,
	checkFirefoxManifest,
	checkSourceArchive,
	DATA_COLLECTION,
	GECKO_ID,
	interpretOwnAddons,
	interpretSource,
	interpretUploadCreate,
	interpretUploadStatus,
	interpretVersion,
	JWT_LIFETIME_SEC,
	jwt,
	NOTES_END,
	NOTES_START,
	ownAddonsRequest,
	requiredSourcePaths,
	reviewerNotes,
	SOURCE_MAX_BYTES,
	sourcePackageJsonPath,
	sourceRequest,
	uploadRequest,
	versionRequest,
} from "./publish-firefox-amo"

const FIREFOX_MANIFEST = {
	version: "0.27.0.0",
	version_name: "0.27.0",
	browser_specific_settings: { gecko: { id: GECKO_ID, strict_min_version: "153.0", data_collection_permissions: { required: ["financialAndPaymentInfo"] } } },
}

describe("jwt", () => {
	test("known-answer vector: HS256, 60-second lifetime, the given jti", () => {
		const token = jwt("user:123:456", "SECRET-A1B2", 1_700_000_000, "jti-1")
		expect(token).toBe(
			"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJ1c2VyOjEyMzo0NTYiLCJqdGkiOiJqdGktMSIsImlhdCI6MTcwMDAwMDAwMCwiZXhwIjoxNzAwMDAwMDYwfQ.kakMVRNcZxWmS1yokOKzypCgZjcZgHJ88hYIs9UHH_w",
		)
		const [header, payload] = token.split(".").slice(0, 2).map((p) => JSON.parse(Buffer.from(p, "base64url").toString()))
		expect(header).toEqual({ alg: "HS256", typ: "JWT" })
		expect(payload.exp - payload.iat).toBe(JWT_LIFETIME_SEC)
		expect(JWT_LIFETIME_SEC).toBeLessThanOrEqual(300)
	})

	test("a different jti or secret yields a different token", () => {
		const a = jwt("i", "s", 1, "x")
		expect(jwt("i", "s", 1, "y")).not.toBe(a)
		expect(jwt("i", "t", 1, "x")).not.toBe(a)
	})
})

describe("requests", () => {
	test("upload is multipart on the listed channel; version is JSON with approval notes; source is a multipart PATCH", () => {
		const up = uploadRequest(new Uint8Array([1]), "nulo-firefox-0.27.0.zip")
		expect(up).toMatchObject({ kind: "multipart", method: "POST", fields: { channel: "listed" } })
		expect(up.url).toBe("https://addons.mozilla.org/api/v5/addons/upload/")
		const v = versionRequest(GECKO_ID, "uuid-1", "notes")
		expect(v).toMatchObject({ kind: "json", method: "POST", body: { upload: "uuid-1", approval_notes: "notes" } })
		expect(v.url).toBe("https://addons.mozilla.org/api/v5/addons/addon/wallet%40nulo.sh/versions/")
		const s = sourceRequest(GECKO_ID, 42, new Uint8Array([2]), "src.zip")
		expect(s).toMatchObject({ kind: "multipart", method: "PATCH" })
		expect(s.url).toBe("https://addons.mozilla.org/api/v5/addons/addon/wallet%40nulo.sh/versions/42/")
		expect(s.kind === "multipart" && Object.keys(s.files)).toEqual(["source"])
	})
})

describe("interpreters", () => {
	test("upload create needs a uuid", () => {
		expect(interpretUploadCreate({ uuid: "u" })).toEqual({ ok: true, value: "u" })
		for (const bad of [null, [], {}, { uuid: "" }, { uuid: 3 }]) expect(interpretUploadCreate(bad).ok).toBe(false)
	})

	test("upload status: processing, valid, invalid with bounded errors", () => {
		expect(interpretUploadStatus({ processed: false })).toEqual({ ok: true, value: { kind: "processing" } })
		expect(interpretUploadStatus({ processed: true, valid: true })).toEqual({ ok: true, value: { kind: "valid" } })
		const messages = Array.from({ length: 14 }, (_, i) => ({ type: i % 2 ? "warning" : "error", message: `m${i}`, description: "x".repeat(300) }))
		const r = interpretUploadStatus({ processed: true, valid: false, validation: { messages } })
		expect(r.ok && r.value.kind === "invalid" && r.value.errors.length).toBe(7)
		expect(r.ok && r.value.kind === "invalid" && r.value.errors.every((e) => e.length <= 200)).toBe(true)
		expect(interpretUploadStatus({ processed: true, valid: false })).toEqual({ ok: true, value: { kind: "invalid", errors: [] } })
		expect(interpretUploadStatus("nope").ok).toBe(false)
	})

	test("version: id, the manifest's numeric version and channel listed are all required", () => {
		const good = { id: 7, version: "0.27.0.0", channel: "listed", file: { status: "unreviewed" } }
		expect(interpretVersion(good, "0.27.0.0")).toEqual({ ok: true, value: { id: 7, version: "0.27.0.0", channel: "listed", fileStatus: "unreviewed" } })
		expect(interpretVersion({ ...good, id: undefined }, "0.27.0.0").ok).toBe(false)
		expect(interpretVersion({ ...good, version: "0.27.0" }, "0.27.0.0").ok).toBe(false)
		expect(interpretVersion({ ...good, channel: "unlisted" }, "0.27.0.0").ok).toBe(false)
		expect(interpretVersion({ ...good, file: null }, "0.27.0.0")).toMatchObject({ ok: true, value: { fileStatus: "unknown" } })
	})

	test("source and own-add-ons", () => {
		expect(interpretSource({ source: "https://addons.mozilla.org/x/source.zip" }).ok).toBe(true)
		expect(interpretSource({ source: null }).ok).toBe(false)
		expect(interpretOwnAddons({ results: [{ guid: "other@x" }, { guid: GECKO_ID, status: "incomplete" }] }, GECKO_ID)).toEqual({ ok: true, value: { kind: "found", status: "incomplete" } })
		expect(interpretOwnAddons({ results: [{ guid: "other@x" }], next: null }, GECKO_ID)).toEqual({ ok: true, value: { kind: "absent", listed: 1 } })
		const next = "https://addons.mozilla.org/api/v5/addons/addon/?page=2&page_size=50"
		expect(interpretOwnAddons({ results: [{ guid: "other@x" }], next }, GECKO_ID)).toEqual({ ok: true, value: { kind: "next", url: next, listed: 1 } })
		expect(interpretOwnAddons({ results: [], next: "https://evil.example/steal" }, GECKO_ID)).toEqual({ ok: true, value: { kind: "absent", listed: 0 } })
		expect(interpretOwnAddons({ detail: "Authentication credentials were not provided." }, GECKO_ID).ok).toBe(false)
		expect(ownAddonsRequest().url).toBe("https://addons.mozilla.org/api/v5/addons/addon/?page_size=50")
		expect(ownAddonsRequest(next).url).toBe(next)
	})

	test("apiError keeps strings and string arrays only, truncated", () => {
		expect(apiError({ detail: "Version 0.27.0.0 already exists.", upload: ["a", "b"], nested: { x: 1 } })).toBe("detail: Version 0.27.0.0 already exists. | upload: a; b")
		expect(apiError({ detail: "x".repeat(500) }).length).toBe(200)
		expect(apiError("text")).toBe("no error detail")
	})
})

describe("checkFirefoxManifest", () => {
	test("accepts the Firefox build of this release and retains the numeric version", () => {
		expect(checkFirefoxManifest(FIREFOX_MANIFEST, "0.27.0")).toEqual({ ok: true, value: { storeVersion: "0.27.0.0" } })
	})

	test("refuses a Chrome zip, a wrong gecko id, an unsettled declaration and a version mismatch", () => {
		const gecko = FIREFOX_MANIFEST.browser_specific_settings.gecko
		const bss = (over: Record<string, unknown>) => ({ ...FIREFOX_MANIFEST, browser_specific_settings: { gecko: { ...gecko, ...over } } })
		const cases: [unknown, string][] = [
			[{ version: "0.27.0.0", version_name: "0.27.0" }, "browser_specific_settings"],
			[bss({ id: "other@nulo.sh" }), "gecko.id"],
			[bss({ data_collection_permissions: { required: ["none"] } }), "settled"],
			[bss({ data_collection_permissions: { required: ["financialAndPaymentInfo", "authenticationInfo"] } }), "settled"],
			[bss({ data_collection_permissions: undefined }), "settled"],
			[{ ...FIREFOX_MANIFEST, version_name: "0.26.0" }, "version_name"],
			[{ ...FIREFOX_MANIFEST, version: "0.27.0" }, "four integers"],
			[{ ...FIREFOX_MANIFEST, version: "0.28.0.0" }, "derive"],
			[null, "not an object"],
		]
		for (const [manifest, word] of cases) {
			const r = checkFirefoxManifest(manifest, "0.27.0")
			expect(r.ok).toBe(false)
			expect(!r.ok && r.reason).toContain(word)
		}
		expect(DATA_COLLECTION).toEqual(["financialAndPaymentInfo"])
	})
})

describe("checkSourceArchive", () => {
	const paths = [...requiredSourcePaths("0.27.0"), sourcePackageJsonPath("0.27.0")]
	const pkg = JSON.stringify({ name: "@nulo/extension", version: "0.27.0" })
	test("needs the prefixed paths, a tree at VERSION, and stays under 200 MB", () => {
		expect(paths).toEqual(["nulo-0.27.0/apps/extension/store/SOURCE-BUILD.md", "nulo-0.27.0/bun.lock", "nulo-0.27.0/apps/extension/package.json"])
		expect(checkSourceArchive([...paths, "nulo-0.27.0/README.md"], 30e6, "0.27.0", pkg)).toEqual({ ok: true, value: true })
		expect(checkSourceArchive(["apps/extension/store/SOURCE-BUILD.md", "bun.lock", "apps/extension/package.json"], 30e6, "0.27.0", pkg).ok).toBe(false)
		expect(checkSourceArchive([paths[0], paths[2]], 30e6, "0.27.0", pkg).ok).toBe(false)
		expect(checkSourceArchive(paths, SOURCE_MAX_BYTES, "0.27.0", pkg).ok).toBe(false)
	})

	test("a tree whose package version is not VERSION is refused: the reviewer's rebuild would refuse it too", () => {
		const r = checkSourceArchive([...requiredSourcePaths("0.28.0"), sourcePackageJsonPath("0.28.0")], 30e6, "0.28.0", pkg)
		expect(r.ok).toBe(false)
		expect(!r.ok && r.reason).toContain('"0.27.0", not 0.28.0')
		expect(checkSourceArchive(paths, 30e6, "0.27.0", "not json").ok).toBe(false)
	})
})

describe("reviewerNotes", () => {
	test("returns the trimmed block between the markers, and refuses a missing or empty one", () => {
		expect(reviewerNotes(`# x\n${NOTES_START}\n\nHello reviewer.\n\n${NOTES_END}\nrest`)).toEqual({ ok: true, value: "Hello reviewer." })
		expect(reviewerNotes("# x\nno block").ok).toBe(false)
		expect(reviewerNotes(`${NOTES_START}\n\n${NOTES_END}`).ok).toBe(false)
		expect(reviewerNotes(`${NOTES_END}\n${NOTES_START}`).ok).toBe(false)
	})
})
