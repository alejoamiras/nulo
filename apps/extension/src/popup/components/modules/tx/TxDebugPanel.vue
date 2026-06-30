<script setup>
/**
 * Collapsible debug-details panel inside the tx-detail page. Lists the
 * raw hash, created/updated timestamps, raw call list (with re-entry
 * + chunkNonce hints), and the error blob if the tx failed. Header is
 * a chevron toggle; everything below the header lives in the expanded
 * section.
 */
import { DateTime } from "luxon"
import { trimAddress } from "@/utils/string"

defineProps({
	tx: { type: Object, required: true },
})

const emit = defineEmits(["copy"])

const expanded = ref(false)

const formatTimestamp = (timestamp) => {
	if (!timestamp) return "N/A"
	return DateTime.fromMillis(timestamp).toFormat("yyyy-MM-dd HH:mm:ss")
}
</script>

<template>
	<Flex wide direction="column" gap="10">
		<button type="button" @click="expanded = !expanded" :class="$style.debug_toggle">
			<SectionLabel label="Debug details" />
			<Icon
				name="chevron"
				size="12"
				color="tertiary"
				:style="{ transform: `rotate(${expanded ? '180' : '0'}deg)`, transition: 'transform 0.2s ease' }"
			/>
		</button>

		<Flex v-if="expanded" wide direction="column" gap="12" :class="$style.details_box">
			<Flex wide justify="between" align="center">
				<span :class="$style.detail_key">Tx hash</span>
				<Flex @click="emit('copy', tx.hash)" align="center" gap="6" :class="'copyable'">
					<span :class="$style.detail_value_mono">{{ trimAddress(tx.hash, 8, 6) }}</span>
					<Icon name="copy" size="10" color="tertiary" />
				</Flex>
			</Flex>

			<Flex wide justify="between" align="center">
				<span :class="$style.detail_key">Created</span>
				<span :class="$style.detail_value_mono">{{ formatTimestamp(tx.createdAt) }}</span>
			</Flex>

			<Flex wide justify="between" align="center">
				<span :class="$style.detail_key">Updated</span>
				<span :class="$style.detail_value_mono">{{ formatTimestamp(tx.updatedAt) }}</span>
			</Flex>

			<Flex
				v-if="tx.calls?.some((c) => 'callIndex' in c || c.chunkNonce || c.isBatch)"
				wide
				direction="column"
				gap="6"
			>
				<span :class="$style.detail_key">Raw calls</span>
				<Flex wide direction="column" gap="4">
					<Flex
						v-for="(c, idx) in tx.calls"
						:key="idx"
						wide
						direction="column"
						gap="2"
						:class="$style.raw_call_item"
					>
						<Flex wide justify="between" align="center">
							<Flex align="center" gap="4">
								<span v-if="c.isBatch" :class="$style.detail_value_aux" title="Re-entry call">↩</span>
								<span :class="$style.raw_call_method">{{ c.method ?? "Unknown" }}</span>
							</Flex>
							<span v-if="'callIndex' in c" :class="$style.detail_value_aux">#{{ c.callIndex }}</span>
						</Flex>
						<span
							v-if="c.chunkNonce"
							@click="emit('copy', c.chunkNonce)"
							:class="[$style.raw_call_aux, 'copyable']"
						>
							chunk: {{ trimAddress(c.chunkNonce, 6, 4) }}
						</span>
					</Flex>
				</Flex>
			</Flex>

			<Flex v-if="tx.error" wide direction="column" gap="6">
				<span :class="$style.error_key">Error</span>
				<span :class="$style.error_text">{{ tx.error }}</span>
			</Flex>
		</Flex>
	</Flex>
</template>

<style module>
.debug_toggle {
	display: flex;
	align-items: center;
	justify-content: space-between;
	width: 100%;

	padding: 0;
	background: transparent;
	border: none;
	cursor: pointer;

	color: inherit;
	text-align: inherit;

	transition: opacity 0.2s ease;

	&:hover {
		opacity: 0.8;
	}
}

.details_box {
	padding: 12px;
	border: 1px solid var(--nulo-border);
	background: transparent;
}

.detail_key {
	font-family: var(--font-headline);
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.05em;
	text-transform: uppercase;
	color: var(--nulo-secondary);
}

.detail_value_mono {
	font-family: var(--font-mono);
	font-size: 12px;
	font-weight: 600;
	color: var(--txt-primary);
}

.detail_value_aux {
	font-family: var(--font-mono);
	font-size: 10px;
	color: var(--nulo-outline);
}

.raw_call_item {
	padding: 6px 8px;
	border-left: 1px solid var(--nulo-border);
}

.raw_call_method {
	font-family: var(--font-mono);
	font-size: 11px;
	font-weight: 600;
	color: var(--txt-primary);
}

.raw_call_aux {
	font-family: var(--font-mono);
	font-size: 10px;
	color: var(--nulo-secondary);
}

.error_key {
	font-family: var(--font-headline);
	font-size: 11px;
	font-weight: 700;
	letter-spacing: 0.05em;
	text-transform: uppercase;
	color: var(--red);
}

.error_text {
	padding: 8px 10px;
	border: 1px solid rgba(255, 0, 0, 0.3);
	background: transparent;

	font-family: var(--font-mono);
	font-size: 11px;
	color: var(--red);
	word-break: break-word;
}
</style>
