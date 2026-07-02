<script setup>
/**
 * Fee-method dropdown trigger + popup used by `FeeSettingsCard`. The
 * trigger shows the active method's title (or "Select method"); the
 * popup lists every entry from `methods` with the per-entry testid
 * `send-fee-method-{subtitle}`. Disabled entries (token_fpc placeholder)
 * cannot be selected.
 */
import { Dropdown } from "@/components/ui/Dropdown"

defineProps({
	modelValue: { type: Object, default: null },
	methods: { type: Array, required: true },
})

const emit = defineEmits(["update:modelValue", "open", "close"])
</script>

<template>
	<Flex direction="column" gap="4" :class="$style.card">
		<span :class="$style.fee_label">Fee Source</span>
		<Dropdown @onOpen="emit('open')" @onClose="emit('close')">
			<template #trigger>
				<Flex
					align="center"
					justify="between"
					class="clickable"
					data-testid="send-fee-method-trigger"
					:data-fee-method="modelValue?.subtitle"
				>
					<span v-if="modelValue" :class="$style.fee_value">{{ modelValue.title }}</span>
					<span v-else :class="[$style.fee_value, $style.fee_placeholder]">Select method</span>
					<MaterialIcon name="expand_more" :size="16" color="secondary" />
				</Flex>
			</template>

			<template #popup>
				<DropdownItem
					v-for="method in methods"
					:key="method.fpc?.id ?? method.type"
					:disabled="method.disabled"
					:data-testid="`send-fee-method-${method.subtitle}`"
					@click="!method.disabled && emit('update:modelValue', method)"
				>
					<Flex align="center" justify="between" gap="8" wide>
						<Text size="13" weight="600" :color="method.disabled ? 'tertiary' : 'primary'">
							{{ method.title }}
						</Text>
						<Text size="11" color="tertiary">
							{{ method.disabled && method.disabledReason ? method.disabledReason : method.subtitle }}
						</Text>
					</Flex>
				</DropdownItem>
			</template>
		</Dropdown>
	</Flex>
</template>

<style module>
.card {
	padding: 12px;
}

.fee_label {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	text-transform: uppercase;
	letter-spacing: 0.1em;
	color: var(--nulo-secondary);
}

.fee_value {
	font-family: var(--font-mono);
	font-size: 12px;
	color: var(--txt-primary);
}

.fee_placeholder {
	color: var(--nulo-secondary);
}
</style>
