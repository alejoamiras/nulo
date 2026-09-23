import { crx } from "@crxjs/vite-plugin"
import { thirdPartyNotices } from "@nulo/third-party-notices"
import { mergeConfig } from "vite"
import manifest from "./manifest/manifest.firefox.config"
import viteConfig from "./vite.config"

// Registered here, not in the shared config: Storybook and vitest load that one too, and the
// notices policy describes the shipped extension only. Worker bundles are separate builds the
// main plugin list never sees, hence the second registration.
const notices = thirdPartyNotices()

// `mergeConfig` returns a fresh config (plugins concatenated, `build` merged)
// instead of mutating the shared `viteConfig` singleton in place — so importing
// this wrapper can never leak the crx plugin / outDir into the chrome wrapper.
export default mergeConfig(viteConfig, {
	plugins: [crx({ manifest, browser: "firefox" }), notices.main],
	worker: { plugins: () => [notices.worker] },
	build: { outDir: "dist/firefox" },
})
