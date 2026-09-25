import { afterAll, describe, expect, test } from "bun:test"
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
		expect(pathTokens("see implementations-plan/{a,b}/plan.md, implementations-plan/<plan>/x and implementations-plan/**.")).toEqual([
			"implementations-plan/a/plan.md",
			"implementations-plan/b/plan.md",
		])
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

	test("a brace token is checked alternative by alternative", () => {
		const repo = makeRepo({ "CLAUDE.md": "implementations-plan/{a,b}/plan.md\n", "implementations-plan/a/plan.md": "a\n" })
		expect(findings(repo, "path-token").map((f) => f.detail)).toEqual(["implementations-plan/b/plan.md does not resolve at HEAD"])
	})
})
