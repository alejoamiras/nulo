<script setup lang="ts">
import { computed, type PropType, useCssModule } from "vue"
import Icon from "../core/Icon.vue"
import Spinner from "./Spinner.vue"
import type { TextColorName } from "../color-names"

defineEmits(["onKeybind"])
const props = defineProps({
	size: {
		type: String as PropType<"large" | "medium" | "small" | "mini" | "dynamic" | "micro">,
		default: "medium",
	},
	/**
	 * Visual variant.
	 *   primary             — solid accent (default)
	 *   primary_outline     — transparent + brutalist 2px outline
	 *   secondary           — solid surface chip
	 *   ghost               — transparent text-only
	 *   text                — link-styled inline text button
	 *   cta                 — full-width brutalist big CTA
	 *   cta_outline         — outline-style CTA (transparent + outline)
	 *   cta_destructive     — red-bg CTA (destructive action confirmation)
	 */
	variant: {
		type: String as PropType<
			"primary" | "primary_outline" | "secondary" | "ghost" | "text" | "cta" | "cta_outline" | "cta_destructive"
		>,
		default: "primary",
	},
	wide: {
		type: Boolean,
		default: false,
	},
	disabled: {
		type: Boolean,
	},
	loading: {
		type: Boolean,
	},
	// Closed anchor mode: `tag="a"` renders a styled <a href> — NOT an arbitrary component constructor
	// (a wallet primitive must not accept one). Router links are wired by the extension wrapper via
	// RouterLink custom → tag="a"; the faucet uses the default <button>.
	tag: {
		type: String as PropType<"button" | "a">,
		default: "button",
	},
	href: {
		type: String,
		required: false,
	},
	target: {
		type: String,
		required: false,
	},
	leftIcon: {
		type: String,
		required: false,
	},
	leftIconColor: {
		type: String as PropType<TextColorName>,
		required: false,
	},
	rightIcon: {
		type: String,
		required: false,
	},
	rightIconColor: {
		type: String as PropType<TextColorName>,
		required: false,
	},
})

const style = useCssModule()

const getStyles = () => {
	const hasCorrectSize = ["large", "medium", "small", "mini", "dynamic", "micro"].includes(props.size)

	return [
		style.wrapper,
		style[props.variant],
		props.wide && style.wide,
		hasCorrectSize && style[props.size],
		props.disabled && style.disabled,
	]
}

// rel hygiene on anchors that open/reuse a SEPARATE browsing context (reverse-tabnabbing
// protection). _self/_parent/_top reuse an existing context — no new window.opener to leak. _blank
// AND any named target are opener-capable, so both get noopener noreferrer. Modern browsers default
// _blank to noopener, but named targets do NOT — the primitive hardens both rather than trusting the UA.
const rel = computed(() => {
	if (props.tag !== "a" || !props.target) return undefined
	const reusesContext = props.target === "_self" || props.target === "_parent" || props.target === "_top"
	return reusesContext ? undefined : "noopener noreferrer"
})
</script>

<template>
	<component
		:is="tag"
		v-bind="tag === 'a' ? { href, target, rel } : null"
		:tabindex="disabled ? -1 : 0"
		:disabled="tag === 'button' && disabled ? true : null"
		:aria-busy="loading || undefined"
		:class="[...getStyles(), loading && $style.loading]"
	>
		<!--
			Spinner + Icon inherit the button's `color` property via
			currentColor / Icon's no-color default. This makes loading +
			icon visuals adapt automatically to each variant's foreground
			(e.g., dark on .primary's light bg; light on .secondary's
			dark bg). Callers can still override with leftIconColor /
			rightIconColor when a specific brand color is needed.
		-->
		<Spinner v-if="loading" color="currentColor" />
		<Icon
			v-if="leftIcon"
			:name="leftIcon"
			size="16"
			:color="leftIconColor"
			:class="$style.left_icon"
		/>
		<slot />
		<Icon
			v-if="rightIcon"
			:name="rightIcon"
			size="16"
			:color="rightIconColor"
			:class="$style.right_icon"
		/>
	</component>
</template>

<style module>
.wrapper {
	position: relative;

	overflow: hidden;

	display: flex;
	align-items: center;
	justify-content: center;
	gap: 10px;

	cursor: pointer;
	box-sizing: border-box;
	user-select: none;

	background-clip: padding-box !important;

	color: var(--txt-primary);
	font-weight: 600;
	white-space: nowrap;

	transition: all 0.2s ease;
}

.wrapper.loading {
	opacity: 0.8;
	pointer-events: none;
}

.wrapper.wide {
	width: 100%;
	justify-content: center;
}

/* Keyboard-only focus indicator. Only fires for keyboard navigation
 * (Tab / arrow keys) — mouse clicks don't trigger :focus-visible, so
 * mouse users see no change. Brutalist 2px outline in the brand accent. */
.wrapper:focus-visible {
	outline: 2px solid var(--nulo-accent);
	outline-offset: 2px;
}

/** SIZES */
.wrapper.dynamic {
	height: initial;
	border-radius: 0;
	padding: 10px 0;
}

.wrapper.large {
	height: 48px;
	font-size: 14px;
	line-height: 1;
	border-radius: 0;
	letter-spacing: 0.05em;
	padding: 0 16px;
}

.wrapper.medium {
	min-height: 40px;
	gap: 8px;
	font-size: 13px;
	border-radius: 0;
	padding: 0 14px;
	letter-spacing: 0.03em;
}

