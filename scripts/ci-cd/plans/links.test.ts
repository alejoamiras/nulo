import { afterAll, describe, expect, test } from "bun:test"
import { checkTree } from "./check"
import { cleanupRepos, findings, makeRepo, writeFiles } from "./fixture-repo"
import { expandBraces, extract, pathTokens, resolveHref } from "./links"

afterAll(cleanupRepos)

describe("extract", () => {
	const md = [
		"# T",
		"",
		"A `[code](code.md)` span is not a link.",
		"",
		'[inline](a/b.md), [ref][r] and <a href="raw.md">raw</a>.',
		"",
		'<div><a href="block.md">b</a><img src="i.png"></div>',
		"",
		"[r]: ref%20target.md",
		"",
		"## Outcome",
		"",
		"- **Date**: x",
		"",
		"```md",
		"## Outcome",
		"```",
		"",
		"## Outcome & Quality Bar",
	].join("\n")

	test("inline, reference-style, raw-inline and block-HTML links are links; a code span is not", () => {
		const { links } = extract("p/plan.md", md)
		expect(links.map((l) => l.href)).toEqual(["a/b.md", "ref%20target.md", "raw.md", "block.md", "i.png"])
		expect(links.map((l) => l.line)).toEqual([5, 9, 5, 7, 7])
	})

	test("h2 texts come decoded from the rendering; a fenced heading is not one", () => {
		expect(extract("p/plan.md", md).h2).toEqual(["Outcome", "Outcome & Quality Bar"])
	})

	test(".html goes straight to the rewriter", () => {
		expect(extract("p/eli5.html", '<p><a href="plan.md">p</a></p>').links.map((l) => l.href)).toEqual(["plan.md"])
	})

	test("GFM autolinks: bare https, www. and angle-bracket URLs are links, as GitHub renders them; a bare path is not", () => {
		const src = "x https://e.example/a y\n\nwww.e.example/b\n\n<https://e.example/c>\n\ndocs/a.md\n"
		expect(extract("a.md", src).links.map((l) => `${l.line} ${l.href}`)).toEqual([
			"1 https://e.example/a",
			"3 http://www.e.example/b",
			"5 https://e.example/c",
		])
	})

	test("every URL-bearing attribute is a link, and srcset splits into its candidates", () => {
		const html = [
			'<img src="i.png" srcset="dead.md 1x, other.md 2x">',
			'<picture><source srcset="s1.png 1x,s2.png"></picture>',
			'<link href="style.css"><script src="app.js"></script>',
			'<iframe src="frame.html"></iframe>',
			'<map><area href="map.md"></map>',
			'<video src="v.mp4" poster="p.png"><track src="t.vtt"></video>',
		].join("\n")
		expect(extract("p/eli5.html", html).links.map((l) => `${l.line} ${l.href}`)).toEqual([
			"1 i.png",
			"1 dead.md",
			"1 other.md",
			"2 s1.png",
			"2 s2.png",
			"3 style.css",
			"3 app.js",
			"4 frame.html",
			"5 map.md",
			"6 v.mp4",
			"6 p.png",
			"6 t.vtt",
		])
	})

	test("every URL attribute the policy judges is a link: input src, cite, action, formaction, ping, SVG href, object data", () => {
		const html = [
			'<input type="image" src="in.png"><blockquote cite="bq.md"></blockquote><q cite="q.md">q</q>',
			'<form action="f.md"><button formaction="b.md">b</button></form><del cite="d.md">d</del>',
			'<a href="a.md" ping="p1.md p2.md">a</a><svg><image href="im.svg"/><use xlink:href="u.svg"/></svg>',
			'<object data="o.md"></object><div data="not-a-url"></div><table background="bg.png"></table>',
		].join("\n")
		expect(extract("p/eli5.html", html).links.map((l) => `${l.line} ${l.href}`)).toEqual([
			"1 in.png",
			"1 bq.md",
			"1 q.md",
			"2 f.md",
			"2 b.md",
			"2 d.md",
			"3 a.md",
			"3 p1.md",
			"3 p2.md",
			"3 im.svg",
			"3 u.svg",
			"4 o.md",
			"4 bg.png",
		])
	})

	test("a CSS url() or @import, in a style attribute or a <style> block, is a link; url(#id) is an anchor", () => {
		const html = [
			'<div style="background: url(\'bg.png\')"><svg><rect fill="url(#g)"/></svg></div>',
			'<style>@import "s.css"; @import url(t.css); b { background: url( u.png ) }</style>',
		].join("\n")
		expect(extract("p/eli5.html", html).links.map((l) => `${l.line} ${l.href}`)).toEqual([
			"1 bg.png",
			"1 #g",
			"2 t.css",
			"2 u.png",
			"2 s.css",
		])
	})

	test("an srcset in Markdown's raw HTML is checked like any link", () => {
		const repo = makeRepo({ "README.md": '<img srcset="dead.md 1x">\n' })
		expect(findings(repo, "link-missing").map((f) => f.detail)).toEqual(["dead.md → dead.md is not in the git index"])
	})

	test("a numeric reference past U+10FFFF in an href never crashes the run", () => {
		const repo = makeRepo({ "README.md": '<a href="&#x110000;">x</a>\n' })
		expect(() => checkTree({ cwd: repo })).not.toThrow()
	})
})

