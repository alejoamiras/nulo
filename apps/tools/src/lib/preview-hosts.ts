/**
 * Cloudflare Pages preview hostnames for the build-integrity hostname layer (Layer 5,
 * tools-two-network). A PR preview is a PROD build served at TWO hostnames: the per-commit
 * `<hash>.<project>.pages.dev` (CF_PAGES_URL) and the branch alias
 * `<sanitized-branch>.<project>.pages.dev`. Both are baked as EXACT strings — the layer's
 * no-wildcard stance (codex bug-bash r1, tools-two-network) is unchanged: an arbitrary
 * `*.pages.dev` host still refuses to load.
 *
 * Pure + node-free so the derivation is unit-testable; consumed by vite.config.ts at build time.
 */

/** CF's branch-alias sanitization: lowercase, non-alphanumeric runs → "-", trimmed, capped at
 *  28 chars with no trailing hyphen. Must track Cloudflare's observed behavior — a drift here
 *  bakes a wrong alias and the guard (correctly) refuses the branch URL. */
export function cfBranchAliasHost(pagesUrl: string, branch: string): string {
	const projectDomain = new URL(pagesUrl).hostname.split(".").slice(1).join(".")
	const alias = branch
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 28)
		.replace(/-+$/g, "")
	return `${alias}.${projectDomain}`
}

/** The exact allowed preview hostnames for this build, or [] when previews don't apply
 *  (non-testnet target, no CF env, or the production `dev` branch — mainnet artifacts never
 *  accept an alternate host). */
export function deriveAllowedPreviewHosts(opts: {
	targetKey: string
	cfPagesUrl: string | undefined
	cfBranch: string | undefined
}): string[] {
	const { targetKey, cfPagesUrl, cfBranch } = opts
	if (targetKey !== "testnet" || !cfPagesUrl || !cfBranch || cfBranch === "dev") return []
	return [new URL(cfPagesUrl).hostname, cfBranchAliasHost(cfPagesUrl, cfBranch)]
}
