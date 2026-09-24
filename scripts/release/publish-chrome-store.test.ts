import { describe, expect, test } from "bun:test"
import {
	ACCEPTED_WARNINGS,
	acceptedWarnings,
	apiError,
	collectWarnings,
	compareStoreVersions,
	interpretAcceptedPublish,
	interpretAsyncUploadState,
	interpretPreflight,
	interpretPublish,
	interpretUpload,
	parseStoreVersion,
	publishRequest,
	statusRequest,
	uploadRequest,
} from "./publish-chrome-store"

const ITEM = "abcdefghijklmnopabcdefghijklmnop"

const BROAD_HOST = { reason: "BROAD_HOST_USAGE", description: "Your item is requesting broad host permissions which may require an in-depth review." }

/** The refusal `blockOnWarnings: true` produces, detail for detail as the store sent it. */
function refusal(warnings: unknown[] = [BROAD_HOST], over: { reason?: string; itemId?: string; extra?: unknown[]; status?: string } = {}) {
	return {
		error: {
			code: 400,
			message: "Validation warnings were encountered that require confirmation.",
			status: over.status ?? "FAILED_PRECONDITION",
			details: [
				{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: over.reason ?? "MANUAL_CONFIRMATION_REQUIRED", domain: "chromewebstore.googleapis.com", metadata: { itemId: over.itemId ?? ITEM, publisherId: "pub" } },
				{ "@type": "type.googleapis.com/google.rpc.LocalizedMessage", locale: "en-US", message: "Validation warnings were encountered that require confirmation." },
				{ "@type": "type.googleapis.com/google.rpc.Help", links: [{ description: "Edit Item Link", url: "https://chrome.google.com/webstore/devconsole/pub/item/edit/package" }] },
				{ "@type": "type.googleapis.com/google.chrome.webstore.v2.WarningsInfo", warnings },
				...(over.extra ?? []),
			],
		},
	}
}

describe("requests", () => {
	test("upload goes to the upload host with a raw zip body; status and publish to the item", () => {
		const up = uploadRequest("pub", ITEM, "tok", new Uint8Array([1]))
		expect(up.url).toBe(`https://chromewebstore.googleapis.com/upload/v2/publishers/pub/items/${ITEM}:upload`)
		expect(up.headers["Content-Type"]).toBe("application/zip")
		expect(up.headers.Authorization).toBe("Bearer tok")
		expect(statusRequest("pub", ITEM, "tok")).toMatchObject({ method: "GET", url: `https://chromewebstore.googleapis.com/v2/publishers/pub/items/${ITEM}:fetchStatus` })
		const pub = publishRequest("pub", ITEM, "tok", "STAGED_PUBLISH")
		expect(pub.url.endsWith(":publish")).toBe(true)
		expect(JSON.parse(pub.body as string)).toEqual({ publishType: "STAGED_PUBLISH", blockOnWarnings: true })
		expect(JSON.parse(publishRequest("pub", ITEM, "tok", "STAGED_PUBLISH", false).body as string)).toEqual({ publishType: "STAGED_PUBLISH", blockOnWarnings: false })
	})
})

describe("store versions", () => {
	test("are integer tuples padded to four parts, so 0.10.0.0 is above 0.9.0.0", () => {
		expect(parseStoreVersion("0.9")).toEqual([0, 9, 0, 0])
		expect(compareStoreVersions(parseStoreVersion("0.10.0.0") as number[], parseStoreVersion("0.9.0.0") as number[])).toBe(1)
		expect(compareStoreVersions(parseStoreVersion("1.2.3.4") as number[], parseStoreVersion("1.2.3.4") as number[])).toBe(0)
	})

	test("reject semver, five parts and out-of-range components", () => {
		for (const v of ["0.27.0-rc", "1.2.3.4.5", "", "70000", "1.a"]) expect(parseStoreVersion(v)).toBeNull()
	})
})

