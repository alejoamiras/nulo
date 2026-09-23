// Modified from Azguard Wallet (https://github.com/AzguardWallet/azguard-wallet), Copyright 2026 BB Strategy Pte. Ltd., Apache-2.0.
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
	// Presto: HTTPS is the proving transport; plain HTTP carries only the witness-free health
	// diagnostic and the headless CI server. Holding both keeps extension pages out of Chrome's
	// local-network-access prompt.
	host_permissions: ["https://passkey.nulo.sh/", "https://127.0.0.1/*", "http://127.0.0.1/*"],
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
			// The passkey Relying Party host and its descendants must carry no script at all,
			// the wallet's own included: any script there could run the PRF ceremony.
			exclude_matches: ["*://passkey.nulo.sh/*", "*://*.passkey.nulo.sh/*"],
			run_at: "document_start",
		},
	],
	permissions: ["alarms", "offscreen", "storage", "sidePanel", "unlimitedStorage", "downloads"],
	content_security_policy: {
		extension_pages: "script-src 'self' 'wasm-unsafe-eval'; img-src 'self' data: blob:",
	},
	cross_origin_embedder_policy: {
		value: "require-corp",
	},
	cross_origin_opener_policy: {
		value: "same-origin",
	},
	// Generated from src/assets/logo.png by scripts/store-icons.ts; `--check` fails on drift.
	icons: {
		16: "src/assets/icons/16.png",
		32: "src/assets/icons/32.png",
		48: "src/assets/icons/48.png",
		96: "src/assets/icons/96.png",
		128: "src/assets/icons/128.png",
	},
} as ManifestV3Export
