import type { Meta, StoryObj } from "@storybook/vue3-vite"
import Spinner from "./Spinner.vue"

const meta: Meta<typeof Spinner> = {
	title: "UI / Spinner",
	component: Spinner,
	tags: ["autodocs"],
	argTypes: {
		size: { control: "text" },
		color: { control: "text" },
	},
	args: { size: "16", color: "--txt-primary" },
	render: (args) => ({
		components: { Spinner },
		setup: () => ({ args }),
		template: '<div style="padding: 24px;"><Spinner v-bind="args" /></div>',
	}),
}
export default meta

type Story = StoryObj<typeof Spinner>

export const Default: Story = {}
export const Small: Story = { args: { size: "12" } }
export const Large: Story = { args: { size: "32" } }
export const Accent: Story = { args: { color: "--nulo-accent" } }
export const Inverted: Story = { args: { color: "--txt-inverse" } }
export const CurrentColor: Story = {
	args: { color: "currentColor" },
	render: (args) => ({
		components: { Spinner },
		setup: () => ({ args }),
		template: '<div style="padding: 24px; color: hotpink;"><Spinner v-bind="args" /></div>',
	}),
}

export const SizeMatrix: Story = {
	render: () => ({
		components: { Spinner },
		template: `
			<div style="display: flex; align-items: center; gap: 24px; padding: 24px;">
				<Spinner size="12" />
				<Spinner size="16" />
				<Spinner size="24" />
				<Spinner size="32" />
				<Spinner size="48" />
			</div>
		`,
	}),
}
