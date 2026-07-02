/**
 * Storybook coverage for the Dropdown family — Root, Trigger, Item, Title, Divider.
 * The root wraps a teleported menu so the stories use the canonical compose
 * pattern (Root → Trigger as default slot, items in `#popup` slot).
 */
import type { Meta, StoryObj } from "@storybook/vue3-vite"
import DropdownRoot from "./DropdownRoot.vue"
import DropdownTrigger from "./DropdownTrigger.vue"
import DropdownItem from "./DropdownItem.vue"
import DropdownTitle from "./DropdownTitle.vue"
import DropdownDivider from "./DropdownDivider.vue"

const meta: Meta<typeof DropdownRoot> = {
	title: "UI / Dropdown",
	component: DropdownRoot,
	tags: ["autodocs"],
	argTypes: {
		side: { control: "select", options: ["top", "bottom", "left", "right"] },
		position: { control: "select", options: ["start", "end"] },
		forceOpen: { control: "boolean" },
		disabled: { control: "boolean" },
		fullWidth: { control: "boolean" },
	},
	args: { side: "bottom", position: "start" },
	render: (args) => ({
		components: { DropdownRoot, DropdownTrigger, DropdownItem, DropdownTitle, DropdownDivider },
		setup: () => ({ args }),
		template: `
			<div style="padding: 80px;">
				<DropdownRoot v-bind="args">
					<DropdownTrigger :width="180">Open menu</DropdownTrigger>
					<template #popup>
						<DropdownTitle>Menu group</DropdownTitle>
						<DropdownItem>Action one</DropdownItem>
						<DropdownItem>Action two</DropdownItem>
						<DropdownDivider />
						<DropdownItem :disabled="true">Disabled action</DropdownItem>
					</template>
				</DropdownRoot>
			</div>
		`,
	}),
}
export default meta

type Story = StoryObj<typeof DropdownRoot>

export const Default: Story = {}
export const ForceOpen: Story = { args: { forceOpen: true } }
export const Disabled: Story = { args: { disabled: true } }
export const FullWidth: Story = {
	args: { fullWidth: true },
	render: (args) => ({
		components: { DropdownRoot, DropdownTrigger, DropdownItem },
		setup: () => ({ args }),
		template: `
			<div style="padding: 24px; width: 360px;">
				<DropdownRoot v-bind="args">
					<DropdownTrigger :wide="true">Wide trigger</DropdownTrigger>
					<template #popup>
						<DropdownItem>Wide menu item</DropdownItem>
					</template>
				</DropdownRoot>
			</div>
		`,
	}),
}

/** Item-only matrix — quick visual reference for the standalone Item component. */
export const ItemMatrix: Story = {
	render: () => ({
		components: { DropdownItem, DropdownTitle, DropdownDivider },
		template: `
			<div style="padding: 16px; min-width: 220px; background: var(--app-bg); border: 2px solid var(--nulo-outline);">
				<DropdownTitle>Section A</DropdownTitle>
				<DropdownItem>Default item</DropdownItem>
				<DropdownItem>Another item</DropdownItem>
				<DropdownDivider />
				<DropdownTitle>Section B</DropdownTitle>
				<DropdownItem :disabled="true">Disabled item</DropdownItem>
			</div>
		`,
	}),
}
