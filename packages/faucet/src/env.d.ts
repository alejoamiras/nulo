/// <reference types="vite/client" />

interface ImportMetaEnv {
	readonly VITE_AZTEC_NODE_URL?: string
	readonly VITE_EXPLORER_BASE_URL?: string
	readonly VITE_CHAIN_ID?: string
	readonly VITE_CHAIN_VERSION?: string
	readonly VITE_NULO_INSTALL_URL?: string
}

interface ImportMeta {
	readonly env: ImportMetaEnv
}

declare module "*.vue" {
	import type { DefineComponent } from "vue"
	const component: DefineComponent<object, object, unknown>
	export default component
}
