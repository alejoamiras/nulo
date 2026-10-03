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
	composes: divider row from "../../../../../components/ui/Settings/settings-row.module.css";
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
	composes: row_text from "../../../../../components/ui/Settings/settings-row.module.css";
}

.row_name {
	composes: row_name from "../../../../../components/ui/Settings/settings-row.module.css";
}

.row_address {
	composes: row_sub from "../../../../../components/ui/Settings/settings-row.module.css";
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
	composes: row_actions from "../../../../../components/ui/Settings/settings-row.module.css";
}
</style>
