<script setup lang="ts">
/**
 * Selected send-recipient summary. Shows the account/contact name + the address
 * masked as `0x?????? *** ????????` (first 8 / last 8). A tap on the eye reveals
 * the FULL address (mono, selectable) + copy — this is the recipient-verification
 * surface for the send screen (which submits + navigates away with no later
 * confirm step). Reveal is OPTIONAL by design (user decision); the masked form is
 * a glance summary, the reveal is for 100% certainty.
 */
import { computed, onBeforeUnmount, ref } from "vue"

/** Macros */
const props = defineProps<{
	name?: string
	address: string
}>()
const emit = defineEmits<{ change: []; copied: []; "copy-error": [] }>()

/** Reactive state */
const revealed = ref(false)
const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | undefined

const masked = computed(() => {
	const a = props.address ?? ""
	if (a.length <= 16) return a
	return `${a.slice(0, 8)} *** ${a.slice(-8)}`
})

/** Handlers */
const toggleReveal = () => {
	revealed.value = !revealed.value
}

const handleCopy = async () => {
	try {
		await window.navigator.clipboard.writeText(props.address)
		copied.value = true
		clearTimeout(copiedTimer)
		copiedTimer = setTimeout(() => {
			copied.value = false
		}, 1500)
		emit("copied")
	} catch {
		emit("copy-error")
	}
}

onBeforeUnmount(() => clearTimeout(copiedTimer))
</script>

<template>
	<Flex direction="column" gap="10" :class="$style.card" data-testid="recipient-card">
		<Flex align="center" justify="between" gap="10" wide>
			<Flex align="center" gap="10" :class="$style.identity">
				<AccountAvatar :name="name" :address="address" :size="32" />
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

		<Flex v-if="revealed" direction="column" gap="6" :class="$style.reveal" data-testid="recipient-card-full">
			<Text size="12" weight="500" color="primary" mono selectable :class="$style.full_addr">
				{{ address }}
			</Text>
			<button type="button" :class="$style.copy_btn" data-testid="recipient-card-copy" @click="handleCopy">
				<Icon name="copy" size="12" color="secondary" />
				<Text size="11" weight="600" color="secondary">{{ copied ? "Copied" : "Copy full address" }}</Text>
			</button>
		</Flex>
	</Flex>
</template>

<style module>
.card {
	border: 2px solid var(--nulo-outline);
	background: var(--nulo-surface-low);
	padding: 12px 14px;
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

.copy_btn {
	display: inline-flex;
	align-items: center;
	gap: 6px;
	align-self: flex-start;
	background: transparent;
	cursor: pointer;
}

.copy_btn:hover :global(.fill--secondary) {
	fill: var(--nulo-accent);
}
</style>
