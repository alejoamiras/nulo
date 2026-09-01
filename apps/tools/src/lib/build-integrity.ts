import { MANIFEST_CHAIN } from "@/contracts/bridge-deployments"
import { type ToolsTarget, resolveToolsTarget } from "./network-targets"

export interface ManifestChainIdentity {
	l1ChainId?: number
	walletChainId?: number
}

/**
 * The pure integrity check — returns a human error string, or `null` when the build is coherent. Kept
 * side-effect-free (no module state, no `window`) so it's exhaustively unit-testable.
 *
 * Two of the five fail-closed layers live here:
 *  - Layer 5 (hostname↔target): a build served at the wrong host is internally consistent (it passes
 *    the chain layers) but must NOT run. PROD-only — dev/preview/e2e legitimately run on localhost.
 *  - Layer 2 sync half (target↔manifest): the bundled manifest MUST self-declare its chain and match
 *    the build target, else a wrong-manifest build shipped. (The async manifest↔node half is
 *    `assertNodeChainMatches`, run after the node handshake.)
 */
export function checkBuildIntegrity(
	target: Pick<ToolsTarget, "key" | "l1ChainId" | "walletChainId" | "host">,
	manifest: ManifestChainIdentity,
	opts: { hostname: string; isProd: boolean; allowedPreviewHosts?: readonly string[] },
): string | null {
	// A Cloudflare PR preview is a PROD build at its EXACT baked preview hostnames (the per-commit
	// CF_PAGES_URL host + the branch alias, derived at build time — never a wildcard, and never
	// baked into mainnet builds; see makeToolsConfig / preview-hosts.ts).
	const hostOk = opts.hostname === target.host || (opts.allowedPreviewHosts?.includes(opts.hostname) ?? false)
	if (opts.isProd && !hostOk) {
		return `hostname ${opts.hostname} != ${target.key} target host ${target.host} (mis-hosted build)`
	}
	if (manifest.l1ChainId === undefined || manifest.walletChainId === undefined) {
		return "bundled manifest is missing l1ChainId/walletChainId — cannot verify chain identity"
	}
	if (manifest.walletChainId !== target.walletChainId || manifest.l1ChainId !== target.l1ChainId) {
		return (
			`bundled manifest chain (l1=${manifest.l1ChainId}, wallet=${manifest.walletChainId}) != ` +
			`${target.key} target (l1=${target.l1ChainId}, wallet=${target.walletChainId})`
		)
	}
	return null
}

/** Fail-closed gate called before mount — throws (app refuses to render) on any mismatch. */
export function assertBuildIntegrity(hostname: string = typeof window !== "undefined" ? window.location.hostname : ""): void {
	const err = checkBuildIntegrity(resolveToolsTarget(), MANIFEST_CHAIN, {
		hostname,
		isProd: import.meta.env.PROD,
		allowedPreviewHosts: (import.meta.env.VITE_ALLOWED_PREVIEW_HOSTS || "").split(",").filter(Boolean),
	})
	if (err) throw new Error(`build integrity check failed — refusing to load: ${err}`)
}

/** Layer 2 async half — call after the node handshake with the node's derived wallet chain id. */
export function assertNodeChainMatches(nodeWalletChainId: number): void {
	const target = resolveToolsTarget()
	if (nodeWalletChainId !== target.walletChainId) {
		throw new Error(
			`build integrity check failed — live node chain ${nodeWalletChainId} != ${target.key} target ${target.walletChainId}`,
		)
	}
}
