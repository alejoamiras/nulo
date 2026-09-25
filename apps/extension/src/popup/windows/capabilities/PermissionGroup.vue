<script setup lang="ts">
/**
 * One group of the permission window: its label, then each row with its current line, where the
 * word "authorization(s)" is the dotted term. A held row is read-only and marked granted.
 */
import PermissionRow from "@/components/composite/capabilities/PermissionRow.vue"
import DottedTerm from "@/components/composite/DottedTerm.vue"
import type { PermissionRowEntry, SubSegment } from "./permission-rows"

defineProps<{
	label: string
	rows: readonly {
		entry: PermissionRowEntry
		capId?: string
		line: readonly SubSegment[]
		badge?: string
		selected: boolean
	}[]
	granted?: boolean
}>()

const emit = defineEmits<{ toggle: [key: string, on: boolean] }>()
</script>

<template>
	<Flex direction="column" gap="10" wide>
		<SectionLabel :label="label" />

		<ItemsContainer>
			<PermissionRow
				v-for="row in rows"
				:key="row.entry.key"
				data-testid="cap-item"
				:data-cap-id="row.capId"
				:data-cap-row="row.entry.key"
				:data-cap-granted="granted ? 'true' : undefined"
				:icon="row.entry.icon"
				:title="row.entry.title"
				:switchLabel="row.entry.switchLabel"
				:flagged="row.entry.flagged"
				:chip="row.entry.chip"
				:badge="row.badge"
				:titleTestid="row.entry.key === 'unknown' ? 'cap-unrecognized-badge' : undefined"
				:modelValue="row.selected"
				@update:modelValue="(on: boolean) => emit('toggle', row.entry.key, on)"
			>
				<template v-if="row.line.length" #sub>
					<template v-for="(segment, i) in row.line" :key="i">
						<DottedTerm v-if="'term' in segment" term="authorization" testid="cap-auth-term">{{ segment.term }}</DottedTerm>
						<template v-else>{{ segment.text }}</template>
					</template>
				</template>
			</PermissionRow>
		</ItemsContainer>
	</Flex>
</template>
