import type { Meta, StoryObj } from "@storybook/vue3-vite"
import LoadingState from "./LoadingState.vue"

const meta: Meta<typeof LoadingState> = {
	title: "UI / LoadingState",
	component: LoadingState,
	tags: ["autodocs"],
	argTypes: {
		label: { control: "text" },
		sub: { control: "text" },
	},
	args: { label: "Loading…" },
	render: (args) => ({
		components: { LoadingState },
		setup: () => ({ args }),
		template: '<div style="padding: 24px; width: 360px;"><LoadingState v-bind="args" /></div>',
	}),
}
export default meta

type Story = StoryObj<typeof LoadingState>

export const Default: Story = {}
export const WithSub: Story = { args: { label: "Fetching balances", sub: "This may take a moment" } }
export const ImportingProfile: Story = { args: { label: "Importing profile", sub: "Re-encrypting accounts under new password" } }
