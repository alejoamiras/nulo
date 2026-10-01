import { describe, expect, test } from "bun:test"
import { clip } from "./closed"
import { memView, P, row } from "./fixture"
import { ARCHIVE_HEADER, activeIndex, archiveIndex } from "./split-index"

describe("split-index", () => {
	test("the active index keeps its header and, verbatim, every line the move leaves", () => {
		const src = [
			"# Index",
			"",
			"Format: `- [plan-name](plan-name/plan.md) — status — hook`",
			"",
			"- [a](a/plan.md) — done — a",
			"- [live](live/plan.md) — active — l",
			"",
			"## Old section",
			"",
			"Its paragraph.",
			"",
			"- [b](b/runbook.md) — done — b",
			"  b continued",
			"- a proposal — proposed — p",
			"",
			"## Newer section",
			"",
			"- [newer](newer/plan.md) — active — n",
			"  newer continued",
			"",
		].join("\n")
		expect(activeIndex(src, new Set(["a", "b"]), new Set(["## Old section", "Its paragraph."]))).toBe(
			[
				"# Index",
				"",
				"Format: `- [plan-name](plan-name/plan.md) — status — hook`",
				"",
				"- [live](live/plan.md) — active — l",
				"- a proposal — proposed — p",
				"",
				"## Newer section",
				"",
				"- [newer](newer/plan.md) — active — n",
				"  newer continued",
				"",
			].join("\n"),
		)
	})

	test("an archive line: status softened, date once, PRs, and a balanced hook clipped whole at 200 and linked from archive/", () => {
		const hook = `${"word ".repeat(37)}[x](live/plan.md) tail`
		const rows = [
			row("a", {
				prs: [1, 2],
				hook: "3 phases ✓** (light) — beside [live](live/plan.md) and [b](b/plan.md), `implementations-plan/b`",
			}),
			row("b", {
				status: "historical — pre-open-source import (2026-05-19)",
				date: "2026-05-19",
				outcomeFile: `${P}/b/README.md`,
				hook,
			}),
		]
		const text = archiveIndex(
			rows.map((r) => ({ row: r, at: `${P}/archive/${r.dir}` })),
			{ moved: new Set(["a", "b"]), before: memView({}) },
		)
		expect(text).toBe(
			[
				...ARCHIVE_HEADER,
				"",
				"- [a](a/plan.md) — completed 2026-09-01 (#1, #2) — 3 phases ✓ (light) — beside [live](../live/plan.md) and [b](b/plan.md), `implementations-plan/archive/b`",
				`- [b](b/README.md) — historical, pre-open-source import (2026-05-19) — ${Array(37).fill("word").join(" ")}…`,
				"",
			].join("\n"),
		)
		expect(clip("alpha beta gamma", 13)).toBe("alpha beta…")
		expect(clip("aaa [two words](x) b", 12)).toBe("aaa…")
	})
})