describe("resolveHref", () => {
	test("relative, repo-rooted, anchor, external and escaping hrefs", () => {
		expect(resolveHref("implementations-plan/p/plan.md", "../q/plan.md#x")).toEqual({
			kind: "repo",
			path: "implementations-plan/q/plan.md",
		})
		expect(resolveHref("docs/a.md", "/CLAUDE.md")).toEqual({ kind: "repo", path: "CLAUDE.md" })
		expect(resolveHref("docs/a.md", "#top")).toEqual({ kind: "anchor" })
		expect(resolveHref("docs/a.md", "https://example.com")).toEqual({ kind: "external" })
		expect(resolveHref("docs/a.md", "../../x.md")).toEqual({ kind: "repo", path: null })
	})
})

describe("path tokens", () => {
	test("brace tokens expand; templates and globs are not paths; trailing punctuation drops", () => {
		expect(expandBraces("implementations-plan/{a,b}/x/{c,d}.md")).toEqual([
			"implementations-plan/a/x/c.md",
			"implementations-plan/a/x/d.md",
			"implementations-plan/b/x/c.md",
			"implementations-plan/b/x/d.md",
		])
		expect(pathTokens("see implementations-plan/{a,b}/plan.md, implementations-plan/<plan>/x and implementations-plan/**.")).toEqual({
			paths: ["implementations-plan/a/plan.md", "implementations-plan/b/plan.md"],
			overflow: [],
		})
	})

	test("expansion stops past BRACE_CAP results, before building them, and the token becomes a finding", () => {
		const bomb = `implementations-plan/${"{a,b}".repeat(9)}/plan.md`
		expect(expandBraces(bomb)).toBeNull()
		expect(expandBraces("{a,b}".repeat(40))).toBeNull()
		expect(expandBraces("{a,b}".repeat(8))).toHaveLength(256)
		const repo = makeRepo({ "README.md": `${bomb}\n` })
		expect(findings(repo, "path-token").map((f) => f.detail)).toEqual([`${bomb} expands to more than 256 paths`])
	})
})

describe("link-untracked", () => {
	test("a kept file linking a transcript shape fails", () => {
		const repo = makeRepo({
			"implementations-plan/p/plan.md": "[audit](audit-codex.md)\n",
			"implementations-plan/p/audit-codex.md": "x\n",
		})
		expect(findings(repo, "link-untracked").map((f) => `${f.file}:${f.line}`)).toEqual(["implementations-plan/p/plan.md:1"])
	})

	test("a lessons file keeps its transcript-shaped name; a transcript's own links leave with it", () => {
		const repo = makeRepo({
			"implementations-plan/p/plan.md": "[log](lessons/audit-x.md)\n",
			"implementations-plan/p/lessons/audit-x.md": "x\n",
			"implementations-plan/p/audit-codex.md": "[draft](plan-v2.md)\n",
		})
		expect(findings(repo, "link-untracked")).toEqual([])
	})
})

