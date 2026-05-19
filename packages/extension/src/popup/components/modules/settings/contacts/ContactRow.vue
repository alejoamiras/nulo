<script setup>
import { trimAddress } from "@/utils/string"

/**
 * Single contact entry in the address-book list. Owns the avatar, name,
 * address (trimmed) + sender chip, and the three action icons (copy,
 * edit, delete). Click on the body fires `select`; each action emits
 * its own event so the parent can dispatch confirms / popup sequences.
 */
const props = defineProps({
	contact: { type: Object, required: true },
	isSender: { type: Boolean, default: false },
})

const emit = defineEmits(["select", "copy", "edit", "delete"])
</script>

<template>
	<div
		role="button"
		tabindex="0"
		@click="emit('select', contact)"
		@keydown.enter="emit('select', contact)"
		:class="$style.row"
		data-testid="contact-row"
		:data-contact-name="contact.name"
	>
		<Flex align="center" gap="12" wide>
			<div :class="$style.avatar">
				<span :class="$style.avatar_text">{{ contact.abbr }}</span>
			</div>

			<Flex direction="column" gap="2" wide :class="$style.row_text">
				<span :class="$style.row_name">{{ contact.name }}</span>
				<Flex align="center" gap="6">
					<span :class="$style.row_address">{{ trimAddress(contact.address) }}</span>
					<span
						v-if="isSender"
						:class="$style.sender_chip"
						title="Registered as sender"
						aria-label="Registered as private-transfer sender"
						data-testid="contact-sender-chip"
					>S</span>
				</Flex>
			</Flex>

			<Flex align="center" gap="8" :class="$style.actions">
				<span
					role="button"
					tabindex="0"
					@click.stop="emit('copy', contact)"
					@keydown.enter.stop="emit('copy', contact)"
					:class="$style.action"
					aria-label="Copy address"
				>
					<Icon name="copy" size="14" color="tertiary" />
				</span>
				<span
					role="button"
					tabindex="0"
					data-testid="contact-edit"
					@click.stop="emit('edit', contact)"
					@keydown.enter.stop="emit('edit', contact)"
					:class="$style.action"
					aria-label="Edit contact"
				>
					<Icon name="edit" size="14" color="tertiary" />
				</span>
				<span
					role="button"
					tabindex="0"
					data-testid="contact-delete"
					@click.stop="emit('delete', contact)"
					@keydown.enter.stop="emit('delete', contact)"
					:class="[$style.action, $style.action_danger]"
					aria-label="Delete contact"
				>
					<Icon name="close-circle" size="14" color="tertiary" />
				</span>
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
	outline: none;

	transition: background 0.2s var(--bezier);

	&:hover {
		background: var(--nulo-surface-high);
	}

	&:active {
		background: var(--nulo-surface-highest);
	}

	&:focus-visible {
		background: var(--nulo-surface-high);
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

.action {
	display: inline-flex;
	align-items: center;
	justify-content: center;

	width: 20px;
	height: 20px;

	cursor: pointer;
	outline: none;

	transition: all 0.2s var(--bezier);

	&:hover svg {
		fill: var(--txt-primary);
	}

	&:focus-visible {
		background: var(--nulo-surface-high);
	}
}

.action_danger {
	&:hover svg {
		fill: var(--txt-primary);
	}
}
</style>