describe("preflight", () => {
	const ours = "0.27.0.0"
	const status = (over: Record<string, unknown> = {}) => ({ itemId: ITEM, ...over })

	test("accepts absent revisions (never published, nothing submitted)", () => {
		expect(interpretPreflight(status(), ITEM, ours)).toMatchObject({ ok: true })
	})

	test("refuses a wrong itemId, a taken-down item and a pending review", () => {
		expect(interpretPreflight(status({ itemId: "other" }), ITEM, ours)).toMatchObject({ ok: false, reason: expect.stringContaining("expected") })
		expect(interpretPreflight(status({ takenDown: true }), ITEM, ours)).toMatchObject({ ok: false, reason: expect.stringContaining("taken down") })
		expect(interpretPreflight(status({ submittedItemRevisionStatus: { state: "PENDING_REVIEW" } }), ITEM, ours)).toMatchObject({
			ok: false,
			reason: expect.stringContaining("pending review"),
		})
	})

	test("refuses a not-lower version in any distribution channel of either revision", () => {
		const published = { state: "PUBLISHED", distributionChannels: [{ crxVersion: "0.26.0.0" }, { crxVersion: "0.27.0.0" }] }
		expect(interpretPreflight(status({ publishedItemRevisionStatus: published }), ITEM, ours)).toMatchObject({ ok: false, reason: expect.stringContaining("not lower") })
		const staged = { state: "STAGED", distributionChannels: [{ crxVersion: "0.10.0.0" }] }
		expect(interpretPreflight(status({ submittedItemRevisionStatus: staged }), ITEM, "0.9.0.0")).toMatchObject({ ok: false })
		expect(interpretPreflight(status({ submittedItemRevisionStatus: staged }), ITEM, "0.11.0.0")).toMatchObject({ ok: true })
	})

	test("refuses a present revision with a missing, undocumented, unspecified or malformed state", () => {
		expect(interpretPreflight(status({ publishedItemRevisionStatus: {} }), ITEM, ours)).toMatchObject({ ok: false, reason: expect.stringContaining("unknown state") })
		for (const state of ["SOMETHING_NEW", "DEPLOYING", "UNPUBLISHED", "TAKEN_DOWN", "ITEM_STATE_UNSPECIFIED"]) {
			expect(interpretPreflight(status({ submittedItemRevisionStatus: { state } }), ITEM, ours).ok, state).toBe(false)
		}
		expect(interpretPreflight(status({ publishedItemRevisionStatus: null }), ITEM, ours)).toMatchObject({ ok: false })
		expect(interpretPreflight(status({ publishedItemRevisionStatus: { state: "PUBLISHED", distributionChannels: [null] } }), ITEM, ours)).toMatchObject({ ok: false })
		// A present non-array must not be read as "no channels": that would let a higher version through.
		const object = { state: "PUBLISHED", distributionChannels: { crxVersion: "99.0.0.0" } }
		expect(interpretPreflight(status({ publishedItemRevisionStatus: object }), ITEM, ours)).toMatchObject({ ok: false, reason: expect.stringContaining("distributionChannels") })
		expect(interpretPreflight(status({ submittedItemRevisionStatus: { state: "STAGED", distributionChannels: "0.26.0.0" } }), ITEM, ours)).toMatchObject({ ok: false })
	})

	test("accepts every documented non-pending state at a lower version", () => {
		for (const state of ["STAGED", "PUBLISHED", "PUBLISHED_TO_TESTERS", "REJECTED", "CANCELLED"]) {
			const revision = { state, distributionChannels: [{ crxVersion: "0.26.0.0" }] }
			expect(interpretPreflight(status({ publishedItemRevisionStatus: revision }), ITEM, ours).ok, state).toBe(true)
		}
	})
})

