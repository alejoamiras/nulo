import { defineConfig } from "vite"
import { releaseHtmlPlugin } from "./scripts/release-html-plugin"

export default defineConfig({
	server: {
		port: 5175,
	},
	build: {
		modulePreload: { polyfill: false },
	},
	plugins: [releaseHtmlPlugin()],
})
