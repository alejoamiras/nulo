/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_AZTEC_NODE_URL?: string
	readonly VITE_EXPLORER_BASE_URL?: string
	readonly VITE_NULO_INSTALL_URL?: string
	/** The active build target, `define`d by vite.<target>.config.mts (unset ⇒ testnet fallback). */
	readonly VITE_FAUCET_TARGET?: "testnet" | "mainnet"
	/** The per-target bridge manifest JSON, `define`d at build (unset ⇒ static testnet import). */
	readonly VITE_BRIDGE_MANIFEST_JSON?: string
	/** The EXACT CF Pages preview hostname baked at build (testnet previews only; "" otherwise). */
	readonly VITE_ALLOWED_PREVIEW_HOST?: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}

declare module "*.vue" {
	import type { DefineComponent } from "vue"
	const component: DefineComponent<object, object, unknown>
	export default component
}
