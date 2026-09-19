import { describe, expect, test } from "vitest"
import { isStylesheet, stylesheetSpecifiers } from "./stylesheets.ts"

describe("stylesheet imports", () => {
	test("every way CSS, Sass and Less write an import is read", () => {
		const code = `
			@import "pkg/quoted.css";
			@import 'pkg/single.css' screen;
			@import url("pkg/url-quoted.css");
			@import url(pkg/url-bare.css);
			@import url( pkg/url-spaced.css ) layer(base);
			@import "pkg/list-a", "pkg/list-b";
			@use "~pkg/sass" as theme;
			@forward "pkg/forwarded";
			@import url("https://fonts.example/remote.css");
			@import url(//cdn.example/remote.css);
			.rule { background: url(pkg/not-an-import.png) }
		`
		expect(stylesheetSpecifiers(code)).toEqual([
			"pkg/quoted.css",
			"pkg/single.css",
			"pkg/url-quoted.css",
			"pkg/url-bare.css",
			"pkg/url-spaced.css",
			"pkg/list-a",
			"pkg/list-b",
			"~pkg/sass",
			"pkg/forwarded",
		])
	})

	test("style files and Vue style blocks are stylesheets; scripts are not", () => {
		expect(["/a/x.css", "/a/x.scss?direct", "/a/C.vue?vue&type=style&index=0&lang.scss"].every(isStylesheet)).toBe(true)
		expect(["/a/x.ts", "/a/C.vue", "/a/C.vue?vue&type=script&lang.ts"].some(isStylesheet)).toBe(false)
	})
})
