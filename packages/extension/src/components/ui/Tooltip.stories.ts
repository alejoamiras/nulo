import type { Meta, StoryObj } from "@storybook/vue3-vite"
import Tooltip from "./Tooltip.vue"

const meta: Meta<typeof Tooltip> = {
	title: "UI / Tooltip",
	component: Tooltip,
	tags: ["autodocs"],
	argTypes: {
		side: { control: "select", options: ["top", "bottom", "left", "right"] },
		position: { control: "select", options: ["start", "center", "end"] },
		textAlign: { control: "select", options: ["left", "center", "right"] },
		wide: { control: "boolean" },
		disabled: { control: "boolean" },
		delay: { control: "number" },
	},
	args: { side: "bottom", position: "center" },
	render: (args) => ({
		components: { Tooltip },
		setup: () => ({ args }),
		template: `
			<div style="padding: 80px; display: flex; justify-content: center;">
				<Tooltip v-bind="args">
					<button style="padding: 8px 16px; border: 1px solid #555; background: transparent; color: inherit; font-family: inherit; cursor: help;">
						Hover me
					</button>
					<template #content>This is a tooltip body.</template>
				</Tooltip>
			</div>
		`,
	}),
}
export default meta

type Story = StoryObj<typeof Tooltip>

export const Default: Story = {}
export const Top: Story = { args: { side: "top" } }
export const Right: Story = { args: { side: "right" } }
export const Left: Story = { args: { side: "left" } }
export const StartPosition: Story = { args: { position: "start" } }
export const EndPosition: Story = { args: { position: "end" } }
export const Disabled: Story = { args: { disabled: true } }
export const Delayed: Story = { args: { delay: 500 } }
