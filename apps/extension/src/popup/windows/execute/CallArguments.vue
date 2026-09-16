<script setup lang="ts">
/**
 * The argument block under one call. Owns only its raw-fields toggle: the fields are a last resort,
 * closed by default, and the notice above them says why the wallet could not do better.
 */
import type { TokenInfo } from "@/wallet/services/token/client"
import { safeWire } from "./humanize"
import { type CallSurface, RAW_NOTICE, amountLabel, rawToggleLabel, valueText, valueTitle } from "./call-surface"

const props = defineProps<{
	surface: CallSurface
	/** The call's target, so an amount can be labeled with the token the wallet knows at that address. */
	contract: unknown
	chainId?: number
	tokens?: readonly TokenInfo[]
	/** Prefix for every `data-testid` in the block, so each host surface stays addressable. */
	prefix: string
	/** Whether the request's JSON view carries this call, so capped rows can point there. */
	jsonView?: boolean
}>()

const rawOpen = ref(false)
const amount = computed(() =>
	props.surface.kind === "transfer" || props.surface.kind === "mint"
		? amountLabel(props.tokens, props.chainId, props.contract, props.surface.amount)
		: undefined,
)
</script>

<template>
	<Flex
		v-if="surface.kind === 'transfer' || surface.kind === 'mint'"
		:data-testid="`${prefix}-structured-args`"
		:data-intent-kind="surface.kind"
		direction="column"
		gap="2"
		:class="$style.block"
	>
		<!-- The sender is rendered even when the call carries none: a dApp can spend from another
		     account it names, and the entrypoint spends from nobody. -->
		<Flex v-if="surface.kind === 'transfer'" :data-testid="`${prefix}-transfer-sender`" :data-sender-kind="surface.sender.kind" justify="between" :class="$style.row">
			<template v-if="surface.sender.kind === 'none'">
				<Text size="11" color="secondary">Caller:</Text>
				<Text size="11" color="primary">none</Text>
			</template>
			<template v-else-if="surface.sender.kind === 'account'">
				<Text size="11" color="secondary">From:</Text>
				<Text size="11" color="primary">this account <Text color="secondary">(<AddressDisplay :address="surface.sender.address" size="11" />)</Text></Text>
			</template>
			<template v-else>
				<Text size="11" color="secondary">From:</Text>
				<AddressDisplay :address="surface.sender.address" size="11" />
			</template>
		</Flex>
		<Flex justify="between" :class="$style.row">
			<Text size="11" color="secondary">{{ surface.kind === "mint" ? "Mint to:" : "To:" }}</Text>
			<AddressDisplay :address="surface.to" size="11" />
		</Flex>
		<Flex justify="between" :class="$style.row">
			<Text size="11" color="secondary">Amount:</Text>
			<Text :data-testid="`${prefix}-amount`" size="11" color="primary">
				{{ amount?.text }}
				<Text v-if="amount?.symbol" weight="600">{{ amount.symbol }}</Text>
				<Text v-else color="tertiary">base units</Text>
			</Text>
		</Flex>
		<Flex v-if="surface.kind === 'transfer' && surface.nonce !== undefined" :data-testid="`${prefix}-transfer-nonce`" justify="between" :class="$style.row">
			<Text size="11" color="secondary">Authwit nonce:</Text>
			<Text size="11" color="primary">{{ surface.nonce }}</Text>
		</Flex>
	</Flex>

	<Flex v-else-if="surface.kind === 'decoded'" :data-testid="`${prefix}-decoded-args`" direction="column" gap="2" :class="$style.block">
		<Flex
			v-for="(p, m) in surface.params"
			:key="m"
			:data-testid="`${prefix}-decoded-param`"
			:data-param="p.name"
			:data-value-kind="p.value.kind"
			justify="between"
			:class="$style.row"
		>
			<Text size="11" color="secondary">{{ safeWire(p.name, 32) }}:</Text>
			<AddressDisplay v-if="p.value.kind === 'address'" :address="p.value.value" size="11" />
			<Text
				v-else
				size="11"
				color="primary"
				:mono="p.value.kind === 'field'"
				:title="valueTitle(p.value)"
			>
				{{ valueText(p.value) }}
			</Text>
		</Flex>
	</Flex>

	<Text v-else-if="surface.kind === 'pending'" :data-testid="`${prefix}-args-pending`" size="11" color="tertiary" :class="$style.block">
		Reading arguments…
	</Text>

	<Flex v-else :data-testid="`${prefix}-unverified-args`" :data-reason="surface.reason" direction="column" gap="4" :class="$style.block">
		<Flex align="center" gap="4">
			<Icon name="warning" size="12" color="orange" />
			<Text :data-testid="`${prefix}-unverified-warning`" size="11" weight="600" color="orange">Can't read the arguments</Text>
		</Flex>
		<Text size="11" color="tertiary">{{ RAW_NOTICE[surface.reason] }} Check what the app says this does before approving.</Text>
		<button
			v-if="surface.rows.length"
			type="button"
			:data-testid="`${prefix}-raw-toggle`"
			:aria-expanded="rawOpen"
			:class="$style.toggle"
			@click="rawOpen = !rawOpen"
		>
			<Icon name="chevron-right" size="10" color="secondary" :class="[$style.chevron, rawOpen && $style.chevron_open]" />
			<Text size="11" color="secondary">{{ rawToggleLabel(surface.rows.length + surface.hidden, rawOpen) }}</Text>
		</button>
		<Flex v-if="rawOpen" :data-testid="`${prefix}-raw-args`" direction="column" gap="2">
			<Flex v-for="(row, m) in surface.rows" :key="m" :data-testid="`${prefix}-arg`" :data-arg-kind="row.kind" justify="between" :class="$style.row">
				<Text size="11" color="secondary">#{{ m }}</Text>
				<Text v-if="row.kind === 'field'" size="11" color="primary" mono :title="row.full">
					{{ row.short }}<Text v-if="row.decimal !== undefined" color="tertiary"> = {{ row.decimal }}</Text>
				</Text>
				<Text v-else-if="row.kind === 'text'" size="11" color="primary">{{ row.value }}</Text>
				<Text v-else size="11" color="tertiary">(unreadable)</Text>
			</Flex>
			<Text v-if="surface.hidden" :data-testid="`${prefix}-args-more`" size="11" color="tertiary">
				+{{ surface.hidden }} more{{ jsonView ? " in the JSON view" : " not shown" }}
			</Text>
		</Flex>
	</Flex>
</template>

<style module>
.block {
	width: 100%;
}

.row {
	width: 100%;
	gap: 12px;

	> :last-child {
		min-width: 0;
		text-align: right;
	}
}

.toggle {
	display: inline-flex;
	align-items: center;
	align-self: flex-start;
	gap: 4px;
	padding: 2px 0;
	border: 0;
	background: none;
	cursor: pointer;
	font: inherit;
}

.chevron {
	transition: transform 120ms ease;
}

.chevron_open {
	transform: rotate(90deg);
}
</style>
