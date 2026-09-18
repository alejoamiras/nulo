import { describe, expect, test } from "bun:test"
import { PREVIEW_COMMENT_MARKER, parseBuildResult, renderPreviewComment } from "./preview-comment"

const base = {
	headSha: "d066fdec5368206a5deb349dc5a82fd871c9a9c5",
	version: "0.27.0-pr.612",
	runUrl: "https://github.com/o/r/actions/runs/1",
}

describe("renderPreviewComment", () => {
	test("starts with the sticky marker and names the head, version and run", () => {
		const body = renderPreviewComment({
			...base,
			targets: [{ name: "Chrome", result: "success", url: "https://github.com/o/r/actions/runs/1/artifacts/9" }],
		})
		expect(body.startsWith(PREVIEW_COMMENT_MARKER)).toBe(true)
		expect(body).toContain("`d066fde`")
		expect(body).toContain("`0.27.0-pr.612`")
		expect(body).toContain("[workflow run](https://github.com/o/r/actions/runs/1)")
		expect(body).toContain("- **Chrome**: [download](https://github.com/o/r/actions/runs/1/artifacts/9)")
	})

	test("renders every build result distinctly, and a skipped target as not built", () => {
		const body = renderPreviewComment({
			...base,
			targets: [
				{ name: "Chrome", result: "failure", url: "" },
				{ name: "Firefox", result: "skipped", url: "" },
			],
		})
		expect(body).toContain("- **Chrome**: build failure")
		expect(body).toContain("- **Firefox**: not built for this change")
		expect(body).not.toContain("[download]")
	})

	test("a successful build without an artifact URL says so instead of linking nowhere", () => {
		const body = renderPreviewComment({ ...base, targets: [{ name: "Firefox", result: "success", url: "" }] })
		expect(body).toContain("- **Firefox**: built, but the artifact URL is missing")
	})
})

describe("parseBuildResult", () => {
	test("keeps the three GitHub outcomes and folds everything else into skipped", () => {
		expect(parseBuildResult("success")).toBe("success")
		expect(parseBuildResult("failure")).toBe("failure")
		expect(parseBuildResult("cancelled")).toBe("cancelled")
		expect(parseBuildResult("skipped")).toBe("skipped")
		expect(parseBuildResult("")).toBe("skipped")
		expect(parseBuildResult(undefined)).toBe("skipped")
	})
})
