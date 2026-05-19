#!/usr/bin/env bun
/**
 * Build-time fetch: writes src/generated/release.json with the latest stable
 * release's Chrome zip URL + version, or a `no-release` fallback if no
 * release is published yet.
 *
 * Runs as `prebuild` automatically when `bun run build` executes. Also runs
 * in Cloudflare Pages' build environment on every push.
 */

import { writeFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { type GitHubReleaseResponse, noReleaseInfo, resolveReleaseInfo } from "../src/release-resolver"

const repo = process.env.GITHUB_REPOSITORY || "alejoamiras/nulo"
const apiUrl = `https://api.github.com/repos/${repo}/releases/latest`

const here = dirname(fileURLToPath(import.meta.url))
const outPath = resolve(here, "../src/generated/release.json")

const headers: Record<string, string> = {
	"User-Agent": "nulo-landing-build",
	Accept: "application/vnd.github+json",
}
if (process.env.GITHUB_TOKEN) {
	headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`
}

const res = await fetch(apiUrl, { headers })

function writeJson(value: unknown): void {
	writeFileSync(outPath, `${JSON.stringify(value, null, 2)}\n`)
}

if (res.status === 404) {
	writeJson(noReleaseInfo(repo))
	console.log(`[fetch-latest-release] no stable release published yet (${repo})`)
	process.exit(0)
}

if (!res.ok) {
	console.error(`[fetch-latest-release] GitHub API ${res.status} ${res.statusText} for ${apiUrl}`)
	process.exit(1)
}

const api = (await res.json()) as GitHubReleaseResponse
const info = resolveReleaseInfo(api)
writeJson(info)
console.log(`[fetch-latest-release] wrote release.json for v${info.status === "ok" ? info.version : "?"}`)
