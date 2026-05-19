/**
 * Typed accessor for the build-time release info. The JSON is produced by
 * scripts/fetch-latest-release.ts during `prebuild`. If it's missing at
 * import time, the build is broken — fail loud rather than mask.
 */

import releaseInfoJson from "./generated/release.json"

export type ReleaseInfo =
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

export const releaseInfo = releaseInfoJson as ReleaseInfo
