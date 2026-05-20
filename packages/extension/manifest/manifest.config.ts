import type { ManifestV3Export } from "@crxjs/vite-plugin"
import packageJson from "../package.json"

const { version, name, description, displayName } = packageJson

// Map the package.json semver onto Chrome's 4-int manifest version. Strip every
// non-digit, non-dot character (e.g. "0.15.0-rc.1" → "0.15.0.1") and split on
// "." only. Anything beyond four parts is discarded; missing parts default to 0.
// Verified against `0.14.9`, `0.15.0`, `0.15.0-rc.1`, `1.0.0-beta.3` — all
// produce Chrome-installable strings. The original `version` is preserved in
// `version_name` below for the UI string Chrome shows users.
const [major = "0", minor = "0", patch = "0", label = "0"] = version.replace(/[^\d.]+/g, "").split(".")

export default {
	name: displayName || name,
	description,
	version: `${major}.${minor}.${patch}.${label}`,
	version_name: version,
	manifest_version: 3,
	host_permissions: ["https://nulo.sh/", "http://127.0.0.1/*"],
	action: {
		default_popup: "src/popup/index.html#/popup/general",
	},
	background: {
		service_worker: "src/wallet/index.ts",
		type: "module",
	},
	side_panel: {
		default_path: "src/popup/index.html",
	},
	content_scripts: [
		{
			all_frames: true,
			js: ["src/content-script/content.ts"],
			matches: ["*://*/*"],
			run_at: "document_start",
		},
	],
	permissions: ["alarms", "offscreen", "storage", "sidePanel", "unlimitedStorage"],
	optional_permissions: ["downloads"],
	content_security_policy: {
		extension_pages: "script-src 'self' 'wasm-unsafe-eval'",
	},
	cross_origin_embedder_policy: {
		value: "require-corp",
	},
	cross_origin_opener_policy: {
		value: "same-origin",
	},
	icons: {
		16: "src/assets/logo.png",
		24: "src/assets/logo.png",
		32: "src/assets/logo.png",
		128: "src/assets/logo.png",
	},
	web_accessible_resources: [
		{
			matches: ["*://*/*"],
			resources: ["src/assets/logo.png"],
		},
	],
} as ManifestV3Export
