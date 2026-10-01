import { existsSync, readFileSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"
import { siteHeaders } from "./scripts/headers"
import { releaseHtmlPlugin } from "./scripts/release-html-plugin"

const here = dirname(fileURLToPath(import.meta.url))

// Written by scripts/build-legal.ts (predev/prebuild). Read as data: Vite loads this config under
// the ambient Node with workspace imports externalized, where a raw-TypeScript package cannot load.
// Absent only when nothing is being built (`vite preview` over an existing dist); CI asserts that a
// build ships the pages, so a missing list cannot silently drop them.
const legalPagesFile = resolve(here, "src/generated/legal-pages.json")
const legalPages: string[] = existsSync(legalPagesFile) ? JSON.parse(readFileSync(legalPagesFile, "utf8")) : []

export default defineConfig({
	server: {
		port: 5175,
	},
	preview: {
		// Cloudflare applies public/_headers in production; preview would otherwise run without the CSP.
		headers: siteHeaders(readFileSync(resolve(here, "public/_headers"), "utf8")),
	},
	build: {
		modulePreload: { polyfill: false },
		rollupOptions: {
			// Cloudflare serves `terms.html` at `/terms` and `terms/v1.0/index.html` at `/terms/v1.0/`,
			// so extra HTML entries are the whole routing story. scripts/build-legal.ts writes them.
			input: ["index.html", ...legalPages].map((path) => resolve(here, path)),
		},
	},
	plugins: [releaseHtmlPlugin()],
})
