import { readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import { siteHeaders } from "./scripts/headers"
import { releaseHtmlPlugin } from "./scripts/release-html-plugin"

const here = dirname(fileURLToPath(import.meta.url))

export default defineConfig({
	server: {
		port: 5175,
	},
	preview: {
		// Pages applies public/_headers in production; preview would otherwise run without the CSP.
		headers: siteHeaders(readFileSync(resolve(here, "public/_headers"), "utf8")),
	},
	build: {
		modulePreload: { polyfill: false },
	},
	plugins: [releaseHtmlPlugin()],
})