describe("upload", () => {
	test("SUCCEEDED is done only for our item at our version", () => {
		expect(interpretUpload({ uploadState: "SUCCEEDED", itemId: ITEM, crxVersion: "0.27.0.0" }, ITEM, "0.27.0.0")).toEqual({ kind: "done" })
		expect(interpretUpload({ uploadState: "SUCCEEDED", itemId: ITEM, crxVersion: "0.26.0.0" }, ITEM, "0.27.0.0")).toMatchObject({ kind: "fail" })
		expect(interpretUpload({ uploadState: "SUCCEEDED", itemId: "x", crxVersion: "0.27.0.0" }, ITEM, "0.27.0.0")).toMatchObject({ kind: "fail" })
	})

	test("both in-progress spellings poll; FAILED, NOT_FOUND, unspecified and unknown fail", () => {
		expect(interpretUpload({ itemId: ITEM, uploadState: "IN_PROGRESS" }, ITEM, "0.27.0.0")).toEqual({ kind: "poll" })
		expect(interpretUpload({ itemId: ITEM, uploadState: "UPLOAD_IN_PROGRESS" }, ITEM, "0.27.0.0")).toEqual({ kind: "poll" })
		for (const s of ["FAILED", "NOT_FOUND", "UPLOAD_STATE_UNSPECIFIED", "WHATEVER", undefined]) {
			expect(interpretUpload({ itemId: ITEM, uploadState: s }, ITEM, "0.27.0.0").kind).toBe("fail")
		}
	})

	// An async answer for another item must never lead to polling — and then publishing — ours.
	test("an upload response or a poll for another item fails, whatever its state", () => {
		expect(interpretUpload({ itemId: "other", uploadState: "IN_PROGRESS" }, ITEM, "0.27.0.0")).toMatchObject({ kind: "fail" })
		expect(interpretUpload({ uploadState: "IN_PROGRESS" }, ITEM, "0.27.0.0")).toMatchObject({ kind: "fail" })
		expect(interpretAsyncUploadState({ itemId: "other", lastAsyncUploadState: "SUCCEEDED" }, ITEM)).toMatchObject({ kind: "fail" })
	})

	test("while polling, a missing lastAsyncUploadState is a failure, not a wait", () => {
		expect(interpretAsyncUploadState({ itemId: ITEM }, ITEM)).toMatchObject({ kind: "fail" })
		expect(interpretAsyncUploadState({ itemId: ITEM, lastAsyncUploadState: "IN_PROGRESS" }, ITEM)).toEqual({ kind: "poll" })
		expect(interpretAsyncUploadState({ itemId: ITEM, lastAsyncUploadState: "SUCCEEDED" }, ITEM)).toEqual({ kind: "done" })
		expect(interpretAsyncUploadState({ itemId: ITEM, lastAsyncUploadState: "FAILED" }, ITEM)).toMatchObject({ kind: "fail" })
	})
})

describe("publish", () => {
	test("distinct summaries for PENDING_REVIEW, STAGED and PUBLISHED; REJECTED and unknown fail", () => {
		const s = (state: string) => interpretPublish({ state }, 200)
		expect(s("PENDING_REVIEW")).toMatchObject({ ok: true, summary: expect.stringContaining("review") })
		expect(s("STAGED")).toMatchObject({ ok: true, summary: expect.stringContaining("30 days") })
		expect(s("PUBLISHED")).toMatchObject({ ok: true, summary: expect.stringContaining("live") })
		expect(s("REJECTED")).toMatchObject({ ok: false })
		expect(s("NEW_STATE")).toMatchObject({ ok: false })
	})

	test("reads warnings from both envelopes", () => {
		expect(collectWarnings({ warningInfo: { warnings: ["w1", { code: "W2" }] } })).toEqual(["w1", '{"code":"W2"}'])
		const refused = interpretPublish({ error: { code: 400, message: "blocked on warnings", details: [{ reason: "ICON" }] } }, 400)
		expect(refused.ok).toBe(false)
		const reason = refused.ok ? "" : refused.reason
		expect(reason).toContain("blocked on warnings")
		expect(reason).toContain("ICON")
		// A refusal's warnings are listed by reason, so a second reason is never lost to the per-entry truncation.
		const listed = collectWarnings(refusal([{ ...BROAD_HOST, description: "x".repeat(300) }, { reason: "LARGE_ICON", description: "icon" }]))
		expect(listed.some((w) => w.startsWith("BROAD_HOST_USAGE: xxx"))).toBe(true)
		expect(listed).toContain("LARGE_ICON: icon")
	})

	test("apiError keeps only the API's strings, truncated", () => {
		expect(apiError({ error: { message: "m", status: "PERMISSION_DENIED" } })).toBe("m — PERMISSION_DENIED")
		expect(apiError({ error: { message: "x".repeat(300) } }).length).toBe(200)
		expect(apiError("nope")).toBe("no error detail")
	})
})

