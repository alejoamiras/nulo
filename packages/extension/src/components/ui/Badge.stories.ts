import type { Meta, StoryObj } from "@storybook/vue3-vite"
import { Badge } from "@nulo/design"

const meta: Meta<typeof Badge> = {
	title: "UI / Badge",
	component: Badge,
	tags: ["autodocs"],
	argTypes: {
		variant: { control: "select", options: ["info", "warning", "error", "purple"] },
	},
	args: { variant: "info" },
	render: (args) => ({
		components: { Badge },
		setup: () => ({ args }),
		template: '<div style="padding: 24px;"><Badge v-bind="args">badge content</Badge></div>',
	}),
}
export default meta

type Story = StoryObj<typeof Badge>

export const Info: Story = { args: { variant: "info" } }
export const Warning: Story = { args: { variant: "warning" } }
export const ErrorState: Story = { args: { variant: "error" } }
export const Purple: Story = { args: { variant: "purple" } }

export const VariantMatrix: Story = {
	render: () => ({
		components: { Badge },
		template: `
			<div style="display: flex; gap: 12px; padding: 24px;">
				<Badge variant="info">info</Badge>
				<Badge variant="warning">warning</Badge>
				<Badge variant="error">error</Badge>
				<Badge variant="purple">purple</Badge>
			</div>
		`,
	}),
}
