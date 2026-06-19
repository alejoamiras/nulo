/**
 * Storybook 10 — Vue 3 + Vite framework.
 *
 * Stories live colocated next to their SFC: `<Name>.stories.ts` or
 * `<Name>.stories.vue` next to `<Name>.vue`.
 *
 * Preview-time setup (global SCSS, Pinia, teleport roots, chrome stub)
 * lives in `.storybook/preview.ts`.
 */
import type { StorybookConfig } from "@storybook/vue3-vite"
import { fileURLToPath, URL } from "node:url"
import useAutoImport from "unplugin-auto-import/vite"
import useComponents from "unplugin-vue-components/vite"
// Storybook v10's main.ts loader requires explicit .ts extensions on relative imports.
import { nuloDesignResolver } from "../scripts/design-resolver.ts"

const config: StorybookConfig = {
	framework: {
		name: "@storybook/vue3-vite",
		options: {},
	},
	stories: ["../src/components/**/*.stories.@(ts|vue)", "../src/design/**/*.stories.@(ts|vue)"],
	addons: [],
	docs: {
		autodocs: false,
	},
	viteFinal(viteConfig) {
		// Mirror the build's path aliases so stories import like the app does.
		viteConfig.resolve = viteConfig.resolve ?? {}
		viteConfig.resolve.alias = {
			...(viteConfig.resolve.alias ?? {}),
			"@": fileURLToPath(new URL("../src", import.meta.url)),
			"~": fileURLToPath(new URL("../src", import.meta.url)),
		}
		// Mirror __VERSION__ etc. so primitives that read them don't crash.
		viteConfig.define = {
			...(viteConfig.define ?? {}),
			__VERSION__: JSON.stringify("story"),
			__SENTINEL__: JSON.stringify("0"),
			__AZTEC_VERSION__: JSON.stringify("story"),
			__NAME__: JSON.stringify("@nulo/extension"),
			__DISPLAY_NAME__: JSON.stringify("Nulo (story)"),
		}
		// Mirror production auto-import + auto-component registration so
		// SFCs in stories see the same identifier surface as in the app
		// (RouterLink, ref, computed, Spinner, Icon, ...). Without these
		// plugins, Button.vue's <Spinner v-if="loading"> and
		// <Icon :name=...> render as unresolved tags.
		viteConfig.plugins = viteConfig.plugins ?? []
		viteConfig.plugins.push(
			useAutoImport({
				imports: ["vue", "vue-router"],
				dts: false,
			}),
			useComponents({
				dirs: ["../src/components"],
				resolvers: [nuloDesignResolver()],
				dts: false,
			}),
		)
		return viteConfig
	},
}

export default config
