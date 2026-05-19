import type { Meta, StoryObj } from "@storybook/vue3-vite"
import AmountCard from "./AmountCard.vue"

const meta: Meta<typeof AmountCard> = {
	title: "Composite / AmountCard",
	component: AmountCard,
	tags: ["autodocs"],
	args: {
		token: { symbol: "USDC" },
		tokenBalanceByType: 1000,
		selectedSendType: "private",
		modelValue: "",
	},
	render: (args) => ({
		components: { AmountCard },
		setup: () => ({ args }),
		template: '<div style="padding: 24px; width: 360px;"><AmountCard v-bind="args" /></div>',
	}),
}
export default meta

type Story = StoryObj<typeof AmountCard>

export const Default: Story = {}
export const WithValue: Story = { args: { modelValue: "12.5" } }
export const NoBalance: Story = { args: { tokenBalanceByType: 0 } }
export const PublicSend: Story = { args: { selectedSendType: "public" } }
