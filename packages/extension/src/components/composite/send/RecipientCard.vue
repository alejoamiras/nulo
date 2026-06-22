<script setup lang="ts">
/**
 * Selected send-recipient summary. Shows the account/contact name + the address
 * masked as `0x??????…????????` (first 8 / last 8). A tap on the eye reveals the
 * FULL address (mono, selectable) — the recipient-verification surface for the
 * send screen (which submits + navigates away with no later confirm step).
 * Reveal is OPTIONAL by design (user decision); the masked form is a glance
 * summary, the reveal is for 100% certainty (select the text to copy if needed).
 */
import { computed, ref } from "vue"

/** Macros */
const props = defineProps<{
	name?: string
	address: string
}>()
const emit = defineEmits<{ change: [] }>()

/** Reactive state */
const revealed = ref(false)

const masked = computed(() => {
	const a = props.address ?? ""
	if (a.length <= 16) return a
	// Single ellipsis glyph (baseline-aligned) — matches how addresses are truncated
	// across the app; the spaced `***` rendered misaligned in the mono font.
	return `${a.slice(0, 8)}…${a.slice(-8)}`
})

/** Handlers */
const toggleReveal = () => {
	revealed.value = !revealed.value
}
</script>

<template>
	<Flex direction="column" gap="10" :class="$style.card" data-testid="recipient-card">
		<Flex align="center" justify="between" gap="10" wide>
			<Flex align="center" gap="10" :class="$style.identity">
				<AccountAvatar :name="name" :size="36" />
				<Flex direction="column" gap="2" :class="$style.text">
					<Text size="14" weight="600" color="primary" noWrap :class="$style.name">
						{{ name || "Address" }}
					</Text>
					<Text size="12" weight="500" color="tertiary" mono noWrap data-testid="recipient-card-masked">
						{{ masked }}
					</Text>
				</Flex>
			</Flex>
			<Flex align="center" gap="4" :class="$style.actions">
				<button
					type="button"
					:class="$style.icon_btn"
					data-testid="recipient-card-reveal"
					:aria-label="revealed ? 'Hide full address' : 'Reveal full address'"
					@click="toggleReveal"
				>
					<Icon :name="revealed ? 'eye-off' : 'eye'" size="16" color="secondary" />
				</button>
				<button
					type="button"
					:class="$style.icon_btn"
					data-testid="recipient-card-change"
					aria-label="Change recipient"
					@click="emit('change')"
				>
					<Icon name="close" size="16" color="secondary" />
				</button>
			</Flex>
		</Flex>

		<Flex v-if="revealed" :class="$style.reveal" data-testid="recipient-card-full">
			<Text size="12" weight="500" color="primary" mono selectable :class="$style.full_addr">
				{{ address }}
			</Text>
		</Flex>
	</Flex>
</template>

<style module>
/* Style D — field-style underline: no box, a single bottom rule (matches the
 * brutalist input fields), flush horizontal. */
.card {
	background: transparent;
	border-bottom: 1px solid var(--nulo-border);
	padding: 12px 0;
}

.identity {
	min-width: 0;
	flex: 1;
}

.text {
	min-width: 0;
}

.name {
	max-width: 100%;
	text-overflow: ellipsis;
	overflow: hidden;
}

.actions {
	flex-shrink: 0;
}

.icon_btn {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	width: 28px;
	height: 28px;
	background: transparent;
	cursor: pointer;
	transition: background 0.2s var(--bezier);
}

.icon_btn:hover {
	background: var(--nulo-surface-high);
}

.reveal {
	padding-top: 10px;
	border-top: 1px solid var(--nulo-border);
}

.full_addr {
	word-break: break-all;
	line-height: 1.4 !important;
}
</style>
