<script setup>
import RowTarget from "@/components/ui/RowTarget.vue"

/**
 * Single authwit card. Renders the kind-specific kv_grid (call /
 * encoded_call / intent / message_hash) and exposes click events for
 * the parent to open the JSON viewer or fire the revoke confirm.
 */
const props = defineProps({
	authwit: { type: Object, required: true },
})

const emit = defineEmits(["open", "revoke"])

const titleId = useId()
</script>

<template>
	<div @click="emit('open', authwit)" :class="$style.card">
		<RowTarget :labelledby="titleId" />

		<div :class="$style.header">
			<span :id="titleId" :class="$style.type">{{ authwit.kindName ?? "Custom Authwit" }}</span>

			<Tooltip position="end">
				<RowAction label="Revoke authwit" :class="$style.revoke" @click="emit('revoke', authwit)">
					<Icon name="close-circle" color="secondary" size="16" />
				</RowAction>
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
	composes: card from "../record-card.module.css";

	border: 1px solid var(--nulo-border);

	padding: 12px;

	&:hover .revoke,
	&:focus-within .revoke {
		opacity: 1;
	}
}

.header {
	composes: header from "../record-card.module.css";
}

.type {
	composes: type from "../record-card.module.css";
}

.revoke {
	opacity: 0;

	transition: all 0.2s var(--bezier);
}

.kv_grid {
	composes: kv_grid from "../record-card.module.css";
}

.kv_key {
	composes: kv_key from "../record-card.module.css";
}

.kv_val {
	composes: kv_val from "../record-card.module.css";
}

.kv_val_wrap {
	composes: kv_val_wrap from "../record-card.module.css";
}
</style>
