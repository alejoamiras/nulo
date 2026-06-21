import { crx } from "@crxjs/vite-plugin"
import { mergeConfig } from "vite"
import manifest from "./manifest/manifest.firefox.config"
import viteConfig from "./vite.config"

// `mergeConfig` returns a fresh config (plugins concatenated, `build` merged)
// instead of mutating the shared `viteConfig` singleton in place — so importing
// this wrapper can never leak the crx plugin / outDir into the chrome wrapper.
export default mergeConfig(viteConfig, {
	plugins: [crx({ manifest, browser: "firefox" })],
	build: { outDir: "dist/firefox" },
})
