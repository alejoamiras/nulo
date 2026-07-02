/**
 * Pure extraction of `release.yml`'s `resolve` step (the tag/version/is_prerelease
 * derivation). The git-side checks it pairs with — tag existence (`git rev-parse
 * --verify`) and the commit SHA (`git rev-list -n 1`) — stay in the workflow,
 * since they need the checked-out repo. This module owns only the pure decision:
 * which tag wins, and what version + prerelease-ness it implies.
 *
 * Behavior is byte-for-byte the old bash:
 *   TAG = isPush ? release-please's tag_name : the workflow_dispatch `tag` input
 *   empty TAG  -> hard error (dispatch needs the input; push needs a created release)
 *   VERSION    = TAG without a leading "v"
 *   isPrerelease = VERSION contains "-"  (e.g. 0.24.0-rc, 0.24.0-rc.1)
 */

export interface ResolveTagInput {
	/** true on `push` to main, false on `workflow_dispatch`. */
	isPush: boolean
	/** release-please `tag_name` output (only meaningful on the push path). */
	tagFromPlease: string | undefined
	/** the `tag` workflow_dispatch input (only meaningful on the dispatch path). */
	tagFromInput: string | undefined
}

export interface ResolvedTag {
	/** e.g. `v0.23.0` — exactly as it must exist as a git ref. */
	tag: string
	/** e.g. `0.23.0` — the `v`-stripped version. */
	version: string
	/** true when the version carries a prerelease segment (`-rc`, `-rc.1`, …). */
	isPrerelease: boolean
}

/** The message the old bash printed via `::error::` on an unresolved tag. */
export const NO_TAG_ERROR =
	"no tag resolved — workflow_dispatch requires the 'tag' input (e.g. v0.20.0), and push events need release-please to have created a release."

export function resolveTag(input: ResolveTagInput): ResolvedTag {
	const raw = (input.isPush ? input.tagFromPlease : input.tagFromInput) ?? ""
	const tag = raw.trim()
	if (!tag) throw new Error(NO_TAG_ERROR)
	const version = tag.startsWith("v") ? tag.slice(1) : tag
	const isPrerelease = version.includes("-")
	return { tag, version, isPrerelease }
}
