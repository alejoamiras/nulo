<script setup>
/**
 * Single row in the manage-FPCs list. Four modes:
 *  - synthetic="public-fj"   non-interactive Public Fee Juice anchor;
 *                            no copy / edit / delete and no right-side
 *                            content. The description carries the meaning.
 *  - nonEditable + protected fully locked protocol row (PrivateFPC);
 *                            copy only, no edit, no delete.
 *  - protected               canonical SponsoredFPC; copy + edit, no delete.
 *  - default                 user-added FPC; full action set.
 *
 * `nonEditable` exists because PrivateFPC validation can't tolerate
 * arbitrary addresses (custom-salt instances aren't deployed publicly
 * and the wallet ships a single bundled artifact). Locking is the
 * honest UX. SponsoredFPC keeps the edit affordance since real
 * sponsors are typically deployed and queryable via PXE.
 */
const props = defineProps({
	fpc: { type: Object, required: true },
	synthetic: { type: String, default: undefined },
	protectedRow: { type: Boolean, default: false },
	nonEditable: { type: Boolean, default: false },
})

const emit = defineEmits(["copyAddress", "edit", "delete"])

const isSynthetic = computed(() => props.synthetic === "public-fj")
</script>

<template>
	<SettingItem
		:title="fpc.name || fpc.address"
		:description="fpc.typeDescription"
		icon="fpc"
		iconBgColor="transparent"
		raw
		:class="$style.fpc_item"
		data-testid="fpc-row"
		:data-fpc-id="fpc.id"
		:data-fpc-name="fpc.name || fpc.address"
		:data-fpc-protected="protectedRow ? 'true' : null"
		:data-fpc-synthetic="synthetic ?? null"
	>
		<template #right>
			<Flex v-if="!isSynthetic" align="center" gap="8">
				<Tooltip position="end" delay="350">
					<Icon
						@click="emit('copyAddress', fpc.address)"
						name="copy"
						size="14"
						color="tertiary"
						:class="$style.icon_btn"
					/>
					<template #content>Copy FPC address</template>
				</Tooltip>

				<Tooltip v-if="!nonEditable" position="end" delay="350">
					<Icon
						@click.stop="emit('edit', fpc)"
						name="edit"
						size="14"
						color="tertiary"
						:class="$style.icon_btn"
						data-testid="fpc-edit-btn"
					/>
					<template #content>Edit FPC</template>
				</Tooltip>

				<Tooltip v-if="!protectedRow" position="end" delay="350">
					<Icon
						@click.stop="emit('delete', fpc)"
						name="close-circle"
						size="14"
						color="tertiary"
						:class="$style.icon_btn"
						data-testid="fpc-delete-btn"
					/>
					<template #content>Delete FPC</template>
				</Tooltip>
			</Flex>
		</template>
	</SettingItem>
</template>

<style module>
.fpc_item {
	min-height: 60px;
	height: auto !important;
	padding-top: 8px;
	padding-bottom: 8px;

	& span:last-child {
		white-space: normal;
	}
}

.icon_btn {
	cursor: pointer;
	transition: all 0.2s var(--bezier);

	&:hover {
		fill: var(--txt-primary);
	}
}
</style>
