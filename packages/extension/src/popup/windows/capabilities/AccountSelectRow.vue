<script setup lang="ts">
/**
 * Selectable account row for the capabilities-window account picker.
 * Shows the account name + chain pill + truncated address. When
 * selected, expands an "Alias" input that the parent persists into a
 * `caip → alias` map (delivered via `formatCaipAccount`).
 */
import { getChainName } from "@/components/ui/utils.js"
import { formatCaipAccount } from "@/wallet/utils/caip"

defineProps<{
	account: { address: string; name: string; chainId: number }
	selected: boolean
	alias?: string
	disabled?: boolean
}>()

const emit = defineEmits(["toggle", "updateAlias"])

const caip = (a: { address: string; chainId: number }) => formatCaipAccount(a.chainId, a.address)
</script>

<template>
	<div
		data-testid="cap-account-item"
		:data-account-id="account.address"
		:data-account-name="account.name"
		role="button"
		tabindex="0"
		@click="emit('toggle')"
		@keydown.enter="emit('toggle')"
		:class="[$style.row, disabled && $style.row_disabled]"
	>
		<Flex align="center" gap="12" wide>
			<Icon
				v-if="selected"
				name="check-circle"
				size="16"
				color="primary"
				:class="$style.row_check"
			/>
			<Icon v-else name="circle" size="16" color="secondary" :class="$style.row_check" />

			<Flex direction="column" gap="2" wide :class="$style.row_text">
				<Flex align="center" justify="between" gap="8" wide>
					<span :class="$style.row_name">{{ account.name }}</span>
					<span :class="$style.chain_label">{{ getChainName(account.chainId).toUpperCase() }}</span>
				</Flex>
				<span :class="$style.row_address">
					{{ `${account.address.slice(0, 6)}...${account.address.slice(-4)}` }}
				</span>
			</Flex>
		</Flex>

		<Flex
			v-if="selected"
			direction="column"
			gap="4"
			wide
			:class="$style.alias_block"
			@click.stop
			@keydown.stop
		>
			<Flex align="center" gap="4">
				<span :class="$style.alias_label">Alias</span>
				<Tooltip position="start">
					<Icon name="info" size="11" color="tertiary" />
					<template #content>
						<Text size="12" color="secondary" :style="{ lineHeight: '1.2' }">
							A private name for this account visible only to this app
						</Text>
					</template>
				</Tooltip>
			</Flex>
			<input
				data-testid="cap-account-alias-input"
				:value="alias ?? account.name"
				@input="emit('updateAlias', caip(account), ($event.target as HTMLInputElement).value)"
				:class="$style.alias_input"
				:placeholder="account.name"
			/>
		</Flex>
	</div>
</template>

<style module>
.row {
	position: relative;

	display: flex;
	flex-direction: column;
	gap: 10px;

	padding: 12px 14px;
	cursor: pointer;
	outline: none;
	background: transparent;

	transition: background 0.2s var(--bezier);

	&:hover {
		background: var(--nulo-surface-high);
	}

	&:focus-visible {
		background: var(--nulo-surface-high);
	}

	&::after {
		position: absolute;
		bottom: 0;
		left: 14px;
		right: 14px;
		display: block;
		height: 1px;

		background: rgba(74, 70, 63, 0.3);

		content: " ";
	}

	&:last-child::after {
		display: none;
	}
}

.row_disabled {
	cursor: default;
	pointer-events: none;
	opacity: 0.5;
}

.row_check {
	flex-shrink: 0;
}

.row_text {
	min-width: 0;
}

.row_name {
	font-family: var(--font-body);
	font-size: 14px;
	font-weight: 600;
	color: var(--txt-primary);
	line-height: 20px;

	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.row_address {
	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--nulo-secondary);
	line-height: 16px;

	overflow: hidden;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.chain_label {
	flex-shrink: 0;

	font-family: var(--font-mono);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.08em;
	color: var(--nulo-secondary);
}

.alias_block {
	padding: 0 0 0 28px;
}

.alias_label {
	font-family: var(--font-headline);
	font-size: 10px;
	font-weight: 700;
	letter-spacing: 0.1em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.alias_input {
	width: 100%;

	padding: 8px 10px;
	border: 1px solid var(--nulo-border);
	background: var(--nulo-surface-low);
	color: var(--txt-primary);
	font-size: 13px;
	font-family: inherit;
	outline: none;

	transition: border-color 0.2s ease;

	&:focus {
		border-color: var(--nulo-accent);
	}

	&::placeholder {
		color: var(--nulo-outline);
	}
}
</style>