describe("accepted warnings", () => {
	// Growing this set is a reviewed change to the manifest's review surface, so the test names it in full.
	test("the accepted list is exactly BROAD_HOST_USAGE", () => {
		expect([...ACCEPTED_WARNINGS]).toEqual(["BROAD_HOST_USAGE"])
	})

	test("the store's own refusal on BROAD_HOST_USAGE alone is accepted, with its description", () => {
		expect(acceptedWarnings(refusal(), 400, ITEM)).toEqual([BROAD_HOST])
		const twice = acceptedWarnings(refusal([BROAD_HOST, { reason: "BROAD_HOST_USAGE" }]), 400, ITEM)
		expect(twice?.map((w) => w.reason)).toEqual(["BROAD_HOST_USAGE", "BROAD_HOST_USAGE"])
	})

	test("any warning outside the list, or no warning at all, is never accepted", () => {
		expect(acceptedWarnings(refusal([BROAD_HOST, { reason: "LARGE_ICON", description: "…" }]), 400, ITEM)).toBeNull()
		expect(acceptedWarnings(refusal([{ reason: "NEW_REASON" }]), 400, ITEM)).toBeNull()
		expect(acceptedWarnings(refusal([]), 400, ITEM)).toBeNull()
		const noWarningsInfo = refusal()
		noWarningsInfo.error.details = noWarningsInfo.error.details.slice(0, 3)
		expect(acceptedWarnings(noWarningsInfo, 400, ITEM)).toBeNull()
	})

	test("an unreadable or unexpected refusal fails closed", () => {
		expect(acceptedWarnings(refusal([{ description: "no reason" }]), 400, ITEM)).toBeNull()
		expect(acceptedWarnings(refusal(["BROAD_HOST_USAGE"]), 400, ITEM)).toBeNull()
		expect(acceptedWarnings(refusal([BROAD_HOST], { reason: "SOMETHING_ELSE" }), 400, ITEM)).toBeNull()
		expect(acceptedWarnings(refusal([BROAD_HOST], { itemId: "other" }), 400, ITEM)).toBeNull()
		expect(acceptedWarnings(refusal([BROAD_HOST], { status: "INVALID_ARGUMENT" }), 400, ITEM)).toBeNull()
		expect(acceptedWarnings(refusal([BROAD_HOST], { extra: [{ "@type": "type.googleapis.com/google.rpc.PreconditionFailure", violations: [] }] }), 400, ITEM)).toBeNull()
		expect(acceptedWarnings(refusal([BROAD_HOST], { extra: [{ reason: "BROAD_HOST_USAGE" }] }), 400, ITEM)).toBeNull()
		expect(acceptedWarnings(refusal(), 403, ITEM)).toBeNull()
		expect(acceptedWarnings({ error: { code: 400, status: "FAILED_PRECONDITION", details: [{ reason: "BROAD_HOST_USAGE" }] } }, 400, ITEM)).toBeNull()
		expect(acceptedWarnings({ error: { code: 400, status: "FAILED_PRECONDITION" } }, 400, ITEM)).toBeNull()
		expect(acceptedWarnings({ state: "PENDING_REVIEW" }, 200, ITEM)).toBeNull()
		// A refusal that also carries the success envelope's fields is a shape the script does not know.
		expect(acceptedWarnings({ ...refusal(), warningInfo: { warnings: [{ reason: "LARGE_ICON" }] } }, 400, ITEM)).toBeNull()
		expect(acceptedWarnings({ ...refusal(), state: "PENDING_REVIEW" }, 400, ITEM)).toBeNull()
		const twoConfirmations = refusal([BROAD_HOST], { extra: [refusal().error.details[0]] })
		expect(acceptedWarnings(twoConfirmations, 400, ITEM)).toBeNull()
		expect(acceptedWarnings(refusal([BROAD_HOST], { extra: [[BROAD_HOST]] }), 400, ITEM)).toBeNull()
	})

	test("rendering stays bounded whatever the store sends, and never throws", () => {
		const flood = Array.from({ length: 1_000 }, (_, i) => ({ reason: `W${i}`, description: "x".repeat(500) }))
		const lines = collectWarnings(refusal(flood))
		expect(lines.length).toBeLessThanOrEqual(10)
		for (const line of lines) expect(line.length).toBeLessThanOrEqual(200)
		expect(collectWarnings({ warningInfo: { warnings: {} } })).toEqual(["{}"])
		expect(collectWarnings({ warningInfo: [BROAD_HOST] })).toEqual([])
		const many = interpretAcceptedPublish({ state: "PENDING_REVIEW", warningInfo: { warnings: flood } }, 200)
		expect(many.ok ? "" : many.reason).toContain("(+990 more)")
		expect((many.ok ? "" : many.reason).length).toBeLessThan(1_000)
	})

	test("a first-call success that still lists warnings stays a success and shows them", () => {
		const live = interpretPublish({ state: "PUBLISHED", warningInfo: { warnings: [BROAD_HOST] } }, 200)
		expect(live).toMatchObject({ ok: true, summary: expect.stringContaining("BROAD_HOST_USAGE: Your item") })
	})

	test("the retry's verdict fails once the store lists a warning it was not licensed to ignore", () => {
		expect(interpretAcceptedPublish({ state: "PENDING_REVIEW", warningInfo: { warnings: [BROAD_HOST] } }, 200)).toMatchObject({ ok: true })
		expect(interpretAcceptedPublish({ state: "PENDING_REVIEW", warningInfo: {} }, 200)).toMatchObject({ ok: true })
		expect(interpretAcceptedPublish({ state: "STAGED" }, 200)).toMatchObject({ ok: true })
		const stranger = interpretAcceptedPublish({ state: "PENDING_REVIEW", warningInfo: { warnings: [BROAD_HOST, { reason: "LARGE_ICON" }] } }, 200)
		const reason = stranger.ok ? "" : stranger.reason
		expect(reason).toContain("LARGE_ICON")
		expect(reason).toContain("dashboard")
		expect(interpretAcceptedPublish({ state: "PENDING_REVIEW", warningInfo: { warnings: "none" } }, 200)).toMatchObject({ ok: false, reason: expect.stringContaining("unreadable") })
		expect(interpretAcceptedPublish({ state: "PENDING_REVIEW", warningInfo: { warnings: {} } }, 200)).toMatchObject({ ok: false, reason: expect.stringContaining("unreadable") })
		expect(interpretAcceptedPublish({ state: "PENDING_REVIEW", warningInfo: [{ reason: "LARGE_ICON" }] }, 200)).toMatchObject({ ok: false, reason: expect.stringContaining("unreadable") })
		expect(interpretAcceptedPublish(refusal(), 400)).toMatchObject({ ok: false, reason: expect.stringContaining("refused") })
	})
})
