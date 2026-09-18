/**
 * The PR "preview build" comment: one sticky comment per PR (found by a hidden marker, edited in
 * place on every push) pointing at the extension builds `pr-quick.yml` already uploads as workflow
 * artifacts. The comment is the only thing that makes those artifacts discoverable — GitHub buries
 * them in the run's Summary page. Rendering is pure; the upsert shells out to `gh api`.
 *
 * A build's result is rendered per target. A skipped Firefox build is normal (its job only runs when
 * the diff touches Firefox-relevant files), so a skipped target reads as "not built for this
 * change", never as an error; a failed build still updates the comment so a stale link from a
 * previous push cannot pass for the current head.
 */

import { $ } from "bun"

export const PREVIEW_COMMENT_MARKER = "<!-- nulo-extension-preview -->"

export type BuildResult = "success" | "failure" | "cancelled" | "skipped"

export interface PreviewTarget {
	name: "Chrome" | "Firefox"
	result: BuildResult
	/** The artifact download URL (empty unless the build succeeded and uploaded). */
	url: string
}

export interface PreviewCommentInput {
	headSha: string
	version: string
	runUrl: string
	targets: PreviewTarget[]
}

function targetLine(t: PreviewTarget): string {
	switch (t.result) {
		case "success":
			return t.url ? `- **${t.name}**: [download](${t.url})` : `- **${t.name}**: built, but the artifact URL is missing`
		case "skipped":
			return `- **${t.name}**: not built for this change`
		default:
			return `- **${t.name}**: build ${t.result}`
	}
}

export function renderPreviewComment(input: PreviewCommentInput): string {
	const short = input.headSha.slice(0, 7)
	return [
		PREVIEW_COMMENT_MARKER,
		`### Extension preview build — \`${short}\``,
		"",
		`Version \`${input.version}\` · [workflow run](${input.runUrl}) · artifacts expire after 7 days.`,
		"",
		...input.targets.map(targetLine),
		"",
		"<details><summary>Load it</summary>",
		"",
		"1. Download and unzip (GitHub wraps the `dist/` folder in a zip).",
		"2. Chrome: `chrome://extensions` → Developer mode → **Load unpacked** → pick the unzipped folder.",
		"   Firefox: `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on…** → pick `manifest.json`.",
		"",
		"</details>",
	].join("\n")
}

/** Parses a job result as GitHub exposes it (`needs.<job>.result`); anything unknown is "skipped". */
export function parseBuildResult(value: string | undefined): BuildResult {
	return value === "success" || value === "failure" || value === "cancelled" ? value : "skipped"
}

/** The login GitHub gives comments posted with the workflow token. */
export const WORKFLOW_BOT_LOGIN = "github-actions[bot]"

export interface IssueComment {
	id: number
	body: string
	user: { login: string }
}

/** The comment to edit: the marker alone is spoofable by any commenter, so the author must be the
 *  workflow bot too — otherwise a planted marker would make the job try to edit a stranger's
 *  comment (and fail, or worse, succeed for an admin token). */
export function selectPreviewComment(comments: IssueComment[]): number | null {
	return comments.find((c) => c.user.login === WORKFLOW_BOT_LOGIN && c.body.startsWith(PREVIEW_COMMENT_MARKER))?.id ?? null
}

async function findExistingComment(repo: string, prNumber: number): Promise<number | null> {
	const out = await $`gh api ${`repos/${repo}/issues/${prNumber}/comments?per_page=100`} --paginate --slurp`.nothrow().quiet()
	if (out.exitCode !== 0) throw new Error(`gh api comments failed: ${out.stderr.toString()}`)
	// `--slurp` wraps the pages in an array of arrays.
	const pages = JSON.parse(out.stdout.toString()) as IssueComment[][]
	return selectPreviewComment(pages.flat())
}

/** The PR's live head. The job runs after minute-long builds; a push in between makes this run's
 *  links describe a superseded head, and the run that describes the new one may already have
 *  written — so a stale run must not overwrite it. */
async function liveHeadSha(repo: string, prNumber: number): Promise<string> {
	const out = await $`gh api ${`repos/${repo}/pulls/${prNumber}`} --jq .head.sha`.nothrow().quiet()
	if (out.exitCode !== 0) throw new Error(`gh api pull failed: ${out.stderr.toString()}`)
	return out.stdout.toString().trim()
}

/** Create the comment or edit the existing one in place; a run whose head the PR has moved past
 *  leaves the comment alone. */
export async function upsertPreviewComment(
	repo: string,
	prNumber: number,
	headSha: string,
	body: string,
): Promise<"created" | "updated" | "stale"> {
	const live = await liveHeadSha(repo, prNumber)
	if (live !== headSha) return "stale"
	const existing = await findExistingComment(repo, prNumber)
	const res = existing
		? await $`gh api -X PATCH ${`repos/${repo}/issues/comments/${existing}`} -f body=${body}`.nothrow().quiet()
		: await $`gh api -X POST ${`repos/${repo}/issues/${prNumber}/comments`} -f body=${body}`.nothrow().quiet()
	if (res.exitCode !== 0) throw new Error(`gh api comment ${existing ? "update" : "create"} failed: ${res.stderr.toString()}`)
	return existing ? "updated" : "created"
}

if (import.meta.main) {
	const env = (name: string) => {
		const v = process.env[name]
		if (v === undefined) throw new Error(`missing env ${name}`)
		return v
	}
	const body = renderPreviewComment({
		headSha: env("HEAD_SHA"),
		version: env("PREVIEW_VERSION"),
		runUrl: env("RUN_URL"),
		targets: [
			{ name: "Chrome", result: parseBuildResult(process.env.CHROME_RESULT), url: process.env.CHROME_URL ?? "" },
			{ name: "Firefox", result: parseBuildResult(process.env.FIREFOX_RESULT), url: process.env.FIREFOX_URL ?? "" },
		],
	})
	const action = await upsertPreviewComment(env("REPO"), Number(env("PR_NUMBER")), env("HEAD_SHA"), body)
	console.log(action === "stale" ? `PR #${env("PR_NUMBER")} head moved past ${env("HEAD_SHA")}; comment left alone` : `preview comment ${action} on #${env("PR_NUMBER")}`)
}
