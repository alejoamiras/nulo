<script setup lang="ts">
import { computed, type CSSProperties } from "vue"

import iconsJson from "../internal/icons.json"

type IconPath = { path: string; opacity?: number; color?: string }
const icons = iconsJson as Record<string, string | IconPath[]>

const props = defineProps({
	name: { type: String, required: true, default: "warning" },
	size: { type: [String, Number], default: "16" },
	color: { type: String, default: null },
	hoverColor: { type: String, required: false },
	rotate: { type: [String, Number], default: 0 },
	fill: { type: Boolean, default: false },
	scale: { type: [String, Number], default: 1 },
	loading: { type: Boolean, default: false },
})

const styles = computed<CSSProperties>(() => {
	const s: CSSProperties = {
		minWidth: `${props.size}px`,
		minHeight: `${props.size}px`,
		transformBox: "view-box",
		transformOrigin: "center center",
		transform: "",
	}

	const ops: string[] = []
	if (props.rotate) ops.push(`rotate(${props.rotate}deg)`)
	if (props.scale !== 1) ops.push(`scale(${props.scale})`)
	if (ops.length) s.transform = ops.join(" ")

	// When no `color` prop is set, default fill to currentColor so the icon inherits the parent's
	// text color. Callers needing a brand color pass color="primary" etc. → the .fill--* class (base.css).
	if (!props.color) s.fill = "currentColor"

	return s
})

const classes = computed(() => {
	const iconClasses: string[] = []
	if (props.color) iconClasses.push(`fill--${props.color}`)
	return iconClasses
})

const hoverColorVar = computed(() => `var(--txt-${props.hoverColor})`)

const iconData = computed(() => icons[props.name.charAt(0).toLowerCase() + props.name.slice(1)])
const singlePath = computed(() => (typeof iconData.value === "string" ? iconData.value : ""))
const multiPath = computed(() => (Array.isArray(iconData.value) ? iconData.value : []))
</script>

<template>
	<svg
		viewBox="0 0 24 24"
		:width="size"
		:height="size"
		:style="styles"
		:class="[...classes, props.hoverColor && $style.hovered, loading && $style.loading]"
		role="img"
	>
		<path v-if="!Array.isArray(iconData)" :d="singlePath" />
		<template v-else>
			<path
				v-for="(icon, i) in multiPath"
				:key="i"
				:d="icon.path"
				:style="{ opacity: fill ? 1 : icon.opacity, fill: icon.color && icon.color }"
			/>
		</template>
	</svg>
</template>

<style module>
.hovered {
	transition: all 0.3s var(--bezier);

	&:hover {
		fill: v-bind(hoverColorVar);
	}
}

.loading {
	animation: skeleton 1s ease-in-out infinite;
}

@keyframes skeleton {
	0% {
		opacity: 1;
	}

	50% {
		opacity: 0.5;
	}

	100% {
		opacity: 1;
	}
}
</style>
