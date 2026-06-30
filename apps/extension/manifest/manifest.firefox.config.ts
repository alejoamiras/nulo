import { defineManifest } from "@crxjs/vite-plugin"
import ManifestConfig from "./manifest.config"

// Permissions that don't exist in Firefox MV3:
// - "background": Firefox uses a persistent background page model, not
//   the dedicated MV3 background permission flag.
// - "offscreen": no `chrome.offscreen` API in Firefox MV3. A
//   hidden-minimized-window fallback in `wallet/utils/offscreen.ts`
//   handles it at runtime via `hasOffscreenApi()`. Including the
//   permission would emit a manifest warning at install time without
//   any benefit.
const FIREFOX_INCOMPATIBLE_PERMISSIONS = new Set(["background", "offscreen"])

// @ts-expect-error ManifestConfig provides all required fields
export default defineManifest((_env) => ({
	...ManifestConfig,
	browser_specific_settings: {
		gecko: {
			id: "{}",
		},
	},
	background: {
		scripts: ["src/wallet/index.ts"],
		type: "module",
		persistent: false,
	},
	// @ts-expect-error
	permissions: ManifestConfig.permissions.filter((permission) => !FIREFOX_INCOMPATIBLE_PERMISSIONS.has(permission)),
}))
