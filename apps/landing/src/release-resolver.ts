/**
 * Pure helpers for turning a GitHub /releases/latest API payload into the
 * landing's ReleaseInfo shape (or building the no-release fallback). Kept
 * separate from scripts/fetch-latest-release.ts so it can be unit-tested.
 */

import type { ReleaseInfo } from "./release"

export type GitHubAsset = {
	name: string
	browser_download_url: string
}

export type GitHubReleaseResponse = {
	tag_name: string
	html_url: string
	published_at: string
	assets: GitHubAsset[]
}

export function resolveReleaseInfo(api: GitHubReleaseResponse): ReleaseInfo {
	const version = api.tag_name.replace(/^v/, "")
	const chromeAsset = api.assets.find((a) => /^nulo-chrome-.*\.zip$/.test(a.name))
	if (!chromeAsset) {
		throw new Error(`release ${api.tag_name} has no nulo-chrome-*.zip asset`)
	}
	const shasumsAsset = api.assets.find((a) => a.name === "SHASUMS256.txt")
	return {
		status: "ok",
		version,
		publishedAt: api.published_at,
		chromeZipUrl: chromeAsset.browser_download_url,
		releaseUrl: api.html_url,
		shasumsUrl: shasumsAsset?.browser_download_url ?? api.html_url,
	}
}

export function noReleaseInfo(repo: string): ReleaseInfo {
	return {
		status: "no-release",
		releaseUrl: `https://github.com/${repo}/releases`,
	}
}
