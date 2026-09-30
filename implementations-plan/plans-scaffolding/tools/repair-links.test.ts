import { describe, expect, test } from "bun:test"
import { memView, P } from "./fixture"
import { applyHandFixes, planRepairs, type RepairCtx, repairFile } from "./repair-links"

const before = memView({
	[`${P}/gone/plan.md`]: "",
	[`${P}/gone/x.md`]: "",
	[`${P}/other/plan.md`]: "",
	[`${P}/live/plan.md`]: "",
	[`${P}/index.md`]: "",
	"apps/x.ts": "",
})
const ctx: RepairCtx = { moved: new Set(["gone", "other"]), before }
const MOVED = [`${P}/gone/plan.md`, `${P}/archive/gone/plan.md`] as const

describe("repair-links", () => {
	test("a moved file's links resolve from its old home and point from its new one; code, anchors and URLs stay", () => {
		const src = [
			"[sib](x.md) [dot](./x.md) [idx](../index.md) [other](../other/plan.md#top) [live](../live/plan.md?v=1)",
			"[code](../../apps/x.ts:12) [ext](https://example.com/a) [anchor](#h) <a href='../index.md'>raw</a>",
			"[cite](implementations-plan/other/plan.md:40) [live cite](implementations-plan/live/plan.md:3)",
			"`[span](../index.md)` and `implementations-plan/other/plan.md`",
		].join("\n")
		expect(repairFile(...MOVED, src, ctx)).toBe(
			[
				"[sib](x.md) [dot](./x.md) [idx](../../index.md) [other](../other/plan.md#top) [live](../../live/plan.md?v=1)",
				"[code](../../../apps/x.ts:12) [ext](https://example.com/a) [anchor](#h) <a href='../../index.md'>raw</a>",
				"[cite](implementations-plan/archive/other/plan.md:40) [live cite](implementations-plan/live/plan.md:3)",
				"`[span](../index.md)` and `implementations-plan/other/plan.md`",
			].join("\n"),
		)
	})

	test("a staying doc maps links into moved dirs; live docs map path tokens too, frozen prose and permalinks keep theirs", () => {
		const claude =
			"See [g](implementations-plan/gone/plan.md), `implementations-plan/gone/x.md`, `implementations-plan/live/plan.md`, https://github.com/alejoamiras/nulo/blob/abc/implementations-plan/gone/plan.md.\n"
		expect(repairFile("CLAUDE.md", "CLAUDE.md", claude, ctx)).toBe(
			"See [g](implementations-plan/archive/gone/plan.md), `implementations-plan/archive/gone/x.md`, `implementations-plan/live/plan.md`, https://github.com/alejoamiras/nulo/blob/abc/implementations-plan/gone/plan.md.\n",
		)
		const audit = "Per [the plan](../../implementations-plan/gone/plan.md), `implementations-plan/gone/plan.md`.\n"
		expect(repairFile("audit/x/a.md", "audit/x/a.md", audit, ctx)).toBe(
			"Per [the plan](../../implementations-plan/archive/gone/plan.md), `implementations-plan/gone/plan.md`.\n",
		)
		const lessons = "- A lesson. [Evidence](gone/plan.md), `implementations-plan/other/plan.md`.\n"
		expect(repairFile(`${P}/lessons.md`, `${P}/lessons.md`, lessons, ctx)).toBe(
			"- A lesson. [Evidence](archive/gone/plan.md), `implementations-plan/archive/other/plan.md`.\n",
		)
		expect(repairFile("apps/x.ts", "apps/x.ts", "// implementations-plan/gone/plan.md\n", ctx)).toBe(
			"// implementations-plan/gone/plan.md\n",
		)
		expect(() => repairFile(...MOVED, "[sp](../index%20x.md)\n", ctx)).toThrow("percent-encoded")
	})

	test("a hand fix applies once, is a no-op when applied, and refuses a partial move or a drifted count", () => {
		const release = ["release-prerelease-fix", "required-check-mismatch", "stable-release-0.24.0", "release-pipeline-hardening"]
		const brace =
			"Examples: `implementations-plan/{release-prerelease-fix,required-check-mismatch,stable-release-0.24.0,release-pipeline-hardening}/`.\n"
		const fixed = applyHandFixes("CLAUDE.md", brace, new Set(release))
		expect(fixed).toBe(brace.replace("`implementations-plan/{", "`implementations-plan/archive/{"))
		expect(applyHandFixes("CLAUDE.md", fixed, new Set(release))).toBe(fixed)
		expect(() => applyHandFixes("CLAUDE.md", brace, new Set(release.slice(1)))).toThrow("do not all move")
		const shots = `${P}/ux-feedback/design/shots.mjs`
		const script = [
			"// python3 implementations-plan/ux-feedback/design/mocks/build.py",
			"// node implementations-plan/ux-feedback/design/shots.mjs",
			'const repo = path.resolve(here, "../../..");',
			'run("python3 implementations-plan/ux-feedback/design/mocks/build.py")',
		].join("\n")
		const moved = new Set(["ux-feedback"])
		expect(applyHandFixes(shots, script, moved)).toBe(
			script
				.replaceAll("implementations-plan/ux-feedback/", "implementations-plan/archive/ux-feedback/")
				.replace('"../../.."', '"../../../.."'),
		)
		expect(() => applyHandFixes(shots, `${script}\n// implementations-plan/ux-feedback/design/x`, moved)).toThrow("found 4")
		expect(applyHandFixes(`${P}/ux-feedback/design/mocks/build.py`, "REPO = HERE.resolve().parents[3]\n", moved)).toBe(
			"REPO = HERE.resolve().parents[4]\n",
		)
	})

	test("a moved file is repaired from its text before the move, once, and refused if it changed since", () => {
		const source = "Back to [the index](../index.md).\n"
		const pre = memView({ [`${P}/gone/plan.md`]: source, [`${P}/index.md`]: "" })
		const post = (text: string) => memView({ [`${P}/archive/gone/plan.md`]: text, [`${P}/index.md`]: "" })
		const repaired = "Back to [the index](../../index.md).\n"
		const moved = new Set(["gone"])
		expect([...planRepairs(post(source), pre, moved)]).toEqual([[`${P}/archive/gone/plan.md`, repaired]])
		expect(planRepairs(post(repaired), pre, moved).size).toBe(0)
		expect(() => planRepairs(post("Edited after the move.\n"), pre, moved)).toThrow("changed after its move")
	})
})
