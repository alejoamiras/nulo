/**
 * Ambient declaration for `.vue` Single File Components.
 *
 * Required because vue-tsc can only emit types for SFCs that use
 * `<script setup lang="ts">`. Plain `<script setup>` SFCs (no lang
 * attribute) have no inferred type, so TS consumers importing them
 * trigger `TS7016: Could not find a declaration file for module`.
 *
 * This shim gives them a structural `DefineComponent<{}, {}, any>`
 * fallback, matching the shape the Vue tooling generates for typed
 * SFCs. Only kicks in when no per-file `.vue.d.ts` exists (e.g. when
 * vue-tsc has already emitted proper types for a `lang="ts"` SFC).
 */

declare module "*.vue" {
	import type { DefineComponent } from "vue"
	// biome-ignore lint/complexity/noBannedTypes: shim only — Vue tooling generates the same signature
	// biome-ignore lint/suspicious/noExplicitAny: shim only — Vue tooling generates `any` for the third generic
	const component: DefineComponent<{}, {}, any>
	export default component
}