describe("link-missing", () => {
	test("a live doc's target must be in the git index, not merely on disk", () => {
		const repo = makeRepo({ "README.md": "[a](docs/a.md) [b](docs/b.md) [cite](docs/a.md:3)\n", "docs/a.md": "a\n" })
		writeFiles(repo, { "docs/b.md": "untracked\n" })
		expect(findings(repo, "link-missing").map((f) => f.detail)).toEqual([
			"docs/b.md → docs/b.md is not in the git index",
			"docs/a.md:3 → docs/a.md:3 is not in the git index",
		])
	})

	test("a live doc whose targets all exist passes", () => {
		const repo = makeRepo({ "README.md": "[a](docs/a.md) [dir](docs/)\n", "docs/a.md": "a\n" })
		expect(findings(repo, "link-missing")).toEqual([])
	})

	test("plan prose checks only links into the plan tree, not repo-rooted code cites", () => {
		const repo = makeRepo({
			"implementations-plan/p/plan.md":
				"[gone](../q/plan.md) [cite](apps/x.ts:12) [root](apps/x.ts) [out](../../apps/missing.ts) [here](plan.md:40)\n",
			"apps/x.ts": "x\n",
		})
		expect(findings(repo, "link-missing").map((f) => f.detail)).toEqual([
			"../q/plan.md → implementations-plan/q/plan.md is not in the git index",
		])
	})

	test("a `:line` suffix or a repo-rooted spelling never hides a dead plan-tree target", () => {
		const repo = makeRepo({
			"implementations-plan/p/plan.md": [
				"[a](../gone/plan.md:1)",
				"[b](implementations-plan/gone/plan.md)",
				"[c](implementations-plan/gone/plan.md:3-9)",
				"[d](implementations-plan/p/plan.md:2)",
				"[e](apps/missing.ts:4)",
				"[f](.claude/skills/gone/SKILL.md:9)",
			].join("\n"),
			"apps/x.ts": "x\n",
			".claude/skills/s/SKILL.md": "s\n",
		})
		expect(findings(repo, "link-missing").map((f) => `${f.line} ${f.detail}`)).toEqual([
			"1 ../gone/plan.md:1 → implementations-plan/gone/plan.md is not in the git index",
			"2 implementations-plan/gone/plan.md → implementations-plan/gone/plan.md is not in the git index",
			"3 implementations-plan/gone/plan.md:3-9 → implementations-plan/gone/plan.md is not in the git index",
		])
	})

	test("a dot segment never lets a plan-relative link pass as a repo-rooted cite", () => {
		const repo = makeRepo({
			"implementations-plan/p/plan.md": [
				"[a](apps/../../gone/plan.md)",
				"[b](apps/./../../gone/plan.md:4)",
				"[c](%61pps/../../gone/plan.md)",
				"[d](apps/x.ts:12)",
				"[e](apps/gone.ts)",
			].join("\n"),
			"apps/x.ts": "x\n",
		})
		expect(findings(repo, "link-missing").map((f) => `${f.line} ${f.detail}`)).toEqual([
			"1 apps/../../gone/plan.md → implementations-plan/gone/plan.md is not in the git index",
			"2 apps/./../../gone/plan.md:4 → implementations-plan/gone/plan.md is not in the git index",
			"3 %61pps/../../gone/plan.md → implementations-plan/gone/plan.md is not in the git index",
		])
	})
})