.wrapper.small {
	height: 32px;
	gap: 6px;
	border-radius: 0;
	padding: 0 12px;
}

.wrapper.mini {
	height: 26px;
	gap: 6px;
	border-radius: 0;
	font-size: 12px;
	padding: 0 10px;
}

.wrapper.micro {
	height: 20px;
	gap: 6px;
	border-radius: 0;
	font-size: 11px;
	padding: 0 8px;
}

/** VARIANTS */
.wrapper.primary {
	background: var(--nulo-accent);
	color: var(--txt-inverse);
	fill: var(--txt-inverse);
	font-family: var(--font-headline);
	font-weight: 700;
	text-transform: uppercase;
}
.wrapper.primary:hover:not(.disabled):not(.loading) {
	background: color-mix(in srgb, var(--nulo-accent), var(--txt-primary) 18%);
}
.wrapper.primary:active:not(.disabled):not(.loading) {
	transform: scale(0.98);
}

/** Brutalist outlined variant — same typographic weight as primary
 *  (font-headline + uppercase) but transparent bg with a 2px architectural
 *  edge. Used for second-tier actions where a soft --nulo-surface-high
 *  chip would fight the brutalist CTA language. */
.wrapper.primary_outline {
	background: transparent;
	color: var(--txt-primary);
	fill: var(--txt-primary);
	font-family: var(--font-headline);
	font-weight: 700;
	text-transform: uppercase;
	border: 2px solid var(--nulo-outline);
}
.wrapper.primary_outline:hover:not(.disabled):not(.loading) {
	background: var(--nulo-surface-low);
}
.wrapper.primary_outline:active:not(.disabled):not(.loading) {
	background: var(--nulo-surface-high);
}

.wrapper.secondary {
	background: var(--nulo-surface-high);
	color: var(--txt-primary);
}
.wrapper.secondary:hover:not(.disabled):not(.loading) {
	background: var(--nulo-surface-highest);
}
.wrapper.secondary:active:not(.disabled):not(.loading) {
	background: var(--nulo-surface-low);
}

/** Brutalist text-only style, "ghost" naming used across the design
 *  system. Transparent background, light hover surface. */
.wrapper.ghost {
	background: transparent;
	color: var(--txt-primary);
}
.wrapper.ghost:hover:not(.disabled):not(.loading) {
	background: var(--nulo-surface-low);
}
.wrapper.ghost:active:not(.disabled):not(.loading) {
	background: var(--nulo-surface-high);
}

.wrapper.text {
	height: initial;
	color: var(--nulo-accent);
	background: transparent;
	padding: 0;

	transition: color 0.2s ease;
}
.wrapper.text:hover {
	color: var(--txt-primary);
}
.wrapper.text.small {
	font-size: 12px;
	line-height: 1;
}

/** Shared CTA typography contract — ONE source for all three variants
 *  (a CTA-wide tracking/size/height change is a single edit; a fourth
 *  variant inherits it by joining this selector list). Variants below
 *  keep only their colors, border, and interaction states. */
.wrapper.cta,
.wrapper.cta_outline,
.wrapper.cta_destructive {
	width: 100%;
	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 14px;
	letter-spacing: 0.2em;
	text-transform: uppercase;
	padding: 20px 0;
}

/** CTA — full-width brutalist call-to-action for primary page-level
 *  submits (Continue, Decrypt Backup, Import, Confirm). */
.wrapper.cta {
	background: var(--nulo-accent);
	color: var(--txt-inverse);
	fill: var(--txt-inverse);
	border: none;
}
.wrapper.cta:hover:not(.disabled):not(.loading) {
	background: color-mix(in srgb, var(--nulo-accent), var(--txt-primary) 18%);
}
.wrapper.cta:active:not(.disabled):not(.loading) {
	background: var(--txt-primary);
	color: var(--app-bg);
	transition: none;
}

/** Outlined CTA flavor — transparent + nulo-outline border + secondary
 *  text. Used as a Cancel / Back partner to a primary CTA. */
.wrapper.cta_outline {
	background: transparent;
	color: var(--nulo-secondary);
	fill: var(--nulo-secondary);
	border: 1px solid var(--nulo-outline);
}
.wrapper.cta_outline:hover:not(.disabled):not(.loading) {
	background: var(--nulo-surface-low);
	color: var(--txt-primary);
	border-color: var(--nulo-secondary);
}

/** Destructive CTA flavor — red bg + white text. Reserved for
 *  irreversible actions (Delete Profile, Wipe Wallet). */
.wrapper.cta_destructive {
	background: var(--red);
	color: var(--txt-white);
	fill: var(--txt-white);
	border: none;
}
.wrapper.cta_destructive:hover:not(.disabled):not(.loading) {
	opacity: 0.9;
}

/** OTHER */
.wrapper.disabled {
	pointer-events: none;
	opacity: 0.3;
}

/* A running submit is its own state, not "invalid form": while loading, keep
 * the brighter loading treatment so the spinner carries the message — the 0.3
 * disabled dim stays reserved for genuinely unavailable controls. */
.wrapper.disabled.loading {
	opacity: 0.8;
}

.left_icon {
	position: absolute;
	top: 50%;
	left: 8px;
	transform: translateY(-50%);
}

.right_icon {
	position: absolute;
	top: 50%;
	right: 8px;
	transform: translateY(-50%);
}

.wrapper.medium {
	& .left_icon {
		left: 12px;
	}

	& .right_icon {
		right: 12px;
	}
}
</style>
