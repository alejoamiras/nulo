import { describe, expect, it } from "vitest"
import { cfBranchAliasHost, deriveAllowedPreviewHosts } from "./preview-hosts"

describe("cfBranchAliasHost", () => {
	it("matches Cloudflare's observed sanitization: 28-char cap, lowercase, hyphenized", () => {
		// The real case that motivated this: 29-char branch → 28-char alias.
		expect(cfBranchAliasHost("https://4182ff98.nulo-tools-testnet.pages.dev", "worktree-faucet-multi-account")).toBe(
			"worktree-faucet-multi-accoun.nulo-tools-testnet.pages.dev",
		)
	})

	it("hyphenizes non-alphanumeric runs and trims edges + the truncation seam", () => {
		expect(cfBranchAliasHost("https://x.proj.pages.dev", "Feat/Fancy_Branch!!")).toBe("feat-fancy-branch.proj.pages.dev")
		// A hyphen landing exactly at the 28-char cut must not survive as a trailing dash.
		expect(cfBranchAliasHost("https://x.proj.pages.dev", `${"a".repeat(27)}-tail`)).toBe(`${"a".repeat(27)}.proj.pages.dev`)
	})
})

describe("deriveAllowedPreviewHosts", () => {
	const CF = { cfPagesUrl: "https://4182ff98.nulo-tools-testnet.pages.dev", cfBranch: "worktree-faucet-multi-account" }

	it("testnet preview branch: exactly the per-commit host and the branch alias — no wildcards", () => {
		expect(deriveAllowedPreviewHosts({ targetKey: "testnet", ...CF })).toEqual([
			"4182ff98.nulo-tools-testnet.pages.dev",
			"worktree-faucet-multi-accoun.nulo-tools-testnet.pages.dev",
		])
	})

	it("mainnet builds never accept alternate hosts", () => {
		expect(deriveAllowedPreviewHosts({ targetKey: "mainnet", ...CF })).toEqual([])
	})

	it("the production dev branch and non-CF builds bake nothing", () => {
		expect(deriveAllowedPreviewHosts({ targetKey: "testnet", ...CF, cfBranch: "dev" })).toEqual([])
		expect(deriveAllowedPreviewHosts({ targetKey: "testnet", cfPagesUrl: undefined, cfBranch: "x" })).toEqual([])
	})
})
