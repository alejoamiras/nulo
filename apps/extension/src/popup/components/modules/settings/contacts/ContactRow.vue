<script setup>
import RowTarget from "@/components/ui/RowTarget.vue"
import { trimAddress } from "@/utils/string"

/**
 * Single contact entry in the address-book list: a link to Send with this contact selected, with
 * the avatar, name, address (trimmed) + sender chip, and the three actions (copy, edit, delete),
 * each emitting its own event so the parent can dispatch confirms / popup sequences.
 */
const props = defineProps({
	contact: { type: Object, required: true },
	isSender: { type: Boolean, default: false },
})

const emit = defineEmits(["copy", "edit", "delete"])

const titleId = useId()
const target = ref(null)
</script>

<template>
	<div :class="$style.row" data-testid="contact-row" :data-contact-name="contact.name">
		<RowTarget ref="target" :to="`/popup/send?contact=${encodeURIComponent(contact.id)}`" :labelledby="titleId" />

		<Flex align="center" gap="12" wide>
			<div :class="$style.avatar">
				<span :class="$style.avatar_text">{{ contact.abbr }}</span>
			</div>

			<Flex direction="column" gap="2" wide :class="$style.row_text">
				<span :id="titleId" :class="$style.row_name">{{ contact.name }}</span>
				<Flex align="center" gap="6">
					<span :class="$style.row_address">{{ trimAddress(contact.address) }}</span>
					<!-- Raised above the target so its title shows; `.stop` so a press opens the row once. -->
					<span
						v-if="isSender"
						:class="$style.sender_chip"
						title="Registered as sender"
						aria-label="Registered as private-transfer sender"
						data-testid="contact-sender-chip"
						@click.stop="target?.activate()"
					>S</span>
				</Flex>
			</Flex>

			<Flex align="center" gap="8" :class="$style.actions">
				<RowAction label="Copy address" @click="emit('copy', contact)">
					<Icon name="copy" size="14" color="tertiary" />
				</RowAction>
				<RowAction label="Edit contact" data-testid="contact-edit" @click="emit('edit', contact)">
					<Icon name="edit" size="14" color="tertiary" />
				</RowAction>
				<RowAction label="Delete contact" data-testid="contact-delete" @click="emit('delete', contact)">
					<Icon name="close-circle" size="14" color="tertiary" />
				</RowAction>
			</Flex>
		</Flex>
	</div>
</template>

<style module>
.row {
	position: relative;
	padding: 12px 16px;
	cursor: pointer;
	background: transparent;

	transition: background 0.2s var(--bezier);

	&:hover,
	&:has(> [data-row-target]:focus-visible) {
		background: var(--nulo-surface-high);
	}

	&:has(> [data-row-target]:focus-visible) {
		outline: 2px solid var(--nulo-accent);
		outline-offset: -2px;
	}

	&:active {
		background: var(--nulo-surface-highest);
	}

	&::after {
		position: absolute;
		bottom: 0;
		left: 16px;
		right: 16px;
		display: block;
		height: 1px;

		background: rgba(74, 70, 63, 0.3);

		content: " ";
	}

	&:last-child::after {
		display: none;
	}
}

.avatar {
	display: flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;

	width: 24px;
	height: 24px;

	background: var(--nulo-surface-high);
}

.avatar_text {
	font-family: var(--font-mono);
	font-size: 10px;
	font-weight: 700;
	color: var(--txt-primary);
	line-height: 1;
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
	letter-spacing: 0.01em;

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

.sender_chip {
	position: relative;
	z-index: 1;
	flex-shrink: 0;

	display: inline-flex;
	align-items: center;
	justify-content: center;

	min-width: 14px;
	padding: 1px 4px;

	font-family: var(--font-mono);
	font-size: 9px;
	font-weight: 700;
	letter-spacing: 0.04em;
	line-height: 1.2;
	text-transform: uppercase;

	color: var(--txt-primary);
	background: rgba(74, 70, 63, 0.25);
	border: 1px solid rgba(74, 70, 63, 0.45);
}

.actions {
	flex-shrink: 0;
}
</style>
