import type { Meta, StoryObj } from "@storybook/vue3-vite"
import Popover from "./Popover.vue"

const meta: Meta<typeof Popover> = {
	title: "UI / Popover",
	component: Popover,
	tags: ["autodocs"],
	argTypes: {
		open: { control: "boolean" },
		side: { control: "select", options: ["left", "right"] },
		width: { control: "text" },
		height: { control: "text" },
		disabled: { control: "boolean" },
	},
	args: { open: true, side: "left", width: "240" },
	render: (args) => ({
		components: { Popover },
		setup: () => ({ args }),
		template: `
			<div style="padding: 80px; display: flex; justify-content: flex-end;">
				<Popover v-bind="args">
					<button style="padding: 8px 16px; border: 1px solid #555; background: transparent; color: inherit; font-family: inherit;">
						Trigger
					</button>
					<template #content>
						<div style="padding: 16px;">
							<p style="margin: 0;">Popover body content.</p>
						</div>
					</template>
				</Popover>
			</div>
		`,
	}),
}
export default meta

type Story = StoryObj<typeof Popover>

export const Open: Story = { args: { open: true } }
export const Closed: Story = { args: { open: false } }
export const Disabled: Story = { args: { disabled: true } }
export const RightSide: Story = { args: { side: "right" } }
export const SizedHeight: Story = { args: { height: "200" } }
