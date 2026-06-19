/**
 * Storybook preview — runs once per story render.
 *
 * Per round-3 audit, primitives in this codebase rely on:
 *   1. Global CSS vars (defined in src/assets/styles/_base.scss + src/popup/index.scss)
 *   2. Pinia stores (some primitives transitively pull stores via composables)
 *   3. Teleport roots in the DOM (Tooltip, DropdownRoot, Popover, ToastManager, Popup)
 *   4. chrome.runtime API (Vitest stubs this at tests/vitest.setup.ts:88-113;
 *      Storybook needs the same stub for L4+ stories that touch service-bound code)
 *
 * This file installs all four, so primitives + composites render
 * faithfully in the sandbox.
 */
import type { Preview } from "@storybook/vue3-vite"
import { setup } from "@storybook/vue3-vite"
import { createPinia } from "pinia"

// (1) Global CSS — same imports as src/popup/index.ts:30-31
import "@nulo/design/base.css"
import "@/popup/index.scss"

const TELEPORT_ROOTS = ["popup", "tooltip", "dropdown", "popover", "toast"] as const

function ensureTeleportRoots() {
	if (typeof document === "undefined") return
	for (const id of TELEPORT_ROOTS) {
		if (!document.getElementById(id)) {
			const el = document.createElement("div")
			el.id = id
			document.body.appendChild(el)
		}
	}
}

// (4) chrome.runtime stub — minimal surface for primitives that may
// transitively reach for it. L4+ stories needing more should mock
// per-story, not globally.
function ensureChromeStub() {
	if (typeof globalThis === "undefined") return
	const g = globalThis as { chrome?: unknown }
	if (g.chrome) return
	g.chrome = {
		runtime: {
			id: "story-stub",
			getURL: (path: string) => path,
			connect: () => ({
				postMessage: () => {},
				onMessage: { addListener: () => {}, removeListener: () => {} },
				onDisconnect: { addListener: () => {}, removeListener: () => {} },
				disconnect: () => {},
			}),
			sendMessage: () => Promise.resolve(),
			onMessage: { addListener: () => {}, removeListener: () => {} },
		},
		storage: {
			local: { get: async () => ({}), set: async () => {} },
			session: { get: async () => ({}), set: async () => {} },
		},
	}
}

// (2) Pinia + (3) teleport roots + (4) chrome stub — installed once
// per Vue app instance via the framework's setup() hook.
setup((app) => {
	app.use(createPinia())
	ensureTeleportRoots()
	ensureChromeStub()
})

const preview: Preview = {
	parameters: {
		controls: {
			matchers: {
				color: /(background|color)$/i,
				date: /Date$/i,
			},
		},
		// Storybook's default canvas is white. The brutalist palette in
		// _base.scss assumes a dark background (--app-bg: #0a0908) — text,
		// spinner color, default icon color all render light-on-light when
		// the canvas is white. Match the app's actual background here.
		// Light theme switching arrives later (see STATUS.md follow-ups).
		backgrounds: {
			default: "app",
			values: [
				{ name: "app", value: "#0a0908" },
				{ name: "light", value: "#f5f5f7" },
			],
		},
	},
	decorators: [
		// Apply --app-bg as the wrapper background. Uses the live CSS var
		// so a future theme switcher (data-theme="light") will track.
		(story) => ({
			components: { story },
			template:
				'<div style="background: var(--app-bg); padding: 24px; min-height: 100vh; color: var(--txt-primary);"><story /></div>',
		}),
	],
}

export default preview
