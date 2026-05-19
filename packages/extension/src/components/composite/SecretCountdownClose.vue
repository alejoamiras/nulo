<script setup>
/**
 * Close button with optional countdown progress overlay + "Disable
 * auto-close" ghost link. Used by the export pages (key.vue + seed.vue)
 * after the secret is revealed; the absolutely-positioned progress bar
 * is the reason the underlying element stays a raw `<button>` rather
 * than the `<Button>` primitive.
 *
 * The page owns the countdown state (`useSecretCountdown` composable);
 * this composite is purely the visual treatment.
 */
defineProps({
	/** Display label like "2:00". Empty string hides the suffix. */
	countdownLabel: { type: String, default: "" },
	/** Hides the progress bar overlay + the "Disable auto-close" link. */
	autoCloseDisabled: { type: Boolean, default: false },
	/**
	 * CSS animation duration the progress bar uses to shrink to zero
	 * (`shrink` keyframe). Pages set this to match `autoCloseMs`.
	 */
	progressDurationMs: { type: Number, required: true },
})

const emit = defineEmits(["close", "disableAutoClose"])
</script>

<template>
	<Flex direction="column" gap="8">
		<button @click="emit('close')" :class="[$style.cta, $style.cta_outline]" data-testid="close-btn">
			<span :class="$style.close_label">
				Close<span v-if="!autoCloseDisabled && countdownLabel"> · {{ countdownLabel }}</span>
			</span>
			<div
				v-if="!autoCloseDisabled"
				:class="$style.progress_bar"
				:style="{ animationDuration: `${progressDurationMs}ms` }"
			/>
		</button>

		<button
			v-if="!autoCloseDisabled"
			@click="emit('disableAutoClose')"
			type="button"
			:class="$style.ghost_link"
		>
			Disable auto-close
		</button>
	</Flex>
</template>

<style module>
.cta {
	position: relative;
	width: 100%;
	border: none;

	background: var(--nulo-accent);
	color: #0a0908;

	font-family: var(--font-headline);
	font-weight: 700;
	font-size: 14px;
	letter-spacing: 0.2em;
	text-transform: uppercase;

	padding: 20px 0;
	cursor: pointer;

	transition: all 0.2s var(--bezier);

	&:hover {
		background: #fff;
	}

	&:active {
		background: var(--txt-primary);
		color: var(--app-bg);
		transition: none;
	}

	&:disabled {
		opacity: 0.3;
		pointer-events: none;
	}

	&:focus-visible {
		outline: 2px dotted var(--nulo-accent);
		outline-offset: 2px;
	}
}

.cta_outline {
	overflow: hidden;

	background: transparent;
	color: var(--nulo-secondary);
	border: 1px solid var(--nulo-outline);

	&:hover {
		background: var(--nulo-surface-low);
		color: var(--txt-primary);
		border-color: var(--nulo-secondary);
	}
}

.close_label {
	position: relative;
	z-index: 1;
	font-variant-numeric: tabular-nums;
}

@keyframes shrink {
	0% {
		transform: translateX(0);
	}

	100% {
		transform: translateX(-100%);
	}
}

.progress_bar {
	position: absolute;
	top: 0;
	bottom: 0;
	left: 0;
	right: 0;
	z-index: 0;

	background: var(--nulo-surface-high);

	animation-name: shrink;
	animation-timing-function: linear;
	will-change: transform;
}

.ghost_link {
	align-self: center;

	font-family: var(--font-headline);
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.12em;
	text-transform: uppercase;

	color: var(--nulo-secondary);
	background: transparent;
	border: none;
	cursor: pointer;

	padding: 4px 0;
	text-decoration: underline;
	text-decoration-thickness: 1px;
	text-underline-offset: 4px;

	transition: color 0.2s var(--bezier);

	&:hover {
		color: var(--txt-primary);
	}
}

:global([theme="light"]) {
	.ghost_link {
		color: var(--txt-secondary);
	}
	.ghost_link:hover {
		color: var(--txt-primary);
	}
}
</style>
