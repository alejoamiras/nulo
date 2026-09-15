<script setup lang="ts">
/**
 * The Presto status card both shells render: a tone-coloured dot, the title and
 * detail from `copyFor`, the retry button named by the copy, and the numbered
 * recovery steps when a state has them. Presentation only — the page owns the
 * probe and passes the copy in.
 */
import type { PrestoCopy } from "@/utils/presto-ui-state"

const props = defineProps<{
	copy: PrestoCopy
	/** The UI state kind, exposed as `data-status` for tests and styling. */
	status: string
	diagnosis?: string
	/** The settings layout: smaller type, the retry button under the text. */
	compact?: boolean
	testid?: string
	retryTestid?: string
}>()
const emit = defineEmits<{ retry: [] }>()

const stepNumber = (index: number) => String(index + 1).padStart(2, "0")
</script>

<template>
	<div
		:class="[$style.card, $style[`tone_${props.copy.tone}`], props.compact && $style.compact]"
		:data-testid="props.testid"
		:data-status="props.status"
		:data-diagnosis="props.diagnosis"
	>
		<div :class="$style.head">
			<span :class="[$style.dot, props.copy.tone === 'pending' && $style.pulse]" />
			<div :class="$style.body">
				<span :class="$style.title">{{ props.copy.title }}</span>
				<span v-if="props.copy.detail" :class="$style.detail">{{ props.copy.detail }}</span>
				<button
					v-if="props.compact && props.copy.retry"
					type="button"
					:class="[$style.retry, $style.retry_inline]"
					:data-testid="props.retryTestid"
					@click="emit('retry')"
				>
					{{ props.copy.retry }}
				</button>
			</div>
			<button
				v-if="!props.compact && props.copy.retry"
				type="button"
				:class="$style.retry"
				:data-testid="props.retryTestid"
				@click="emit('retry')"
			>
				{{ props.copy.retry }}
			</button>
		</div>
		<ol v-if="props.copy.steps?.length" :class="$style.steps">
			<li v-for="(step, index) in props.copy.steps" :key="step" :class="$style.step">
				<span :class="$style.step_num">{{ stepNumber(index) }}</span>
				<span :class="$style.step_text">{{ step }}</span>
			</li>
		</ol>
	</div>
</template>

<style module>
.card {
	background: var(--nulo-surface);
	border: 1px solid var(--nulo-border);
	transition: border-color 0.2s var(--bezier);
}

.tone_go {
	border-color: var(--green);
}

.tone_warn {
	border-color: var(--yellow);
}

.tone_off {
	border-color: var(--nulo-outline);
}

.head {
	display: flex;
	align-items: flex-start;
	gap: 16px;
	padding: 20px 24px;
}

.compact .head {
	gap: 12px;
	padding: 14px 16px;
}

.dot {
	width: 10px;
	height: 10px;
	flex-shrink: 0;
	margin-top: 4px;
	background: var(--nulo-secondary);
	transition: background 0.2s var(--bezier);
}

.tone_go .dot {
	background: var(--green);
}

.tone_accent .dot {
	background: var(--nulo-accent);
}

.tone_warn .dot {
	background: var(--yellow);
}

.tone_off .dot {
	background: var(--red);
}

.pulse {
	animation: pulse 1.4s ease-in-out infinite;
}

@keyframes pulse {
	0%,
	100% {
		opacity: 0.45;
	}
	50% {
		opacity: 1;
	}
}

.body {
	display: flex;
	flex-direction: column;
	gap: 4px;
	flex: 1;
	min-width: 0;
}

.compact .body {
	gap: 10px;
}

.title {
	font-family: var(--font-headline);
	font-size: 15px;
	font-weight: 700;
	line-height: 1.25;
	color: var(--txt-primary);
}

.compact .title {
	font-size: 14px;
}

.detail {
	font-size: 13px;
	line-height: 1.5;
	color: var(--txt-secondary);
}

.compact .detail {
	font-size: 12px;
}

.retry {
	margin-left: auto;
	background: transparent;
	border: 1px solid var(--nulo-outline);
	color: var(--txt-secondary);
	font-family: var(--font-headline);
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.12em;
	text-transform: uppercase;
	padding: 8px 14px;
	cursor: pointer;
	transition:
		background 0.15s var(--bezier),
		color 0.15s var(--bezier),
		border-color 0.15s var(--bezier);
	flex-shrink: 0;
}

.retry_inline {
	margin-left: 0;
	align-self: flex-start;
}

.retry:hover {
	background: var(--nulo-surface-low);
	color: var(--txt-primary);
	border-color: var(--nulo-secondary);
}

.retry:focus-visible {
	outline: 2px dotted var(--nulo-accent);
	outline-offset: 2px;
}

.steps {
	display: flex;
	flex-direction: column;
	gap: 10px;
	list-style: none;
	margin: 0;
	padding: 14px 16px;
	background: var(--nulo-surface-low);
	border-top: 1px solid var(--nulo-border);
}

.step {
	display: flex;
	align-items: flex-start;
	gap: 12px;
}

.step_num {
	font-family: var(--font-mono);
	font-size: 10px;
	font-weight: 600;
	letter-spacing: 0.08em;
	color: var(--nulo-outline);
	padding-top: 3px;
	flex-shrink: 0;
}

.step_text {
	font-size: 13px;
	line-height: 1.5;
	color: var(--txt-primary);
}
</style>
