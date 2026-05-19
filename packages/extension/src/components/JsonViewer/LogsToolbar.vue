<script setup>
/**
 * Top-right action toolbar inside `LogsViewer.vue`. Owns the per-key
 * Source / Level filter popovers and the "more" Dropdown
 * (CSV export + Clear logs). Filter state + handlers come from the
 * `useLogFilters` composable; this component is purely visual.
 *
 * Each filter button reads its open state from `popovers[kind]` and
 * its "active" tint from `allOptionsSelected[kind]` (false = filtered,
 * which renders the chip in the accent color).
 */
import { capitalize } from "@/utils"
import { getDisplayName } from "./logs-format"

defineProps({
	popovers: { type: Object, required: true },
	filters: { type: Object, required: true },
	searchTerm: { type: String, default: "" },
	allOptionsSelected: { type: Object, required: true },
})

const emit = defineEmits(["openPopover", "closePopover", "toggleFilter", "selectAll", "update:searchTerm", "exportCsv", "clearLogs"])

const kinds = ["source", "level"]

const filteredKeys = (kind, filters, search) => {
	const all = Object.keys(filters[kind])
	if (kind !== "source") return all
	const q = (search || "").toLowerCase()
	return all.filter((s) => s.includes(q))
}
</script>

<template>
	<Flex align="center" gap="12" :class="$style.actions">
		<Popover
			v-for="kind in kinds"
			:key="kind"
			:open="popovers[kind]"
			@on-close="emit('closePopover', kind)"
			side="left"
			:width="kind === 'source' ? '200' : '136'"
		>
			<Flex
				@click="emit('openPopover', kind)"
				align="center"
				gap="4"
				:class="[$style.filter_button, !allOptionsSelected[kind] && $style.filter_button_active]"
			>
				<Icon :name="allOptionsSelected[kind] ? 'filter-outline' : 'filter'" size="14" />
				<Text size="12">{{ capitalize(kind) }}</Text>
			</Flex>

			<template #content>
				<Flex direction="column" gap="4" :class="$style.filter_content_wrapper">
					<Flex direction="column" gap="8" wide :class="$style.filter_content_title">
						<Text size="12" color="tertiary">{{ `Filter by log ${kind}` }}</Text>

						<Input
							v-if="kind === 'source'"
							:modelValue="searchTerm"
							@update:modelValue="emit('update:searchTerm', $event)"
							size="mini"
							placeholder="Search"
							autofocus
							:class="$style.filter_content_input"
						/>
					</Flex>

					<Flex
						align="start"
						direction="column"
						gap="4"
						:class="kind === 'source' && $style.filter_items_wrapper"
					>
						<Flex
							v-if="!searchTerm"
							@click="emit('selectAll', kind)"
							align="center"
							justify="start"
							gap="8"
							wide
							:class="$style.filter_content_item"
						>
							<Icon :name="allOptionsSelected[kind] ? 'check-circle' : 'circle'" size="12" />
							<Text size="12">Select All</Text>
						</Flex>

						<template v-if="filteredKeys(kind, filters, searchTerm).length">
							<Flex
								v-for="k in filteredKeys(kind, filters, searchTerm)"
								:key="k"
								@click="emit('toggleFilter', kind, k)"
								align="center"
								gap="8"
								wide
								:class="[$style.filter_content_item, !filters[kind][k] && $style.inactive]"
							>
								<Icon :name="filters[kind][k] ? 'check-circle' : 'circle'" size="12" />
								<Text size="12">{{ getDisplayName(kind, k) }}</Text>
							</Flex>
						</template>
						<Flex v-else align="center" justify="center" wide :class="$style.empty_content">
							<Text size="12" weight="500" color="tertiary">Nothing was found</Text>
						</Flex>
					</Flex>
				</Flex>
			</template>
		</Popover>

		<Dropdown>
			<Flex align="center" gap="4" :class="$style.filter_button">
				<Icon name="dots" size="14" />
			</Flex>

			<template #popup>
				<DropdownItem @click="emit('exportCsv')" :class="$style.filter_content_item">
					<Flex align="center" gap="8">
						<Icon name="download-outline" size="12" />
						<Text size="12">Export logs to CSV</Text>
					</Flex>
				</DropdownItem>
				<DropdownItem @click="emit('clearLogs')" :class="$style.filter_content_item">
					<Flex align="center" gap="6">
						<Icon name="close" size="14" style="padding-right: 4px" />
						Clear logs
					</Flex>
				</DropdownItem>
			</template>
		</Dropdown>
	</Flex>
</template>

<style module>
.actions {
	position: absolute;
	right: 18px;
	transform: translateY(10px);
	z-index: 1;
}

.filter_button {
	padding: 6px 8px;
	background-color: var(--dropdown-bg);
	border: 1px solid var(--nulo-border);
	border-radius: 6px;

	color: var(--txt-secondary);
	fill: var(--txt-secondary);

	cursor: pointer;

	transition: all 0.1s ease;

	&:hover {
		border-color: var(--txt-tertiary);

		* {
			color: var(--txt-primary);
			fill: var(--txt-primary);
		}
	}
}

.filter_button_active {
	fill: var(--blue);

	&:hover {
		* {
			fill: var(--blue);
		}
	}
}

.filter_content_wrapper {
	padding: 2px 8px 0 8px;
	min-height: 0;
	flex: 1;
}

.filter_content_title {
	border-bottom: 1.5px solid var(--nulo-border);
	padding-bottom: 8px;
}

.filter_items_wrapper {
	flex: 1;

	min-height: 0;
	max-height: 200px;

	overflow-y: scroll;
	scrollbar-width: thin;
	scrollbar-color: var(--txt-tertiary) transparent;
}

.filter_content_item {
	padding: 6px 8px;
	background-color: var(--dropdown-bg);
	border-radius: 4px;

	color: var(--txt-secondary);
	fill: var(--txt-secondary);

	cursor: pointer;

	transition: all 0.1s ease;

	&:hover {
		background: var(--nulo-surface-high);
		* {
			color: var(--txt-primary);
			fill: var(--txt-primary);
		}
	}
}

.inactive {
	color: var(--txt-tertiary);
	fill: var(--txt-tertiary);
}

.empty_content {
	padding: 6px 0;
}
</style>
