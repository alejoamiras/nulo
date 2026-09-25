<script setup lang="ts">
/**
 * One permission: its icon, title, current line and, when it has a switch name, a switch. Only the
 * switch acts: the row has no hover and no click. A consumer fills the `sub` slot to put a dotted
 * term in the line; this row imports no other composite.
 */
const props = defineProps<{
	icon: string
	title: string
	/** The line under the title; a switch row reads it while on. */
	subOn?: string
	/** The line while off; a switch row without one keeps `subOn`. */
	subOff?: string
	/** The switch's accessible name; a row without one has no switch. */
	switchLabel?: string
	switchTestid?: string
	flagged?: boolean
	chip?: string
	/** A quiet fact on the title line, such as a permission declined before. */
	badge?: string
	titleTestid?: string
	modelValue?: boolean
}>()

const emit = defineEmits<{ "update:modelValue": [value: boolean] }>()

const slots = useSlots()

const subId = useId()
const hasSwitch = computed(() => props.switchLabel !== undefined)
const line = computed(() => (hasSwitch.value && !props.modelValue ? (props.subOff ?? props.subOn) : props.subOn))
const hasSub = computed(() => line.value !== undefined || slots.sub !== undefined)
</script>

<template>
	<div :class="[$style.row, flagged && $style.flagged]">
		<MaterialIcon :name="icon" :size="16" :class="$style.icon" aria-hidden="true" />

		<div :class="$style.body">
			<div :data-testid="titleTestid" :class="$style.title">
				<span v-if="badge" :class="$style.title_line">
					<span>{{ title }}</span>
					<span data-testid="cap-rerequested-badge" :class="$style.badge">{{ badge }}</span>
				</span>
				<template v-else>{{ title }}</template>
			</div>
			<div v-if="hasSub" :id="subId" data-testid="cap-row-sub" :class="$style.sub">
				<slot name="sub" :on="modelValue === true">{{ line }}</slot>
			</div>
			<span v-if="chip" :class="$style.chip">
				<Icon name="warning" size="11" color="orange" aria-hidden="true" />
				{{ chip }}
			</span>
		</div>

		<Toggle
			v-if="hasSwitch"
			:data-testid="switchTestid ?? 'cap-toggle'"
			:aria-label="switchLabel"
			:aria-describedby="hasSub ? subId : undefined"
			:modelValue="modelValue === true"
			:class="$style.switch"
			@update:modelValue="(value: boolean) => emit('update:modelValue', value)"
		/>
	</div>
</template>

<style module>
.row {
	display: grid;
	grid-template-columns: 16px 1fr auto;
	align-items: start;
	gap: 10px;

	padding: 9px 12px;
}

.row + .row {
	border-top: 1px solid rgba(74, 70, 63, 0.2);
}

:global([theme="light"]) .row + .row {
	border-top-color: rgba(124, 116, 104, 0.2);
}

/* Two classes, so the icon's own color utility never decides. */
.row .icon {
	margin-top: 1px;
	color: var(--nulo-secondary);
}

.row.flagged .icon {
	color: var(--orange);
}

.body {
	min-width: 0;
}

.title {
	font-size: 13px;
	font-weight: 600;
	line-height: 1.35;
	color: var(--txt-primary);
}

.sub {
	margin-top: 2px;

	font-size: 11.5px;
	line-height: 1.4;
	color: var(--nulo-secondary);
}

.title_line {
	display: flex;
	flex-wrap: wrap;
	align-items: center;
	column-gap: 6px;
}

.chip,
.badge {
	align-items: center;
	gap: 4px;

	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
}

/* Block-level, so its line carries no strut from the inherited font. */
.chip {
	display: flex;
	width: fit-content;
	margin-top: 3px;
	color: var(--orange);
}

.badge {
	display: inline-flex;
	color: var(--txt-secondary);
}

.switch {
	margin-top: 1px;
}

/* Two classes outrank the primitive's `.wrapper:focus { outline: none }` whatever the order. */
.row .switch:focus-visible {
	outline: 1px solid var(--txt-primary);
	outline-offset: 2px;
}
</style>
