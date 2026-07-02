import { describe, expect, test } from "bun:test"
import { NO_TAG_ERROR, resolveTag } from "./resolve-tag"

describe("resolveTag", () => {
	test("push path takes release-please's tag", () => {
		expect(resolveTag({ isPush: true, tagFromPlease: "v0.23.0", tagFromInput: "" })).toEqual({
			tag: "v0.23.0",
			version: "0.23.0",
			isPrerelease: false,
		})
	})

	test("dispatch path takes the input tag", () => {
		expect(resolveTag({ isPush: false, tagFromPlease: "", tagFromInput: "v0.20.0" })).toEqual({
			tag: "v0.20.0",
			version: "0.20.0",
			isPrerelease: false,
		})
	})

	test("push prefers release-please even when an input is also present", () => {
		expect(resolveTag({ isPush: true, tagFromPlease: "v0.23.0", tagFromInput: "v9.9.9" }).tag).toBe("v0.23.0")
	})

	test("dispatch prefers the input even when a please tag is also present", () => {
		expect(resolveTag({ isPush: false, tagFromPlease: "v9.9.9", tagFromInput: "v0.20.0" }).tag).toBe("v0.20.0")
	})

	test("prerelease tag (rc, no counter) is flagged", () => {
		expect(resolveTag({ isPush: false, tagFromPlease: "", tagFromInput: "v0.24.0-rc" })).toEqual({
			tag: "v0.24.0-rc",
			version: "0.24.0-rc",
			isPrerelease: true,
		})
	})

	test("prerelease tag with a counter is flagged", () => {
		expect(resolveTag({ isPush: false, tagFromPlease: "", tagFromInput: "v0.24.0-rc.1" }).isPrerelease).toBe(true)
	})

	test("strips only a leading v (a tag without the prefix still parses)", () => {
		expect(resolveTag({ isPush: false, tagFromPlease: "", tagFromInput: "0.23.0" }).version).toBe("0.23.0")
	})

	test("trims surrounding whitespace", () => {
		expect(resolveTag({ isPush: true, tagFromPlease: "  v0.23.0\n", tagFromInput: "" }).tag).toBe("v0.23.0")
	})

	test("empty tag on push (release-please created nothing) throws", () => {
		expect(() => resolveTag({ isPush: true, tagFromPlease: "", tagFromInput: "v1.2.3" })).toThrow(NO_TAG_ERROR)
	})

	test("empty tag on dispatch (no input) throws", () => {
		expect(() => resolveTag({ isPush: false, tagFromPlease: "v1.2.3", tagFromInput: "" })).toThrow(NO_TAG_ERROR)
	})

	test("undefined tag fields throw rather than producing 'undefined'", () => {
		expect(() => resolveTag({ isPush: true, tagFromPlease: undefined, tagFromInput: undefined })).toThrow(NO_TAG_ERROR)
	})

	test("whitespace-only tag is treated as empty", () => {
		expect(() => resolveTag({ isPush: false, tagFromPlease: "", tagFromInput: "   " })).toThrow(NO_TAG_ERROR)
	})
})