describe("link-opaque", () => {
	test("a <base href>, in HTML or in Markdown's raw HTML, is a finding: it moves every relative link", () => {
		const repo = makeRepo({
			"docs/eli5.html": '<base href="https://attacker.example/">\n<a href="plan.md">p</a>\n',
			"README.md": 'x\n\n<base href="/elsewhere/">\n',
		})
		expect(findings(repo, "link-opaque").map((f) => `${f.file}:${f.line}`)).toEqual(["docs/eli5.html:1", "README.md:3"])
	})

	test("a named reference the gate cannot decode is a finding; a semicolonless numeric one is decoded", () => {
		const permalink = "https://github.com/alejoamiras/nulo/&#98lob/BAD/README.md"
		const repo = makeRepo({
			"README.md": [
				'<a href="https://github.com&sol;alejoamiras&sol;nulo&sol;blob&sol;BAD&sol;README.md">x</a>',
				`<a href="${permalink}">y</a>`,
				'<a href="docs/a.md?x=1&amp;y=2">ok</a>',
				'<a href="docs/a.md?x=1&amp/y">legacy</a>',
				'<a href="https://fonts.example/css?family=A&family=B&notify&not=1">text</a>',
			].join("\n"),
			"docs/a.md": "a\n",
		})
		expect(findings(repo, "link-opaque").map((f) => `${f.line} ${f.detail}`)).toEqual([
			"1 &sol; is a character reference the gate cannot decode",
			"4 &amp is a character reference the gate cannot decode",
		])
		expect(findings(repo, "permalink-shape").map((f) => f.line)).toEqual([2])
	})

	test("URL-bearing constructs outside the policy are findings, never skipped; a fragment url() is not one", () => {
		const html = [
			'<iframe srcdoc="<a href=gone.md>x</a>"></iframe>',
			'<object codebase="/x/" data="o.md"></object>',
			'<meta http-equiv="refresh" content="0; url=gone.md">',
			"<div style=\"background: image-set('a.png' 1x)\">d</div>",
			"<style>a { background: url(a\\(b.png) }</style>",
			'<applet code="A.class"></applet><param name="movie" value="m.swf">',
			'<svg><rect fill="url(#grad)"/></svg><meta charset="utf-8">',
		].join("\n")
		const repo = makeRepo({ "docs/eli5.html": html })
		expect(findings(repo, "link-opaque").map((f) => f.line)).toEqual([1, 2, 3, 4, 5, 6, 6])
	})
})

describe("path-token", () => {
	test("a live doc's plan path must resolve at HEAD", () => {
		const repo = makeRepo({
			"README.md": "See implementations-plan/gone/plan.md and implementations-plan/p/plan.md.\n",
			"implementations-plan/p/plan.md": "p\n",
		})
		expect(findings(repo, "path-token").map((f) => `${f.file}:${f.line} ${f.detail}`)).toEqual([
			"README.md:1 implementations-plan/gone/plan.md does not resolve at HEAD",
		])
	})

	test("code may name a plan that now lives under archive/; a live doc may not", () => {
		const repo = makeRepo({
			"src/a.ts": "// see implementations-plan/old/plan.md\n",
			"docs/notes.md": "implementations-plan/old/plan.md\n",
			"implementations-plan/archive/old/plan.md": "old\n",
		})
		expect(findings(repo, "path-token").map((f) => f.file)).toEqual(["docs/notes.md"])
	})

	test("a NUL byte does not hide a file's plan paths", () => {
		const repo = makeRepo({ "README.md": "x\0y\nimplementations-plan/gone/plan.md\n" })
		expect(findings(repo, "path-token").map((f) => f.line)).toEqual([2])
	})

	test("a colon in a file name never hides its plan paths", () => {
		const repo = makeRepo({ "src/a:b.ts": "x\n// implementations-plan/gone/plan.md\r\n" })
		expect(findings(repo, "path-token").map((f) => `${f.file}:${f.line}`)).toEqual(["src/a:b.ts:2"])
	})

	test("a brace token is checked alternative by alternative", () => {
		const repo = makeRepo({ "CLAUDE.md": "implementations-plan/{a,b}/plan.md\n", "implementations-plan/a/plan.md": "a\n" })
		expect(findings(repo, "path-token").map((f) => f.detail)).toEqual(["implementations-plan/b/plan.md does not resolve at HEAD"])
	})
})
