/**
 * Vite plugin: at build start, reads src/generated/release.json (produced by
 * the prebuild step) and rewrites a fixed set of tokens in index.html:
 *
 *   {{chrome_zip_url}}  {{version}}  {{release_url}}  {{shasums_url}}
 *
 * Guardrail: throws if any of those known tokens survive substitution, so we
 * never ship unsubstituted placeholders. Other `{{...}}` strings in the HTML
 * are left untouched (we don't claim ownership of `{{` as a syntax).
 */

import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { Plugin } from "vite"

type ReleaseInfo =
	| {
			status: "ok"
			version: string
			publishedAt: string
			chromeZipUrl: string
			releaseUrl: string
			shasumsUrl: string
	  }
	| {
			status: "no-release"
			releaseUrl: string
	  }

const TOKEN_NAMES = ["chrome_zip_url", "version", "release_url", "shasums_url"] as const

export function releaseHtmlPlugin(): Plugin {
	let info: ReleaseInfo

	return {
		name: "nulo-release-html",
		enforce: "pre",

		buildStart() {
			const here = dirname(fileURLToPath(import.meta.url))
			const path = resolve(here, "../src/generated/release.json")
			info = JSON.parse(readFileSync(path, "utf8")) as ReleaseInfo
		},

		transformIndexHtml(html) {
			const tokens: Record<(typeof TOKEN_NAMES)[number], string> =
				info.status === "ok"
					? {
							chrome_zip_url: info.chromeZipUrl,
							version: info.version,
							release_url: info.releaseUrl,
							shasums_url: info.shasumsUrl,
						}
					: {
							chrome_zip_url: info.releaseUrl,
							version: "",
							release_url: info.releaseUrl,
							shasums_url: info.releaseUrl,
						}

			let out = html
			for (const name of TOKEN_NAMES) {
				out = out.replaceAll(`{{${name}}}`, tokens[name])
			}

			for (const name of TOKEN_NAMES) {
				if (out.includes(`{{${name}}}`)) {
					throw new Error(`releaseHtmlPlugin: unsubstituted token {{${name}}} survived. Check fetch-latest-release.ts output.`)
				}
			}

			return out
		},
	}
}
