import type { Meta, StoryObj } from "@storybook/vue3-vite"
import SubPageHeader from "./SubPageHeader.vue"

const meta: Meta<typeof SubPageHeader> = {
	title: "UI / SubPageHeader",
	component: SubPageHeader,
	tags: ["autodocs"],
	argTypes: {
		title: { control: "text" },
		showBack: { control: "boolean" },
		leadingIcon: { control: "text" },
	},
	args: { title: "Settings", showBack: true },
	render: (args) => ({
		components: { SubPageHeader },
		setup: () => ({ args }),
		template: '<div style="padding-top: 24px;"><SubPageHeader v-bind="args" /></div>',
	}),
}
export default meta

type Story = StoryObj<typeof SubPageHeader>

export const Default: Story = {}
export const WithLeadingIcon: Story = { args: { leadingIcon: "settings" } }
export const NoBack: Story = { args: { showBack: false } }
export const NoTitle: Story = { args: { title: "" } }
export const WithTrailing: Story = {
	render: (args) => ({
		components: { SubPageHeader },
		setup: () => ({ args }),
		template: `
			<div style="padding-top: 24px;">
				<SubPageHeader v-bind="args">
					<template #trailing>
						<button style="padding: 6px 10px; background: transparent; color: inherit; border: 1px solid #555; cursor: pointer;">edit</button>
					</template>
				</SubPageHeader>
			</div>
		`,
	}),
}
