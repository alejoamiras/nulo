<script setup>
/**
 * Single authwit card. Renders the kind-specific kv_grid (call /
 * encoded_call / intent / message_hash) and exposes click events for
 * the parent to open the JSON viewer or fire the revoke confirm.
 */
const props = defineProps({
	authwit: { type: Object, required: true },
})

const emit = defineEmits(["open", "revoke"])
</script>

<template>
	<div @click="emit('open', authwit)" :class="$style.card">
		<div :class="$style.header">
			<span :class="$style.type">{{ authwit.kindName ?? "Custom Authwit" }}</span>

			<Tooltip position="end">
				<Icon
					@click.stop="emit('revoke', authwit)"
					name="close-circle"
					color="secondary"
					size="16"
					:class="$style.revoke"
				/>
				<template #content>Revoke authwit</template>
			</Tooltip>
		</div>

		<div :class="$style.kv_grid">
			<template v-if="authwit.content.kind === 'call'">
				<span :class="$style.kv_key">caller</span>
				<span :class="[$style.kv_val, $style.kv_val_wrap]">{{ authwit.content.caller }}</span>
				<span :class="$style.kv_key">contract</span>
				<span :class="[$style.kv_val, $style.kv_val_wrap]">{{ authwit.content.contract }}</span>
				<span :class="$style.kv_key">method</span>
				<span :class="$style.kv_val">{{ authwit.content.method }}</span>
			</template>
			<template v-else-if="authwit.content.kind === 'encoded_call'">
				<span :class="$style.kv_key">caller</span>
				<span :class="[$style.kv_val, $style.kv_val_wrap]">{{ authwit.content.caller }}</span>
				<span :class="$style.kv_key">to</span>
				<span :class="[$style.kv_val, $style.kv_val_wrap]">{{ authwit.content.to }}</span>
				<span :class="$style.kv_key">selector</span>
				<span :class="$style.kv_val">{{ authwit.content.selector }}</span>
			</template>
			<template v-else-if="authwit.content.kind === 'intent'">
				<span :class="$style.kv_key">consumer</span>
				<span :class="[$style.kv_val, $style.kv_val_wrap]">{{ authwit.content.consumer }}</span>
				<span :class="$style.kv_key">intent</span>
				<span :class="[$style.kv_val, $style.kv_val_wrap]">{{ authwit.content.intent.join(", ") }}</span>
			</template>
			<template v-else-if="authwit.content.kind === 'message_hash'">
				<span :class="$style.kv_key">hash</span>
				<span :class="[$style.kv_val, $style.kv_val_wrap]">{{ authwit.content.messageHash }}</span>
			</template>
		</div>
	</div>
</template>

<style module>
.card {
	display: flex;
	flex-direction: column;
	gap: 10px;

	cursor: pointer;

	border: 1px solid var(--nulo-border);

	padding: 12px;

	transition: all 0.2s var(--bezier);

	&:hover {
		background: var(--nulo-surface-low);
		border-color: var(--nulo-outline);

		& .revoke {
			opacity: 1;
		}
	}

	&:active {
		background: var(--nulo-surface-high);
	}
}

.header {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 12px;
}

.type {
	flex: 1;
	min-width: 0;

	font-family: var(--font-headline);
	font-size: 13px;
	font-weight: 700;
	letter-spacing: 0.04em;
	text-transform: uppercase;
	color: var(--txt-primary);

	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.revoke {
	opacity: 0;

	transition: all 0.2s var(--bezier);

	&:hover {
		fill: var(--txt-primary);
	}
}

.kv_grid {
	display: grid;
	grid-template-columns: minmax(90px, 120px) 1fr;
	gap: 4px 12px;
	align-items: baseline;
}

.kv_key {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-outline);

	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.kv_val {
	font-family: var(--font-mono);
	font-size: 12px;
	color: var(--txt-primary);

	min-width: 0;

	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

/* Addresses / hashes wrap onto 2 lines instead of truncating —
 * users need to glance-verify head + tail bytes. */
.kv_val_wrap {
	white-space: normal;
	overflow-wrap: anywhere;
	line-height: 1.4;
	display: -webkit-box;
	-webkit-box-orient: vertical;
	-webkit-line-clamp: 2;
	line-clamp: 2;
}
</style>
