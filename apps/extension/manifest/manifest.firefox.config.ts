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
// - "sidePanel": Chrome-only; Firefox's equivalent is `sidebar_action`.
//   AMO's validator rejects it outright ("Invalid permissions"). Every
//   call site is already feature-gated on `chrome.sidePanel`, so the
//   panel simply stays absent.
const FIREFOX_INCOMPATIBLE_PERMISSIONS = new Set(["background", "offscreen", "sidePanel"])

// @ts-expect-error ManifestConfig provides all required fields
export default defineManifest((_env) => ({
	...ManifestConfig,
	browser_specific_settings: {
		gecko: {
			// Firefox validates the id shape at install (a GUID in braces or an email-shaped
			// string) and rejects the whole add-on as invalid otherwise. It is the add-on's
			// permanent identity on AMO: never change it once a Firefox build has shipped.
			id: "wallet@nulo.sh",
			// AMO requires every new extension to declare what it collects. The wallet stores
			// keys and settings on the user's own machine and sends nothing anywhere that
			// identifies them; RPC and price queries carry addresses, which Mozilla's schema
			// does not class as collection. Revisit before adding telemetry of any kind.
			data_collection_permissions: {
				required: ["none"],
			},
			// WebAuthn from an extension page — how a passkey profile is created and unlocked —
			// works from Firefox 150. 153 is the floor this wallet is tested against, and it
			// deliberately excludes the 140 ESR line rather than shipping a passkey flow that
			// cannot run there.
			strict_min_version: "153.0",
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
